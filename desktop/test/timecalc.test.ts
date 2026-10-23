import { describe, expect, it } from 'vitest'
import { addDays, daySummary, formatHM, splitByDay, weekStart, weekSummary } from '@shared/timecalc'
import { at } from './helpers'

describe('timecalc', () => {
  it('splits at local midnight', () => {
    const segs = splitByDay(at('2026-10-21 23:30'), at('2026-10-22 00:30'))
    expect(segs.map((s) => [s.day, (s.end - s.start) / 60000])).toEqual([
      ['2026-10-21', 30],
      ['2026-10-22', 30]
    ])
  })

  it('handles the DST switch (25 h day)', () => {
    // 2026-10-25: clocks go back in Europe/Berlin
    const segs = splitByDay(at('2026-10-25 00:00'), at('2026-10-26 00:00'))
    expect(segs).toHaveLength(1)
    expect((segs[0].end - segs[0].start) / 3600000).toBe(25)
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('finds monday', () => {
    expect(weekStart('2026-10-22')).toBe('2026-10-19')
    expect(weekStart('2026-10-25')).toBe('2026-10-19')
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
  })

  it('computes net work time and break hints', () => {
    const s = daySummary(
      '2026-10-21',
      {
        presences: [{ id: 1, start: at('2026-10-21 08:00'), end: at('2026-10-21 15:00') }],
        pauses: [{ id: 1, presenceId: 1, start: at('2026-10-21 12:00'), end: at('2026-10-21 12:20'), resumeProjectId: null }],
        entries: [{ id: 1, projectId: 7, start: at('2026-10-21 08:00'), end: at('2026-10-21 12:00'), note: '', ytIssue: null }]
      },
      at('2026-10-21 18:00')
    )
    expect(formatHM(s.netSec)).toBe('6:40')
    expect(s.perProject[7]).toBe(4 * 3600)
    expect(formatHM(s.unassignedSec)).toBe('2:40')
    expect(s.hints.map((h) => h.text)).toEqual(['Mehr als 6 h Arbeitszeit, aber weniger als 30 min Pause'])
  })

  it('counts open intervals up to now and flags a forgotten day', () => {
    const now = at('2026-10-22 09:00')
    const data = { presences: [{ id: 1, start: at('2026-10-21 08:00'), end: null }], pauses: [], entries: [] }
    const s = daySummary('2026-10-22', data, now)
    expect(s.presenceSec).toBe(9 * 3600)
    expect(s.hints.some((h) => h.text.includes('Vortag'))).toBe(true)
  })

  it('sums a week per project and day', () => {
    const w = weekSummary(
      '2026-10-22',
      {
        presences: [],
        pauses: [],
        entries: [
          { id: 1, projectId: 1, start: at('2026-10-19 09:00'), end: at('2026-10-19 10:00'), note: '', ytIssue: null },
          { id: 2, projectId: 1, start: at('2026-10-25 23:00'), end: at('2026-10-26 01:00'), note: '', ytIssue: null }
        ]
      },
      at('2026-10-30 00:00')
    )
    expect(w.days[0]).toBe('2026-10-19')
    expect(w.perProject[1]).toEqual([3600, 0, 0, 0, 0, 0, 3600])
  })
})
