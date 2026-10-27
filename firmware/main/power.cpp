#include "power.h"

#include "board.h"
#include "driver/ledc.h"
#include "esp_check.h"

namespace power {

namespace {
constexpr ledc_timer_t kTimer = LEDC_TIMER_0;
constexpr ledc_channel_t kChannel = LEDC_CHANNEL_0;
constexpr ledc_timer_bit_t kResolution = LEDC_TIMER_10_BIT;
}  // namespace

void init() {
    gpio_config_t out = {};
    out.pin_bit_mask = (1ULL << board::kPower3v3) | (1ULL << board::kPower5v) | (1ULL << board::kLedRingPower) |
                       (1ULL << board::kPowerLed);
    out.mode = GPIO_MODE_OUTPUT;
    ESP_ERROR_CHECK(gpio_config(&out));
    gpio_set_level(board::kPower3v3, 1);
    gpio_set_level(board::kPower5v, 1);
    gpio_set_level(board::kLedRingPower, 1);
    gpio_set_level(board::kPowerLed, 1);  // off: the LED ring shows the state

    ledc_timer_config_t timer = {};
    timer.speed_mode = LEDC_LOW_SPEED_MODE;
    timer.duty_resolution = kResolution;
    timer.timer_num = kTimer;
    timer.freq_hz = 5000;
    timer.clk_cfg = LEDC_AUTO_CLK;
    ESP_ERROR_CHECK(ledc_timer_config(&timer));
    ledc_channel_config_t ch = {};
    ch.gpio_num = board::kLcdBacklight;
    ch.speed_mode = LEDC_LOW_SPEED_MODE;
    ch.channel = kChannel;
    ch.timer_sel = kTimer;
    ch.duty = 0;
    ESP_ERROR_CHECK(ledc_channel_config(&ch));
}

void set_backlight(int percent) {
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    const uint32_t max = (1u << kResolution) - 1;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, kChannel, max * uint32_t(percent) / 100u);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, kChannel);
}

}  // namespace power
