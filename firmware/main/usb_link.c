#include "usb_link.h"

#include <string.h>

#include "usb_ids.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "tinyusb.h"
#include "tinyusb_default_config.h"

static const char *TAG = "usb";

enum { ITF_NUM_VENDOR = 0, ITF_NUM_TOTAL };
enum { VENDOR_REQUEST_WEBUSB = 1, VENDOR_REQUEST_MICROSOFT = 2 };

#define EPNUM_VENDOR_OUT 0x01
#define EPNUM_VENDOR_IN 0x81
#define CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_VENDOR_DESC_LEN)

static const tusb_desc_device_t s_device = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0210,  // >= 2.1 for the BOS descriptor (WebUSB, MS OS 2.0)
    .bDeviceClass = 0x00,
    .bDeviceSubClass = 0x00,
    .bDeviceProtocol = 0x00,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = TT_USB_VID,
    .idProduct = TT_USB_PID,
    .bcdDevice = 0x0100,
    .iManufacturer = 1,
    .iProduct = 2,
    .iSerialNumber = 3,
    .bNumConfigurations = 1,
};

static const uint8_t s_config[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0x00, 500),
    TUD_VENDOR_DESCRIPTOR(ITF_NUM_VENDOR, 4, EPNUM_VENDOR_OUT, EPNUM_VENDOR_IN, 64),
};

// ---- BOS: WebUSB platform capability + Microsoft OS 2.0 (WinUSB without driver install) ----

#define BOS_TOTAL_LEN (TUD_BOS_DESC_LEN + TUD_BOS_WEBUSB_DESC_LEN + TUD_BOS_MICROSOFT_OS_DESC_LEN)

// Whole device (single interface): set header, compatible ID, registry property.
#define MS_OS_20_DESC_LEN 0xA2

static const uint8_t s_bos[] = {
    TUD_BOS_DESCRIPTOR(BOS_TOTAL_LEN, 2),
    TUD_BOS_WEBUSB_DESCRIPTOR(VENDOR_REQUEST_WEBUSB, 0),  // no landing page
    TUD_BOS_MS_OS_20_DESCRIPTOR(MS_OS_20_DESC_LEN, VENDOR_REQUEST_MICROSOFT),
};

static const uint8_t s_ms_os_20[] = {
    // Set header: length, type, Windows version, total length
    U16_TO_U8S_LE(0x000A), U16_TO_U8S_LE(MS_OS_20_SET_HEADER_DESCRIPTOR), U32_TO_U8S_LE(0x06030000),
    U16_TO_U8S_LE(MS_OS_20_DESC_LEN),
    // Compatible ID: WINUSB
    U16_TO_U8S_LE(0x0014), U16_TO_U8S_LE(MS_OS_20_FEATURE_COMPATBLE_ID), 'W', 'I', 'N', 'U', 'S', 'B', 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // Registry property: DeviceInterfaceGUIDs (REG_MULTI_SZ)
    U16_TO_U8S_LE(MS_OS_20_DESC_LEN - 0x0A - 0x14), U16_TO_U8S_LE(MS_OS_20_FEATURE_REG_PROPERTY),
    U16_TO_U8S_LE(0x0007), U16_TO_U8S_LE(0x002A),
    'D', 0, 'e', 0, 'v', 0, 'i', 0, 'c', 0, 'e', 0, 'I', 0, 'n', 0, 't', 0, 'e', 0, 'r', 0, 'f', 0, 'a', 0, 'c', 0, 'e', 0,
    'G', 0, 'U', 0, 'I', 0, 'D', 0, 's', 0, 0, 0,
    U16_TO_U8S_LE(0x0050),
    // {6D1F3A54-2B8E-4C61-9A47-1E0C5B7D3F20}, generated for TimeToddler
    '{', 0, '6', 0, 'D', 0, '1', 0, 'F', 0, '3', 0, 'A', 0, '5', 0, '4', 0, '-', 0, '2', 0, 'B', 0, '8', 0, 'E', 0, '-', 0,
    '4', 0, 'C', 0, '6', 0, '1', 0, '-', 0, '9', 0, 'A', 0, '4', 0, '7', 0, '-', 0, '1', 0, 'E', 0, '0', 0, 'C', 0, '5', 0,
    'B', 0, '7', 0, 'D', 0, '3', 0, 'F', 0, '2', 0, '0', 0, '}', 0, 0, 0, 0, 0,
};

_Static_assert(sizeof(s_ms_os_20) == MS_OS_20_DESC_LEN, "MS OS 2.0 descriptor length");

const uint8_t *tud_descriptor_bos_cb(void) {
    return s_bos;
}

bool tud_vendor_control_xfer_cb(uint8_t rhport, uint8_t stage, const tusb_control_request_t *request) {
    if (stage != CONTROL_STAGE_SETUP) return true;
    if (request->bmRequestType_bit.type == TUSB_REQ_TYPE_VENDOR && request->bRequest == VENDOR_REQUEST_MICROSOFT &&
        request->wIndex == 7) {
        return tud_control_xfer(rhport, request, (void *)(uintptr_t)s_ms_os_20, sizeof(s_ms_os_20));
    }
    return false;  // stall everything else (no WebUSB landing page)
}

// ---- data ----

static usb_link_rx_cb_t s_on_rx;
static SemaphoreHandle_t s_tx_lock;

// TinyUSB changed the size type; follow whichever version the component manager resolved.
#if CFG_TUD_API_V0_19_COMPAT
void tud_vendor_rx_cb(uint8_t idx, const uint8_t *buffer, uint16_t bufsize) {
#else
void tud_vendor_rx_cb(uint8_t idx, const uint8_t *buffer, uint32_t bufsize) {
#endif
    (void)idx;
    if (buffer && bufsize) {  // unbuffered mode
        if (s_on_rx) s_on_rx(buffer, bufsize);
        return;
    }
    uint8_t buf[64];
    uint32_t n;
    while ((n = tud_vendor_read(buf, sizeof(buf))) > 0) {
        if (s_on_rx) s_on_rx(buf, n);
    }
}

bool usb_link_mounted(void) {
    return tud_mounted() && tud_vendor_mounted();
}

size_t usb_link_write(const char *data, size_t len) {
    if (!usb_link_mounted()) return 0;
    xSemaphoreTake(s_tx_lock, portMAX_DELAY);
    size_t done = 0;
    // A line is at most 512 bytes and the TX FIFO 512: wait briefly for room instead of dropping half a line.
    for (int tries = 0; done < len && tries < 50; ++tries) {
        uint32_t room = tud_vendor_write_available();
        if (room == 0) {
            tud_vendor_write_flush();
            vTaskDelay(pdMS_TO_TICKS(2));
            continue;
        }
        uint32_t chunk = (len - done) < room ? (len - done) : room;
        done += tud_vendor_write(data + done, chunk);
    }
    tud_vendor_write_flush();
    xSemaphoreGive(s_tx_lock);
    return done;
}

esp_err_t usb_link_start(usb_link_rx_cb_t on_rx, const char *serial) {
    s_on_rx = on_rx;
    s_tx_lock = xSemaphoreCreateMutex();
    if (!s_tx_lock) return ESP_ERR_NO_MEM;

    static const char *strings[5];
    static const char lang[] = {0x09, 0x04};  // English (US)
    strings[0] = lang;
    strings[1] = "TimeToddler";
    strings[2] = "TimeToddler Knob";
    strings[3] = serial;
    strings[4] = "TimeToddler Knob";

    tinyusb_config_t cfg = TINYUSB_DEFAULT_CONFIG();
    cfg.descriptor.device = &s_device;
    cfg.descriptor.full_speed_config = s_config;
    cfg.descriptor.string = strings;
    cfg.descriptor.string_count = sizeof(strings) / sizeof(strings[0]);
    esp_err_t err = tinyusb_driver_install(&cfg);
    if (err == ESP_OK) ESP_LOGI(TAG, "USB %04x:%04x serial %s", TT_USB_VID, TT_USB_PID, serial);
    return err;
}
