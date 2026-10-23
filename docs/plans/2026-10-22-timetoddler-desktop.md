# timetoddler Desktop-App + YouTrack – Umsetzungsplan

**Spec:** `docs/specs/2026-10-22-timetoddler-design.md`
**Umfang dieses Plans:** Electron-App vollständig ohne Knopf bedienbar, YouTrack-Anbindung. Firmware und USB-Gerätelink folgen in einem eigenen Plan.

## Abweichung von der Spec

- **SQLite über `sql.js` (WASM) statt `better-sqlite3`.** Kein natives Modul, also kein Rebuild gegen die Electron-ABI und keine Build-Toolchain auf Windows/macOS. Die Datenmenge (Zeiteinträge) ist klein; die Datenbank liegt im Speicher und wird nach jeder Änderung atomar (`tmp` + `rename`) nach `userData/timetoddler.sqlite` geschrieben.

## Aufbau `desktop/`

| Pfad | Inhalt |
|---|---|
| `src/core/` | reine Logik ohne Electron, mit Vitest getestet: `db.ts` (Schema, Migration), `repo.ts`, `tracker.ts` (Start/Stopp/Umbuchen/Kommen/Pause/Gehen), `timecalc.ts` (Tagesteilung, Netto-Arbeitszeit, Hinweise, Summen), `tiles.ts`, `csv.ts`, `youtrack.ts`, `booking.ts` (Entwürfe, Hash, Warteschlange) |
| `src/main/` | Fenster, Tray, IPC, Token mit `safeStorage`, Sync-Warteschlange mit Timer |
| `src/preload/` | schmale, typisierte API (`window.tt`) |
| `src/renderer/` | React: Kacheln + Arbeitszeitleiste, Tag, Woche, Tätigkeiten, Einstellungen |
| `src/shared/` | Typen und IPC-Vertrag |

## Schritte

1. Gerüst: `electron-vite`, TypeScript, React, Vitest, `electron-builder`-Konfiguration.
2. Core: Schema und Repository, Tracker mit Regeln aus der Spec (auto Kommen, Wiederaufnahme nach Pause, Gehen beendet alles), Zeitberechnung, Kachelreihenfolge, CSV. Tests zu jedem Modul.
3. YouTrack-Client (`fetch` injiziert) und Buchungslogik: Entwurf je `(entry, day)`, Minuten kaufmännisch gerundet (min. 1), Hash, Create/Update/Delete, Ticketwechsel, Backoff 30 s…30 min, 401/403 stoppt, 404 → Fehler. Tests gegen gemockten `fetch`.
4. Main/Preload: IPC-Handler, Persistenz, Tray mit laufender Zeit, Einstellungen, Token verschlüsselt.
5. Renderer: alle Buchungen ohne Knopf: Start/Stopp per Kachel, Umbuchen, Einträge manuell anlegen/ändern/löschen, Anwesenheit und Pausen bearbeiten, „Tag/Woche buchen“, CSV-Export, YouTrack-Import (Projekte, Tickets).
6. Prüfen: `npm test`, `npm run typecheck`, `npm run build`; App unter Xvfb starten (Smoke-Test).
