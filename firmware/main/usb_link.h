// USB device: one vendor interface (WebUSB / WinUSB) carrying JSON lines.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Called from the TinyUSB task with received bytes; copy them, don't block. */
typedef void (*usb_link_rx_cb_t)(const uint8_t *data, size_t len);

/** Installs TinyUSB with our descriptors. `serial` must stay valid. */
esp_err_t usb_link_start(usb_link_rx_cb_t on_rx, const char *serial);

/** True while the host has configured the device. */
bool usb_link_mounted(void);

/** Queues and flushes bytes on the vendor IN endpoint. Thread-safe. Returns bytes accepted. */
size_t usb_link_write(const char *data, size_t len);

#ifdef __cplusplus
}
#endif
