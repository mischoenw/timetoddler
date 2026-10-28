import { holidayOn, type StateCode } from './holidays'
import { addDays } from './timecalc'
import type { Absence, DayCalendar, Settings } from './types'

export interface CalendarContext {
  state: StateCode | ''
  regional: boolean
  /** Weekdays that are working days, 0 = Sunday … 6 = Saturday. */
  workdays: number[]
}

export function calendarContext(s: Settings): CalendarContext {
  return { state: s['work.state'], regional: s['work.regionalHolidays'], workdays: s['work.workdays'] }
}

const weekday = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Regular working day: a configured weekday that is not a public holiday. */
export function isWorkday(day: string, ctx: CalendarContext): boolean {
  return ctx.workdays.includes(weekday(day)) && !holidayOn(day, ctx.state, ctx.regional)
}

/** Vacation days an absence costs: working days in its range, a half day counts 0.5. */
export function absenceDays(a: Pick<Absence, 'firstDay' | 'lastDay' | 'half'>, ctx: CalendarContext): number {
  let n = 0
  for (let d = a.firstDay; d <= a.lastDay; d = addDays(d, 1)) if (isWorkday(d, ctx)) n++
  return a.half ? n / 2 : n
}

export function calendarDay(day: string, absences: Absence[], ctx: CalendarContext): DayCalendar {
  const h = holidayOn(day, ctx.state, ctx.regional)
  const a = absences.find((x) => x.firstDay <= day && day <= x.lastDay)
  return {
    day,
    holiday: h?.name ?? null,
    absence: a ? { id: a.id, kind: a.kind, half: a.half } : null,
    workday: isWorkday(day, ctx)
  }
}
