import type { DaySummary, Entry, Hint, Pause, Presence, WeekSummary } from './types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar day of a timestamp. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseDay(day: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) throw new Error(`Ungültiger Tag: ${day}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Local midnight; DST-safe because it goes through the local calendar. */
export function dayStart(day: string): number {
  const [y, m, d] = parseDay(day)
  return new Date(y, m - 1, d).getTime()
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parseDay(day)
  return localDay(new Date(y, m - 1, d + n).getTime())
}

export function dayRange(day: string): [number, number] {
  return [dayStart(day), dayStart(addDays(day, 1))]
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = parseDay(day)
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7
  return addDays(day, -dow)
}

export interface DaySegment {
  day: string
  start: number
  end: number
}

/** Splits [start, end) at local midnights. */
export function splitByDay(start: number, end: number): DaySegment[] {
  const out: DaySegment[] = []
  let cur = start
  while (cur < end) {
    const day = localDay(cur)
    const next = Math.min(end, dayStart(addDays(day, 1)))
    out.push({ day, start: cur, end: next })
    cur = next
  }
  return out
}

/** Seconds of [start, end ?? now) inside [from, to). */
export function overlapSec(start: number, end: number | null, from: number, to: number, now: number): number {
  const e = end ?? now
  const ms = Math.min(e, to) - Math.max(start, from)
  return ms > 0 ? Math.floor(ms / 1000) : 0
}

export interface TimeData {
  entries: Entry[]
  presences: Presence[]
  pauses: Pause[]
}

const H = 3600

export function daySummary(day: string, data: TimeData, now: number): DaySummary {
  const [from, to] = dayRange(day)
  const sum = (xs: { start: number; end: number | null }[]): number =>
    xs.reduce((acc, x) => acc + overlapSec(x.start, x.end, from, to, now), 0)

  const presenceSec = sum(data.presences)
  const pauseSec = sum(data.pauses)
  const netSec = Math.max(0, presenceSec - pauseSec)

  const perProject: Record<number, number> = {}
  let entriesSec = 0
  for (const e of data.entries) {
    const s = overlapSec(e.start, e.end, from, to, now)
    if (s === 0) continue
    perProject[e.projectId] = (perProject[e.projectId] ?? 0) + s
    entriesSec += s
  }

  const hints: Hint[] = []
  if (netSec > 6 * H && pauseSec < 30 * 60) hints.push({ level: 'warn', text: 'Mehr als 6 h Arbeitszeit, aber weniger als 30 min Pause' })
  if (netSec > 9 * H && pauseSec < 45 * 60) hints.push({ level: 'warn', text: 'Mehr als 9 h Arbeitszeit, aber weniger als 45 min Pause' })
  if (netSec > 10 * H) hints.push({ level: 'warn', text: 'Mehr als 10 h Arbeitszeit' })
  for (const e of data.entries) {
    if (e.end === null && now - e.start > 12 * H * 1000) hints.push({ level: 'warn', text: 'Ein Eintrag läuft seit mehr als 12 h' })
  }
  for (const p of data.presences) {
    if (p.end === null && p.start < from) hints.push({ level: 'warn', text: 'Anwesenheit vom Vortag ist noch offen (Gehen vergessen?)' })
  }

  return {
    day,
    presenceSec,
    pauseSec,
    netSec,
    entriesSec,
    unassignedSec: Math.max(0, netSec - entriesSec),
    perProject,
    hints
  }
}

export function weekSummary(anyDay: string, data: TimeData, now: number): WeekSummary {
  const first = weekStart(anyDay)
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
  const perProject: Record<number, number[]> = {}
  const netPerDay: number[] = []
  days.forEach((day, i) => {
    const s = daySummary(day, data, now)
    netPerDay.push(s.netSec)
    for (const [pid, sec] of Object.entries(s.perProject)) {
      ;(perProject[Number(pid)] ??= Array(7).fill(0))[i] = sec
    }
  })
  return { days, perProject, netPerDay }
}

/** `H:MM` */
export function formatHM(sec: number): string {
  const m = Math.round(sec / 60)
  return `${Math.floor(m / 60)}:${pad(m % 60)}`
}

/** `H:MM:SS` */
export function formatHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
