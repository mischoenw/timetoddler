// TimeToddler knob: forwards encoder, button and tap to the app over USB and shows the state the app sends.
#include <cstring>

#include "board.h"
#include "driver/spi_master.h"
#include "esp_app_desc.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/stream_buffer.h"
#include "input.h"
#include "lcd_st77961.h"
#include "leds.h"
#include "power.h"
#include "protocol.h"
#include "ui.h"
#include "usb_link.h"

namespace {

const char *TAG = "main";
/** The app sends its state every 2 s; without anything for this long it counts as gone. */
constexpr int64_t kLinkTimeoutMs = 3000;

StreamBufferHandle_t s_rx;
char s_serial[13];

void on_usb_rx(const uint8_t *data, size_t len) {
    xStreamBufferSend(s_rx, data, len, 0);
}

int64_t now_ms() {
    return esp_timer_get_time() / 1000;
}

lv_display_t *init_display() {
    spi_bus_config_t bus = {};
    bus.sclk_io_num = board::kLcdSclk;
    bus.mosi_io_num = board::kLcdMosi;
    bus.miso_io_num = -1;
    bus.quadwp_io_num = -1;
    bus.quadhd_io_num = -1;
    bus.max_transfer_sz = board::kLcdSize * 40 * 2;
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_spi_config_t io_cfg = {};
    io_cfg.cs_gpio_num = board::kLcdCs;
    io_cfg.dc_gpio_num = board::kLcdDc;
    io_cfg.spi_mode = 0;
    io_cfg.pclk_hz = board::kLcdSpiHz;
    io_cfg.trans_queue_depth = 10;
    io_cfg.lcd_cmd_bits = 8;
    io_cfg.lcd_param_bits = 8;
    esp_lcd_panel_io_handle_t io;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_cfg, &io));

    esp_lcd_panel_handle_t panel;
    ESP_ERROR_CHECK(lcd_st77961_new(io, board::kLcdRst, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));

    const lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    ESP_ERROR_CHECK(lvgl_port_init(&port_cfg));
    lvgl_port_display_cfg_t disp_cfg = {};
    disp_cfg.io_handle = io;
    disp_cfg.panel_handle = panel;
    disp_cfg.buffer_size = board::kLcdSize * 40;
    disp_cfg.double_buffer = true;
    disp_cfg.hres = board::kLcdSize;
    disp_cfg.vres = board::kLcdSize;
    disp_cfg.color_format = LV_COLOR_FORMAT_RGB565;
    disp_cfg.flags.buff_dma = 1;
    disp_cfg.flags.swap_bytes = 1;  // the panel expects big-endian RGB565
    lv_display_t *disp = lvgl_port_add_disp(&disp_cfg);
    assert(disp);
    return disp;
}

void send_line(const char *buf, size_t n) {
    if (n) usb_link_write(buf, n);
}

void send_hello() {
    char buf[128];
    send_line(buf, proto::fmt_hello(buf, sizeof(buf), esp_app_get_description()->version, s_serial));
}

void send_input(const input::Event &e) {
    char buf[64];
    switch (e.kind) {
        case input::Kind::Rotate: send_line(buf, proto::fmt_rot(buf, sizeof(buf), e.count)); break;
        case input::Kind::Short: send_line(buf, proto::fmt_btn(buf, sizeof(buf), "short")); break;
        case input::Kind::Long: send_line(buf, proto::fmt_btn(buf, sizeof(buf), "long")); break;
        case input::Kind::Double: send_line(buf, proto::fmt_btn(buf, sizeof(buf), "double")); break;
        case input::Kind::Tap: send_line(buf, proto::fmt_tap(buf, sizeof(buf))); break;
    }
}

/** Collects bytes into lines; drops lines longer than the protocol allows. */
class LineBuffer {
public:
    template <typename OnLine>
    void push(const uint8_t *data, size_t len, OnLine on_line) {
        for (size_t i = 0; i < len; ++i) {
            const char c = char(data[i]);
            if (c == '\n') {
                if (!overflow_ && len_ > 0) on_line(buf_, len_);
                len_ = 0;
                overflow_ = false;
            } else if (c != '\r') {
                if (len_ < sizeof(buf_)) buf_[len_++] = c;
                else overflow_ = true;
            }
        }
    }

private:
    char buf_[proto::kMaxLine];
    size_t len_ = 0;
    bool overflow_ = false;
};

}  // namespace

extern "C" void app_main(void) {
    power::init();

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_EFUSE_FACTORY);
    snprintf(s_serial, sizeof(s_serial), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    s_rx = xStreamBufferCreate(2048, 1);
    ESP_ERROR_CHECK(usb_link_start(on_usb_rx, s_serial));

    lv_display_t *disp = init_display();
    if (lvgl_port_lock(0)) {
        ui::init(disp);
        lvgl_port_unlock();
    }
    power::set_backlight(80);
    leds::init();
    auto *events = static_cast<QueueHandle_t>(input::start());
    ESP_LOGI(TAG, "TimeToddler knob %s ready", esp_app_get_description()->version);

    LineBuffer lines;
    proto::State state;
    bool connected = false;
    int64_t last_rx = -kLinkTimeoutMs;
    int64_t last_tick = 0;
    bool was_mounted = false;

    for (;;) {
        uint8_t chunk[128];
        const size_t n = xStreamBufferReceive(s_rx, chunk, sizeof(chunk), pdMS_TO_TICKS(10));
        const int64_t now = now_ms();
        bool state_changed = false;

        lines.push(chunk, n, [&](const char *line, size_t len) {
            proto::HostMsg msg;
            if (!proto::parse_host_line(line, len, msg)) {
                ESP_LOGW(TAG, "ignored line (%u bytes)", unsigned(len));
                return;
            }
            last_rx = now;
            switch (msg.kind) {
                case proto::Kind::HelloQuery: send_hello(); break;
                case proto::Kind::State:
                    state = msg.state;
                    state_changed = true;
                    break;
                case proto::Kind::Cfg:
                    power::set_backlight(msg.cfg.brightness < 5 ? 5 : msg.cfg.brightness);
                    leds::set_brightness(msg.cfg.led);
                    break;
                case proto::Kind::None: break;
            }
        });

        const bool mounted = usb_link_mounted();
        if (mounted && !was_mounted) send_hello();
        was_mounted = mounted;

        const bool now_connected = mounted && now - last_rx < kLinkTimeoutMs;
        if (now_connected != connected) {
            connected = now_connected;
            state_changed = true;
        }

        // Inputs only mean something while the app is listening.
        input::Event e;
        while (xQueueReceive(events, &e, 0) == pdTRUE) {
            if (connected) send_input(e);
        }

        if (state_changed) {
            leds::show(state, connected);
            if (lvgl_port_lock(0)) {
                ui::show(state, connected, now);
                lvgl_port_unlock();
            }
            last_tick = now;
        } else if (now - last_tick >= 1000) {
            if (lvgl_port_lock(0)) {
                ui::tick(now);
                lvgl_port_unlock();
            }
            last_tick = now;
        }
    }
}
