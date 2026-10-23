import { describe, expect, it, vi } from 'vitest'
import { normalizeBaseUrl, YouTrackClient, YouTrackError } from '@core/youtrack'

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
