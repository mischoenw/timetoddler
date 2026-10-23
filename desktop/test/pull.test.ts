import { describe, expect, it, vi } from 'vitest'
import { buildDrafts, CONNECTOR, entryState } from '@core/booking'
import { pullWorkItems } from '@core/pull'
import type { Repo } from '@core/repo'
import type { RemoteWorkItem } from '@shared/types'
import { at, setup } from './helpers'

/** Defaults to a day entered in YouTrack (UTC midnight). */
const wi = (o: Partial<RemoteWorkItem> = {}): RemoteWorkItem => {
  const day = o.day ?? '2026-10-21'
  return { id: 'w-1', issue: 'ABC-1', day, date: Date.parse(`${day}T00:00:00Z`), minutes: 60, text: '', ...o }
}

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
  const api = { listMyWorkItems: vi.fn(async (_fromDay: string, _toDay: string) => items) }
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
    // one extra day on each side: YouTrack may filter by UTC date
    expect(api.listMyWorkItems).toHaveBeenCalledWith('2026-09-20', '2026-10-22')
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

  it('does not unbook at the window edge and ignores items outside the window', async () => {
    const { svc, repo, api, pull, p, state, ofTile } = await pullSetup()
    const edge = svc.createEntry({ projectId: p.id, start: at('2026-09-21 00:30'), end: at('2026-09-21 01:00'), note: '', ytIssue: null })
    book(repo, edge.id, 'w-edge')
    const before = svc.createEntry({ projectId: p.id, start: at('2026-09-20 09:00'), end: at('2026-09-20 10:00'), note: '', ytIssue: null })
    book(repo, before.id, 'w-before')
    // the server filters by UTC date: 00:30 Berlin is still 2026-09-20 in UTC
    const edgeItem = wi({ id: 'w-edge', day: '2026-09-21', date: at('2026-09-21 00:30'), minutes: 30 })
    vi.mocked(api.listMyWorkItems).mockImplementation(async (from: string) => (from <= '2026-09-20' ? [edgeItem, wi({ id: 'new-old', day: '2026-09-20' })] : []))
    expect(await pull([])).toEqual({ created: 0, updated: 0, unbooked: 0 })
    expect(state(edge.id)).toBe('booked')
    expect(state(before.id)).toBe('booked')
    expect(ofTile()).toHaveLength(2)
  })

  it('keeps entries just after midnight when YouTrack truncates the date to UTC midnight', async () => {
    const { svc, repo, pull, p } = await pullSetup()
    const e = svc.createEntry({ projectId: p.id, start: at('2026-10-21 00:30'), end: at('2026-10-21 01:30'), note: '', ytIssue: null })
    book(repo, e.id, 'w-1')
    // pushed at 2026-10-20T22:30Z, reported back as 2026-10-20T00:00Z
    const truncated = { day: '2026-10-20', date: Date.UTC(2026, 9, 20) }
    expect(await pull([wi({ ...truncated })])).toEqual({ created: 0, updated: 0, unbooked: 0 })
    expect(await pull([wi({ ...truncated, text: 'neu' })])).toEqual({ created: 0, updated: 1, unbooked: 0 })
    expect(repo.getEntry(e.id)).toMatchObject({ start: at('2026-10-21 00:30'), end: at('2026-10-21 01:30'), note: 'neu' })
    expect(repo.bookingsOfEntry(e.id, CONNECTOR).map((r) => r.day)).toEqual(['2026-10-21'])
  })

  it('adopts a work item whose push response was lost instead of duplicating it', async () => {
    const { svc, repo, pull, p, ofTile } = await pullSetup()
    const e = svc.createEntry({ projectId: p.id, start: at('2026-10-21 09:00'), end: at('2026-10-21 10:00'), note: 'n', ytIssue: null })
    svc.bookRange('2026-10-21', '2026-10-21') // pending, no remote id yet
    expect(await pull([wi({ text: 'n' })])).toEqual({ created: 0, updated: 0, unbooked: 0 })
    expect(ofTile()).toHaveLength(1)
    expect(repo.bookingsOfEntry(e.id, CONNECTOR)).toMatchObject([{ remoteId: 'w-1', status: 'pending' }])
  })
})
