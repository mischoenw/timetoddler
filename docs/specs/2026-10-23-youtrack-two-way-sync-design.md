# YouTrack: Zwei-Wege-Sync der Buchungen

Stand: 2026-10-23. Ergänzt `2026-10-22-timetoddler-design.md`, Abschnitt Sync, der bisher nur einen Einweg-Push vorsah.

## Ziel

Gebuchte Zeiten auf YouTrack-Tätigkeiten sind in App und YouTrack gleich:

- Ändert oder löscht man ein von der App gebuchtes Work Item in YouTrack, übernimmt die App das.
- Bucht man direkt in YouTrack (Web, IDE) auf das Ticket einer Kachel, erscheint die Buchung als Eintrag in Tag und Woche.

Die lokale Datenbank bleibt führend: Lokale Änderungen gehen vor.

## Umfang

Abgerufen werden **alle eigenen Work Items der letzten 31 Tage** (heute eingeschlossen):

```
GET /api/workItems?author=me&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
    &fields=id,date,duration(minutes),text,issue(idReadable)&$top=500&$skip=…
```

Seitenweise, bis eine Seite weniger als `$top` Einträge liefert.

Berücksichtigt werden nur:

1. **Bekannte Work Items:** ihre ID steht als `remote_id` in einer Buchungszeile (`booking`). Daraus entstehen Änderungen und Löschungen.
2. **Neue Work Items** auf einem Ticket, das bei einer Kachel als **Standard-Ticket** (`project.yt_issue`) eingetragen ist. Haben mehrere Kacheln dasselbe Ticket: nicht archivierte vor archivierten, darin Favoriten zuerst, dann die kleinste ID.

Alle anderen Work Items (andere Tickets, Projekt-Kacheln ohne passendes Standard-Ticket) werden ignoriert.

## Ablauf

- Der Pull läuft in `SyncQueue.runOnce()` **nach** dem Push. Damit sind lokale Änderungen schon in YouTrack, bevor der Pull sie sehen könnte: Die App gewinnt.
- Takt: beim Start, mit der bestehenden Sync-Schleife höchstens alle 10 min (`PULL_INTERVAL_MS`) und sofort bei „Jetzt synchronisieren“ (`syncNow`, erzwungen).
- Nur wenn YouTrack konfiguriert ist, kein Auth-Fehler vorliegt und die Einstellung `youtrack.pull` (Standard `true`, „Buchungen aus YouTrack holen“) an ist.
- Pull und Push laufen nie gleichzeitig (gemeinsame Sperre in `SyncQueue`); ein Pull, der auf einen laufenden Push trifft, fällt aus und kommt beim nächsten Takt.
- Fehler beim Pull: wie beim Push in `lastError`; 401/403 setzt `authError`. Ein fehlgeschlagener Pull ändert lokal nichts.

## Abbildung

Der **Tag** eines Work Items: Ist `date` genau UTC-Mitternacht (so speichert YouTrack in seiner Oberfläche erfasste Tage), das UTC-Datum; sonst (von der App mit lokaler Startzeit gebucht) der lokale Tag von `date`. Der Tag einer lokalen Buchungszeile ist `booking.day`. Work Items mit 0 Minuten werden nicht übernommen.

### Bekanntes Work Item

Nur für Buchungszeilen mit Status `booked`, deren Eintrag existiert, beendet ist und genau **eine** Buchungszeile hat (Einträge über Mitternacht werden nicht angefasst), und deren aktueller Entwurf zum `synced_hash` passt (lokal unverändert). Alle anderen Zeilen überspringt der Pull: ausstehend, Fehler, zum Löschen vorgemerkt, lokal geändert.

Verglichen wird das Work Item mit dem aktuellen Entwurf des Eintrags (`buildDrafts`):

| Unterschied | Wirkung auf den Eintrag |
|---|---|
| Dauer (Minuten) | `end = start + minutes` |
| Text | `note = text` (leer bei `null`) |
| Tag | Eintrag zieht auf den neuen Tag, Platz wie bei neuen Einträgen, Dauer bleibt |
| Arbeitstyp | ignoriert |

Danach werden `day`, `synced_hash` (Hash des neuen Entwurfs) und `synced_at` der Buchungszeile gesetzt, Status bleibt `booked`. Der Eintrag wird direkt im Repo geändert, **ohne** `reconcileEntry`, damit nichts erneut eingereiht wird.

### Gelöschtes Work Item

Eine Buchungszeile mit Status `booked`, `remote_id` gesetzt und `day` im Abrufzeitraum, deren `remote_id` nicht in der Antwort vorkommt, wird gelöscht. Der Eintrag bleibt und hat damit den Status „offen“. Er wird nicht automatisch neu gebucht, auch nicht im Modus „beim Stoppen“.

### Neues Work Item

Neuer Eintrag auf der Kachel (siehe Umfang):

- `start`: Ende des letzten Eintrags an diesem Tag; ohne Einträge Beginn der ersten Anwesenheit an diesem Tag; sonst 09:00 Ortszeit.
- `end = start + minutes`, `note = text`, `yt_issue = null` (das Ticket kommt von der Kachel).
- Würde der Eintrag über Mitternacht reichen, wird `start` so weit vorgezogen, dass er um Mitternacht endet (der Eintrag bleibt an einem Tag und hat genau ein Work Item).
- Buchungszeile: `day` = Tag des Eintrags, `remote_id`, `remote_issue` = Ticket, `synced_hash` = Hash des Entwurfs, Status `booked`.

Damit gilt der Eintrag sofort als „gebucht“ und wird nicht zurückgeschrieben.

## Komponenten

| Datei | Änderung |
|---|---|
| `src/core/youtrack.ts` | `listMyWorkItems(fromDay, toDay): Promise<RemoteWorkItem[]>` mit Seitenabruf |
| `src/shared/types.ts` | `RemoteWorkItem { id, issue, day, minutes, text }`; Einstellung `youtrack.pull`; `SyncStatus.lastPull` |
| `src/core/pull.ts` (neu) | `pullWorkItems(repo, api, now): { created, updated, unbooked }`, reine Logik ohne Netz außer über `api` |
| `src/core/booking.ts` | `SyncQueue.pullOnce(force)` ruft `pullWorkItems` auf, merkt `lastPull`; Main ruft es nach `runOnce()` auf |
| `src/core/repo.ts` | Abfragen: gebuchte Zeilen mit `remote_id` in einem Zeitraum, Zeile per `remote_id` |
| `src/main/api.ts` | `syncNow` erzwingt den Pull; `syncStatus` liefert `lastPull` |
| `src/renderer/src/views/Settings.tsx` | Schalter „Buchungen aus YouTrack holen“, Status „zuletzt geholt“ |
| `docs/specs/2026-10-22-timetoddler-design.md` | Grundsatz „Einweg-Push“ verweist auf diese Spec |

## Tests

- `pull.test.ts` gegen ein Fake-API:
  - neues Work Item → Eintrag hinter dem letzten Eintrag, Status gebucht
  - neues Work Item ohne Einträge → Beginn der Anwesenheit bzw. 09:00
  - Dauer, Text oder Tag geändert → Eintrag angepasst, weiterhin gebucht, kein erneuter Push
  - Work Item fehlt → Buchungszeile weg, Eintrag offen
  - ausstehende oder lokal geänderte Zeile → unverändert
  - Ticket ohne Kachel → ignoriert
  - Eintrag über Mitternacht → unverändert
- `youtrack.test.ts`: URL mit `author=me`, Datumsgrenzen, Seitenabruf, Abbildung `date` → UTC-Tag.

## Risiken

- **Tag aus `date`:** Die App bucht mit dem lokalen Startzeitpunkt des Eintrags. Ob YouTrack diesen Zeitpunkt unverändert zurückgibt oder auf UTC-Mitternacht kürzt, muss gegen den echten Server geprüft werden. Kürzt er, kann ein Eintrag kurz nach Mitternacht Ortszeit als „auf den Vortag verschoben“ erkannt werden.
- **Verschoben aus dem Zeitraum:** Wird ein Work Item in YouTrack auf einen Tag vor dem Abrufzeitraum verschoben, sieht die App es als gelöscht und entbucht den Eintrag.
- **Duplikate:** Wer dieselbe Zeit lokal (ungebucht) und direkt in YouTrack erfasst, bekommt zwei Einträge. Die App ordnet sie nicht zu.
- **Fremdänderung an Einträgen über Mitternacht** wird nicht übernommen und beim nächsten lokalen Ändern überschrieben.
