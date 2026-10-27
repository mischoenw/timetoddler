// Elecrow CrowPanel 1.46" HMI ESP32-S3 Rotary Display (schematic "ESP32 Display-1.46-V1.0").
#pragma once

#include "driver/gpio.h"
#include "usb_ids.h"

namespace board {

// Power rails and indicators
constexpr gpio_num_t kPower3v3 = GPIO_NUM_1;      // high = on
constexpr gpio_num_t kPower5v = GPIO_NUM_2;       // high = on
constexpr gpio_num_t kLedRingPower = GPIO_NUM_17; // high = on
constexpr gpio_num_t kPowerLed = GPIO_NUM_40;     // active low

// Display: ST77961, 360x360, SPI
constexpr gpio_num_t kLcdSclk = GPIO_NUM_10;
constexpr gpio_num_t kLcdMosi = GPIO_NUM_11;
constexpr gpio_num_t kLcdDc = GPIO_NUM_3;
constexpr gpio_num_t kLcdCs = GPIO_NUM_9;
constexpr gpio_num_t kLcdRst = GPIO_NUM_14;
constexpr gpio_num_t kLcdBacklight = GPIO_NUM_46;
constexpr int kLcdSize = 360;
constexpr int kLcdSpiHz = 40 * 1000 * 1000;  // SCLK is routed through the GPIO matrix

// Touch: CST816, I2C
constexpr gpio_num_t kTouchSda = GPIO_NUM_6;
constexpr gpio_num_t kTouchScl = GPIO_NUM_7;
constexpr gpio_num_t kTouchInt = GPIO_NUM_5;
constexpr gpio_num_t kTouchRst = GPIO_NUM_13;
constexpr uint8_t kTouchAddr = 0x15;

// Rotary encoder and its push switch (active low)
constexpr gpio_num_t kEncA = GPIO_NUM_45;
constexpr gpio_num_t kEncB = GPIO_NUM_42;
constexpr gpio_num_t kEncSwitch = GPIO_NUM_41;

// LED ring: 8x WS2812 (GRB)
constexpr gpio_num_t kLedRing = GPIO_NUM_48;
constexpr int kLedCount = 8;

}  // namespace board
