# YouTrack Zwei-Wege-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eigene YouTrack-Work-Items der letzten 31 Tage in die App holen: Änderungen und Löschungen von App-Buchungen übernehmen, neue Buchungen auf Kachel-Tickets als Einträge anlegen.

**Architecture:** Neuer Client-Aufruf `listMyWorkItems` (`GET /api/workItems?author=me`), reine Abgleichslogik in `src/core/pull.ts` (`pullWorkItems(repo, api, now)`), die direkt über das Repo schreibt (ohne `reconcileEntry`, damit nichts neu eingereiht wird). `SyncQueue.pullOnce(force)` teilt die Sperre mit dem Push; der Main-Prozess ruft es nach `runOnce()` auf.

**Tech Stack:** TypeScript, Electron, sql.js, Vitest, React (Einstellungen).

**Spec:** `docs/specs/2026-10-23-youtrack-two-way-sync-design.md`

## Global Constraints

- Alle Befehle in `desktop/` ausführen, mit Node ≥ 20.19: vorher `export PATH=$HOME/.nvm/versions/node/v24.22.1/bin:$PATH` (System-Node 18 bricht Vitest).
- Abrufzeitraum: **31 Tage** einschließlich heute (`PULL_DAYS = 31`).
- Pull höchstens alle **10 min** (`PULL_INTERVAL_MS = 10 * 60_000`), erzwungen bei „Jetzt synchronisieren“.
- Einstellung `youtrack.pull`, Standard `true`, Text „Buchungen aus YouTrack holen“.
- Lokale Daten gewinnen: Nur Buchungszeilen mit Status `booked`, deren Entwurf-Hash zu `synced_hash` passt und die genau eine Zeile pro Eintrag haben, werden geändert.
- Neue Einträge: hinter dem letzten Eintrag des Tages, sonst Beginn der ersten Anwesenheit, sonst 09:00; nie über Mitternacht.
- Gelöscht in YouTrack → Buchungszeile löschen, Eintrag bleibt („offen“).
- UI-Texte deutsch, Code und Kommentare englisch, Stil wie im umgebenden Code (keine Semikolons, 2 Leerzeichen, single quotes).
- Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AUdaQEJu9gTZXhP8wwDiKr
  ```

## Review Focus

- **Seite genau voll:** Liefert YouTrack genau `$top` Einträge, muss eine weitere Seite geholt werden (Test in Task 1).
- **Kurz nach Mitternacht gebucht:** Ein App-Work-Item mit Startzeit 00:30 Ortszeit (= 22:30 UTC Vortag) muss den lokalen Tag behalten, sonst würde der Eintrag fälschlich verschoben (Test in Task 1).
- **Aus altem Tag in den Zeitraum verschoben:** Ein bekanntes Work Item, dessen Buchungszeile vor dem Zeitraum liegt, ist eine Änderung, kein neuer Eintrag (Test in Task 2).
- **Längere Dauer am Tagesende:** Verlängerung oder Neuanlage darf den Eintrag nicht über Mitternacht schieben (Test in Task 2).
- **Push läuft gerade:** Ein Pull während eines Pushs darf nicht laufen, sonst überschreiben veraltete Remote-Werte frisch gepushte lokale Werte (Test in Task 3).

---

### Task 1: Client `listMyWorkItems`

**Files:**
- Modify: `desktop/src/shared/types.ts` (nach `RemoteIssue`)
- Modify: `desktop/src/core/youtrack.ts`
- Test: `desktop/test/youtrack.test.ts`

**Interfaces:**
- Produces: `interface RemoteWorkItem { id: string; issue: string; day: string; minutes: number; text: string }` in `@shared/types`; `YouTrackClient.listMyWorkItems(fromDay: string, toDay: string, pageSize = 500): Promise<RemoteWorkItem[]>`.

- [ ] **Step 1: Write the failing tests** — in `desktop/test/youtrack.test.ts` den Import um `at` erweitern und vor `it('classifies errors'` einfügen:

```ts
import { at } from './helpers'
```

```ts
  it('lists own work items page by page and maps the day', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `w-${offset + i}`,
        date: Date.UTC(2026, 9, 21),
        duration: { minutes: 30 },
        text: null,
        issue: { idReadable: 'ABC-1' }
      }))
    const { f, c } = client((url) => json(url.includes('$skip=0') ? page(2, 0) : page(1, 2)))
    const items = await c.listMyWorkItems('2026-09-21', '2026-10-21', 2)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ id: 'w-0', issue: 'ABC-1', day: '2026-10-21', minutes: 30, text: '' })
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[0][0]).toContain('/api/workItems?author=me&startDate=2026-09-21&endDate=2026-10-21')
    expect(f.mock.calls[0][0]).toContain('$top=2&$skip=0')
    expect(f.mock.calls[1][0]).toContain('$skip=2')
  })

  it('keeps the local day for work items with a time of day', async () => {
    // booked by the app at 00:30 Berlin = 22:30 UTC the day before
    const { c } = client(() =>
      json([{ id: 'w', date: at('2026-10-22 00:30'), duration: { minutes: 30 }, text: 't', issue: { idReadable: 'ABC-1' } }])
    )
    expect((await c.listMyWorkItems('2026-10-01', '2026-10-31'))[0].day).toBe('2026-10-22')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/youtrack.test.ts`
Expected: FAIL, `c.listMyWorkItems is not a function`.

- [ ] **Step 3: Implement** — in `desktop/src/shared/types.ts` nach `interface RemoteIssue { … }`:

```ts
/** Own work item from YouTrack; `day` is local `YYYY-MM-DD`. */
export interface RemoteWorkItem {
  id: string
  issue: string
  day: string
  minutes: number
  text: string
}
```

In `desktop/src/core/youtrack.ts`: Import erweitern auf `import type { QuerySuggestion, RemoteIssue, RemoteProject, RemoteWorkItem, RemoteWorkType } from '@shared/types'` und `import { localDay } from '@shared/timecalc'` ergänzen. Methode nach `listWorkTypes` einfügen:

```ts
  /** Own work items dated in [fromDay, toDay] (`YYYY-MM-DD`), all pages. */
  async listMyWorkItems(fromDay: string, toDay: string, pageSize = 500): Promise<RemoteWorkItem[]> {
    const out: RemoteWorkItem[] = []
    for (let skip = 0; ; skip += pageSize) {
      const page = await this.request<WorkItemDto[]>(
        'GET',
        `/workItems?author=me&startDate=${fromDay}&endDate=${toDay}&fields=${WORK_ITEM_FIELDS}&$top=${pageSize}&$skip=${skip}`
      )
      out.push(...page.map(toWorkItem))
      if (page.length < pageSize) return out
    }
  }
```

Am Dateiende, nach `toIssue`:

```ts
const WORK_ITEM_FIELDS = 'id,date,duration(minutes),text,issue(idReadable)'

interface WorkItemDto {
  id: string
  date: number
  duration: { minutes: number } | null
  text: string | null
  issue: { idReadable: string } | null
}

/** Days entered in YouTrack are stored as UTC midnight; items booked by the app keep their local start time. */
function workItemDay(ms: number): string {
  const d = new Date(ms)
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  return utcMidnight ? d.toISOString().slice(0, 10) : localDay(ms)
}

const toWorkItem = (w: WorkItemDto): RemoteWorkItem => ({
  id: w.id,
  issue: w.issue?.idReadable ?? '',
  day: workItemDay(w.date),
  minutes: w.duration?.minutes ?? 0,
  text: w.text ?? ''
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/youtrack.test.ts && npm run typecheck`
Expected: PASS, keine Typfehler.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/core/youtrack.ts desktop/test/youtrack.test.ts
git commit -m "YouTrack client: list own work items"
```

---

### Task 2: Abgleich `pullWorkItems`

**Files:**
- Modify: `desktop/src/core/repo.ts` (Abschnitt Bookings, nach `bookingsForEntries`)
- Create: `desktop/src/core/pull.ts`
- Test: `desktop/test/pull.test.ts`

**Interfaces:**
- Consumes: `RemoteWorkItem` (Task 1); `buildDrafts`, `entryState`, `CONNECTOR` aus `@core/booking`; `Repo`.
- Produces: `Repo.bookingByRemoteId(connector: string, remoteId: string): BookingRow | undefined`; `Repo.bookedBetween(connector: string, fromDay: string, toDay: string): BookingRow[]`; in `@core/pull`: `PULL_DAYS = 31`, `interface PullApi { listMyWorkItems(fromDay: string, toDay: string): Promise<RemoteWorkItem[]> }`, `interface PullResult { created: number; updated: number; unbooked: number }`, `pullWorkItems(repo: Repo, api: PullApi, now: number): Promise<PullResult>`.

- [ ] **Step 1: Write the failing tests** — `desktop/test/pull.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildDrafts, CONNECTOR, entryState } from '@core/booking'
import { pullWorkItems } from '@core/pull'
import type { Repo } from '@core/repo'
import type { RemoteWorkItem } from '@shared/types'
import { at, setup } from './helpers'

const wi = (o: Partial<RemoteWorkItem> = {}): RemoteWorkItem => ({ id: 'w-1', issue: 'ABC-1', day: '2026-10-21', minutes: 60, text: '', ...o })

/** Marks every day of an entry as booked, as a successful push would. */
function book(repo: Repo, entryId: number, ...remoteIds: string[]) {
  const e = repo.getEntry(entryId)!
  buildDrafts(e, repo.getProject(e.projectId)).forEach((d, i) =>
    repo.upsertBooking({
      entryId,
      day: d.day,
      connector: CONNECTOR,
      remoteId: remoteIds[i],
      remoteIssue: d.issue,
      syncedHash: d.hash,
      status: 'booked',
      error: null,
      attempts: 0,
      nextTry: 0,
      syncedAt: 0
    })
  )
}

async function pullSetup(start = '2026-10-21 18:00') {
  const s = await setup(start)
  const p = s.svc.createProject({ name: 'Ticket', kind: 'youtrack', ytIssue: 'ABC-1' })
  let items: RemoteWorkItem[] = []
  const api = { listMyWorkItems: vi.fn(async () => items) }
  const pull = (xs: RemoteWorkItem[]) => {
    items = xs
    return pullWorkItems(s.repo, api, s.clock.t)
  }
  const state = (id: number) => {
    const e = s.repo.getEntry(id)!
    return entryState(e, s.repo.getProject(e.projectId), s.repo.bookingsOfEntry(id, CONNECTOR))
  }
  const ofTile = (projectId = p.id) => s.repo.entriesBetween(0, Infinity).filter((e) => e.projectId === projectId)
  return { ...s, p, api, pull, state, ofTile }
}

describe('pull from YouTrack', () => {
  it('creates new work items behind the last entry of the day as booked', async () => {
    const { svc, api, pull, state, ofTile } = await pullSetup()
    const meeting = svc.createProject({ name: 'Meeting' })
    svc.createEntry({ projectId: meeting.id, start: at('2026-10-21 09:00'), end: at('2026-10-21 10:30'), note: '', ytIssue: null })
    expect(await pull([wi({ minutes: 45, text: 'Review' }), wi({ id: 'zero', minutes: 0 })])).toEqual({ created: 1, updated: 0, unbooked: 0 })
    expect(api.listMyWorkItems).toHaveBeenCalledWith('2026-09-21', '2026-10-21')
    const [e] = ofTile()
    expect(e).toMatchObject({ start: at('2026-10-21 10:30'), end: at('2026-10-21 11:15'), note: 'Review', ytIssue: null })
    expect(state(e.id)).toBe('booked')
    expect(await pull([wi({ minutes: 45, text: 'Review' })])).toEqual({ created: 0, updated: 0, unbooked: 0 })
  })

  it('places new items at the first presence, else at 09:00', async () => {
    const { svc, pull, ofTile } = await pullSetup()
    svc.createPresence(at('2026-10-21 07:45'), at('2026-10-21 16:00'))
    await pull([wi({ id: 'a' }), wi({ id: 'b', day: '2026-10-20' })])
    expect(ofTile().map((e) => e.start)).toEqual([at('2026-10-20 09:00'), at('2026-10-21 07:45')])
  })

  it('never lets a new entry run past midnight', async () => {
    const { svc, pull, ofTile, p } = await pullSetup('2026-10-22 08:00')
    const meeting = svc.createProject({ name: 'Meeting' })
    svc.createEntry({ projectId: meeting.id, start: at('2026-10-21 22:00'), end: at('2026-10-21 23:30'), note: '', ytIssue: null })
    await pull([wi()])
    const [e] = ofTile()
    expect(e.end).toBe(at('2026-10-22 00:00'))
    expect(buildDrafts(e, p)).toHaveLength(1)
  })

  it('applies remote duration, note and day without queueing a push', async () => {
    const { svc, repo, pull, state } = await pullSetup()
    const p = repo.listProjects()[0]
    const e = svc.createEntry({ projectId: p.id, start: at('2026-10-21 09:00'), end: at('2026-10-21 10:00'), note: 'n', ytIssue: null })
    book(repo, e.id, 'w-1')
    expect(await pull([wi({ minutes: 90, text: 'neu' })])).toEqual({ created: 0, updated: 1, unbooked: 0 })
    expect(repo.getEntry(e.id)).toMatchObject({ start: at('2026-10-21 09:00'), end: at('2026-10-21 10:30'), note: 'neu' })
    expect(state(e.id)).toBe('booked')
    expect(repo.dueBookings(CONNECTOR, Infinity)).toEqual([])

    await pull([wi({ minutes: 90, text: 'neu', day: '2026-10-20' })])
    expect(repo.getEntry(e.id)).toMatchObject({ start: at('2026-10-20 09:00'), end: at('2026-10-20 10:30') })
    expect(repo.bookingsOfEntry(e.id, CONNECTOR).map((r) => r.day)).toEqual(['2026-10-20'])
    expect(state(e.id)).toBe('booked')
  })

  it('treats a known item moved into the window as a change, not a new entry', async () => {
    const { svc, repo, pull, p, ofTile } = await pullSetup()
    const e = svc.createEntry({ projectId: p.id, start: at('2026-09-01 09:00'), end: at('2026-09-01 10:00'), note: '', ytIssue: null })
    book(repo, e.id, 'w-old')
    expect(await pull([wi({ id: 'w-old' })])).toEqual({ created: 0, updated: 1, unbooked: 0 })
    expect(ofTile()).toHaveLength(1)
    expect(repo.getEntry(e.id)!.start).toBe(at('2026-10-21 09:00'))
  })

  it('keeps a longer remote duration inside the day', async () => {
    const { svc, repo, pull, p } = await pullSetup('2026-10-22 08:00')
    const e = svc.createEntry({ projectId: p.id, start: at('2026-10-21 23:00'), end: at('2026-10-21 23:30'), note: '', ytIssue: null })
    book(repo, e.id, 'w-1')
    await pull([wi({ minutes: 90 })])
    expect(repo.getEntry(e.id)).toMatchObject({ start: at('2026-10-21 22:30'), end: at('2026-10-22 00:00') })
  })

  it('unbooks entries whose work item was deleted', async () => {
    const { svc, repo, pull, p, state } = await pullSetup()
    const e = svc.createEntry({ projectId: p.id, start: at('2026-10-21 09:00'), end: at('2026-10-21 10:00'), note: '', ytIssue: null })
    book(repo, e.id, 'w-1')
    expect(await pull([])).toEqual({ created: 0, updated: 0, unbooked: 1 })
    expect(repo.getEntry(e.id)).toBeDefined()
    expect(state(e.id)).toBe('open')
    expect(repo.dueBookings(CONNECTOR, Infinity)).toEqual([])
  })

  it('leaves pending and locally changed bookings alone', async () => {
    const { svc, repo, pull, p } = await pullSetup()
    const a = svc.createEntry({ projectId: p.id, start: at('2026-10-21 09:00'), end: at('2026-10-21 10:00'), note: '', ytIssue: null })
    book(repo, a.id, 'w-a')
    svc.updateEntry(a.id, { note: 'lokal' }) // requeues the row as pending
    const b = svc.createEntry({ projectId: p.id, start: at('2026-10-21 11:00'), end: at('2026-10-21 12:00'), note: '', ytIssue: null })
    book(repo, b.id, 'w-b')
    repo.updateEntry(b.id, { note: 'x' }) // changed without requeue: hash no longer matches
    expect(await pull([wi({ id: 'w-a', minutes: 120 }), wi({ id: 'w-b', minutes: 120 })])).toEqual({ created: 0, updated: 0, unbooked: 0 })
    expect(repo.getEntry(a.id)).toMatchObject({ end: at('2026-10-21 10:00'), note: 'lokal' })
    expect(repo.getEntry(b.id)).toMatchObject({ end: at('2026-10-21 12:00'), note: 'x' })
    expect(await pull([])).toEqual({ created: 0, updated: 0, unbooked: 1 }) // only b, a is pending
  })

  it('leaves entries over midnight alone', async () => {
    const { svc, repo, pull, p } = await pullSetup('2026-10-22 08:00')
    const e = svc.createEntry({ projectId: p.id, start: at('2026-10-21 23:00'), end: at('2026-10-22 01:00'), note: '', ytIssue: null })
    book(repo, e.id, 'w-1', 'w-2')
    await pull([wi({ id: 'w-1', minutes: 5 }), wi({ id: 'w-2', day: '2026-10-22', minutes: 60 })])
    expect(repo.getEntry(e.id)).toMatchObject({ start: at('2026-10-21 23:00'), end: at('2026-10-22 01:00') })
  })

  it('ignores tickets without a tile and prefers an active favourite tile', async () => {
    const { svc, pull, ofTile } = await pullSetup()
    const fav = svc.createProject({ name: 'Fav', kind: 'youtrack', ytIssue: 'ABC-1', favorite: true })
    svc.createProject({ name: 'Alt', kind: 'youtrack', ytIssue: 'abc-1', favorite: true, archived: true })
    expect(await pull([wi({ id: 'x', issue: 'XYZ-9' }), wi({ id: 'y' })])).toEqual({ created: 1, updated: 0, unbooked: 0 })
    expect(ofTile(fav.id)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/pull.test.ts`
Expected: FAIL, `Failed to resolve import "@core/pull"`.

- [ ] **Step 3: Implement the repo queries** — in `desktop/src/core/repo.ts` nach `bookingsForEntries(…) { … }`:

```ts
  bookingByRemoteId(connector: string, remoteId: string): BookingRow | undefined {
    const r = this.db.get<BookingDbRow>('SELECT * FROM booking WHERE connector = ? AND remote_id = ?', [connector, remoteId])
    return r && toBooking(r)
  }

  /** Booked rows with a remote work item on days in [fromDay, toDay]. */
  bookedBetween(connector: string, fromDay: string, toDay: string): BookingRow[] {
    return this.db
      .all<BookingDbRow>(
        `SELECT * FROM booking WHERE connector = ? AND status = 'booked' AND remote_id IS NOT NULL AND day BETWEEN ? AND ?`,
        [connector, fromDay, toDay]
      )
      .map(toBooking)
  }
```

- [ ] **Step 4: Implement `desktop/src/core/pull.ts`**

```ts
import type { BookingRow, Entry, Project, RemoteWorkItem } from '@shared/types'
import { addDays, dayRange, localDay } from '@shared/timecalc'
import { buildDrafts, CONNECTOR } from './booking'
import type { Repo } from './repo'

export const PULL_DAYS = 31

export interface PullApi {
  listMyWorkItems(fromDay: string, toDay: string): Promise<RemoteWorkItem[]>
}

export interface PullResult {
  created: number
  updated: number
  unbooked: number
}

/**
 * Brings own work items of the last PULL_DAYS days into the local data: changes and deletions of
 * items the app booked, and new items on a tile's ticket. Rows that are not cleanly booked
 * (pending, error, changed locally) are left alone, so local edits win.
 */
export async function pullWorkItems(repo: Repo, api: PullApi, now: number): Promise<PullResult> {
  const toDay = localDay(now)
  const fromDay = addDays(toDay, -(PULL_DAYS - 1))
  const items = await api.listMyWorkItems(fromDay, toDay)
  const res: PullResult = { created: 0, updated: 0, unbooked: 0 }
  repo.tx(() => {
    const seen = new Set(items.map((i) => i.id))
    for (const row of repo.bookedBetween(CONNECTOR, fromDay, toDay)) {
      if (seen.has(row.remoteId!)) continue
      repo.deleteBooking(row.entryId, row.day, CONNECTOR)
      res.unbooked++
    }
    const tiles = tilesByIssue(repo.listProjects())
    for (const item of items) {
      if (item.minutes < 1) continue
      const row = repo.bookingByRemoteId(CONNECTOR, item.id)
      if (row) {
        if (applyRemote(repo, row, item, now)) res.updated++
        continue
      }
      const tile = tiles.get(item.issue.toUpperCase())
      if (!tile) continue
      const dur = item.minutes * 60_000
      const start = fitDay(item.day, slotStart(repo, item.day, null, now), dur)
      const entry = repo.createEntry({ projectId: tile.id, start, end: start + dur, note: item.text, ytIssue: null })
      markBooked(repo, entry, tile, item.id, now)
      res.created++
    }
  })
  return res
}

/** Ticket -> tile that receives new work items: active before archived, favourites first, then oldest. */
function tilesByIssue(projects: Project[]): Map<string, Project> {
  const m = new Map<string, Project>()
  const order = [...projects].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || Number(b.favorite) - Number(a.favorite) || a.id - b.id
  )
  for (const p of order) {
    const key = p.kind === 'youtrack' ? p.ytIssue?.toUpperCase() : undefined
    if (key && !m.has(key)) m.set(key, p)
  }
  return m
}

function applyRemote(repo: Repo, row: BookingRow, item: RemoteWorkItem, now: number): boolean {
  if (row.status !== 'booked') return false
  const entry = repo.getEntry(row.entryId)
  if (!entry || entry.end === null) return false
  const project = repo.getProject(entry.projectId)
  const drafts = buildDrafts(entry, project)
  if (drafts.length !== 1 || drafts[0].hash !== row.syncedHash) return false
  const d = drafts[0]
  if (d.minutes === item.minutes && d.text === item.text && d.day === item.day) return false
  const dur = item.minutes * 60_000
  const start = fitDay(item.day, d.day === item.day ? entry.start : slotStart(repo, item.day, entry.id, now), dur)
  const updated = repo.updateEntry(entry.id, { start, end: start + dur, note: item.text })
  repo.deleteBooking(row.entryId, row.day, CONNECTOR)
  markBooked(repo, updated, project!, row.remoteId!, now)
  return true
}

function markBooked(repo: Repo, entry: Entry, project: Project, remoteId: string, now: number): void {
  const d = buildDrafts(entry, project)[0]
  repo.upsertBooking({
    entryId: entry.id,
    day: d.day,
    connector: CONNECTOR,
    remoteId,
    remoteIssue: d.issue,
    syncedHash: d.hash,
    status: 'booked',
    error: null,
    attempts: 0,
    nextTry: 0,
    syncedAt: now
  })
}

/** Behind the day's last entry, else at the first presence, else 09:00. */
function slotStart(repo: Repo, day: string, excludeId: number | null, now: number): number {
  const [from, to] = dayRange(day)
  const ends = repo
    .entriesBetween(from, to)
    .filter((e) => e.id !== excludeId)
    .map((e) => e.end ?? now)
  if (ends.length > 0) return Math.max(...ends)
  const presence = repo.presencesBetween(from, to)[0]
  return presence ? Math.max(presence.start, from) : new Date(from).setHours(9, 0, 0, 0)
}

/** Keeps [start, start + dur) inside the day so the entry yields exactly one work item. */
function fitDay(day: string, start: number, dur: number): number {
  const [from, to] = dayRange(day)
  return Math.max(from, Math.min(start, to - dur))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck`
Expected: alle Tests PASS (inkl. der bestehenden), keine Typfehler.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/core/repo.ts desktop/src/core/pull.ts desktop/test/pull.test.ts
git commit -m "Pull own YouTrack work items into local entries"
```

---

### Task 3: `SyncQueue.pullOnce` und Einstellung

**Files:**
- Modify: `desktop/src/shared/types.ts` (`Settings`, `DEFAULT_SETTINGS`)
- Modify: `desktop/src/core/booking.ts` (`SyncQueue`)
- Test: `desktop/test/booking.test.ts`

**Interfaces:**
- Consumes: `pullWorkItems`, `PullApi` (Task 2).
- Produces: Einstellung `'youtrack.pull': boolean` (Standard `true`); in `@core/booking`: `PULL_INTERVAL_MS = 10 * 60_000`, `type SyncApi = WorkItemApi & PullApi`, `SyncQueue` nimmt `api: () => SyncApi | null`, neues Feld `lastPull: number | null` (Zeitpunkt des letzten erfolgreichen Pulls), neue Methode `pullOnce(force = false): Promise<void>`.

- [ ] **Step 1: Write the failing tests** — in `desktop/test/booking.test.ts`:

Import ergänzen:

```ts
import { buildDrafts, CONNECTOR, minutesOf, PULL_INTERVAL_MS, SyncQueue, backoff, type SyncApi } from '@core/booking'
```

`fakeApi()` so anpassen, dass es `SyncApi` erfüllt (Typ und neues Feld):

```ts
function fakeApi() {
  let n = 0
  const items = new Map<string, { issue: string; minutes: number; text: string }>()
  const api: SyncApi & { items: typeof items } = {
    items,
    createWorkItem: vi.fn(async (d) => {
      const id = `wi-${++n}`
      items.set(id, { issue: d.issue, minutes: d.minutes, text: d.text })
      return id
    }),
    updateWorkItem: vi.fn(async (id, d) => {
      if (!items.has(id)) throw new YouTrackError('notfound', 'gone', 404)
      items.set(id, { issue: d.issue, minutes: d.minutes, text: d.text })
    }),
    deleteWorkItem: vi.fn(async (_issue, id) => {
      items.delete(id)
    }),
    listMyWorkItems: vi.fn(async () => [])
  }
  return api
}
```

Neuer `describe`-Block am Dateiende:

```ts
describe('pull scheduling', () => {
  it('pulls at most every 10 minutes unless forced', async () => {
    const { q, api, clock } = await bookedSetup()
    await q.pullOnce()
    await q.pullOnce()
    expect(api.listMyWorkItems).toHaveBeenCalledTimes(1)
    expect(q.lastPull).toBe(clock.t)
    clock.t += PULL_INTERVAL_MS
    await q.pullOnce()
    expect(api.listMyWorkItems).toHaveBeenCalledTimes(2)
    await q.pullOnce(true)
    expect(api.listMyWorkItems).toHaveBeenCalledTimes(3)
  })

  it('does not pull when disabled or while a push runs', async () => {
    const { svc, q, api } = await bookedSetup()
    svc.setSettings({ 'youtrack.pull': false })
    await q.pullOnce(true)
    expect(api.listMyWorkItems).not.toHaveBeenCalled()
    svc.setSettings({ 'youtrack.pull': true })
    svc.bookRange('2026-10-21', '2026-10-21')
    const push = q.runOnce()
    await q.pullOnce(true)
    expect(api.listMyWorkItems).not.toHaveBeenCalled()
    await push
    await q.pullOnce(true)
    expect(api.listMyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('stops on an auth error during pull', async () => {
    const { q, api } = await bookedSetup()
    vi.mocked(api.listMyWorkItems).mockRejectedValueOnce(new YouTrackError('auth', 'YouTrack 401', 401))
    await q.pullOnce(true)
    expect(q.authError).toBe(true)
    expect(q.lastError).toBe('YouTrack 401')
    expect(q.lastPull).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/booking.test.ts`
Expected: FAIL, `q.pullOnce is not a function` (und `PULL_INTERVAL_MS` undefined).

- [ ] **Step 3: Add the setting** — in `desktop/src/shared/types.ts`: in `interface Settings` nach `'youtrack.bookingMode': BookingMode` die Zeile `'youtrack.pull': boolean`, in `DEFAULT_SETTINGS` nach `'youtrack.bookingMode': 'manual',` die Zeile `'youtrack.pull': true,`.

- [ ] **Step 4: Implement in `desktop/src/core/booking.ts`**

Import oben ergänzen:

```ts
import { pullWorkItems, type PullApi } from './pull'
```

(`pull.ts` importiert `buildDrafts`/`CONNECTOR` aus `booking.ts`; der Zyklus ist unkritisch, weil beide Seiten die Importe erst zur Laufzeit in Funktionen nutzen.)

Nach `BACKOFF_MAX_MS`:

```ts
export const PULL_INTERVAL_MS = 10 * 60_000

export type SyncApi = WorkItemApi & PullApi
```

In `SyncQueue`: Feld `lastPull: number | null = null` und `private pullTried: number | null = null` neben `lastRun`; Konstruktor-Parameter `api: () => SyncApi | null`. Methode nach `runOnce()`:

```ts
  /** Fetches changes from YouTrack, at most every PULL_INTERVAL_MS unless forced. Never runs alongside a push. */
  async pullOnce(force = false): Promise<void> {
    if (this.busy || this.authError || !this.repo.getSettings()['youtrack.pull']) return
    const api = this.api()
    if (!api) return
    const now = this.clock()
    if (!force && this.pullTried !== null && now - this.pullTried < PULL_INTERVAL_MS) return
    this.busy = true
    this.pullTried = now
    try {
      await pullWorkItems(this.repo, api, now)
      this.lastPull = now
      this.lastError = null
    } catch (err) {
      this.lastError = (err as Error).message ?? String(err)
      if (err instanceof YouTrackError && err.kind === 'auth') this.authError = true
    } finally {
      this.busy = false
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck`
Expected: alle Tests PASS. Typfehler in `src/main/index.ts` dürfen hier nicht auftreten, weil `YouTrackClient` seit Task 1 `listMyWorkItems` hat; falls doch, Task 1 prüfen.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/core/booking.ts desktop/test/booking.test.ts
git commit -m "Sync queue: scheduled pull from YouTrack, sharing the push lock"
```

---

### Task 4: Main-Prozess, Einstellungen, Doku

**Files:**
- Modify: `desktop/src/shared/types.ts` (`SyncStatus`)
- Modify: `desktop/src/main/api.ts` (`syncStatus`, `syncNow`)
- Modify: `desktop/src/main/index.ts` (`runSync`)
- Modify: `desktop/src/renderer/src/views/Settings.tsx`
- Modify: `docs/specs/2026-10-22-timetoddler-design.md`, `desktop/README.md`

**Interfaces:**
- Consumes: `SyncQueue.pullOnce`, `SyncQueue.lastPull`, Einstellung `youtrack.pull` (Task 3).
- Produces: `SyncStatus.lastPull: number | null`.

- [ ] **Step 1: Status-Feld** — in `desktop/src/shared/types.ts`, `interface SyncStatus`, nach `lastRun: number | null`:

```ts
  lastPull: number | null
```

In `desktop/src/main/api.ts`, `syncStatus()`, nach `lastRun: deps.queue.lastRun`:

```ts
    lastRun: deps.queue.lastRun,
    lastPull: deps.queue.lastPull
```

- [ ] **Step 2: Pull nach dem Push anstoßen** — in `desktop/src/main/api.ts` `syncNow` ersetzen:

```ts
    syncNow: () => {
      queue.resetAuth()
      void queue
        .runOnce()
        .then(() => queue.pullOnce(true))
        .finally(deps.notify)
    },
```

In `desktop/src/main/index.ts` `runSync` ersetzen:

```ts
  const runSync = (): void => {
    void queue
      .runOnce()
      .then(() => queue.pullOnce())
      .finally(notify)
  }
```

- [ ] **Step 3: Einstellungen** — in `desktop/src/renderer/src/views/Settings.tsx` direkt nach dem `</select>` des Feldes „Buchen“ (noch innerhalb von `<div className="form">`):

```tsx
          <span />
          <label className="check">
            <input type="checkbox" checked={s['youtrack.pull']} onChange={(e) => set({ 'youtrack.pull': e.target.checked })} />
            Buchungen aus YouTrack holen (eigene, letzte 31 Tage)
          </label>
```

In der Statuszeile nach `{sync.lastRun && …}`:

```tsx
              {sync.lastPull && ` · geholt ${new Date(sync.lastPull).toLocaleTimeString('de-DE')}`}
```

- [ ] **Step 4: Doku** — in `docs/specs/2026-10-22-timetoddler-design.md` den Satz

`**Grundsatz:** Die lokale Datenbank ist führend, die App funktioniert ohne Sync vollständig. Sync ist ein **Einweg-Push** lokaler Einträge plus das Lesen von Stammdaten (Projekte, Tickets). Änderungen an Work Items direkt in YouTrack holt die App nicht zurück.`

ersetzen durch

`**Grundsatz:** Die lokale Datenbank ist führend, die App funktioniert ohne Sync vollständig. Sync pusht lokale Einträge, liest Stammdaten (Projekte, Tickets) und holt eigene Work Items zurück (Zwei-Wege-Sync, siehe `2026-10-23-youtrack-two-way-sync-design.md`); bei Konflikten gewinnt die App.`

In `desktop/README.md`, Abschnitt „YouTrack“, nach der Zeile „Nach dem Buchen geänderte Einträge …“:

```markdown
- Zurück aus YouTrack (alle 10 min und bei „Jetzt synchronisieren“, abschaltbar): eigene Work Items der letzten 31 Tage. Änderungen an gebuchten Einträgen werden übernommen (lokale Änderungen gehen vor), in YouTrack gelöschte werden wieder „offen“, neue Buchungen auf dem Ticket einer Kachel erscheinen als Eintrag hinter dem letzten Eintrag des Tages.
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: keine Typfehler, alle Tests PASS, Build erfolgreich.

Manuell (mit echtem YouTrack): App mit `npm run dev` starten, in YouTrack auf das Standard-Ticket einer Kachel 30 min für heute buchen, „Jetzt synchronisieren“ → Eintrag erscheint in der Tagesansicht als „gebucht“. Dauer in YouTrack ändern → nach Sync übernommen. Work Item in YouTrack löschen → Eintrag „offen“. Dabei prüfen, ob ein von der App gebuchtes Work Item seine Uhrzeit in `date` behält (Spec-Risiko).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shared/types.ts desktop/src/main/api.ts desktop/src/main/index.ts desktop/src/renderer/src/views/Settings.tsx docs/specs/2026-10-22-timetoddler-design.md desktop/README.md
git commit -m "Wire YouTrack pull into sync loop and settings"
```
