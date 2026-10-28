import type {
  PresenceEndReason,
  Absence,
  AbsenceInput,
  DayCalendar,
  VacationAccount,
  BookingRow,
  DayView,
  Entry,
  EntryInput,
  Pause,
  Presence,
  Project,
  ProjectInput,
  RemoteIssue,
  RemoteProject,
  Settings,
  TrackerState,
  WeekView
} from '@shared/types'
import { addDays, dayRange, daySummary, formatTime, localDay, weekStart, weekSummary } from '@shared/timecalc'
import { nextColor } from '@shared/tiles'
import { absenceDays, calendarContext, calendarDay } from '@shared/calendar'
import type { Repo } from './repo'
import { CONNECTOR, entryState, reconcileEntry, requestBooking } from './booking'

/** Entries shorter than this are treated as accidental clicks and dropped on stop. */
export const MIN_ENTRY_MS = 10_000

export class ValidationError extends Error {}

export class AppService {
  constructor(
    readonly repo: Repo,
    private readonly clock: () => number = Date.now
  ) {}

  // ---- state ------------------------------------------------------------

  state(): TrackerState {
    const running = this.repo.runningEntry()
    const presence = this.repo.openPresence()
    const pause = this.repo.openPause()
    const mode = pause ? 'break' : running ? 'running' : presence ? 'idle' : 'absent'
    return { mode, running, presence, pause }
  }

  settings(): Settings {
    return this.repo.getSettings()
  }

  setSettings(patch: Partial<Settings>): Settings {
    return this.repo.setSettings(patch)
  }

  // ---- tracking (same rules for UI and knob) ------------------------------

  start(projectId: number): Entry {
    const project = this.repo.getProject(projectId)
    if (!project) throw new ValidationError('Tätigkeit nicht gefunden')
    if (project.archived) throw new ValidationError('Tätigkeit ist archiviert')
    const now = this.clock()
    return this.repo.tx(() => {
      const running = this.repo.runningEntry()
      if (running?.projectId === projectId) return running
      if (running) this.stopEntry(running, now)
      const pause = this.repo.openPause()
      if (pause) this.repo.updatePause(pause.id, pause.start, now)
      if (!this.repo.openPresence() && this.settings()['work.autoCome']) this.repo.createPresence(now, null)
      return this.repo.createEntry({ projectId, start: now, end: null, note: '', ytIssue: null })
    })
  }

  stop(): void {
    const running = this.repo.runningEntry()
    if (running) this.repo.tx(() => this.stopEntry(running, this.clock()))
  }

  toggle(projectId: number): void {
    if (this.repo.runningEntry()?.projectId === projectId) this.stop()
    else this.start(projectId)
  }

  /** Long press: the running entry gets another activity, its start time stays. */
  rebook(projectId: number): void {
    const running = this.repo.runningEntry()
    if (!running) {
      this.start(projectId)
      return
    }
    if (!this.repo.getProject(projectId)) throw new ValidationError('Tätigkeit nicht gefunden')
    this.repo.updateEntry(running.id, { projectId, ytIssue: null })
  }

  /** Short press without selection: stop, or restart the last activity. */
  pressDefault(): void {
    if (this.repo.runningEntry()) return this.stop()
    const last = this.repo.lastEntry()
    const p = last && this.repo.getProject(last.projectId)
    if (p && !p.archived) this.start(p.id)
  }

  setRunningNote(note: string): void {
    const running = this.repo.runningEntry()
    if (running) this.repo.updateEntry(running.id, { note })
  }

  come(): void {
    if (this.repo.openPresence()) return
    this.repo.createPresence(this.clock(), null)
  }

  pauseStart(): void {
    const now = this.clock()
    this.repo.tx(() => {
      if (this.repo.openPause()) return
      let presence = this.repo.openPresence()
      if (!presence) presence = this.repo.createPresence(now, null)
      const running = this.repo.runningEntry()
      if (running) this.stopEntry(running, now)
      this.repo.createPause(presence.id, now, null, running?.projectId ?? null)
    })
  }

  pauseEnd(): void {
    const now = this.clock()
    this.repo.tx(() => {
      const pause = this.repo.openPause()
      if (!pause) return
      this.repo.updatePause(pause.id, pause.start, now)
      const resume = pause.resumeProjectId && this.repo.getProject(pause.resumeProjectId)
      if (resume && !resume.archived && this.settings()['work.resumeAfterBreak']) {
        this.repo.createEntry({ projectId: resume.id, start: now, end: null, note: '', ytIssue: null })
      }
    })
  }

  togglePause(): void {
    if (this.repo.openPause()) this.pauseEnd()
    else this.pauseStart()
  }

  go(reason: PresenceEndReason | null = null): void {
    this.goAt(this.clock(), reason)
  }

  /**
   * Ends everything at `at` (also used to close a forgotten day). `doctor`: leaving for a doctor's
   * appointment; without a later "Kommen" that day the target counts as fulfilled.
   */
  goAt(at: number, reason: PresenceEndReason | null = null): void {
    this.repo.tx(() => {
      const running = this.repo.runningEntry()
      if (running) this.stopEntry(running, Math.max(at, running.start))
      const pause = this.repo.openPause()
      if (pause) this.repo.updatePause(pause.id, pause.start, Math.max(at, pause.start))
      const presence = this.repo.openPresence()
      if (presence) this.repo.updatePresence(presence.id, presence.start, Math.max(at, presence.start), reason)
    })
  }

  private stopEntry(entry: Entry, at: number): void {
    if (at - entry.start < MIN_ENTRY_MS) {
      this.repo.deleteEntry(entry.id)
      reconcileEntry(this.repo, entry.id)
      return
    }
    this.repo.updateEntry(entry.id, { end: at })
    this.afterComplete(entry.id)
  }

  private afterComplete(entryId: number): void {
    if (this.settings()['youtrack.bookingMode'] === 'onStop') requestBooking(this.repo, [entryId])
    else reconcileEntry(this.repo, entryId)
  }

  // ---- manual editing ----------------------------------------------------

  createEntry(e: EntryInput): Entry {
    this.validateEntry(e, null)
    return this.repo.tx(() => {
      const created = this.repo.createEntry(e)
      if (created.end !== null) this.afterComplete(created.id)
      return created
    })
  }

  updateEntry(id: number, patch: Partial<EntryInput>): Entry {
    const cur = this.repo.getEntry(id)
    if (!cur) throw new ValidationError('Eintrag nicht gefunden')
    const next = { ...cur, ...patch }
    this.validateEntry(next, id)
    return this.repo.tx(() => {
      const updated = this.repo.updateEntry(id, patch)
      if (cur.end === null && updated.end !== null) this.afterComplete(id)
      else reconcileEntry(this.repo, id)
      return updated
    })
  }

  deleteEntry(id: number): void {
    this.repo.tx(() => {
      this.repo.deleteEntry(id)
      reconcileEntry(this.repo, id)
    })
  }

  private validateEntry(e: EntryInput, id: number | null): void {
    if (!this.repo.getProject(e.projectId)) throw new ValidationError('Tätigkeit fehlt')
    if (e.end !== null && e.end <= e.start) throw new ValidationError('Ende muss nach dem Start liegen')
    if (e.end === null) {
      const running = this.repo.runningEntry()
      if (running && running.id !== id) throw new ValidationError('Es läuft bereits ein Eintrag')
    }
    if (e.start > this.clock() + 60_000) throw new ValidationError('Start liegt in der Zukunft')
  }

  createPresence(start: number, end: number | null): Presence {
    this.validateInterval(start, end)
    this.validatePresenceOverlap(start, end, null)
    if (end === null && this.repo.openPresence()) throw new ValidationError('Es ist bereits eine Anwesenheit offen')
    return this.repo.createPresence(start, end)
  }

  updatePresence(id: number, start: number, end: number | null, endReason?: PresenceEndReason | null): void {
    this.validateInterval(start, end)
    this.validatePresenceOverlap(start, end, id)
    const open = this.repo.openPresence()
    if (end === null && open && open.id !== id) throw new ValidationError('Es ist bereits eine Anwesenheit offen')
    this.repo.updatePresence(id, start, end, end === null ? null : endReason)
  }

  private validatePresenceOverlap(start: number, end: number | null, id: number | null): void {
    const other = this.repo.presencesBetween(start, end ?? Number.MAX_SAFE_INTEGER).find((p) => p.id !== id)
    if (other) {
      const span = `${formatTime(other.start)}–${other.end === null ? 'offen' : formatTime(other.end)}`
      throw new ValidationError(`Anwesenheit überschneidet sich mit ${localDay(other.start)} ${span}`)
    }
  }

  deletePresence(id: number): void {
    this.repo.deletePresence(id)
  }

  createPause(start: number, end: number | null): Pause {
    this.validateInterval(start, end)
    const presence = this.repo.presencesBetween(start, end ?? start + 1)[0]
    if (!presence) throw new ValidationError('Pause muss in einer Anwesenheit liegen')
    if (end === null && this.repo.openPause()) throw new ValidationError('Es ist bereits eine Pause offen')
    return this.repo.createPause(presence.id, start, end, null)
  }

  updatePause(id: number, start: number, end: number | null): void {
    this.validateInterval(start, end)
    this.repo.updatePause(id, start, end)
  }

  deletePause(id: number): void {
    this.repo.deletePause(id)
  }

  private validateInterval(start: number, end: number | null): void {
    if (end !== null && end <= start) throw new ValidationError('Ende muss nach dem Start liegen')
  }

  // ---- projects -----------------------------------------------------------

  projects(): Project[] {
    return this.repo.listProjects()
  }

  createProject(p: Partial<ProjectInput> & { name: string }): Project {
    if (!p.name.trim()) throw new ValidationError('Name fehlt')
    const used = this.repo.listProjects().map((x) => x.color)
    return this.repo.createProject(
      {
        kind: p.kind ?? (p.ytIssue || p.ytProjectId ? 'youtrack' : 'local'),
        name: p.name.trim(),
        client: p.client ?? '',
        color: p.color ?? nextColor(used),
        favorite: p.favorite ?? false,
        archived: p.archived ?? false,
        ytProjectId: p.ytProjectId ?? null,
        ytIssue: p.ytIssue ?? null,
        ytWorkTypeId: p.ytWorkTypeId ?? null
      },
      this.clock()
    )
  }

  updateProject(id: number, patch: Partial<ProjectInput>): Project {
    if (patch.name !== undefined && !patch.name.trim()) throw new ValidationError('Name fehlt')
    return this.repo.tx(() => {
      const p = this.repo.updateProject(id, patch)
      // Kind, ticket or work type changes affect every entry of the activity.
      for (const e of this.repo.entriesOfProject(id)) reconcileEntry(this.repo, e.id)
      return p
    })
  }

  /** Deletes an unused activity, archives one that has entries. */
  deleteProject(id: number): 'deleted' | 'archived' {
    if (this.repo.projectHasEntries(id)) {
      this.repo.updateProject(id, { archived: true })
      return 'archived'
    }
    this.repo.deleteProject(id)
    return 'deleted'
  }

  importRemoteProjects(ps: RemoteProject[]): Project[] {
    const existing = this.repo.listProjects()
    return this.repo.tx(() =>
      ps
        .filter((rp) => !existing.some((p) => p.ytProjectId === rp.id && !p.ytIssue))
        .map((rp) => this.createProject({ kind: 'youtrack', name: rp.name, client: rp.key, ytProjectId: rp.id }))
    )
  }

  importRemoteIssues(is: RemoteIssue[]): Project[] {
    const existing = this.repo.listProjects()
    return this.repo.tx(() =>
      is
        .filter((ri) => !existing.some((p) => p.ytIssue === ri.key))
        .map((ri) =>
          this.createProject({
            kind: 'youtrack',
            name: `${ri.key} ${ri.summary}`,
            client: ri.projectKey,
            ytProjectId: ri.projectId,
            ytIssue: ri.key
          })
        )
    )
  }

  /** Marks activities whose YouTrack project is archived or whose ticket is resolved. */
  markStale(remoteProjects: RemoteProject[], resolvedIssues: Set<string>): void {
    this.repo.tx(() => {
      for (const p of this.repo.listProjects()) {
        if (p.kind !== 'youtrack') continue
        const rp = remoteProjects.find((r) => r.id === p.ytProjectId)
        const stale = (rp?.archived ?? false) || (!!p.ytIssue && resolvedIssues.has(p.ytIssue))
        if (stale !== p.ytStale) this.repo.updateProject(p.id, { ytStale: stale })
      }
    })
  }

  // ---- views ----------------------------------------------------------------

  private data(from: number, to: number) {
    return {
      entries: this.repo.entriesBetween(from, to),
      presences: this.repo.presencesBetween(from, to),
      pauses: this.repo.pausesBetween(from, to)
    }
  }

  day(day: string): DayView {
    const [from, to] = dayRange(day)
    const data = this.data(from, to)
    const rows = this.repo.bookingsForEntries(
      data.entries.map((e) => e.id),
      CONNECTOR
    )
    const projects = new Map(this.repo.listProjects().map((p) => [p.id, p]))
    const calendar = this.calendar(day, day)[0]
    const summary = daySummary(day, data, this.clock(), {
      minLunchBreakMin: this.settings()['work.minLunchBreakMin'],
      targetSec: this.targetSec(calendar)
    })
    const off = calendar.holiday ?? (calendar.absence && !calendar.absence.half ? 'Urlaub' : null)
    if (off && summary.netSec > 0) summary.hints.unshift({ level: 'info', text: `Arbeitszeit erfasst, obwohl ${calendar.holiday ? `Feiertag (${off})` : 'Urlaub'} ist` })
    return {
      day,
      summary,
      calendar,
      entries: data.entries.map((e) => ({
        ...e,
        booking: entryState(e, projects.get(e.projectId), rows),
        bookingError: rows.find((r) => r.entryId === e.id && r.error)?.error ?? null
      })),
      presences: data.presences,
      pauses: data.pauses
    }
  }

  /** Target working time of a day: none on days off, half on a half vacation day. */
  private targetSec(c: DayCalendar): number {
    if (!c.workday) return 0
    const full = this.settings()['work.dailyTargetMin'] * 60
    if (!c.absence) return full
    return c.absence.half ? full / 2 : 0
  }

  /** Holiday, absence and working-day flag for each day of [fromDay, toDay]. */
  calendar(fromDay: string, toDay: string): DayCalendar[] {
    const ctx = calendarContext(this.settings())
    const absences = this.repo.absencesBetween(fromDay, toDay)
    const out: DayCalendar[] = []
    for (let d = fromDay; d <= toDay; d = addDays(d, 1)) out.push(calendarDay(d, absences, ctx))
    return out
  }

  week(anyDay: string): WeekView {
    const first = weekStart(anyDay)
    const from = dayRange(first)[0]
    const to = dayRange(addDays(first, 6))[1]
    const data = this.data(from, to)
    const rows = this.repo.bookingsForEntries(
      data.entries.map((e) => e.id),
      CONNECTOR
    )
    const projects = new Map(this.repo.listProjects().map((p) => [p.id, p]))
    const states = { running: 0, local: 0, unbookable: 0, open: 0, pending: 0, booked: 0, error: 0 }
    for (const e of data.entries) states[entryState(e, projects.get(e.projectId), rows)]++
    const calendar = this.calendar(first, addDays(first, 6))
    const targets = calendar.map((c) => this.targetSec(c))
    return { summary: weekSummary(first, data, this.clock(), targets), states, calendar }
  }

  todayNetSec(): number {
    return this.day(localDay(this.clock())).summary.netSec
  }

  // ---- absences (vacation) ------------------------------------------------

  createAbsence(a: AbsenceInput): Absence {
    this.validateAbsence(a, null)
    return this.repo.createAbsence(a)
  }

  updateAbsence(id: number, a: AbsenceInput): Absence {
    if (!this.repo.getAbsence(id)) throw new ValidationError('Abwesenheit nicht gefunden')
    this.validateAbsence(a, id)
    return this.repo.updateAbsence(id, a)
  }

  deleteAbsence(id: number): void {
    this.repo.deleteAbsence(id)
  }

  private validateAbsence(a: AbsenceInput, id: number | null): void {
    if (a.kind !== 'vacation') throw new ValidationError('Unbekannte Abwesenheit')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.firstDay) || !/^\d{4}-\d{2}-\d{2}$/.test(a.lastDay)) throw new ValidationError('Datum fehlt')
    if (a.lastDay < a.firstDay) throw new ValidationError('Ende liegt vor dem Beginn')
    if (a.half && a.firstDay !== a.lastDay) throw new ValidationError('Halber Tag geht nur für einen einzelnen Tag')
    if (a.firstDay.slice(0, 4) !== a.lastDay.slice(0, 4)) throw new ValidationError('Bitte über den Jahreswechsel in zwei Einträgen buchen')
    const clash = this.repo.absencesBetween(a.firstDay, a.lastDay).find((x) => x.id !== id)
    if (clash) throw new ValidationError(`Überschneidet sich mit Urlaub ${clash.firstDay} – ${clash.lastDay}`)
    if (absenceDays(a, calendarContext(this.settings())) === 0) throw new ValidationError('Im Zeitraum liegt kein Arbeitstag')
  }

  vacationAccount(year: number): VacationAccount {
    const s = this.settings()
    const ctx = calendarContext(s)
    const today = localDay(this.clock())
    const absences = this.repo
      .absencesBetween(`${year}-01-01`, `${year}-12-31`)
      .filter((a) => a.kind === 'vacation')
      .map((a) => ({ ...a, days: absenceDays(a, ctx) }))
    let taken = 0
    let planned = 0
    for (const a of absences) {
      // Split a vacation that spans today into the part already taken and the rest.
      if (a.lastDay <= today) taken += a.days
      else if (a.firstDay > today) planned += a.days
      else {
        const done = absenceDays({ firstDay: a.firstDay, lastDay: today, half: a.half }, ctx)
        taken += done
        planned += a.days - done
      }
    }
    const entitlement = s['vacation.daysPerYear']
    const carryOver = s['vacation.carryOver'][String(year)] ?? 0
    return { year, entitlement, carryOver, taken, planned, remaining: entitlement + carryOver - taken - planned, absences }
  }

  // ---- booking ----------------------------------------------------------------

  bookRange(fromDay: string, toDay: string): number {
    const from = dayRange(fromDay)[0]
    const to = dayRange(toDay)[1]
    const ids = this.repo.entriesBetween(from, to).map((e) => e.id)
    return requestBooking(this.repo, ids)
  }

  retryErrors(): number {
    return this.repo.retryErrors(CONNECTOR)
  }

  bookingRows(entryIds: number[]): BookingRow[] {
    return this.repo.bookingsForEntries(entryIds, CONNECTOR)
  }

  /** Entries of a range, for CSV export. */
  entriesBetween(fromDay: string, toDay: string): Entry[] {
    return this.repo.entriesBetween(dayRange(fromDay)[0], dayRange(toDay)[1])
  }

  attendanceBetween(fromDay: string, toDay: string): { presences: Presence[]; pauses: Pause[] } {
    const from = dayRange(fromDay)[0]
    const to = dayRange(toDay)[1]
    return { presences: this.repo.presencesBetween(from, to), pauses: this.repo.pausesBetween(from, to) }
  }
}
