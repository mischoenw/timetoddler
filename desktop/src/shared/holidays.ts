/** German public holidays per federal state, computed locally (no online lookup). */

export const STATES = [
  ['BW', 'Baden-Württemberg'],
  ['BY', 'Bayern'],
  ['BE', 'Berlin'],
  ['BB', 'Brandenburg'],
  ['HB', 'Bremen'],
  ['HH', 'Hamburg'],
  ['HE', 'Hessen'],
  ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'],
  ['NW', 'Nordrhein-Westfalen'],
  ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'],
  ['SN', 'Sachsen'],
  ['ST', 'Sachsen-Anhalt'],
  ['SH', 'Schleswig-Holstein'],
  ['TH', 'Thüringen']
] as const

export type StateCode = (typeof STATES)[number][0]

export interface Holiday {
  day: string
  name: string
  /** Only in some municipalities of the state (included when regional holidays are switched on). */
  regional: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number): string => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Easter Sunday (Gregorian, anonymous algorithm) as [month, day]. */
export function easter(year: number): [number, number] {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return [month, day]
}

type Rule = { name: string; date: (y: number) => string; states: 'all' | readonly StateCode[]; regional?: readonly StateCode[] }

const fromEaster = (offset: number) => (y: number): string => {
  const [m, d] = easter(y)
  return ymd(y, m, d + offset)
}
const fixed = (m: number, d: number) => (y: number): string => ymd(y, m, d)

/** Buß- und Bettag: the Wednesday before 23 November. */
const repentanceDay = (y: number): string => {
  const nov23 = new Date(Date.UTC(y, 10, 23)).getUTCDay()
  const back = ((nov23 - 3 + 7) % 7) || 7
  return ymd(y, 11, 23 - back)
}

// Legal state as of 2026 (Frauentag BE since 2019, MV since 2023; Weltkindertag TH since 2019; Reformationstag in the north since 2018).
const RULES: Rule[] = [
  { name: 'Neujahr', date: fixed(1, 1), states: 'all' },
  { name: 'Heilige Drei Könige', date: fixed(1, 6), states: ['BW', 'BY', 'ST'] },
  { name: 'Internationaler Frauentag', date: fixed(3, 8), states: ['BE', 'MV'] },
  { name: 'Karfreitag', date: fromEaster(-2), states: 'all' },
  { name: 'Ostersonntag', date: fromEaster(0), states: ['BB', 'HE'] },
  { name: 'Ostermontag', date: fromEaster(1), states: 'all' },
  { name: 'Tag der Arbeit', date: fixed(5, 1), states: 'all' },
  { name: 'Christi Himmelfahrt', date: fromEaster(39), states: 'all' },
  { name: 'Pfingstsonntag', date: fromEaster(49), states: ['BB', 'HE'] },
  { name: 'Pfingstmontag', date: fromEaster(50), states: 'all' },
  { name: 'Fronleichnam', date: fromEaster(60), states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], regional: ['SN', 'TH'] },
  { name: 'Mariä Himmelfahrt', date: fixed(8, 15), states: ['SL'], regional: ['BY'] },
  { name: 'Weltkindertag', date: fixed(9, 20), states: ['TH'] },
  { name: 'Tag der Deutschen Einheit', date: fixed(10, 3), states: 'all' },
  { name: 'Reformationstag', date: fixed(10, 31), states: ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'] },
  { name: 'Allerheiligen', date: fixed(11, 1), states: ['BW', 'BY', 'NW', 'RP', 'SL'] },
  { name: 'Buß- und Bettag', date: repentanceDay, states: ['SN'] },
  { name: '1. Weihnachtstag', date: fixed(12, 25), states: 'all' },
  { name: '2. Weihnachtstag', date: fixed(12, 26), states: 'all' }
]

const cache = new Map<string, Holiday[]>()

/** Holidays of a year for a state; nationwide ones only when no state is chosen. */
export function holidays(year: number, state: StateCode | '', regional = false): Holiday[] {
  const key = `${year}|${state}|${regional}`
  const hit = cache.get(key)
  if (hit) return hit
  const out: Holiday[] = []
  for (const r of RULES) {
    const statewide = r.states === 'all' || (state !== '' && r.states.includes(state))
    const partial = regional && state !== '' && !!r.regional?.includes(state)
    if (statewide || partial) out.push({ day: r.date(year), name: r.name, regional: !statewide })
  }
  out.sort((a, b) => a.day.localeCompare(b.day))
  cache.set(key, out)
  return out
}

export function holidayOn(day: string, state: StateCode | '', regional = false): Holiday | undefined {
  return holidays(Number(day.slice(0, 4)), state, regional).find((h) => h.day === day)
}

export function isStateCode(s: string): s is StateCode {
  return STATES.some(([c]) => c === s)
}
