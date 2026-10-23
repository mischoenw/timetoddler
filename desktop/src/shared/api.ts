import type {
  DayView,
  Entry,
  EntryInput,
  Pause,
  Presence,
  Project,
  ProjectInput,
  QuerySuggestion,
  RemoteIssue,
  RemoteProject,
  RemoteWorkType,
  Settings,
  SyncStatus,
  TrackerState,
  WeekView
} from './types'

export interface Snapshot {
  now: number
  state: TrackerState
  projects: Project[]
  settings: Settings
  sync: SyncStatus
  todayNetSec: number
}

/** Everything the renderer may call in the main process. */
export interface TtApi {
  snapshot(): Snapshot
  day(day: string): DayView
  week(day: string): WeekView

  start(projectId: number): void
  stop(): void
  toggle(projectId: number): void
  rebook(projectId: number): void
  setRunningNote(note: string): void
  come(): void
  pauseStart(): void
  pauseEnd(): void
  go(): void
  goAt(at: number): void

  createEntry(e: EntryInput): Entry
  updateEntry(id: number, patch: Partial<EntryInput>): Entry
  deleteEntry(id: number): void
  createPresence(start: number, end: number | null): Presence
  updatePresence(id: number, start: number, end: number | null): void
  deletePresence(id: number): void
  createPause(start: number, end: number | null): Pause
  updatePause(id: number, start: number, end: number | null): void
  deletePause(id: number): void

  createProject(p: Partial<ProjectInput> & { name: string }): Project
  updateProject(id: number, patch: Partial<ProjectInput>): Project
  deleteProject(id: number): 'deleted' | 'archived'

  setSettings(patch: Partial<Settings>): Settings

  ytConnect(baseUrl: string, token: string | null): { login: string; name: string }
  ytDisconnect(): void
  ytProjects(): RemoteProject[]
  ytSearchIssues(query: string): RemoteIssue[]
  ytAssist(query: string, caret: number): QuerySuggestion[]
  ytIssue(key: string): RemoteIssue
  ytWorkTypes(projectId: string): RemoteWorkType[]
  ytImportProjects(ps: RemoteProject[]): Project[]
  ytImportIssues(is: RemoteIssue[]): Project[]
  ytRefresh(): void

  bookRange(fromDay: string, toDay: string): number
  retryErrors(): number
  syncNow(): void

  exportCsv(kind: 'entries' | 'attendance', fromDay: string, toDay: string): string | null
  toggleWindow(): void
}

export type ApiMethod = keyof TtApi

/** Renderer-side view: every call is async across the IPC boundary. */
export type AsyncApi = {
  [K in ApiMethod]: (...args: Parameters<TtApi[K]>) => Promise<Awaited<ReturnType<TtApi[K]>>>
}

export type IpcResult = { ok: true; value: unknown } | { ok: false; error: string }

export const IPC_INVOKE = 'tt:invoke'
export const IPC_CHANGED = 'tt:changed'
