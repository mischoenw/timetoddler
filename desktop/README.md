# TimeToddler (Desktop)

Zeiterfassung mit Kacheln, Arbeitszeit (Kommen/Pause/Gehen) und YouTrack-Buchung. Electron + React + TypeScript, Daten lokal in SQLite (`sql.js`).
Design: `../docs/specs/2026-10-22-timetoddler-design.md`. Der Drehknopf (CrowPanel 1.46") folgt; die App ist ohne ihn vollständig bedienbar.

```bash
npm install
npm run dev        # App mit Hot Reload
npm test           # Vitest (Core-Logik, YouTrack-Client gegen gemockten fetch)
npm run typecheck
npm run dist       # Installer nach dist/ (Windows NSIS, macOS dmg, Linux AppImage/deb)
```

## Deployment

- **Lokal:** `npm run dist` baut die Installer für das eigene Betriebssystem nach `dist/` (macOS-Pakete nur auf macOS, Windows am besten auf Windows).
- **CI:** `.github/workflows/desktop.yml` baut auf Windows, macOS und Linux. Tag `timetoddler-v0.1.0` pushen (Version in `package.json` vorher anheben) → GitHub Release mit `.exe`, `.dmg`, `.AppImage`, `.deb`. Manuell gestartet: nur Artefakte.
- **Unsigniert:** Windows zeigt SmartScreen („Weitere Informationen → Trotzdem ausführen“), macOS Gatekeeper (Rechtsklick → Öffnen, ggf. `xattr -dr com.apple.quarantine /Applications/TimeToddler.app`). Für die Verteilung im Team: Windows-Codesigning-Zertifikat und Apple Developer ID mit Notarisierung als Secrets hinterlegen.

## Bedienung

- **Erfassen:** Kachel klicken startet/stoppt, Rechtsklick bucht den laufenden Eintrag auf diese Kachel um (Startzeit bleibt). Stern = Favorit (steht vorn). Kommen/Pause/Gehen oben. Fenster schließen lässt die App im Tray weiterlaufen.
- **Tag:** Anwesenheit, Pausen und Einträge nachträglich ändern, anlegen, löschen; Netto-Arbeitszeit und Hinweise (Pausen nach ArbZG, > 10 h). „Tag buchen“ reiht die offenen Einträge für YouTrack ein.
- **Arbeitszeit:** Kommen (grün), Pause (orange), Gehen (rot) mit Auswahl „Gehen (Arztbesuch)“: Die Zeit beim Arzt zählt bis zum nächsten Kommen als Arbeitszeit; ohne erneutes Kommen gilt der Tag als erfüllt (Soll erreicht, keine Überstunden). Tag und Woche zeigen Soll, Ist und Saldo.
- **Feiertage und Urlaub:** Bundesland in den Einstellungen wählen (optional regionale Feiertage). Feiertage, Wochenenden und Urlaub haben kein Soll, ein halber Urlaubstag das halbe. Reiter „Urlaub“: eintragen (auch halbe Tage), Urlaubskonto mit Anspruch, Übertrag, genommen, geplant, Rest; Feiertagsliste des Jahres. Urlaub geht nicht nach YouTrack.
- **Woche:** Summen je Tätigkeit und Tag, „Woche buchen“, CSV-Export.
- **Tätigkeiten:** lokale Tätigkeiten (z. B. Besprechung, Team-Meeting; werden nie gebucht) oder YouTrack-Tätigkeiten mit Standard-Ticket und Arbeitstyp. Übernahme von Tickets oder Projekten aus YouTrack.
- **Einstellungen:** YouTrack-URL und Permanent Token, Ticket-Suche, Buchungsmodus (manuell oder beim Stoppen), Arbeitszeit-Regeln, Drehknopf.

## YouTrack

- Ein Work Item pro Eintrag und Tag, ganze Minuten (kaufmännisch gerundet, min. 1), Notiz = Text.
- Nach dem Buchen geänderte Einträge werden aktualisiert, Ticketwechsel ersetzt das Work Item, Löschen entfernt es.
- Zurück aus YouTrack (alle 10 min und bei „Jetzt synchronisieren“, abschaltbar): eigene Work Items der letzten 31 Tage. Änderungen an gebuchten Einträgen werden übernommen (lokale Änderungen gehen vor), in YouTrack gelöschte werden wieder „offen“, neue Buchungen auf dem Ticket einer Kachel erscheinen als Eintrag hinter dem letzten Eintrag des Tages.
- Netz- und Serverfehler: automatische Wiederholung (30 s bis 30 min). 401/403 stoppt die Synchronisation bis „Verbinden & testen“.
- Der Token liegt verschlüsselt (Schlüsselbund des Systems) in `userData/youtrack.token`, nicht in der Datenbank.

## Drehknopf (CrowPanel 1.46")

Die App findet den Knopf automatisch per WebUSB (VID `303a`, PID `4011`), ein Auswahldialog erscheint nicht. Ohne Gerät lässt sich alles im Simulator unter Einstellungen → Drehknopf ausprobieren.

- **Windows/macOS:** kein Treiber nötig (die Firmware meldet WinUSB über MS-OS-2.0-Deskriptoren).
- **Linux:** Das `.deb` installiert `/usr/lib/udev/rules.d/70-timetoddler.rules`. Beim AppImage die Regel aus `build/70-timetoddler.rules` dorthin kopieren und `sudo udevadm control --reload && sudo udevadm trigger` ausführen.

## Daten

`userData/timetoddler.sqlite` (Windows `%APPDATA%\TimeToddler`, macOS `~/Library/Application Support/TimeToddler`, Linux `~/.config/TimeToddler`). Für Tests lässt sich der Pfad mit `TIMETODDLER_DB` umlenken.
