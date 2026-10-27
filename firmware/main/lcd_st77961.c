#include "lcd_st77961.h"

#include <stdlib.h>
#include <sys/cdefs.h>

#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_lcd_panel_commands.h"
#include "esp_lcd_panel_interface.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "st77961";

typedef struct {
    esp_lcd_panel_t base;
    esp_lcd_panel_io_handle_t io;
    int reset_gpio;
    int x_gap;
    int y_gap;
    uint8_t madctl;
} st77961_t;

typedef struct {
    uint8_t cmd;
    uint8_t len;
    uint8_t data[12];
    uint16_t delay_ms;
} init_cmd_t;

// Vendor init sequence from Elecrow's ESPHome example for this panel; ends with COLMOD 16 bit, SLPOUT, DISPON.
static const init_cmd_t kInit[] = {
    {0xDE, 1, {0x00}, 0},
    {0xDF, 2, {0x98, 0x55}, 0},
    {0xB2, 1, {0x1F}, 0},
    {0xB7, 4, {0x00, 0x1D, 0x00, 0x45}, 0},
    {0xBB, 6, {0x1B, 0x64, 0xC4, 0x1E, 0x3E, 0xF5}, 0},
    {0xBC, 4, {0x03, 0x20, 0xF3, 0xC0}, 0},
    {0xC0, 2, {0x22, 0xA1}, 0},
    {0xC3, 11, {0x00, 0x02, 0x2A, 0x0B, 0x08, 0x48, 0x08, 0x04, 0x62, 0x30, 0x30}, 0},
    {0xC4, 11, {0x40, 0x00, 0xAD, 0x68, 0x43, 0x07, 0x04, 0x16, 0x43, 0x07, 0x04}, 0},
    {0xD3, 2, {0x28, 0x13}, 0},
    {0xD9, 6, {0x00, 0x00, 0xFF, 0x00, 0xF0, 0x00}, 0},
    {0xDE, 1, {0x01}, 0},
    {0xB7, 8, {0x13, 0xE7, 0x64, 0x39, 0x06, 0x36, 0x19, 0x1C}, 0},
    {0xBE, 1, {0x00}, 0},
    {0xC1, 3, {0x00, 0x4A, 0x80}, 0},
    {0xC2, 4, {0x00, 0x16, 0xDA, 0xE7}, 0},
    {0xC7, 8, {0x00, 0x00, 0x00, 0x38, 0x08, 0x08, 0x00, 0x01}, 0},
    {0xC8, 6, {0x00, 0x00, 0x00, 0x00, 0x15, 0x3B}, 0},
    {0xC9, 5, {0x00, 0x16, 0x06, 0x04, 0x0A}, 0},
    {0xCA, 5, {0x08, 0x35, 0x16, 0x1F, 0x1F}, 0},
    {0xCB, 5, {0x01, 0x16, 0x07, 0x05, 0x0B}, 0},
    {0xCC, 5, {0x09, 0x35, 0x16, 0x1F, 0x1F}, 0},
    {0xCD, 5, {0x01, 0x16, 0x09, 0x0B, 0x05}, 0},
    {0xCE, 5, {0x07, 0x15, 0x1F, 0x16, 0x1F}, 0},
    {0xCF, 5, {0x00, 0x16, 0x08, 0x0A, 0x04}, 0},
    {0xD0, 5, {0x06, 0x15, 0x1F, 0x16, 0x1F}, 0},
    {0xD1, 2, {0x02, 0x30}, 0},
    {0xD2, 5, {0x02, 0x03, 0x52, 0xDF, 0xDD}, 0},
    {0xD3, 3, {0x3B, 0x04, 0x48}, 0},
    {0xD5, 7, {0x10, 0x10, 0x07, 0x07, 0x0F, 0x94, 0x26}, 0},
    {0xD6, 3, {0x00, 0x00, 0x40}, 0},
    {0xD7, 3, {0x00, 0x00, 0x20}, 0},
    {0xDE, 1, {0x02}, 0},
    {0xB6, 1, {0x1C}, 0},
    {0xDE, 1, {0x00}, 0},
    {0x4D, 1, {0x00}, 0},
    {0x4E, 1, {0x00}, 0},
    {0x4F, 1, {0x00}, 0},
    {0x4C, 1, {0x01}, 0},
    {0x4C, 1, {0x00}, 0},
    {LCD_CMD_TEON, 0, {0}, 0},
    {LCD_CMD_COLMOD, 1, {0x05}, 0},  // RGB565
    {LCD_CMD_SLPOUT, 0, {0}, 120},
    {LCD_CMD_DISPON, 0, {0}, 20},
};

static esp_err_t tx(st77961_t *p, uint8_t cmd, const void *data, size_t len) {
    return esp_lcd_panel_io_tx_param(p->io, cmd, data, len);
}

static esp_err_t panel_reset(esp_lcd_panel_t *panel) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    if (p->reset_gpio >= 0) {
        gpio_set_level(p->reset_gpio, 0);
        vTaskDelay(pdMS_TO_TICKS(10));
        gpio_set_level(p->reset_gpio, 1);
        vTaskDelay(pdMS_TO_TICKS(120));
    } else {
        ESP_RETURN_ON_ERROR(tx(p, LCD_CMD_SWRESET, NULL, 0), TAG, "swreset");
        vTaskDelay(pdMS_TO_TICKS(120));
    }
    return ESP_OK;
}

static esp_err_t panel_init(esp_lcd_panel_t *panel) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    ESP_RETURN_ON_ERROR(tx(p, LCD_CMD_MADCTL, &p->madctl, 1), TAG, "madctl");
    for (size_t i = 0; i < sizeof(kInit) / sizeof(kInit[0]); ++i) {
        ESP_RETURN_ON_ERROR(tx(p, kInit[i].cmd, kInit[i].data, kInit[i].len), TAG, "init cmd 0x%02x", kInit[i].cmd);
        if (kInit[i].delay_ms) vTaskDelay(pdMS_TO_TICKS(kInit[i].delay_ms));
    }
    return ESP_OK;
}

static esp_err_t panel_del(esp_lcd_panel_t *panel) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    if (p->reset_gpio >= 0) gpio_reset_pin(p->reset_gpio);
    free(p);
    return ESP_OK;
}

static esp_err_t panel_draw_bitmap(esp_lcd_panel_t *panel, int x0, int y0, int x1, int y1, const void *color) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    x0 += p->x_gap;
    x1 += p->x_gap;
    y0 += p->y_gap;
    y1 += p->y_gap;
    const uint8_t caset[] = {(uint8_t)(x0 >> 8), (uint8_t)x0, (uint8_t)((x1 - 1) >> 8), (uint8_t)(x1 - 1)};
    const uint8_t raset[] = {(uint8_t)(y0 >> 8), (uint8_t)y0, (uint8_t)((y1 - 1) >> 8), (uint8_t)(y1 - 1)};
    ESP_RETURN_ON_ERROR(tx(p, LCD_CMD_CASET, caset, 4), TAG, "caset");
    ESP_RETURN_ON_ERROR(tx(p, LCD_CMD_RASET, raset, 4), TAG, "raset");
    size_t len = (size_t)(x1 - x0) * (size_t)(y1 - y0) * 2;
    return esp_lcd_panel_io_tx_color(p->io, LCD_CMD_RAMWR, color, len);
}

static esp_err_t panel_mirror(esp_lcd_panel_t *panel, bool mx, bool my) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    p->madctl = (p->madctl & ~(LCD_CMD_MX_BIT | LCD_CMD_MY_BIT)) | (mx ? LCD_CMD_MX_BIT : 0) | (my ? LCD_CMD_MY_BIT : 0);
    return tx(p, LCD_CMD_MADCTL, &p->madctl, 1);
}

static esp_err_t panel_swap_xy(esp_lcd_panel_t *panel, bool swap) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    p->madctl = (p->madctl & ~LCD_CMD_MV_BIT) | (swap ? LCD_CMD_MV_BIT : 0);
    return tx(p, LCD_CMD_MADCTL, &p->madctl, 1);
}

static esp_err_t panel_set_gap(esp_lcd_panel_t *panel, int x, int y) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    p->x_gap = x;
    p->y_gap = y;
    return ESP_OK;
}

static esp_err_t panel_invert(esp_lcd_panel_t *panel, bool invert) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    return tx(p, invert ? LCD_CMD_INVON : LCD_CMD_INVOFF, NULL, 0);
}

static esp_err_t panel_on_off(esp_lcd_panel_t *panel, bool on) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    return tx(p, on ? LCD_CMD_DISPON : LCD_CMD_DISPOFF, NULL, 0);
}

static esp_err_t panel_sleep(esp_lcd_panel_t *panel, bool sleep) {
    st77961_t *p = __containerof(panel, st77961_t, base);
    esp_err_t err = tx(p, sleep ? LCD_CMD_SLPIN : LCD_CMD_SLPOUT, NULL, 0);
    vTaskDelay(pdMS_TO_TICKS(120));
    return err;
}

esp_err_t lcd_st77961_new(esp_lcd_panel_io_handle_t io, int reset_gpio, esp_lcd_panel_handle_t *out) {
    ESP_RETURN_ON_FALSE(io && out, ESP_ERR_INVALID_ARG, TAG, "invalid argument");
    st77961_t *p = calloc(1, sizeof(st77961_t));
    ESP_RETURN_ON_FALSE(p, ESP_ERR_NO_MEM, TAG, "no memory");
    if (reset_gpio >= 0) {
        const gpio_config_t cfg = {.pin_bit_mask = 1ULL << reset_gpio, .mode = GPIO_MODE_OUTPUT};
        esp_err_t err = gpio_config(&cfg);
        if (err != ESP_OK) {
            free(p);
            return err;
        }
    }
    p->io = io;
    p->reset_gpio = reset_gpio;
    p->madctl = 0x00;  // RGB order, no mirroring (Elecrow example)
    p->base.reset = panel_reset;
    p->base.init = panel_init;
    p->base.del = panel_del;
    p->base.draw_bitmap = panel_draw_bitmap;
    p->base.mirror = panel_mirror;
    p->base.swap_xy = panel_swap_xy;
    p->base.set_gap = panel_set_gap;
    p->base.invert_color = panel_invert;
    p->base.disp_on_off = panel_on_off;
    p->base.disp_sleep = panel_sleep;
    *out = &p->base;
    return ESP_OK;
}
