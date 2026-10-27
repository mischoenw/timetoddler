#include "leds.h"

#include <cmath>

#include "board.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "led_strip.h"

namespace leds {
namespace {

const char *TAG = "leds";
constexpr uint32_t kPauseColor = 0xF58231;
constexpr uint32_t kDisconnectedColor = 0x2050FF;

led_strip_handle_t s_strip;
portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
proto::Mode s_mode = proto::Mode::Absent;
uint32_t s_color = 0;
uint16_t s_idx = 0;
uint16_t s_count = 0;
bool s_connected = false;
int s_brightness = 60;

void set(int i, uint32_t rgb, float level) {
    level = level < 0 ? 0 : level > 1 ? 1 : level;
    auto ch = [&](int shift) { return uint32_t(float((rgb >> shift) & 0xFF) * level); };
    led_strip_set_pixel(s_strip, i, ch(16), ch(8), ch(0));
}

/** 0..1 sine breathing with the given period. */
float breathe(int64_t now_ms, int period_ms, float lo) {
    float phase = float(now_ms % period_ms) / float(period_ms);
    return lo + (1.0f - lo) * (0.5f - 0.5f * cosf(phase * 2.0f * float(M_PI)));
}

void frame(int64_t now_ms) {
    proto::Mode mode;
    uint32_t color;
    uint16_t idx, count;
    bool connected;
    float scale;
    taskENTER_CRITICAL(&s_lock);
    mode = s_mode;
    color = s_color;
    idx = s_idx;
    count = s_count;
    connected = s_connected;
    scale = float(s_brightness) / 100.0f;
    taskEXIT_CRITICAL(&s_lock);

    for (int i = 0; i < board::kLedCount; ++i) {
        float level = 0;
        uint32_t c = color;
        if (!connected) {
            c = kDisconnectedColor;
            level = 0.15f * breathe(now_ms, 3000, 0.2f);
        } else {
            switch (mode) {
                case proto::Mode::Running: level = breathe(now_ms, 4000, 0.25f); break;
                case proto::Mode::Break: c = kPauseColor; level = breathe(now_ms, 4000, 0.25f); break;
                case proto::Mode::Idle: c = 0xFFFFFF; level = i == 0 ? 0.1f : 0; break;
                case proto::Mode::Absent: level = 0; break;
                case proto::Mode::Select: {
                    // Position of the selection on the ring.
                    int pos = count > 0 && idx > 0 ? (int(idx) - 1) * board::kLedCount / int(count) : 0;
                    level = i == pos ? 1.0f : 0.25f;
                    break;
                }
            }
        }
        set(i, c, level * scale);
    }
    led_strip_refresh(s_strip);
}

void task(void *) {
    for (;;) {
        frame(esp_timer_get_time() / 1000);
        vTaskDelay(pdMS_TO_TICKS(33));
    }
}

}  // namespace

void init() {
    led_strip_config_t cfg = {};
    cfg.strip_gpio_num = board::kLedRing;
    cfg.max_leds = board::kLedCount;
    cfg.led_model = LED_MODEL_WS2812;
    cfg.color_component_format.format.r_pos = 1;  // GRB
    cfg.color_component_format.format.g_pos = 0;
    cfg.color_component_format.format.b_pos = 2;
    cfg.color_component_format.format.w_pos = 3;
    cfg.color_component_format.format.bytes_per_color = 1;
    cfg.color_component_format.format.num_components = 3;
    led_strip_rmt_config_t rmt = {};
    rmt.clk_src = RMT_CLK_SRC_DEFAULT;
    rmt.resolution_hz = 10 * 1000 * 1000;
    ESP_ERROR_CHECK(led_strip_new_rmt_device(&cfg, &rmt, &s_strip));
    led_strip_clear(s_strip);
    xTaskCreate(task, "leds", 3072, nullptr, 3, nullptr);
    ESP_LOGI(TAG, "ring ready");
}

void show(const proto::State &state, bool connected) {
    taskENTER_CRITICAL(&s_lock);
    s_mode = state.mode;
    s_color = state.color;
    s_idx = state.idx;
    s_count = state.count;
    s_connected = connected;
    taskEXIT_CRITICAL(&s_lock);
}

void set_brightness(int percent) {
    taskENTER_CRITICAL(&s_lock);
    s_brightness = percent;
    taskEXIT_CRITICAL(&s_lock);
}

}  // namespace leds
