# TimeToddler

Zeiterfassung im Stil von timeBuzzer: Desktop-App mit Kacheln für Tätigkeiten, Arbeitszeit (Kommen/Pause/Gehen) und Buchung nach YouTrack. Als Eingabegerät dient ein USB-Drehknopf mit rundem Display (Elecrow CrowPanel 1.46" HMI ESP32-S3 Rotary Display).

| Ordner | Inhalt | Stand |
|---|---|---|
| [`desktop/`](desktop/) | Electron-App (TypeScript, React, SQLite via sql.js) | nutzbar, ohne Knopf vollständig bedienbar |
| `firmware/` | ESP-IDF-Firmware für das CrowPanel (TinyUSB, WebUSB, LVGL) | geplant |
| [`docs/`](docs/) | Design-Spec und Umsetzungspläne | |

Installer für Windows, macOS und Linux baut der Workflow [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) beim Push eines Tags `timetoddler-v*` und hängt sie an das GitHub Release. Details: [`desktop/README.md`](desktop/README.md).

„timeBuzzer“ ist eine Marke der timeBuzzer GmbH; dieses Projekt steht in keiner Verbindung dazu.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
