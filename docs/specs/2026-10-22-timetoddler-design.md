# TimeToddler: Zeiterfassung mit Drehknopf (timeBuzzer-Nachbau) – Design

**Datum:** 2026-10-22
**Projekte:** `firmware/` (Firmware, ESP-IDF 6.1, Elecrow CrowPanel 1.46" HMI ESP32-S3 Rotary Display, [Berrybase](https://www.berrybase.at/elecrow-crowpanel-1-46-hmi-esp32-s3-rotary-display-ips-drehgeber-esphome-home-assistant-5v)), `desktop/` (Electron-App)
**Status:** Entscheidungen vom User im Gespräch, Spec zur Durchsicht

## Ziel

Nachbau der timeBuzzer-Zeiterfassung: eine Desktop-App mit Kacheln für Projekte und ein USB-Drehknopf am Schreibtisch, mit dem man ohne Maus und Tastatur ein Projekt wählt, den Timer startet, stoppt und umbucht. Als Knopf dient das CrowPanel 1.46". Es hat zusätzlich ein rundes Display und einen LED-Ring und zeigt darauf das aktive Projekt und die laufende Zeit.

**Fertig ist das MVP, wenn:**
- die App nach dem Einstecken das Gerät ohne Zutun erkennt (Windows, macOS, Linux mit udev-Regel),
- Drehen, Drücken, langes Drücken und Tippen wie unten beschrieben wirken und die Zeiteinträge korrekt in der lokalen Datenbank landen,
- Display und LED-Ring innerhalb von 100 ms den Zustand der App zeigen,
- Kommen, Gehen und Pause in der App und am Knopf erfasst werden und die Tagesübersicht Anwesenheit, Pausen und Netto-Arbeitszeit zeigt,
- Tages- und Wochenübersicht stimmen und als CSV exportiert werden können,
- mit eingerichteter YouTrack-Anbindung die Projekte und Tickets aus YouTrack als Kacheln wählbar sind und gestoppte Einträge als Work Items im richtigen Ticket ankommen.

## Vorbild timeBuzzer (Funktionsumfang)

| timeBuzzer | TimeToddler MVP |
|---|---|
| Kacheln für Tätigkeiten/Projekte, Favoriten zuerst | ja (Tätigkeit mit Name, Farbe, Kunde als Freitext, Favorit, archiviert; YouTrack-verknüpft oder rein lokal) |
| Arbeitszeit (Kommen/Gehen/Pause) | ja, lokal gespeichert |
| Buzzer: Berühren öffnet/schließt die App | ja, Tippen aufs Display blendet das App-Fenster ein/aus |
| Drehen wählt Kachel, Drücken startet/stoppt | ja |
| Drücken und Halten korrigiert die Auswahl | ja, als „Umbuchen“ (siehe Bedienung) |
| LED zeigt Projektfarbe und Aufnahmestatus | ja, LED-Ring mit 8 LEDs, zusätzlich das Display |
| Reports, Projekt-Analysen | Tages- und Wochenansicht mit Summen, CSV-Export |
| Erinnerungen | später |
| Integrationen | YouTrack: Projekt-/Ticketliste holen, Zeiten buchen |
| Teams, offene API, Cloud | nicht im MVP |

## Entscheidungen des Users

| Thema | Entscheidung |
|---|---|
| Rolle des Geräts | Eingabe plus Mini-UI: Display zeigt Auswahl, Farbe und laufende Zeit, LED-Ring zeigt den Status. Die App ist die einzige Quelle des Zustands. |
| Host-Anwendung | **Electron-App**, keine PWA |
| Firmware | eigenständiges ESP-IDF-Projekt **ohne `mbed_app`** (kein MQTT, OTA, Provisioning, keine Factory-Partition), nur USB |
| Datenhaltung | **lokal** (SQLite), Sync optional |
| Sync-Ziel | **YouTrack**: Projektliste und Tickets holen, Zeiten als Work Items buchen |
| Lokale Tätigkeiten | In der App lassen sich eigene Tätigkeiten ohne YouTrack anlegen (z. B. Besprechung, Team-Meeting). Sie werden erfasst und ausgewertet, aber nie gebucht. |
| Arbeitszeit | **Kommen, Gehen, Pause** als eigene Erfassung, nur in der App gespeichert (kein Sync) |
| Drehgeber | Zählschritte pro Rastung **in der App einstellbar** |
| Buchungseinheit | **ein Work Item pro Eintrag** (bei Einträgen über Mitternacht eines pro Tag) |
| Name | **timetoddler** (Anzeige „TimeToddler“); „timeBuzzer“ ist eine Marke und taucht im Produkt nicht auf |
| Vorgehen | erst diese Spec, dann Plan, dann Umsetzung |

**Folge der Electron-Entscheidung:** Die App kann ihr Fenster selbst einblenden und in den Vordergrund holen. Damit geht „Berühren öffnet die App“ wie beim Original, was mit einer PWA nicht möglich wäre.

## Hardware (laut Schaltplan `ESP32 Display-1.46-V1.0`, Elecrow-RD/CrowPanel-1.46inch-HMI-ESP32-Rotary-Display)

| Funktion | Pins / Baustein |
|---|---|
| SoC | ESP32-S3R8, 8 MB PSRAM (Octal), 16 MB Flash |
| USB | **natives USB** GPIO 19 (D−) / 20 (D+) über Serienwiderstände an J37 (MX1.25-4P: VBUS, D−, D+, GND) und an die 12-polige FPC. Kein USB-UART-Chip. |
| Display | 1,46", 360×360, ST77961, SPI: SCLK 10, MOSI 11, DC 3, CS 9, RST 14; Backlight PWM GPIO 46 |
| Touch | CST816, I2C: SDA 6, SCL 7, INT 5, RST 13 |
| Drehgeber | A = GPIO 45, B = GPIO 42 (mechanisch, Pull-ups intern aktivieren), Taster GPIO 41 (active low) |
| LED-Ring | 8× WS2812 (RGB4020) an GPIO 48 über Pegelwandler; Versorgung schalten mit GPIO 17 = high |
| Versorgung | GPIO 1 = high (3,3-V-Schiene), GPIO 2 = high (5-V-Schiene) beim Booten setzen |
| Power-LED | GPIO 40, active low |
| frei | I2C-Stecker SDA 38 / SCL 39, UART0, GPIO 4/12 an der FPC |

## Architektur

```
┌──────────── CrowPanel (ESP32-S3) ─────────────┐        USB         ┌──────────── Electron-App ─────────────┐
│ input   PCNT-Encoder, Taster, CST816-Tap      │                    │ Renderer: WebUSB (navigator.usb)      │
│ ui      LVGL 9, esp_lcd ST77961               │   Vendor-IF ◄─────►│   Gerätelink, Protokoll               │
│ leds    led_strip (RMT)                       │   (WebUSB)         │ Renderer: UI (Kacheln, Reports)       │
│ link    TinyUSB: CDC (Log) + Vendor (WebUSB)  │   CDC ──► Log      │ Main: Fenster, Tray, Datenbank, CSV   │
└───────────────────────────────────────────────┘                    └───────────────────────────────────────┘
```

Die App ist die einzige Quelle des Zustands. Das Gerät meldet nur Eingaben und zeigt an, was die App schickt. Eingaben sind nicht lokal vorweggenommen: Der Weg über USB dauert wenige Millisekunden und reicht für ein direktes Gefühl am Knopf.

### USB-Anbindung

- **TinyUSB** (`espressif/esp_tinyusb`) als Composite-Gerät:
  - Interface 0/1: **CDC-ACM** für Log-Ausgabe (`esp_log` umgeleitet), damit `idf.py monitor` weiter funktioniert.
  - Interface 2: **Vendor** mit je einem Bulk-IN- und Bulk-OUT-Endpoint (64 Byte) für das Protokoll.
- **BOS-Deskriptor** mit WebUSB-Platform-Capability (Landing-Page-URL optional) und **MS-OS-2.0-Deskriptor**, der dem Vendor-Interface die Kompatibilitäts-ID `WINUSB` gibt. Windows lädt WinUSB dann ohne Treiberinstallation.
- Linux: udev-Regel (`SUBSYSTEM=="usb", ATTR{idVendor}=="303a", ATTR{idProduct}=="…", MODE="0660", TAG+="uaccess"`) liegt der App bei.
- **Electron:** WebUSB im Renderer. Der Main-Prozess erlaubt das Gerät über `session.setDevicePermissionHandler` und `setPermissionCheckHandler` für die eigene VID/PID und wählt es in `select-usb-device` automatisch aus. Danach liefert `navigator.usb.getDevices()` das Gerät, und auf `connect`/`disconnect` hin verbindet sich die App neu. Native Node-Module sind dafür nicht nötig.

**Verworfen:**
- Nur CDC plus `serialport`: braucht ein natives Modul, und das Protokoll teilt sich den Kanal mit dem Log.
- HID: Chrome und Electron sperren Tastatur- und Maus-HID für Web-APIs, und ein eigenes HID-Gerät bringt gegenüber dem Vendor-Interface nichts.

### Protokoll (Vendor-Interface)

JSON-Zeilen (UTF-8, `\n` als Trenner), höchstens 512 Byte pro Zeile. Gut lesbar und für ein paar Nachrichten pro Sekunde schnell genug. Feld `t` ist der Typ.

**Gerät → App**

| Nachricht | Bedeutung |
|---|---|
| `{"t":"hello","proto":1,"fw":"1.0.0","serial":"…"}` | nach Enumeration und auf `{"t":"hello?"}` |
| `{"t":"rot","c":4}` | Drehgeber, `c` = **rohe PCNT-Zählschritte** seit der letzten Meldung (±, höchstens 20 ms gesammelt). Die Umrechnung in Rastungen macht die App (siehe Drehgeber-Einstellungen). |
| `{"t":"btn","k":"short"}` | Taster kurz (< 600 ms) |
| `{"t":"btn","k":"long"}` | Taster lang (≥ 600 ms), wird beim Erreichen der Schwelle gesendet, nicht beim Loslassen |
| `{"t":"btn","k":"double"}` | Doppelklick (zweiter Druck innerhalb 300 ms); ein `short` wird dann nicht gesendet, `short` kommt also erst 300 ms nach dem Loslassen |
| `{"t":"tap"}` | Tippen aufs Display |

**App → Gerät**

| Nachricht | Bedeutung |
|---|---|
| `{"t":"hello?"}` | Gerät soll sich melden |
| `{"t":"state","mode":"absent"\|"idle"\|"running"\|"break"\|"select","name":"…","client":"…","color":"#RRGGBB","elapsed":1234,"day":24480,"idx":3,"count":12}` | vollständiger Anzeigezustand; `elapsed` = laufender Eintrag bzw. Pause, `day` = Netto-Arbeitszeit heute, beides in Sekunden, das Gerät zählt selbst weiter (`day` nur außerhalb der Pause) |
| `{"t":"cfg","brightness":80,"led":60}` | Helligkeit Display / LED-Ring in Prozent |

Unbekannte Typen und Felder werden ignoriert. `proto` steigt bei inkompatiblen Änderungen; die App lehnt unbekannte Versionen mit Hinweis ab.

### Bedienung

Die Kachelliste ist dieselbe wie in der App: Favoriten zuerst, dann der Rest alphabetisch, archivierte Tätigkeiten nie. Am Ende stehen feste Kacheln für die Arbeitszeit: **Pause** (bzw. **Pause beenden**) und **Gehen**; ist man abwesend, steht dort nur **Kommen**.

**Drehgeber-Einstellungen (App):** „Zählschritte pro Rastung“ (1, 2, 4; Standard 4, mit Kalibrierhilfe: „Knopf eine Rastung drehen“ zeigt die gemessenen Schritte) und „Richtung umkehren“. Die App summiert die rohen Schritte und rückt pro vollständiger Rastung eine Kachel weiter, Reste bleiben stehen.

| Eingabe | Wirkung |
|---|---|
| Drehen | Auswahlmodus: Die Auswahl wandert durch die Kachelliste (am Ende Umlauf). Display und LED zeigen das ausgewählte Projekt. Ohne weitere Eingabe nach **5 s** zurück zur Anzeige des laufenden Eintrags. |
| Kurz drücken | Ausgewähltes Projekt läuft schon → stoppen. Sonst → laufenden Eintrag beenden und ausgewähltes Projekt starten. Ohne Auswahlmodus: laufenden Eintrag stoppen, oder wenn keiner läuft, das zuletzt genutzte Projekt starten. |
| Lang drücken | **Umbuchen:** Der laufende Eintrag bekommt das ausgewählte Projekt, die Startzeit bleibt. Läuft nichts, wirkt es wie kurz drücken. |
| Doppelklick | Pause beginnen bzw. beenden (Kurzweg zur Pause-Kachel). |
| Kurz drücken auf Pause / Gehen / Kommen | Arbeitszeit-Aktion, siehe unten |
| Tippen aufs Display | App-Fenster einblenden und in den Vordergrund holen, oder ausblenden, wenn es schon vorn ist. |

### Arbeitszeit: Kommen, Gehen, Pause

Getrennt von den Tätigkeiten erfasst die App die Anwesenheit. Sie wird nur lokal gespeichert und nicht synchronisiert.

| Aktion | Wirkung |
|---|---|
| Kommen | beginnt einen Anwesenheitsblock. Auch automatisch, wenn eine Tätigkeit gestartet wird, während man abwesend ist (Einstellung, Standard an). |
| Pause | beendet die laufende Tätigkeit, merkt sie sich und beginnt eine Pause. |
| Pause beenden | beendet die Pause; die gemerkte Tätigkeit startet wieder (Einstellung, Standard an). Eine Tätigkeit zu starten beendet die Pause ebenfalls. |
| Gehen | beendet laufende Tätigkeit, Pause und Anwesenheitsblock. |

- Mehrere Anwesenheitsblöcke pro Tag sind erlaubt (z. B. Arztbesuch dazwischen).
- **Netto-Arbeitszeit** = Anwesenheit − Pausen. Die Tagesansicht zeigt zusätzlich die Summe der Tätigkeiten und die Differenz zur Netto-Arbeitszeit („nicht zugeordnet“).
- Hinweise, kein Zwang: Pausen nach Arbeitszeitgesetz (unter 30 min bei mehr als 6 h, unter 45 min bei mehr als 9 h) und mehr als 10 h Netto werden in der Tagesansicht markiert.
- Vergessenes Gehen: Ist beim App-Start oder um Mitternacht noch ein Block vom Vortag offen, fragt die App nach der Gehen-Zeit (Vorschlag: Ende der letzten Tätigkeit).
- Alle Zeiten sind in der Tagesansicht nachträglich änderbar.

### Anzeige am Gerät

- **Display (LVGL 9, rund 360×360):** Außenring als Bogen in Projektfarbe, in der Mitte Projektname (zweizeilig, gekürzt), darunter Kunde, groß die laufende Zeit `H:MM:SS`. Im Auswahlmodus zusätzlich `3 / 12` und Name in Projektfarbe statt Weiß. Im Leerlauf steht „Kein Timer“, in der Pause „Pause“ mit Pausendauer, abwesend „Abwesend“. Klein am unteren Rand die Netto-Arbeitszeit des Tages.
- **LED-Ring:**

| Zustand | LED-Ring |
|---|---|
| Timer läuft | Projektfarbe, langsames Atmen (4 s) |
| Anwesend, kein Timer | aus, eine LED schwach weiß |
| Pause | Orange, langsames Atmen |
| Abwesend | aus |
| Auswahlmodus | Projektfarbe, Position der Auswahl als hellere LED |
| App nicht verbunden | schwaches blaues Pulsieren, Display „Nicht verbunden“ |

Kommt 3 s lang keine Nachricht der App, obwohl USB konfiguriert ist (App nicht gestartet), gilt das Gerät als „nicht verbunden“. Die App schickt dafür alle 2 s `state` als Lebenszeichen. Eingaben ohne Verbindung werden verworfen.

### Firmware-Module (`main/`)

| Datei | Aufgabe |
|---|---|
| `board.h` | Pins und Konstanten aus der Tabelle oben |
| `power.cpp` | Versorgungs-GPIOs, Backlight-PWM (LEDC) |
| `lcd_st77961.cpp` | esp_lcd-Panel: Init-Sequenz aus dem Elecrow-Beispiel, CASET/RASET/RAMWR über `esp_lcd_panel_io_spi`, 80 MHz, DMA |
| `ui.cpp` | LVGL 9 (`espressif/esp_lvgl_port`), Bildschirme Laufend / Auswahl / Leerlauf / Nicht verbunden, eigener 1-s-Takt für `elapsed` |
| `input.cpp` | Drehgeber über **PCNT** in Quadratur mit Glitch-Filter, Taster entprellt mit Kurz/Lang/Doppelklick-Erkennung, CST816-Tap über INT-Pin |
| `leds.cpp` | `espressif/led_strip` (RMT), Animationen aus der Tabelle |
| `usb_link.cpp` | TinyUSB-Init, Deskriptoren (Gerät, Konfiguration, BOS, MS OS 2.0), Zeilenpuffer für Vendor-RX/TX |
| `protocol.cpp` | Nachrichten parsen und bauen (cJSON), ohne ESP-Abhängigkeiten, damit es in `test_host/` auf dem PC testbar ist |
| `main.cpp` | Tasks und Queue: input → link, link → ui/leds |

Partitionen: einfache Tabelle (`factory` 3 MB, `nvs`), da kein OTA. Eigenständiges ESP-IDF-Projekt unter `firmware/` (ESP-IDF 6.1).

### Electron-App (`desktop/`)

- **Stack:** Electron, TypeScript, Vite (`electron-vite`), React im Renderer, Paketierung mit `electron-builder` (Windows NSIS, macOS dmg, Linux AppImage/deb mit udev-Regel).
- **Prozesse:**
  - *Main:* Fenster und Tray (Symbol mit Projektfarbe, laufende Zeit im Tooltip/Menü), USB-Berechtigungen, Datenbank (`better-sqlite3`, Datei im `userData`-Verzeichnis), CSV-Export, Sync-Connectoren, optional Autostart.
  - *Renderer:* UI und Gerätelink (WebUSB). Gerätelink und Main sprechen über eine schmale IPC-API im Preload (`contextIsolation` an, kein `nodeIntegration`).
- **Zustand:** ein Zustandsautomat im Renderer (Abwesend / Leerlauf / Läuft / Pause, darüber Auswahl) verarbeitet Eingaben aus der UI und vom Gerät gleich. Jede Änderung geht als `state` ans Gerät.
- **Ansichten:** Kacheln (Start/Stopp per Klick, Favorit per Stern), Kommen/Pause/Gehen-Leiste oben, Tagesansicht mit Zeitleiste aus Anwesenheit, Pausen und Einträgen (bearbeiten, löschen, manuell hinzufügen, Notiz, Ticket, Buchungsstatus), Wochenansicht mit Summen je Tätigkeit und Tag sowie Netto-Arbeitszeit, Tätigkeitsverwaltung (lokale anlegen, Import aus YouTrack), Einstellungen (Helligkeit, Drehgeber, Arbeitszeit, Autostart, YouTrack).
- **Datenmodell:**
  - `project(id, kind, name, client, color, favorite, archived, created_at, yt_project_id NULL, yt_issue NULL, yt_work_type_id NULL)`; `kind` = `youtrack` \| `local`. (Tabelle heißt `project`, in der UI „Tätigkeit“.)
  - `entry(id, project_id, start_utc, end_utc NULL, note, yt_issue NULL)`; höchstens ein Eintrag mit `end_utc IS NULL`
  - `presence(id, start_utc, end_utc NULL)`, `pause(id, presence_id, start_utc, end_utc NULL, resume_project_id NULL)`; je höchstens ein offener Datensatz
  - `setting(key, value)` u. a. `encoder.steps_per_detent`, `encoder.reverse`, `work.auto_come`, `work.resume_after_break`
  - `booking(entry_id, day, connector, remote_id NULL, minutes, hash, status, error, synced_at)`; Schlüssel `(entry_id, day, connector)`
  - Zeiten in UTC gespeichert, Anzeige in lokaler Zeit. Einträge über Mitternacht werden in Tagesansicht und Export am Tageswechsel aufgeteilt, gespeichert bleibt ein Eintrag.
- **Robustheit:** Beim Start einen offenen Eintrag übernehmen (lief weiter, als die App zu war). Absturz oder Rechner aus: Der Eintrag läuft weiter, bis der Nutzer ihn stoppt oder korrigiert. Ein Hinweis bei offenen Einträgen über 12 h.

### Sync und YouTrack-Anbindung

**Grundsatz:** Die lokale Datenbank ist führend, die App funktioniert ohne Sync vollständig. Sync pusht lokale Einträge, liest Stammdaten (Projekte, Tickets) und holt eigene Work Items zurück (Zwei-Wege-Sync, siehe `2026-10-23-youtrack-two-way-sync-design.md`); bei Konflikten gewinnt die App.

**Connector-Schnittstelle** (Main-Prozess, damit später weitere Ziele wie Jira oder ein eigenes Backend andocken können):

```ts
interface SyncConnector {
  id: string;                                         // "youtrack"
  testConnection(): Promise<{ user: string }>;
  listProjects(): Promise<RemoteProject[]>;           // id, key, name, archived, timeTracking
  searchIssues(query: string): Promise<RemoteIssue[]>; // id, key ("ABC-123"), summary, project
  listWorkTypes(projectId: string): Promise<RemoteWorkType[]>;
  createWorkItem(b: BookingDraft): Promise<string>;   // remote_id
  updateWorkItem(remoteId: string, b: BookingDraft): Promise<void>;
  deleteWorkItem(remoteId: string, issue: string): Promise<void>;
}
```

**YouTrack (REST-API, Cloud und Server gleich):**

| Zweck | Aufruf |
|---|---|
| Anmeldung | Permanent Token des Nutzers, Header `Authorization: Bearer …`. Basis-URL und Token in den Einstellungen; Token mit Electron `safeStorage` verschlüsselt. |
| Verbindung prüfen | `GET /api/users/me?fields=login,name` |
| Projektliste | `GET /api/admin/projects?fields=id,shortName,name,archived` (nur Projekte, die der Nutzer sieht); Zeiterfassung aktiv: `GET /api/admin/projects/{id}/timeTrackingSettings?fields=enabled` |
| Tickets | `GET /api/issues?query=…&fields=id,idReadable,summary,project(id,shortName)`; Standard-Abfrage `for: me #Unresolved`, in den Einstellungen änderbar |
| Arbeitstypen | `GET /api/admin/projects/{id}/timeTrackingSettings/workItemTypes?fields=id,name` |
| Zeit buchen | `POST /api/issues/{idReadable}/timeTracking/workItems?fields=id` mit `{date, duration:{minutes}, text, type:{id}}` |
| Ändern / Löschen | `POST` bzw. `DELETE /api/issues/{idReadable}/timeTracking/workItems/{id}` |

**Abbildung:**
- YouTrack bucht Zeit auf **Tickets**, nicht auf Projekte. Eine Kachel ist ein lokales Projekt mit optionaler Verknüpfung: YouTrack-Projekt, Standard-Ticket, Arbeitstyp.
- Import in der Projektverwaltung: (a) YouTrack-Projekte als Kacheln (Standard-Ticket wird danach gewählt) oder (b) Tickets aus der Abfrage direkt als Kacheln („ABC-123 Kurztitel“).
- **Lokale Tätigkeiten** (`kind = local`, z. B. Besprechung, Team-Meeting) haben keine Verknüpfung, werden nie gebucht und nicht als Fehler markiert, sondern als „lokal“. Eine lokale Tätigkeit kann später mit einem Ticket verknüpft werden (wird dann `youtrack`); bereits erfasste Einträge werden dadurch buchbar.
- Ticket eines Eintrags einer YouTrack-Tätigkeit: `entry.yt_issue`, sonst `project.yt_issue`. Fehlt beides, ist der Eintrag „nicht buchbar“ und wird markiert.
- Ein Work Item gilt für einen Tag. Einträge über Mitternacht ergeben daher je Tag ein Work Item, deshalb `booking` pro `(entry, day)`.
- Dauer in ganzen Minuten, kaufmännisch gerundet, mindestens 1. Text = Notiz des Eintrags.
- Laufende Einträge werden nie gebucht.

**Ablauf:**
- Buchungsmodus in den Einstellungen: **manuell** („Tag buchen“/„Woche buchen“ in den Ansichten, Standard) oder **automatisch beim Stoppen**.
- Eine Warteschlange im Main-Prozess arbeitet ausstehende Buchungen ab: Wiederholung mit Backoff (30 s bis 30 min) bei Netzfehlern und 5xx. Bei 401/403 Stopp und Hinweis „Token prüfen“, bei 404 auf dem Ticket Status „Fehler“ mit Meldung.
- Lokale Änderung nach dem Buchen (Zeit, Notiz, Ticket): neuer `hash` ≠ gebuchter → Update. Bei Ticketwechsel: altes Work Item löschen, neues anlegen. Lokales Löschen löscht nach Rückfrage auch das Work Item.
- Status je Eintrag in der Tagesansicht: lokal / nicht buchbar / ausstehend / gebucht / Fehler (mit Tooltip).
- Anwesenheit und Pausen werden nicht synchronisiert.
- Stammdaten (Projekte, Tickets, Arbeitstypen) werden beim Start und auf Knopfdruck aktualisiert und lokal zwischengespeichert, damit Kacheln offline funktionieren. Im YouTrack archivierte Projekte bzw. erledigte Tickets werden in der Kachelliste markiert, nicht automatisch archiviert.

## Tests

- **Firmware:** `test_host/` (wie bei xmas-led) für `protocol.cpp` und die Kurz/Lang/Doppelklick-Logik des Tasters. Inbetriebnahme auf Hardware: Touch-Tap, Enumeration unter Windows/macOS/Linux.
- **App:** Vitest für Zustandsautomat (inkl. Kommen/Pause/Gehen und Wiederaufnahme), Rastungsumrechnung, Kachelreihenfolge, Tagesaufteilung, Netto-Arbeitszeit und Pausenhinweise, CSV, Buchungsentwürfe (Rundung, Tagesteilung, Hash) und den YouTrack-Connector gegen einen gemockten `fetch` (Statuscodes, Backoff). Ein Geräte-Simulator im Renderer (Tasten für drehen/drücken/lang/doppelt/tippen) zum Entwickeln ohne Hardware.

## Offene Punkte

1. **USB-VID/PID:** für die Entwicklung Espressif-VID `0x303A` mit einer Test-PID. Für den dauerhaften Einsatz eine PID bei Espressif beantragen (github.com/espressif/usb-pids, für ESP-basierte Geräte kostenlos).
Später, nicht im MVP: Buchen zusammengefasst (ein Work Item pro Tag und Ticket statt pro Eintrag).
