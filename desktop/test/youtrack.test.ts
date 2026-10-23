import { describe, expect, it, vi } from 'vitest'
import { normalizeBaseUrl, YouTrackClient, YouTrackError } from '@core/youtrack'
import { at } from './helpers'

function client(handler: (url: string, init: RequestInit) => Response) {
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {}))
  return { f, c: new YouTrackClient({ baseUrl: 'https://yt.example.com/', token: 'perm:abc', fetch: f as unknown as typeof fetch }) }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('YouTrackClient', () => {
  it('normalizes base urls', () => {
    expect(normalizeBaseUrl(' https://x.youtrack.cloud/ ')).toBe('https://x.youtrack.cloud')
    expect(normalizeBaseUrl('https://h/youtrack/api')).toBe('https://h/youtrack')
  })

  it('sends bearer token and maps issues', async () => {
    const { f, c } = client(() =>
      json([{ id: '2-5', idReadable: 'ABC-5', summary: 'S', resolved: null, project: { id: '0-1', shortName: 'ABC' } }])
    )
    const is = await c.searchIssues('for: me #Unresolved')
    expect(is).toEqual([{ id: '2-5', key: 'ABC-5', summary: 'S', resolved: false, projectId: '0-1', projectKey: 'ABC' }])
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('https://yt.example.com/api/issues?query=for%3A%20me%20%23Unresolved')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer perm:abc')
  })

  it('creates a work item with type only when set', async () => {
    const { f, c } = client(() => json({ id: '8-1' }))
    const id = await c.createWorkItem({ issue: 'ABC-5', date: 1000, minutes: 30, text: 't', workTypeId: null })
    expect(id).toBe('8-1')
    expect(f.mock.calls[0][0]).toBe('https://yt.example.com/api/issues/ABC-5/timeTracking/workItems?fields=id')
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ date: 1000, duration: { minutes: 30 }, text: 't' })
    await c.createWorkItem({ issue: 'ABC-5', date: 1000, minutes: 30, text: 't', workTypeId: '9-1' })
    expect(JSON.parse(f.mock.calls[1][1]!.body as string).type).toEqual({ id: '9-1' })
  })

  it('asks YouTrack for query suggestions', async () => {
    const { f, c } = client(() =>
      json({ suggestions: [{ option: 'Unresolved', prefix: '#', suffix: ' ', completionStart: 0, completionEnd: 4, caret: 12, description: 'state' }] })
    )
    const s = await c.assist('#Unr', 4)
    expect(s).toEqual([{ option: 'Unresolved', prefix: '#', suffix: ' ', completionStart: 0, completionEnd: 4, caret: 12, description: 'state' }])
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/yt\.example\.com\/api\/search\/assist\?fields=/)
    expect(f.mock.calls[0][1]!.method).toBe('POST')
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ query: '#Unr', caret: 4 })
  })

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
    expect(items[0]).toEqual({ id: 'w-0', issue: 'ABC-1', day: '2026-10-21', date: Date.UTC(2026, 9, 21), minutes: 30, text: '' })
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

  it('classifies errors', async () => {
    const cases: [number, string][] = [
      [401, 'auth'],
      [403, 'auth'],
      [404, 'notfound'],
      [400, 'client'],
      [503, 'server']
    ]
    for (const [status, kind] of cases) {
      const { c } = client(() => json({ error_description: 'nope' }, status))
      await expect(c.me()).rejects.toMatchObject({ kind, status })
    }
    const { c } = client(() => {
      throw new TypeError('fetch failed')
    })
    await expect(c.me()).rejects.toBeInstanceOf(YouTrackError)
    await expect(c.me()).rejects.toMatchObject({ kind: 'network' })
  })
})
