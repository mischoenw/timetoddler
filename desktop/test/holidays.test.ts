import { describe, expect, it } from 'vitest'
import { easter, holidayOn, holidays, STATES } from '@shared/holidays'
import { absenceDays, calendarDay, isWorkday, type CalendarContext } from '@shared/calendar'
import { attendanceCsv } from '@core/csv'
import { setup } from './helpers'

const ctx = (state: CalendarContext['state'], regional = false): CalendarContext => ({ state, regional, workdays: [1, 2, 3, 4, 5] })

describe('holidays', () => {
  it('computes Easter', () => {
    expect(easter(2024)).toEqual([3, 31])
    expect(easter(2025)).toEqual([4, 20])
    expect(easter(2026)).toEqual([4, 5])
    expect(easter(2027)).toEqual([3, 28])
    expect(easter(2038)).toEqual([4, 25])
  })

  it('has the nine nationwide holidays without a state', () => {
    expect(holidays(2026, '').map((h) => `${h.day} ${h.name}`)).toEqual([
      '2026-01-01 Neujahr',
      '2026-04-03 Karfreitag',
      '2026-04-06 Ostermontag',
      '2026-05-01 Tag der Arbeit',
      '2026-05-14 Christi Himmelfahrt',
      '2026-05-25 Pfingstmontag',
      '2026-10-03 Tag der Deutschen Einheit',
      '2026-12-25 1. Weihnachtstag',
      '2026-12-26 2. Weihnachtstag'
    ])
  })

  it('adds state holidays', () => {
    const names = (s: Parameters<typeof holidays>[1], regional = false) => holidays(2026, s, regional).map((h) => h.name)
    expect(names('BY')).toEqual(expect.arrayContaining(['Heilige Drei Könige', 'Fronleichnam', 'Allerheiligen']))
    expect(names('BY')).not.toContain('Mariä Himmelfahrt')
    expect(names('BY', true)).toContain('Mariä Himmelfahrt')
    expect(names('BE')).toContain('Internationaler Frauentag')
    expect(names('TH')).toEqual(expect.arrayContaining(['Weltkindertag', 'Reformationstag']))
    expect(names('NW')).not.toContain('Reformationstag')
    expect(holidayOn('2026-06-04', 'NW')?.name).toBe('Fronleichnam')
    expect(holidayOn('2026-06-04', 'SN')).toBeUndefined()
    expect(holidayOn('2026-06-04', 'SN', true)).toMatchObject({ name: 'Fronleichnam', regional: true })
    // Wednesday before 23 November
    expect(holidayOn('2026-11-18', 'SN')?.name).toBe('Buß- und Bettag')
    expect(holidayOn('2025-11-19', 'SN')?.name).toBe('Buß- und Bettag')
    expect(holidayOn('2028-11-22', 'SN')?.name).toBe('Buß- und Bettag')
    expect(STATES).toHaveLength(16)
  })

  it('counts vacation days without weekends and holidays', () => {
    // Mon 2026-05-11 … Fri 2026-05-15, Thursday is Ascension Day
    expect(absenceDays({ firstDay: '2026-05-11', lastDay: '2026-05-17', half: false }, ctx('HE'))).toBe(4)
    expect(absenceDays({ firstDay: '2026-05-12', lastDay: '2026-05-12', half: true }, ctx('HE'))).toBe(0.5)
    expect(isWorkday('2026-10-31', ctx('NI'))).toBe(false) // Saturday anyway
    expect(isWorkday('2026-11-02', ctx('NI'))).toBe(true)
    expect(calendarDay('2026-12-25', [], ctx(''))).toMatchObject({ holiday: '1. Weihnachtstag', workday: false })
  })
})

describe('vacation', () => {
  it('validates and books vacation', async () => {
    const { svc } = await setup('2026-07-15 10:00')
    svc.setSettings({ 'work.state': 'BY', 'vacation.daysPerYear': 30, 'vacation.carryOver': { '2026': 2 } })
    const v = { kind: 'vacation' as const, note: '', half: false }
    svc.createAbsence({ ...v, firstDay: '2026-07-13', lastDay: '2026-07-17' }) // spans today: 3 taken, 2 planned
    svc.createAbsence({ ...v, firstDay: '2026-08-14', lastDay: '2026-08-14', half: true })
    expect(() => svc.createAbsence({ ...v, firstDay: '2026-07-17', lastDay: '2026-07-20' })).toThrow(/Überschneidet/)
    expect(() => svc.createAbsence({ ...v, firstDay: '2026-07-18', lastDay: '2026-07-19' })).toThrow(/kein Arbeitstag/)
    expect(() => svc.createAbsence({ ...v, firstDay: '2026-07-20', lastDay: '2026-07-21', half: true })).toThrow(/Halber Tag/)
    expect(() => svc.createAbsence({ ...v, firstDay: '2026-12-28', lastDay: '2027-01-04' })).toThrow(/Jahreswechsel/)
    const acc = svc.vacationAccount(2026)
    expect(acc).toMatchObject({ entitlement: 30, carryOver: 2, taken: 3, planned: 2.5, remaining: 26.5 })
    expect(acc.absences.map((a) => a.days)).toEqual([5, 0.5])

    const day = svc.day('2026-07-14')
    expect(day.calendar).toMatchObject({ holiday: null, absence: { kind: 'vacation', half: false }, workday: true })
    expect(svc.week('2026-08-14').calendar.find((c) => c.day === '2026-08-15')?.holiday).toBeNull() // regional off
    svc.setSettings({ 'work.regionalHolidays': true })
    expect(svc.week('2026-08-14').calendar.find((c) => c.day === '2026-08-15')?.holiday).toBe('Mariä Himmelfahrt')
  })

  it('flags work time on a holiday', async () => {
    const { svc, clock } = await setup('2026-05-01 09:00')
    svc.start(svc.createProject({ name: 'A' }).id)
    clock.set('2026-05-01 10:00')
    svc.stop()
    expect(svc.day('2026-05-01').summary.hints[0]).toMatchObject({ level: 'info', text: expect.stringContaining('Tag der Arbeit') })
  })

  it('lists days off in the attendance CSV', () => {
    const csv = attendanceCsv([], [], 0, [
      { day: '2026-05-01', holiday: 'Tag der Arbeit', absence: null, workday: false },
      { day: '2026-05-04', holiday: null, absence: { id: 1, kind: 'vacation', half: true }, workday: true },
      { day: '2026-05-09', holiday: null, absence: { id: 1, kind: 'vacation', half: false }, workday: false }
    ])
    expect(csv.split('\r\n').slice(1, -1)).toEqual(['2026-05-01;Feiertag: Tag der Arbeit;;;;', '2026-05-04;Urlaub (halber Tag);;;;'])
  })
})

describe('target time and doctor visits', () => {
  it('credits a doctor visit until the next Kommen', async () => {
    const { svc, clock } = await setup('2026-10-21 08:00')
    svc.come()
    clock.set('2026-10-21 10:00')
    svc.go('doctor')
    clock.set('2026-10-21 11:30')
    svc.come()
    clock.set('2026-10-21 17:00')
    svc.go()
    const s = svc.day('2026-10-21').summary
    expect(s).toMatchObject({ targetSec: 8 * 3600, netSec: 7.5 * 3600, doctorSec: 1.5 * 3600, creditedSec: 9 * 3600, balanceSec: 3600 })
    expect(svc.day('2026-10-21').presences[0].endReason).toBe('doctor')
  })

  it('without return the day counts as fulfilled, never as overtime', async () => {
    const { svc, clock } = await setup('2026-10-21 08:00')
    svc.come()
    clock.set('2026-10-21 11:00')
    svc.go('doctor')
    clock.set('2026-10-21 20:00')
    expect(svc.day('2026-10-21').summary).toMatchObject({ netSec: 3 * 3600, doctorSec: 5 * 3600, creditedSec: 8 * 3600, balanceSec: 0 })

    // worked longer than the target before leaving: capped at the target
    const b = await setup('2026-10-22 07:00')
    b.svc.come()
    b.clock.set('2026-10-22 16:30')
    b.svc.go('doctor')
    expect(b.svc.day('2026-10-22').summary).toMatchObject({ creditedSec: 8 * 3600, balanceSec: 0 })
  })

  it('has no target on holidays and half on a half vacation day', async () => {
    const { svc } = await setup('2026-10-21 08:00')
    svc.setSettings({ 'work.state': 'NI', 'work.dailyTargetMin': 420 })
    svc.createAbsence({ kind: 'vacation', firstDay: '2026-10-30', lastDay: '2026-10-30', half: true, note: '' })
    const w = svc.week('2026-10-28').summary
    // Mo 26 … So 1: Sat 31 is Reformationstag (weekend anyway), Fri 30 half vacation
    expect(w.targetPerDay.map((s) => s / 3600)).toEqual([7, 7, 7, 7, 3.5, 0, 0])
    expect(svc.day('2026-12-25').summary.targetSec).toBe(0)
  })
})

describe('doctor visit edge cases', () => {
  it('counts a visit right after coming', async () => {
    const { svc } = await setup('2026-10-21 11:00')
    svc.come()
    svc.go('doctor')
    expect(svc.day('2026-10-21').summary).toMatchObject({ creditedSec: 8 * 3600, balanceSec: 0 })
  })
})

describe('doctor visits are listed separately', () => {
  it('lists returned and open-ended visits with times', async () => {
    const { svc, clock } = await setup('2026-10-21 08:00')
    svc.come()
    clock.set('2026-10-21 09:00')
    svc.go('doctor')
    clock.set('2026-10-21 10:00')
    svc.come()
    clock.set('2026-10-21 12:00')
    svc.go('doctor') // no return: 3 h worked + 1 h doctor, 4 h left until the 8 h target
    clock.set('2026-10-21 19:00')
    const s = svc.day('2026-10-21').summary
    expect(s).toMatchObject({ netSec: 3 * 3600, doctorSec: 5 * 3600, creditedSec: 8 * 3600, balanceSec: 0 })
    expect(s.doctorVisits.map((v) => [new Date(v.start).getHours(), new Date(v.end).getHours(), v.untilTarget])).toEqual([
      [9, 10, false],
      [12, 16, true]
    ])
    const csv = attendanceCsv(svc.day('2026-10-21').presences, [], clock.t, [], svc.doctorVisitsBetween('2026-10-21', '2026-10-21'))
    expect(csv).toContain('2026-10-21;Arztbesuch;09:00;10:00;1:00;60')
    expect(csv).toContain('2026-10-21;Arztbesuch (bis Sollzeit);12:00;16:00;4:00;240')
  })
})
