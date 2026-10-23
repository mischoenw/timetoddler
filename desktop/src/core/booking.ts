import type { BookingRow, Entry, EntryBookingState, Project } from '@shared/types'
import { splitByDay } from '@shared/timecalc'
import type { Repo } from './repo'
import { YouTrackError, type WorkItemDraft } from './youtrack'

export const CONNECTOR = 'youtrack'

export interface BookingDraft extends WorkItemDraft {
  entryId: number
  day: string
  hash: string
}

export function issueOf(entry: Entry, project: Project | undefined): string | null {
  if (!project || project.kind !== 'youtrack') return null
  return entry.ytIssue || project.ytIssue || null
}

/** Whole minutes, rounded half up, at least 1. */
export function minutesOf(ms: number): number {
  return Math.max(1, Math.round(ms / 60000))
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function hashDraft(d: WorkItemDraft): string {
  return fnv1a(JSON.stringify([d.issue, d.date, d.minutes, d.text, d.workTypeId]))
}

/** One work item per entry and local day. Running, local and ticketless entries yield none. */
export function buildDrafts(entry: Entry, project: Project | undefined): BookingDraft[] {
  const issue = issueOf(entry, project)
  if (!issue || entry.end === null || entry.end <= entry.start) return []
  return splitByDay(entry.start, entry.end).map((seg) => {
    const d: WorkItemDraft = {
      issue,
      date: seg.start,
      minutes: minutesOf(seg.end - seg.start),
      text: entry.note,
      workTypeId: project!.ytWorkTypeId
    }
    return { ...d, entryId: entry.id, day: seg.day, hash: hashDraft(d) }
  })
}

const freshRow = (entryId: number, day: string): BookingRow => ({
  entryId,
  day,
  connector: CONNECTOR,
  remoteId: null,
  remoteIssue: null,
  syncedHash: null,
  status: 'pending',
  error: null,
  attempts: 0,
  nextTry: 0,
  syncedAt: null
})

const requeue = (row: BookingRow, status: 'pending' | 'delete'): BookingRow => ({
  ...row,
  status,
  error: null,
  attempts: 0,
  nextTry: 0
})

/** Queues entries for booking ("Tag buchen", or automatically on stop). Returns the number of queued work items. */
export function requestBooking(repo: Repo, entryIds: number[]): number {
  let queued = 0
  repo.tx(() => {
    for (const id of entryIds) {
      const entry = repo.getEntry(id)
      if (!entry) continue
      const drafts = buildDrafts(entry, repo.getProject(entry.projectId))
      const rows = repo.bookingsOfEntry(id, CONNECTOR)
      for (const d of drafts) {
        const row = rows.find((r) => r.day === d.day)
        if (!row) {
          repo.upsertBooking(freshRow(id, d.day))
          queued++
        } else if (row.status === 'error' || row.status === 'delete' || (row.status === 'booked' && row.syncedHash !== d.hash)) {
          repo.upsertBooking(requeue(row, 'pending'))
          queued++
        }
      }
      reconcileEntry(repo, id)
    }
  })
  return queued
}

/**
 * Brings existing booking rows of an entry in line with its current state after any edit or delete.
 * Entries that were never queued stay untouched.
 */
export function reconcileEntry(repo: Repo, entryId: number): void {
  repo.tx(() => {
    const rows = repo.bookingsOfEntry(entryId, CONNECTOR)
    if (rows.length === 0) return
    const entry = repo.getEntry(entryId)
    const drafts = entry ? buildDrafts(entry, repo.getProject(entry.projectId)) : []
    for (const row of rows) {
      const d = drafts.find((x) => x.day === row.day)
      if (!d) {
        if (row.remoteId) {
          if (row.status !== 'delete') repo.upsertBooking(requeue(row, 'delete'))
        } else {
          repo.deleteBooking(row.entryId, row.day, CONNECTOR)
        }
      } else if (row.status === 'delete' || row.status === 'error' || (row.status === 'booked' && row.syncedHash !== d.hash)) {
        repo.upsertBooking(requeue(row, 'pending'))
      }
    }
    for (const d of drafts) {
      if (!rows.some((r) => r.day === d.day)) repo.upsertBooking(freshRow(entryId, d.day))
    }
  })
}

export function entryState(entry: Entry, project: Project | undefined, rows: BookingRow[]): EntryBookingState {
  if (entry.end === null) return 'running'
  if (!project || project.kind === 'local') return 'local'
  if (!issueOf(entry, project)) return 'unbookable'
  const own = rows.filter((r) => r.entryId === entry.id)
  if (own.length === 0) return 'open'
  if (own.some((r) => r.status === 'error')) return 'error'
  if (own.some((r) => r.status === 'pending' || r.status === 'delete')) return 'pending'
  const drafts = buildDrafts(entry, project)
  const allBooked = drafts.every((d) => own.some((r) => r.day === d.day && r.status === 'booked' && r.syncedHash === d.hash))
  return allBooked ? 'booked' : 'open'
}

export interface WorkItemApi {
  createWorkItem(d: WorkItemDraft): Promise<string>
  updateWorkItem(remoteId: string, d: WorkItemDraft): Promise<void>
  deleteWorkItem(issue: string, remoteId: string): Promise<void>
}

export const BACKOFF_MIN_MS = 30_000
export const BACKOFF_MAX_MS = 30 * 60_000

export function backoff(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempts - 1))
}

/** Pushes due booking rows to the remote, one at a time. */
export class SyncQueue {
  authError = false
  lastError: string | null = null
  lastRun: number | null = null
  private busy = false

  constructor(
    private readonly repo: Repo,
    private readonly api: () => WorkItemApi | null,
    private readonly clock: () => number = Date.now
  ) {}

  async runOnce(): Promise<void> {
    if (this.busy) return
    const api = this.api()
    if (!api || this.authError) return
    this.busy = true
    try {
      this.lastRun = this.clock()
      for (const row of this.repo.dueBookings(CONNECTOR, this.clock())) {
        const ok = await this.process(api, row)
        if (!ok) break
      }
    } finally {
      this.busy = false
    }
  }

  /** Call after the user fixed the token or URL. */
  resetAuth(): void {
    this.authError = false
    this.repo.resetBackoff(CONNECTOR)
  }

  private currentDraft(row: BookingRow): BookingDraft | undefined {
    const entry = this.repo.getEntry(row.entryId)
    if (!entry) return undefined
    return buildDrafts(entry, this.repo.getProject(entry.projectId)).find((d) => d.day === row.day)
  }

  /** Returns false if the queue should stop (auth problem). */
  private async process(api: WorkItemApi, row: BookingRow): Promise<boolean> {
    const draft = row.status === 'delete' ? undefined : this.currentDraft(row)
    try {
      if (!draft) {
        if (row.remoteId) await this.ignoreNotFound(api.deleteWorkItem(row.remoteIssue ?? '', row.remoteId))
        this.repo.deleteBooking(row.entryId, row.day, CONNECTOR)
        this.lastError = null
        return true
      }
      let remoteId = row.remoteId
      if (remoteId && row.remoteIssue !== draft.issue) {
        await this.ignoreNotFound(api.deleteWorkItem(row.remoteIssue ?? '', remoteId))
        remoteId = null
      }
      if (remoteId) {
        try {
          await api.updateWorkItem(remoteId, draft)
        } catch (err) {
          // Work item was deleted in YouTrack: book it again.
          if (!(err instanceof YouTrackError && err.kind === 'notfound')) throw err
          remoteId = await api.createWorkItem(draft)
        }
      } else {
        remoteId = await api.createWorkItem(draft)
      }
      this.finish(row, draft, remoteId)
      this.lastError = null
      return true
    } catch (err) {
      return this.fail(row, err)
    }
  }

  private async ignoreNotFound(p: Promise<void>): Promise<void> {
    try {
      await p
    } catch (err) {
      if (!(err instanceof YouTrackError && err.kind === 'notfound')) throw err
    }
  }

  private finish(row: BookingRow, pushed: BookingDraft, remoteId: string): void {
    // The entry may have changed while the request was in flight.
    const now = this.currentDraft(row)
    const changed = !now || now.hash !== pushed.hash
    this.repo.upsertBooking({
      ...row,
      remoteId,
      remoteIssue: pushed.issue,
      syncedHash: pushed.hash,
      status: changed ? (now ? 'pending' : 'delete') : 'booked',
      error: null,
      attempts: 0,
      nextTry: 0,
      syncedAt: this.clock()
    })
  }

  private fail(row: BookingRow, err: unknown): boolean {
    const msg = (err as Error).message ?? String(err)
    this.lastError = msg
    const kind = err instanceof YouTrackError ? err.kind : 'network'
    if (kind === 'auth') {
      this.authError = true
      return false
    }
    if (kind === 'network' || kind === 'server') {
      const attempts = row.attempts + 1
      this.repo.upsertBooking({ ...row, attempts, nextTry: this.clock() + backoff(attempts), error: msg })
      return kind === 'server'
    }
    // notfound (ticket) or other client error: the user has to fix the entry.
    this.repo.upsertBooking({ ...row, status: row.status === 'delete' ? 'delete' : 'error', error: msg, attempts: row.attempts + 1, nextTry: row.status === 'delete' ? this.clock() + BACKOFF_MAX_MS : 0 })
    return true
  }
}
