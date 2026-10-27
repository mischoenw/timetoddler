import { BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import type { ApiMethod, Snapshot, TtApi } from '@shared/api'
import type { EntryBookingState, RemoteProject, SyncStatus } from '@shared/types'
import { tileOrder } from '@shared/tiles'
import type { AppService } from '@core/service'
import { CONNECTOR, entryState, SyncQueue } from '@core/booking'
import { attendanceCsv, entriesCsv } from '@core/csv'
import { normalizeBaseUrl, YouTrackClient } from '@core/youtrack'
import type { TokenStore } from './token'

export type MainApi = {
  [K in ApiMethod]: (...args: Parameters<TtApi[K]>) => ReturnType<TtApi[K]> | Promise<ReturnType<TtApi[K]>>
}

export interface ApiDeps {
  svc: AppService
  tokens: TokenStore
  queue: SyncQueue
  window: () => BrowserWindow | null
  toggleWindow: () => void
  notify: () => void
}

export function youtrackClient(svc: AppService, tokens: TokenStore): YouTrackClient | null {
  const baseUrl = svc.settings()['youtrack.baseUrl']
  const token = tokens.get()
  return baseUrl && token ? new YouTrackClient({ baseUrl, token }) : null
}

export function syncStatus(deps: Pick<ApiDeps, 'svc' | 'tokens' | 'queue'>): SyncStatus {
  const repo = deps.svc.repo
  return {
    configured: !!deps.svc.settings()['youtrack.baseUrl'] && deps.tokens.has(),
    hasToken: deps.tokens.has(),
    tokenProtection: deps.tokens.protection(),
    authError: deps.queue.authError,
    lastError: deps.queue.lastError,
    pending: repo.countBookings(CONNECTOR, ['pending', 'delete']),
    errors: repo.countBookings(CONNECTOR, ['error']),
    lastRun: deps.queue.lastRun,
    lastPull: deps.queue.lastPull
  }
}

/** Refreshes cached YouTrack projects and flags archived projects / resolved tickets. */
export async function refreshMasterData(deps: Pick<ApiDeps, 'svc' | 'tokens'>): Promise<RemoteProject[]> {
  const yt = youtrackClient(deps.svc, deps.tokens)
  if (!yt) throw new Error('YouTrack ist nicht eingerichtet')
  const projects = await yt.listProjects()
  deps.svc.repo.setCache('yt.projects', projects, Date.now())
  const keys = [...new Set(deps.svc.projects().flatMap((p) => (p.kind === 'youtrack' && p.ytIssue ? [p.ytIssue] : [])))]
  const resolved = new Set<string>()
  for (const key of keys) {
    try {
      if ((await yt.getIssue(key)).resolved) resolved.add(key)
    } catch {
      /* deleted or inaccessible ticket: leave the activity as is */
    }
  }
  deps.svc.markStale(projects, resolved)
  return projects
}

export function createApi(deps: ApiDeps): MainApi {
  const { svc, tokens, queue } = deps
  const yt = (): YouTrackClient => {
    const c = youtrackClient(svc, tokens)
    if (!c) throw new Error('YouTrack ist nicht eingerichtet (Einstellungen)')
    return c
  }
  const kick = (): void => {
    void queue.runOnce().finally(deps.notify)
  }

  return {
    snapshot: (): Snapshot => ({
      now: Date.now(),
      state: svc.state(),
      projects: svc.projects(),
      settings: svc.settings(),
      sync: syncStatus(deps),
      todayNetSec: svc.todayNetSec()
    }),
    day: (d) => svc.day(d),
    week: (d) => svc.week(d),

    start: (id) => void svc.start(id),
    stop: () => svc.stop(),
    toggle: (id) => svc.toggle(id),
    rebook: (id) => svc.rebook(id),
    pressDefault: () => svc.pressDefault(),
    togglePause: () => svc.togglePause(),
    setRunningNote: (note) => svc.setRunningNote(note),
    come: () => svc.come(),
    pauseStart: () => svc.pauseStart(),
    pauseEnd: () => svc.pauseEnd(),
    go: () => svc.go(),
    goAt: (at) => svc.goAt(at),

    createEntry: (e) => svc.createEntry(e),
    updateEntry: (id, p) => svc.updateEntry(id, p),
    deleteEntry: (id) => svc.deleteEntry(id),
    createPresence: (s, e) => svc.createPresence(s, e),
    updatePresence: (id, s, e) => svc.updatePresence(id, s, e),
    deletePresence: (id) => svc.deletePresence(id),
    createPause: (s, e) => svc.createPause(s, e),
    updatePause: (id, s, e) => svc.updatePause(id, s, e),
    deletePause: (id) => svc.deletePause(id),

    createProject: (p) => svc.createProject(p),
    updateProject: (id, p) => svc.updateProject(id, p),
    deleteProject: (id) => svc.deleteProject(id),

    setSettings: (patch) => svc.setSettings(patch),

    ytConnect: async (baseUrl, token) => {
      const url = normalizeBaseUrl(baseUrl)
      if (!/^https?:\/\//.test(url)) throw new Error('URL muss mit https:// beginnen')
      const useToken = token ?? tokens.get()
      if (!useToken) throw new Error('Token fehlt')
      const me = await new YouTrackClient({ baseUrl: url, token: useToken }).me()
      if (token) tokens.set(token)
      svc.setSettings({ 'youtrack.baseUrl': url })
      queue.resetAuth()
      kick()
      return me
    },
    ytDisconnect: () => {
      tokens.clear()
      queue.authError = false
    },
    ytProjects: async () => {
      try {
        return await refreshMasterData(deps)
      } catch (err) {
        const cached = svc.repo.getCache<RemoteProject[]>('yt.projects')
        if (cached) return cached.value
        throw err
      }
    },
    ytSearchIssues: (q) => yt().searchIssues(q),
    ytAssist: (q, caret) => yt().assist(q, caret),
    ytIssue: (key) => yt().getIssue(key.trim().toUpperCase()),
    ytWorkTypes: (projectId) => yt().listWorkTypes(projectId),
    ytImportProjects: (ps) => svc.importRemoteProjects(ps),
    ytImportIssues: (is) => svc.importRemoteIssues(is),
    ytRefresh: async () => {
      await refreshMasterData(deps)
    },

    bookRange: (from, to) => {
      const n = svc.bookRange(from, to)
      kick()
      return n
    },
    retryErrors: () => {
      const n = svc.retryErrors()
      queue.resetAuth()
      kick()
      return n
    },
    syncNow: () => {
      queue.resetAuth()
      void queue
        .runOnce()
        .then(() => queue.pullOnce(true))
        .finally(deps.notify)
    },

    exportCsv: async (kind, from, to) => {
      const win = deps.window()
      const name = `timetoddler-${kind === 'entries' ? 'zeiten' : 'arbeitszeit'}-${from}_${to}.csv`
      const opts = { defaultPath: name, filters: [{ name: 'CSV', extensions: ['csv'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      const now = Date.now()
      let csv: string
      if (kind === 'entries') {
        const entries = svc.entriesBetween(from, to)
        const projects = new Map(svc.projects().map((p) => [p.id, p]))
        const rows = svc.bookingRows(entries.map((e) => e.id))
        const states = new Map<number, EntryBookingState>(entries.map((e) => [e.id, entryState(e, projects.get(e.projectId), rows)]))
        csv = entriesCsv(entries, projects, states, now)
      } else {
        const a = svc.attendanceBetween(from, to)
        csv = attendanceCsv(a.presences, a.pauses, now)
      }
      // BOM so Excel detects UTF-8
      writeFileSync(res.filePath, '﻿' + csv, 'utf8')
      return res.filePath
    },
    toggleWindow: () => deps.toggleWindow()
  }
}

/** Order used by the tray menu (and later the knob). */
export const trayProjects = (svc: AppService) => tileOrder(svc.projects()).slice(0, 12)
