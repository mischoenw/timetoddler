// esp_lcd panel driver for the ST77961 on the CrowPanel 1.46" (360x360, RGB565, 4-wire SPI).
#pragma once

#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Creates the panel on an existing panel IO. `reset_gpio` < 0 means no hardware reset line. */
esp_err_t lcd_st77961_new(esp_lcd_panel_io_handle_t io, int reset_gpio, esp_lcd_panel_handle_t *out);

#ifdef __cplusplus
}
#endif
