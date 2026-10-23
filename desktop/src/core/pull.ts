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
