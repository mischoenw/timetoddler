import type { DayCalendar, Entry, EntryBookingState, Pause, Presence, Project } from '@shared/types'
import { formatHM, formatTime, splitByDay } from '@shared/timecalc'
import { issueOf } from './booking'

const STATE_LABEL: Record<EntryBookingState, string> = {
  running: 'läuft',
  local: 'lokal',
  unbookable: 'nicht buchbar',
  open: 'offen',
  pending: 'ausstehend',
  booked: 'gebucht',
  error: 'Fehler'
}

function cell(v: string | number): string {
  const s = String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const line = (vals: (string | number)[]): string => vals.map(cell).join(';')

/** Semicolon CSV (German Excel), one row per entry and day. */
export function entriesCsv(
  entries: Entry[],
  projects: Map<number, Project>,
  states: Map<number, EntryBookingState>,
  now: number
): string {
  const out = [line(['Datum', 'Start', 'Ende', 'Dauer', 'Minuten', 'Tätigkeit', 'Kunde', 'Ticket', 'Notiz', 'Status'])]
  for (const e of entries) {
    const p = projects.get(e.projectId)
    for (const seg of splitByDay(e.start, e.end ?? now)) {
      const sec = Math.floor((seg.end - seg.start) / 1000)
      out.push(
        line([
          seg.day,
          formatTime(seg.start),
          e.end === null ? '' : formatTime(seg.end),
          formatHM(sec),
          Math.round(sec / 60),
          p?.name ?? '?',
          p?.client ?? '',
          issueOf(e, p) ?? '',
          e.note,
          STATE_LABEL[states.get(e.id) ?? 'open']
        ])
      )
    }
  }
  return out.join('\r\n') + '\r\n'
}

/** Attendance, pauses and days off (public holidays, vacation) in date order. */
export function attendanceCsv(presences: Presence[], pauses: Pause[], now: number, calendar: DayCalendar[] = []): string {
  const out = [line(['Datum', 'Art', 'Start', 'Ende', 'Dauer', 'Minuten'])]
  const rows: { day: string; at: number; cells: (string | number)[] }[] = []
  for (const r of [...presences.map((p) => ({ kind: 'Anwesenheit', ...p })), ...pauses.map((p) => ({ kind: 'Pause', ...p }))]) {
    for (const seg of splitByDay(r.start, r.end ?? now)) {
      const sec = Math.floor((seg.end - seg.start) / 1000)
      rows.push({
        day: seg.day,
        at: seg.start,
        cells: [seg.day, r.kind, formatTime(seg.start), r.end === null ? '' : formatTime(seg.end), formatHM(sec), Math.round(sec / 60)]
      })
    }
  }
  for (const c of calendar) {
    if (c.holiday) rows.push({ day: c.day, at: -1, cells: [c.day, `Feiertag: ${c.holiday}`, '', '', '', ''] })
    else if (c.absence && c.workday) rows.push({ day: c.day, at: -1, cells: [c.day, c.absence.half ? 'Urlaub (halber Tag)' : 'Urlaub', '', '', '', ''] })
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at)
  for (const r of rows) out.push(line(r.cells))
  return out.join('\r\n') + '\r\n'
}
