import type { StateCode } from './holidays'

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

/** How an attendance block ended: normally, or leaving for a doctor's appointment. */
export type PresenceEndReason = 'doctor'

export interface Presence {
  id: number
  start: number
  end: number | null
  endReason: PresenceEndReason | null
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
  /** Minimum length of one uninterrupted break on days over 6 h; 0 = off. */
  'work.minLunchBreakMin': number
  /** Federal state for public holidays ('' = nationwide holidays only). */
  'work.state': StateCode | ''
  /** Include holidays that apply only in parts of the state. */
  'work.regionalHolidays': boolean
  /** Working weekdays, 0 = Sunday … 6 = Saturday. */
  'work.workdays': number[]
  /** Target working time per working day in minutes. */
  'work.dailyTargetMin': number
  'vacation.daysPerYear': number
  /** Remaining days carried into a year, by year ("2026": 3.5). */
  'vacation.carryOver': Record<string, number>
  'encoder.stepsPerDetent': number
  'encoder.reverse': boolean
  'youtrack.baseUrl': string
  'youtrack.issueQuery': string
  'youtrack.bookingMode': BookingMode
  'youtrack.pull': boolean
  'device.brightness': number
  'device.led': number
}

export const DEFAULT_SETTINGS: Settings = {
  'work.autoCome': true,
  'work.resumeAfterBreak': true,
  'work.minLunchBreakMin': 30,
  'work.state': '',
  'work.regionalHolidays': false,
  'work.workdays': [1, 2, 3, 4, 5],
  'work.dailyTargetMin': 480,
  'vacation.daysPerYear': 30,
  'vacation.carryOver': {},
  'encoder.stepsPerDetent': 4,
  'encoder.reverse': false,
  'youtrack.baseUrl': '',
  'youtrack.issueQuery': 'for: me #Unresolved',
  'youtrack.bookingMode': 'manual',
  'youtrack.pull': true,
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
  level: 'info' | 'warn' | 'error'
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
  /** Presences that overlap another presence of this day. */
  overlapPresenceIds: number[]
  /** Target for the day (0 on non-working days, holidays and vacation; half on a half vacation day). */
  targetSec: number
  /** Doctor's appointments credited as working time. */
  doctorSec: number
  /** Net work time plus credited doctor time; capped at the target if the day ended at the doctor. */
  creditedSec: number
  balanceSec: number
}

export interface WeekSummary {
  days: string[]
  /** projectId -> seconds per day (same order as `days`). */
  perProject: Record<number, number[]>
  netPerDay: number[]
  targetPerDay: number[]
  creditedPerDay: number[]
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

/** One entry of YouTrack's search assist; insert `prefix + option + suffix` at [completionStart, completionEnd). */
export interface QuerySuggestion {
  option: string
  prefix: string
  suffix: string
  completionStart: number
  completionEnd: number
  caret: number
  description: string
}

/** Own work item from YouTrack; `day` is local `YYYY-MM-DD`. */
export interface RemoteWorkItem {
  id: string
  issue: string
  day: string
  /** Raw `date` as reported by YouTrack (epoch ms). */
  date: number
  minutes: number
  text: string
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
  lastPull: number | null
}

export interface DayView {
  day: string
  summary: DaySummary
  entries: (Entry & { booking: EntryBookingState; bookingError: string | null })[]
  presences: Presence[]
  pauses: Pause[]
  calendar: DayCalendar
}

export interface WeekView {
  summary: WeekSummary
  states: Record<EntryBookingState, number>
  calendar: DayCalendar[]
}

export type AbsenceKind = 'vacation'

export interface Absence {
  id: number
  kind: AbsenceKind
  /** Local days, inclusive. */
  firstDay: string
  lastDay: string
  /** Half day; only for single-day absences. */
  half: boolean
  note: string
}

export type AbsenceInput = Omit<Absence, 'id'>

export interface DayCalendar {
  day: string
  holiday: string | null
  absence: { id: number; kind: AbsenceKind; half: boolean } | null
  /** Configured working weekday and no public holiday. */
  workday: boolean
}

export interface VacationAccount {
  year: number
  entitlement: number
  carryOver: number
  /** Days up to and including today. */
  taken: number
  /** Days after today. */
  planned: number
  remaining: number
  absences: (Absence & { days: number })[]
}
