import type { Db } from './db'
import {
  DEFAULT_SETTINGS,
  type BookingRow,
  type Entry,
  type EntryInput,
  type Pause,
  type Presence,
  type Project,
  type ProjectInput,
  type Settings
} from '@shared/types'

interface ProjectRow {
  id: number
  kind: Project['kind']
  name: string
  client: string
  color: string
  favorite: number
  archived: number
  created_at: number
  yt_project_id: string | null
  yt_issue: string | null
  yt_work_type_id: string | null
  yt_stale: number
}

interface EntryRow {
  id: number
  project_id: number
  start_utc: number
  end_utc: number | null
  note: string
  yt_issue: string | null
}

interface PresenceRow {
  id: number
  start_utc: number
  end_utc: number | null
}

interface PauseRow extends PresenceRow {
  presence_id: number
  resume_project_id: number | null
}

interface BookingDbRow {
  entry_id: number
  day: string
  connector: string
  remote_id: string | null
  remote_issue: string | null
  synced_hash: string | null
  status: BookingRow['status']
  error: string | null
  attempts: number
  next_try: number
  synced_at: number | null
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  client: r.client,
  color: r.color,
  favorite: !!r.favorite,
  archived: !!r.archived,
  createdAt: r.created_at,
  ytProjectId: r.yt_project_id,
  ytIssue: r.yt_issue,
  ytWorkTypeId: r.yt_work_type_id,
  ytStale: !!r.yt_stale
})

const toEntry = (r: EntryRow): Entry => ({
  id: r.id,
  projectId: r.project_id,
  start: r.start_utc,
  end: r.end_utc,
  note: r.note,
  ytIssue: r.yt_issue
})

const toPresence = (r: PresenceRow): Presence => ({ id: r.id, start: r.start_utc, end: r.end_utc })

const toPause = (r: PauseRow): Pause => ({
  id: r.id,
  presenceId: r.presence_id,
  start: r.start_utc,
  end: r.end_utc,
  resumeProjectId: r.resume_project_id
})

const toBooking = (r: BookingDbRow): BookingRow => ({
  entryId: r.entry_id,
  day: r.day,
  connector: r.connector,
  remoteId: r.remote_id,
  remoteIssue: r.remote_issue,
  syncedHash: r.synced_hash,
  status: r.status,
  error: r.error,
  attempts: r.attempts,
  nextTry: r.next_try,
  syncedAt: r.synced_at
})

const b = (v: boolean): number => (v ? 1 : 0)

/** Intervals overlapping [from, to); open intervals count as still running. */
const OVERLAP = '(start_utc < ? AND (end_utc IS NULL OR end_utc > ?))'

export class Repo {
  constructor(readonly db: Db) {}

  tx<T>(fn: () => T): T {
    return this.db.tx(fn)
  }

  // ---- projects -------------------------------------------------------

  listProjects(): Project[] {
    return this.db.all<ProjectRow>('SELECT * FROM project ORDER BY name COLLATE NOCASE').map(toProject)
  }

  getProject(id: number): Project | undefined {
    const r = this.db.get<ProjectRow>('SELECT * FROM project WHERE id = ?', [id])
    return r && toProject(r)
  }

  createProject(p: ProjectInput, now: number): Project {
    const { id } = this.db.run(
      `INSERT INTO project(kind, name, client, color, favorite, archived, created_at, yt_project_id, yt_issue, yt_work_type_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [p.kind, p.name, p.client, p.color, b(p.favorite), b(p.archived), now, p.ytProjectId, p.ytIssue, p.ytWorkTypeId]
    )
    return this.getProject(id)!
  }

  updateProject(id: number, p: Partial<ProjectInput> & { ytStale?: boolean }): Project {
    const cur = this.getProject(id)
    if (!cur) throw new Error(`Tätigkeit ${id} nicht gefunden`)
    const n = { ...cur, ...p }
    this.db.run(
      `UPDATE project SET kind=?, name=?, client=?, color=?, favorite=?, archived=?, yt_project_id=?, yt_issue=?,
       yt_work_type_id=?, yt_stale=? WHERE id=?`,
      [n.kind, n.name, n.client, n.color, b(n.favorite), b(n.archived), n.ytProjectId, n.ytIssue, n.ytWorkTypeId, b(n.ytStale), id]
    )
    return this.getProject(id)!
  }

  projectHasEntries(id: number): boolean {
    return !!this.db.get('SELECT 1 FROM entry WHERE project_id = ? LIMIT 1', [id])
  }

  deleteProject(id: number): void {
    this.db.run('DELETE FROM project WHERE id = ?', [id])
  }

  // ---- entries --------------------------------------------------------

  getEntry(id: number): Entry | undefined {
    const r = this.db.get<EntryRow>('SELECT * FROM entry WHERE id = ?', [id])
    return r && toEntry(r)
  }

  runningEntry(): Entry | null {
    const r = this.db.get<EntryRow>('SELECT * FROM entry WHERE end_utc IS NULL')
    return r ? toEntry(r) : null
  }

  lastEntry(): Entry | null {
    const r = this.db.get<EntryRow>('SELECT * FROM entry ORDER BY start_utc DESC LIMIT 1')
    return r ? toEntry(r) : null
  }

  entriesBetween(from: number, to: number): Entry[] {
    return this.db
      .all<EntryRow>(`SELECT * FROM entry WHERE ${OVERLAP} ORDER BY start_utc`, [to, from])
      .map(toEntry)
  }

  entriesOfProject(projectId: number): Entry[] {
    return this.db.all<EntryRow>('SELECT * FROM entry WHERE project_id = ?', [projectId]).map(toEntry)
  }

  createEntry(e: EntryInput): Entry {
    const { id } = this.db.run(
      'INSERT INTO entry(project_id, start_utc, end_utc, note, yt_issue) VALUES (?,?,?,?,?)',
      [e.projectId, e.start, e.end, e.note, e.ytIssue]
    )
    return this.getEntry(id)!
  }

  updateEntry(id: number, e: Partial<EntryInput>): Entry {
    const cur = this.getEntry(id)
    if (!cur) throw new Error(`Eintrag ${id} nicht gefunden`)
    const n = { ...cur, ...e }
    this.db.run('UPDATE entry SET project_id=?, start_utc=?, end_utc=?, note=?, yt_issue=? WHERE id=?', [
      n.projectId,
      n.start,
      n.end,
      n.note,
      n.ytIssue,
      id
    ])
    return this.getEntry(id)!
  }

  deleteEntry(id: number): void {
    this.db.run('DELETE FROM entry WHERE id = ?', [id])
  }

  // ---- presence / pause -------------------------------------------------

  openPresence(): Presence | null {
    const r = this.db.get<PresenceRow>('SELECT * FROM presence WHERE end_utc IS NULL')
    return r ? toPresence(r) : null
  }

  getPresence(id: number): Presence | undefined {
    const r = this.db.get<PresenceRow>('SELECT * FROM presence WHERE id = ?', [id])
    return r && toPresence(r)
  }

  presencesBetween(from: number, to: number): Presence[] {
    return this.db
      .all<PresenceRow>(`SELECT * FROM presence WHERE ${OVERLAP} ORDER BY start_utc`, [to, from])
      .map(toPresence)
  }

  createPresence(start: number, end: number | null): Presence {
    const { id } = this.db.run('INSERT INTO presence(start_utc, end_utc) VALUES (?,?)', [start, end])
    return this.getPresence(id)!
  }

  updatePresence(id: number, start: number, end: number | null): void {
    this.db.run('UPDATE presence SET start_utc=?, end_utc=? WHERE id=?', [start, end, id])
  }

  deletePresence(id: number): void {
    this.db.run('DELETE FROM presence WHERE id = ?', [id])
  }

  openPause(): Pause | null {
    const r = this.db.get<PauseRow>('SELECT * FROM pause WHERE end_utc IS NULL')
    return r ? toPause(r) : null
  }

  getPause(id: number): Pause | undefined {
    const r = this.db.get<PauseRow>('SELECT * FROM pause WHERE id = ?', [id])
    return r && toPause(r)
  }

  pausesBetween(from: number, to: number): Pause[] {
    return this.db
      .all<PauseRow>(`SELECT * FROM pause WHERE ${OVERLAP} ORDER BY start_utc`, [to, from])
      .map(toPause)
  }

  createPause(presenceId: number, start: number, end: number | null, resumeProjectId: number | null): Pause {
    const { id } = this.db.run(
      'INSERT INTO pause(presence_id, start_utc, end_utc, resume_project_id) VALUES (?,?,?,?)',
      [presenceId, start, end, resumeProjectId]
    )
    return this.getPause(id)!
  }

  updatePause(id: number, start: number, end: number | null): void {
    this.db.run('UPDATE pause SET start_utc=?, end_utc=? WHERE id=?', [start, end, id])
  }

  deletePause(id: number): void {
    this.db.run('DELETE FROM pause WHERE id = ?', [id])
  }

  // ---- bookings ---------------------------------------------------------

  bookingsOfEntry(entryId: number, connector: string): BookingRow[] {
    return this.db
      .all<BookingDbRow>('SELECT * FROM booking WHERE entry_id = ? AND connector = ?', [entryId, connector])
      .map(toBooking)
  }

  bookingsForEntries(entryIds: number[], connector: string): BookingRow[] {
    if (entryIds.length === 0) return []
    const marks = entryIds.map(() => '?').join(',')
    return this.db
      .all<BookingDbRow>(`SELECT * FROM booking WHERE connector = ? AND entry_id IN (${marks})`, [connector, ...entryIds])
      .map(toBooking)
  }

  dueBookings(connector: string, now: number): BookingRow[] {
    return this.db
      .all<BookingDbRow>(
        `SELECT * FROM booking WHERE connector = ? AND status IN ('pending','delete') AND next_try <= ?
         ORDER BY entry_id, day`,
        [connector, now]
      )
      .map(toBooking)
  }

  countBookings(connector: string, status: BookingRow['status'][]): number {
    const marks = status.map(() => '?').join(',')
    const r = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM booking WHERE connector = ? AND status IN (${marks})`,
      [connector, ...status]
    )
    return r?.n ?? 0
  }

  upsertBooking(row: BookingRow): void {
    this.db.run(
      `INSERT INTO booking(entry_id, day, connector, remote_id, remote_issue, synced_hash, status, error, attempts, next_try, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(entry_id, day, connector) DO UPDATE SET remote_id=excluded.remote_id, remote_issue=excluded.remote_issue,
         synced_hash=excluded.synced_hash, status=excluded.status, error=excluded.error, attempts=excluded.attempts,
         next_try=excluded.next_try, synced_at=excluded.synced_at`,
      [
        row.entryId,
        row.day,
        row.connector,
        row.remoteId,
        row.remoteIssue,
        row.syncedHash,
        row.status,
        row.error,
        row.attempts,
        row.nextTry,
        row.syncedAt
      ]
    )
  }

  deleteBooking(entryId: number, day: string, connector: string): void {
    this.db.run('DELETE FROM booking WHERE entry_id = ? AND day = ? AND connector = ?', [entryId, day, connector])
  }

  retryErrors(connector: string): number {
    return this.db.run(
      `UPDATE booking SET status='pending', attempts=0, next_try=0, error=NULL WHERE connector = ? AND status='error'`,
      [connector]
    ).changes
  }

  /** Makes queued rows due again (e.g. after the token was fixed). */
  resetBackoff(connector: string): void {
    this.db.run(`UPDATE booking SET next_try=0 WHERE connector = ? AND status IN ('pending','delete')`, [connector])
  }

  // ---- settings & cache -----------------------------------------------

  getSettings(): Settings {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM setting')
    const s: Settings = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      if (r.key in s) (s as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value)
    }
    return s
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.tx(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS)) throw new Error(`Unbekannte Einstellung ${k}`)
        this.db.run(
          'INSERT INTO setting(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          [k, JSON.stringify(v)]
        )
      }
    })
    return this.getSettings()
  }

  getCache<T>(key: string): { value: T; fetchedAt: number } | null {
    const r = this.db.get<{ value: string; fetched_at: number }>('SELECT value, fetched_at FROM remote_cache WHERE key = ?', [key])
    return r ? { value: JSON.parse(r.value) as T, fetchedAt: r.fetched_at } : null
  }

  setCache(key: string, value: unknown, now: number): void {
    this.db.run(
      'INSERT INTO remote_cache(key, value, fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, fetched_at=excluded.fetched_at',
      [key, JSON.stringify(value), now]
    )
  }
}
