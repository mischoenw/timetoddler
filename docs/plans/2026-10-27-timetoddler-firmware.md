# timetoddler Firmware + USB-Gerätelink – Umsetzungsplan

**Spec:** `docs/specs/2026-10-22-timetoddler-design.md`
**Umfang:** Firmware für das CrowPanel 1.46" unter `firmware/` und der Gerätelink in der Desktop-App.

## Festlegungen

- **USB-IDs (Entwicklung):** VID `0x303A` (Espressif), PID `0x4011`. Eine eigene PID bei Espressif beantragen, bevor Geräte verteilt werden; die IDs stehen an genau einer Stelle je Seite (`firmware/main/board.h`, `desktop/src/shared/protocol.ts`).
- **Protokoll:** JSON-Zeilen wie in der Spec, `rot` mit rohen Zählschritten `c`. Die Firmware parst nur flache Objekte (eigener kleiner Parser, kein cJSON), damit `protocol.cpp` ohne IDF auf dem PC testbar bleibt.
- **Umlaute am Display:** Die eingebauten LVGL-Schriften haben nur ASCII. Montserrat liegt als TTF in `firmware/main/fonts/` und wird mit LVGL Tiny TTF gerendert.
- **Hintergrund-Drosselung:** Der Gerätelink läuft im Renderer. Damit er bei verstecktem Fenster nicht gedrosselt wird, `backgroundThrottling: false`.
- **Knopf-Logik in der App** (`src/shared/knob.ts`, rein und mit Vitest getestet): Rastungen aus rohen Schritten, Auswahlmodus mit 5-s-Timeout, Abbildung von kurz/lang/doppelt/Tippen auf dieselben Aktionen wie die UI. Am Ende der Kachelliste die festen Kacheln Pause/Pause beenden und Gehen bzw. nur Kommen.

## Abweichungen von der Spec

- **Kein CDC-Interface:** Nur das Vendor-Interface. Logs gehen über UART0 (ZX-MX-Stecker); so kann eine blockierende Konsole den Knopf nie aufhalten. Flashen über USB im Download-Modus (BOOT halten, RESET).
- **Schrift:** statt erzeugter LVGL-Fonts Montserrat als TTF eingebettet und zur Laufzeit gerendert (LVGL Tiny TTF), weil `lv_font_conv` hier nicht lief.
- **Build-Prüfung in CI** (`.github/workflows/firmware.yml`, offizielles ESP-IDF-6.1-Image), da die Toolchain in der Entwicklungsumgebung nicht installiert werden konnte.

## Firmware-Aufbau (`firmware/`)

| Datei | Aufgabe |
|---|---|
| `main/board.h`, `main/usb_ids.h` | Pins, USB-IDs, Konstanten |
| `main/power.{h,cpp}` | Versorgung, Backlight-PWM |
| `main/protocol.{h,cpp}` | Zeilen parsen/bauen, ohne IDF |
| `main/button.{h,cpp}` | Kurz/Lang/Doppelklick-Automat, ohne IDF |
| `main/usb_link.{h,c}` | TinyUSB: Gerät, Konfiguration (Vendor), BOS mit WebUSB + MS OS 2.0 |
| `main/input.{h,cpp}` | PCNT-Quadratur, Taster-Abtastung, CST816-Tap |
| `main/lcd_st77961.{h,c}` | esp_lcd-Panel mit Init-Sequenz aus dem Elecrow-Beispiel |
| `main/ui.{h,cpp}` | LVGL 9 über esp_lvgl_port |
| `main/leds.{h,cpp}` | LED-Ring über led_strip (RMT) |
| `main/main.cpp` | Versorgung, Tasks, Verbindungs-Timeout |
| `test_host/` | g++-Tests für protocol und button |

## Schritte

1. App: `shared/protocol.ts`, `shared/knob.ts` mit Tests; Gerätelink (WebUSB) im Renderer, USB-Berechtigungen im Main, Simulator und Gerätestatus in den Einstellungen.
2. Firmware: Projekt, Host-Tests, Module, Build mit ESP-IDF 6.1.
3. Prüfen: `npm test`, Typecheck, App-Smoke-Test mit Simulator; Firmware `idf.py build` und Host-Tests. Hardware-Inbetriebnahme (Farbreihenfolge, Rastung, Touch) beim User.
