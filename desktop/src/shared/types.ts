/** All timestamps are epoch milliseconds (UTC). Days are local `YYYY-MM-DD`. */

export type ProjectKind = 'youtrack' | 'local'

export interface Project {
  id: number
  kind: ProjectKind
  name: string
  client: string
  color: string
  favorite: boolean
  archived: boolean
  createdAt: number
  ytProjectId: string | null
  ytIssue: string | null
  ytWorkTypeId: string | null
  /** Remote state from the last master-data refresh (archived project / resolved issue). */
  ytStale: boolean
}

export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'ytStale'>

export interface Entry {
  id: number
  projectId: number
  start: number
  end: number | null
  note: string
  ytIssue: string | null
}

export type EntryInput = Omit<Entry, 'id'>

export interface Presence {
  id: number
  start: number
  end: number | null
}

export interface Pause {
  id: number
  presenceId: number
  start: number
  end: number | null
  resumeProjectId: number | null
}

export type BookingRowStatus = 'pending' | 'booked' | 'error' | 'delete'

export interface BookingRow {
  entryId: number
  day: string
  connector: string
  remoteId: string | null
  remoteIssue: string | null
  syncedHash: string | null
  status: BookingRowStatus
  error: string | null
  attempts: number
  nextTry: number
  syncedAt: number | null
}

/** Booking state of one entry as shown in the UI. */
export type EntryBookingState =
  | 'running'
  | 'local'
  | 'unbookable'
  | 'open'
  | 'pending'
  | 'booked'
  | 'error'

export type BookingMode = 'manual' | 'onStop'

export interface Settings {
  'work.autoCome': boolean
  'work.resumeAfterBreak': boolean
  'encoder.stepsPerDetent': number
  'encoder.reverse': boolean
  'youtrack.baseUrl': string
  'youtrack.issueQuery': string
  'youtrack.bookingMode': BookingMode
  'device.brightness': number
  'device.led': number
}

export const DEFAULT_SETTINGS: Settings = {
  'work.autoCome': true,
  'work.resumeAfterBreak': true,
  'encoder.stepsPerDetent': 4,
  'encoder.reverse': false,
  'youtrack.baseUrl': '',
  'youtrack.issueQuery': 'for: me #Unresolved',
  'youtrack.bookingMode': 'manual',
  'device.brightness': 80,
  'device.led': 60
}

export type WorkMode = 'absent' | 'idle' | 'running' | 'break'

export interface TrackerState {
  mode: WorkMode
  running: Entry | null
  presence: Presence | null
  pause: Pause | null
}

export interface Hint {
  level: 'info' | 'warn'
  text: string
}

export interface DaySummary {
  day: string
  presenceSec: number
  pauseSec: number
  netSec: number
  entriesSec: number
  unassignedSec: number
  perProject: Record<number, number>
  hints: Hint[]
}

export interface WeekSummary {
  days: string[]
  /** projectId -> seconds per day (same order as `days`). */
  perProject: Record<number, number[]>
  netPerDay: number[]
}

export interface RemoteProject {
  id: string
  key: string
  name: string
  archived: boolean
}

export interface RemoteIssue {
  id: string
  key: string
  summary: string
  resolved: boolean
  projectId: string
  projectKey: string
}

export interface RemoteWorkType {
  id: string
  name: string
}

export interface SyncStatus {
  configured: boolean
  hasToken: boolean
  /** 'basic': Linux without keychain, token only obfuscated. */
  tokenProtection: 'os' | 'basic'
  authError: boolean
  lastError: string | null
  pending: number
  errors: number
  lastRun: number | null
}

export interface DayView {
  day: string
  summary: DaySummary
  entries: (Entry & { booking: EntryBookingState; bookingError: string | null })[]
  presences: Presence[]
  pauses: Pause[]
}

export interface WeekView {
  summary: WeekSummary
  states: Record<EntryBookingState, number>
}
