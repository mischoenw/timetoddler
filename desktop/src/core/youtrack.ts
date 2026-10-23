import type { QuerySuggestion, RemoteIssue, RemoteProject, RemoteWorkType } from '@shared/types'

export type YouTrackErrorKind = 'auth' | 'notfound' | 'client' | 'server' | 'network'

export class YouTrackError extends Error {
  constructor(
    readonly kind: YouTrackErrorKind,
    message: string,
    readonly status = 0
  ) {
    super(message)
  }
}

export interface WorkItemDraft {
  issue: string
  date: number
  minutes: number
  text: string
  workTypeId: string | null
}

export interface YouTrackOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/** `https://x.youtrack.cloud/` or `https://host/youtrack` -> base without trailing slash. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/api$/, '')
}

export class YouTrackClient {
  private readonly base: string
  private readonly fetchFn: typeof fetch

  constructor(private readonly opts: YouTrackOptions) {
    this.base = normalizeBaseUrl(opts.baseUrl)
    this.fetchFn = opts.fetch ?? fetch
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000)
      })
    } catch (err) {
      throw new YouTrackError('network', `YouTrack nicht erreichbar: ${(err as Error).message}`)
    }
    if (res.ok) {
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    }
    let detail = ''
    try {
      const j = (await res.json()) as { error_description?: string; error?: string }
      detail = j.error_description || j.error || ''
    } catch {
      /* body is not JSON */
    }
    const msg = `YouTrack ${res.status}${detail ? `: ${detail}` : ''}`
    if (res.status === 401 || res.status === 403) throw new YouTrackError('auth', msg, res.status)
    if (res.status === 404) throw new YouTrackError('notfound', msg, res.status)
    if (res.status >= 500 || res.status === 429) throw new YouTrackError('server', msg, res.status)
    throw new YouTrackError('client', msg, res.status)
  }

  async me(): Promise<{ login: string; name: string }> {
    const u = await this.request<{ login: string; fullName?: string; name?: string }>('GET', '/users/me?fields=login,fullName,name')
    return { login: u.login, name: u.fullName || u.name || u.login }
  }

  async listProjects(): Promise<RemoteProject[]> {
    const ps = await this.request<{ id: string; shortName: string; name: string; archived: boolean }[]>(
      'GET',
      '/admin/projects?fields=id,shortName,name,archived&$top=1000'
    )
    return ps.map((p) => ({ id: p.id, key: p.shortName, name: p.name, archived: !!p.archived }))
  }

  async timeTrackingEnabled(projectId: string): Promise<boolean> {
    const s = await this.request<{ enabled: boolean }>(
      'GET',
      `/admin/projects/${encodeURIComponent(projectId)}/timeTrackingSettings?fields=enabled`
    )
    return !!s.enabled
  }

  async searchIssues(query: string, top = 200): Promise<RemoteIssue[]> {
    const is = await this.request<IssueDto[]>(
      'GET',
      `/issues?query=${encodeURIComponent(query)}&fields=${ISSUE_FIELDS}&$top=${top}`
    )
    return is.map(toIssue)
  }

  async assist(query: string, caret: number): Promise<QuerySuggestion[]> {
    const r = await this.request<{ suggestions?: Partial<QuerySuggestion>[] }>(
      'POST',
      '/search/assist?fields=suggestions(option,prefix,suffix,completionStart,completionEnd,caret,description)',
      { query, caret }
    )
    return (r.suggestions ?? [])
      .filter((s) => s.option)
      .map((s) => ({
        option: s.option!,
        prefix: s.prefix ?? '',
        suffix: s.suffix ?? '',
        completionStart: s.completionStart ?? caret,
        completionEnd: s.completionEnd ?? caret,
        caret: s.caret ?? caret,
        description: s.description ?? ''
      }))
  }

  async getIssue(key: string): Promise<RemoteIssue> {
    return toIssue(await this.request<IssueDto>('GET', `/issues/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`))
  }

  async listWorkTypes(projectId: string): Promise<RemoteWorkType[]> {
    const ts = await this.request<{ id: string; name: string }[]>(
      'GET',
      `/admin/projects/${encodeURIComponent(projectId)}/timeTrackingSettings/workItemTypes?fields=id,name`
    )
    return ts.map((t) => ({ id: t.id, name: t.name }))
  }

  async createWorkItem(d: WorkItemDraft): Promise<string> {
    const r = await this.request<{ id: string }>(
      'POST',
      `/issues/${encodeURIComponent(d.issue)}/timeTracking/workItems?fields=id`,
      workItemBody(d)
    )
    return r.id
  }

  async updateWorkItem(remoteId: string, d: WorkItemDraft): Promise<void> {
    await this.request(
      'POST',
      `/issues/${encodeURIComponent(d.issue)}/timeTracking/workItems/${encodeURIComponent(remoteId)}?fields=id`,
      workItemBody(d)
    )
  }

  async deleteWorkItem(issue: string, remoteId: string): Promise<void> {
    await this.request('DELETE', `/issues/${encodeURIComponent(issue)}/timeTracking/workItems/${encodeURIComponent(remoteId)}`)
  }
}

const ISSUE_FIELDS = 'id,idReadable,summary,resolved,project(id,shortName)'

interface IssueDto {
  id: string
  idReadable: string
  summary: string
  resolved: number | null
  project: { id: string; shortName: string }
}

const toIssue = (i: IssueDto): RemoteIssue => ({
  id: i.id,
  key: i.idReadable,
  summary: i.summary,
  resolved: i.resolved != null,
  projectId: i.project?.id ?? '',
  projectKey: i.project?.shortName ?? ''
})

function workItemBody(d: WorkItemDraft): Record<string, unknown> {
  return {
    date: d.date,
    duration: { minutes: d.minutes },
    text: d.text,
    ...(d.workTypeId ? { type: { id: d.workTypeId } } : {})
  }
}
