# TimeToddler Knob (Firmware)

ESP-IDF 6.1 firmware for the **Elecrow CrowPanel 1.46" HMI ESP32-S3 Rotary Display**. The knob sends rotation, presses and display taps to the desktop app over USB (WebUSB) and shows the state the app sends: activity, elapsed time, selection, net work time; the LED ring mirrors it.

Design: [`../docs/specs/2026-10-22-timetoddler-design.md`](../docs/specs/2026-10-22-timetoddler-design.md), plan: [`../docs/plans/2026-10-27-timetoddler-firmware.md`](../docs/plans/2026-10-27-timetoddler-firmware.md).

## Build and flash

```bash
. $IDF_PATH/export.sh          # ESP-IDF v6.1
cd firmware
idf.py set-target esp32s3
idf.py build
# USB port is TinyUSB at runtime: hold BOOT, tap RESET, release BOOT -> download mode
idf.py -p /dev/ttyACM0 flash
```

Logs go to **UART0** (ZX-MX 1.25 connector, 115200 baud), because the USB port belongs to the knob protocol.

Host tests for the protocol parser and the button logic (no ESP-IDF needed):

```bash
cmake -S test_host -B build-host && cmake --build build-host && ./build-host/tests
```

CI builds both on every push (`.github/workflows/firmware.yml`) and attaches `timetoddler-knob.bin` as artifact.

## Hardware notes

| Function | Pins |
|---|---|
| Display ST77961 (SPI, 40 MHz) | SCLK 10, MOSI 11, DC 3, CS 9, RST 14, backlight PWM 46 |
| Touch CST816 (I2C 0x15) | SDA 6, SCL 7, INT 5, RST 13 |
| Encoder / switch | A 45, B 42, switch 41 (active low) |
| LED ring 8x WS2812 | data 48, power enable 17 |
| Power rails | GPIO 1 (3.3 V), GPIO 2 (5 V) high |

Bring-up checks on real hardware: colour order of the panel (`madctl` in `lcd_st77961.c`), steps per detent (set in the app: Einstellungen → Drehknopf), tap detection.

## USB

- VID `0x303A`, PID `0x4011` (development; `main/usb_ids.h`). Request an Espressif PID before shipping devices.
- One vendor interface with bulk endpoints, BOS with WebUSB capability and Microsoft OS 2.0 descriptor (WinUSB loads without a driver install on Windows).

## Fonts

`main/fonts/Montserrat-Medium.ttf` (SIL Open Font License 1.1, see `OFL-Montserrat.txt`), rendered at runtime with LVGL Tiny TTF so umlauts work.
