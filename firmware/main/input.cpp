#include "input.h"

#include <cstdlib>

#include "board.h"
#include "button.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/pulse_cnt.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

namespace input {
namespace {

const char *TAG = "input";
constexpr int kPollMs = 5;
constexpr int kRotateReportMs = 20;  // coalesce encoder steps (protocol: at most 20 ms)
constexpr int kPcntLimit = 1000;

// CST816 registers
constexpr uint8_t kRegFingerNum = 0x02;
constexpr uint8_t kRegXposH = 0x03;
constexpr uint8_t kRegDisAutoSleep = 0xFE;
constexpr int64_t kTapMaxMs = 500;
constexpr int kTapMaxMove = 30;

QueueHandle_t s_queue;
pcnt_unit_handle_t s_pcnt;
i2c_master_dev_handle_t s_touch;

void post(Kind kind, int count = 0) {
    Event e{kind, count};
    xQueueSend(s_queue, &e, 0);
}

void init_encoder() {
    pcnt_unit_config_t unit = {};
    unit.low_limit = -kPcntLimit;
    unit.high_limit = kPcntLimit;
    ESP_ERROR_CHECK(pcnt_new_unit(&unit, &s_pcnt));
    pcnt_glitch_filter_config_t filter = {};
    filter.max_glitch_ns = 1000;
    ESP_ERROR_CHECK(pcnt_unit_set_glitch_filter(s_pcnt, &filter));

    // Full quadrature decoding (x4), as in the ESP-IDF rotary encoder example.
    pcnt_chan_config_t a = {};
    a.edge_gpio_num = board::kEncA;
    a.level_gpio_num = board::kEncB;
    pcnt_channel_handle_t ch_a;
    ESP_ERROR_CHECK(pcnt_new_channel(s_pcnt, &a, &ch_a));
    pcnt_chan_config_t b = {};
    b.edge_gpio_num = board::kEncB;
    b.level_gpio_num = board::kEncA;
    pcnt_channel_handle_t ch_b;
    ESP_ERROR_CHECK(pcnt_new_channel(s_pcnt, &b, &ch_b));
    ESP_ERROR_CHECK(pcnt_channel_set_edge_action(ch_a, PCNT_CHANNEL_EDGE_ACTION_DECREASE, PCNT_CHANNEL_EDGE_ACTION_INCREASE));
    ESP_ERROR_CHECK(pcnt_channel_set_level_action(ch_a, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE));
    ESP_ERROR_CHECK(pcnt_channel_set_edge_action(ch_b, PCNT_CHANNEL_EDGE_ACTION_INCREASE, PCNT_CHANNEL_EDGE_ACTION_DECREASE));
    ESP_ERROR_CHECK(pcnt_channel_set_level_action(ch_b, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE));
    // Mechanical encoder without external pull-ups.
    gpio_set_pull_mode(board::kEncA, GPIO_PULLUP_ONLY);
    gpio_set_pull_mode(board::kEncB, GPIO_PULLUP_ONLY);

    ESP_ERROR_CHECK(pcnt_unit_enable(s_pcnt));
    ESP_ERROR_CHECK(pcnt_unit_clear_count(s_pcnt));
    ESP_ERROR_CHECK(pcnt_unit_start(s_pcnt));
}

void init_switch() {
    gpio_config_t cfg = {};
    cfg.pin_bit_mask = 1ULL << board::kEncSwitch;
    cfg.mode = GPIO_MODE_INPUT;
    cfg.pull_up_en = GPIO_PULLUP_ENABLE;
    ESP_ERROR_CHECK(gpio_config(&cfg));
}

bool touch_read(uint8_t reg, uint8_t *out, size_t len) {
    return s_touch && i2c_master_transmit_receive(s_touch, &reg, 1, out, len, 20) == ESP_OK;
}

void init_touch() {
    gpio_config_t rst = {};
    rst.pin_bit_mask = 1ULL << board::kTouchRst;
    rst.mode = GPIO_MODE_OUTPUT;
    ESP_ERROR_CHECK(gpio_config(&rst));
    gpio_set_level(board::kTouchRst, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(board::kTouchRst, 1);
    vTaskDelay(pdMS_TO_TICKS(60));

    gpio_config_t irq = {};
    irq.pin_bit_mask = 1ULL << board::kTouchInt;
    irq.mode = GPIO_MODE_INPUT;
    irq.pull_up_en = GPIO_PULLUP_ENABLE;
    ESP_ERROR_CHECK(gpio_config(&irq));

    i2c_master_bus_config_t bus = {};
    bus.i2c_port = I2C_NUM_0;
    bus.sda_io_num = board::kTouchSda;
    bus.scl_io_num = board::kTouchScl;
    bus.clk_source = I2C_CLK_SRC_DEFAULT;
    bus.glitch_ignore_cnt = 7;
    bus.flags.enable_internal_pullup = true;
    i2c_master_bus_handle_t bus_handle;
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus, &bus_handle));
    i2c_device_config_t dev = {};
    dev.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    dev.device_address = board::kTouchAddr;
    dev.scl_speed_hz = 400000;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus_handle, &dev, &s_touch));

    // Keep the controller awake so a tap is never lost to its wake-up.
    const uint8_t no_sleep[] = {kRegDisAutoSleep, 0x01};
    if (i2c_master_transmit(s_touch, no_sleep, sizeof(no_sleep), 20) != ESP_OK) {
        ESP_LOGW(TAG, "touch controller not responding");
    }
}

struct TapDetector {
    bool down = false;
    int64_t since = 0;
    int x0 = 0, y0 = 0;
    bool moved = false;

    void update(int64_t now_ms) {
        // INT is low while a touch is reported; only then talk to the controller.
        if (!down && gpio_get_level(board::kTouchInt) != 0) return;
        uint8_t fingers = 0;
        uint8_t xy[4];
        if (!touch_read(kRegFingerNum, &fingers, 1)) return;
        if (fingers > 0 && touch_read(kRegXposH, xy, 4)) {
            int x = ((xy[0] & 0x0F) << 8) | xy[1];
            int y = ((xy[2] & 0x0F) << 8) | xy[3];
            if (!down) {
                down = true;
                since = now_ms;
                x0 = x;
                y0 = y;
                moved = false;
            } else if (std::abs(x - x0) > kTapMaxMove || std::abs(y - y0) > kTapMaxMove) {
                moved = true;
            }
        } else if (fingers == 0 && down) {
            down = false;
            if (!moved && now_ms - since <= kTapMaxMs) post(Kind::Tap);
        }
    }
};

void task(void *) {
    button::Debouncer debounce;
    button::Clicks clicks;
    TapDetector tap;
    int last = 0;
    int pending = 0;
    int64_t last_report = 0;
    for (;;) {
        const int64_t now = esp_timer_get_time() / 1000;

        int count = 0;
        pcnt_unit_get_count(s_pcnt, &count);
        pending += count - last;
        last = count;
        if (std::abs(count) > kPcntLimit / 2) {  // stay away from the hardware limits
            pcnt_unit_clear_count(s_pcnt);
            last = 0;
        }
        if (pending != 0 && now - last_report >= kRotateReportMs) {
            post(Kind::Rotate, pending);
            pending = 0;
            last_report = now;
        }

        const bool pressed = debounce.update(gpio_get_level(board::kEncSwitch) == 0, uint32_t(now));
        switch (clicks.update(pressed, uint32_t(now))) {
            case button::Event::Short: post(Kind::Short); break;
            case button::Event::Long: post(Kind::Long); break;
            case button::Event::Double: post(Kind::Double); break;
            case button::Event::None: break;
        }

        tap.update(now);
        vTaskDelay(pdMS_TO_TICKS(kPollMs));
    }
}

}  // namespace

void *start() {
    s_queue = xQueueCreate(32, sizeof(Event));
    init_encoder();
    init_switch();
    init_touch();
    xTaskCreate(task, "input", 4096, nullptr, 6, nullptr);
    return s_queue;
}

}  // namespace input
