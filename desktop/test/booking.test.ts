import { describe, expect, it, vi } from 'vitest'
import { buildDrafts, CONNECTOR, minutesOf, SyncQueue, backoff, type WorkItemApi } from '@core/booking'
import { YouTrackError } from '@core/youtrack'
import { at, setup } from './helpers'

function fakeApi() {
  let n = 0
  const items = new Map<string, { issue: string; minutes: number; text: string }>()
  const api: WorkItemApi & { items: typeof items } = {
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
    })
  }
  return api
}

async function bookedSetup() {
  const s = await setup('2026-10-21 18:00')
  const p = s.svc.createProject({ name: 'Ticket', kind: 'youtrack', ytIssue: 'ABC-1' })
  const e = s.svc.createEntry({ projectId: p.id, start: at('2026-10-21 09:00'), end: at('2026-10-21 10:29'), note: 'n', ytIssue: null })
  const api = fakeApi()
  const q = new SyncQueue(s.repo, () => api, s.clock.now)
  return { ...s, p, e, api, q }
}

describe('drafts', () => {
  it('rounds minutes half up with a minimum of one', () => {
    expect(minutesOf(29_999)).toBe(1)
    expect(minutesOf(90_000)).toBe(2)
    expect(minutesOf(89_999)).toBe(1)
  })

  it('splits over midnight and skips local or running entries', async () => {
    const { svc } = await setup()
    const yt = svc.createProject({ name: 'T', kind: 'youtrack', ytIssue: 'ABC-1' })
    const local = svc.createProject({ name: 'Meeting' })
    const e = { id: 1, projectId: yt.id, start: at('2026-10-21 23:00'), end: at('2026-10-22 01:00'), note: '', ytIssue: null }
    expect(buildDrafts(e, yt).map((d) => [d.day, d.minutes])).toEqual([
      ['2026-10-21', 60],
      ['2026-10-22', 60]
    ])
    expect(buildDrafts({ ...e, end: null }, yt)).toEqual([])
    expect(buildDrafts({ ...e, projectId: local.id }, local)).toEqual([])
    expect(buildDrafts({ ...e, ytIssue: 'XYZ-9' }, yt)[0].issue).toBe('XYZ-9')
  })
})

describe('booking flow', () => {
  it('manual mode books only on request', async () => {
    const { svc, q, api } = await bookedSetup()
    await q.runOnce()
    expect(api.createWorkItem).not.toHaveBeenCalled()
    expect(svc.day('2026-10-21').entries[0].booking).toBe('open')
    expect(svc.bookRange('2026-10-21', '2026-10-21')).toBe(1)
    expect(svc.day('2026-10-21').entries[0].booking).toBe('pending')
    await q.runOnce()
    expect([...api.items.values()]).toEqual([{ issue: 'ABC-1', minutes: 89, text: 'n' }])
    expect(svc.day('2026-10-21').entries[0].booking).toBe('booked')
  })

  it('onStop mode queues when the timer stops', async () => {
    const { svc, q, api, p, clock } = await bookedSetup()
    svc.setSettings({ 'youtrack.bookingMode': 'onStop' })
    clock.set('2026-10-21 11:00')
    svc.start(p.id)
    clock.set('2026-10-21 11:30')
    svc.stop()
    await q.runOnce()
    expect(api.createWorkItem).toHaveBeenCalledTimes(1)
  })

  it('edits update, ticket change replaces, delete removes', async () => {
    const { svc, q, api, e } = await bookedSetup()
    svc.bookRange('2026-10-21', '2026-10-21')
    await q.runOnce()
    svc.updateEntry(e.id, { note: 'neu' })
    expect(svc.day('2026-10-21').entries[0].booking).toBe('pending')
    await q.runOnce()
    expect(api.updateWorkItem).toHaveBeenCalledTimes(1)
    expect([...api.items.values()][0].text).toBe('neu')

    svc.updateEntry(e.id, { ytIssue: 'XYZ-2' })
    await q.runOnce()
    expect(api.deleteWorkItem).toHaveBeenCalledWith('ABC-1', 'wi-1')
    expect([...api.items.values()]).toEqual([{ issue: 'XYZ-2', minutes: 89, text: 'neu' }])

    svc.deleteEntry(e.id)
    await q.runOnce()
    expect(api.items.size).toBe(0)
  })

  it('making the activity local deletes its work items', async () => {
    const { svc, q, api, p } = await bookedSetup()
    svc.bookRange('2026-10-21', '2026-10-21')
    await q.runOnce()
    svc.updateProject(p.id, { kind: 'local' })
    await q.runOnce()
    expect(api.items.size).toBe(0)
    expect(svc.day('2026-10-21').entries[0].booking).toBe('local')
  })

  it('re-creates a work item deleted in YouTrack', async () => {
    const { svc, q, api, e } = await bookedSetup()
    svc.bookRange('2026-10-21', '2026-10-21')
    await q.runOnce()
    api.items.clear()
    svc.updateEntry(e.id, { note: 'x' })
    await q.runOnce()
    expect(api.createWorkItem).toHaveBeenCalledTimes(2)
    expect(svc.day('2026-10-21').entries[0].booking).toBe('booked')
  })

  it('backs off on network errors and stops on auth errors', async () => {
    const { svc, q, api, repo, clock } = await bookedSetup()
    svc.bookRange('2026-10-21', '2026-10-21')
    vi.mocked(api.createWorkItem).mockRejectedValueOnce(new YouTrackError('network', 'offline'))
    await q.runOnce()
    const row = repo.bookingsOfEntry(1, CONNECTOR)[0]
    expect(row).toMatchObject({ status: 'pending', attempts: 1, nextTry: clock.t + 30_000 })
    await q.runOnce()
    expect(api.createWorkItem).toHaveBeenCalledTimes(1)

    clock.t += 30_000
    vi.mocked(api.createWorkItem).mockRejectedValueOnce(new YouTrackError('auth', 'YouTrack 401', 401))
    await q.runOnce()
    expect(q.authError).toBe(true)
    await q.runOnce()
    expect(api.createWorkItem).toHaveBeenCalledTimes(2)
    q.resetAuth()
    await q.runOnce()
    expect(svc.day('2026-10-21').entries[0].booking).toBe('booked')
    expect(backoff(10)).toBe(30 * 60_000)
  })

  it('marks unknown tickets as error until the entry changes', async () => {
    const { svc, q, api, e } = await bookedSetup()
    svc.bookRange('2026-10-21', '2026-10-21')
    vi.mocked(api.createWorkItem).mockRejectedValueOnce(new YouTrackError('notfound', 'YouTrack 404', 404))
    await q.runOnce()
    const d = svc.day('2026-10-21').entries[0]
    expect(d.booking).toBe('error')
    expect(d.bookingError).toContain('404')
    svc.updateEntry(e.id, { ytIssue: 'ABC-2' })
    await q.runOnce()
    expect(svc.day('2026-10-21').entries[0].booking).toBe('booked')
  })

  it('a change during the request leaves the row pending', async () => {
    const { svc, q, api, e } = await bookedSetup()
    svc.bookRange('2026-10-21', '2026-10-21')
    vi.mocked(api.createWorkItem).mockImplementationOnce(async () => {
      svc.updateEntry(e.id, { note: 'während' })
      return 'wi-x'
    })
    await q.runOnce()
    expect(svc.day('2026-10-21').entries[0].booking).toBe('pending')
    await q.runOnce()
    expect(api.updateWorkItem).toHaveBeenCalledWith('wi-x', expect.objectContaining({ text: 'während' }))
  })
})
