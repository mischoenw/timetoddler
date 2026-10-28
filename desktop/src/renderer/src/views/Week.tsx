import type { Snapshot } from '@shared/api'
import { addDays, formatHM, weekStart } from '@shared/timecalc'
import { api, useLive } from '../api'
import { Dot, useAction } from '../ui'
import { DayNav, formatSignedHM } from './Day'

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export function WeekViewPage(props: { snap: Snapshot; day: string; setDay: (d: string) => void; onOpenDay: (d: string) => void }) {
  const run = useAction()
  const first = weekStart(props.day)
  const last = addDays(first, 6)
  const { data } = useLive(() => api.week(first), [first])
  if (!data) return null
  const w = data.summary
  const rows = Object.entries(w.perProject)
    .map(([pid, secs]) => ({ p: props.snap.projects.find((x) => x.id === Number(pid)), secs }))
    .sort((a, b) => (a.p?.name ?? '').localeCompare(b.p?.name ?? '', 'de'))
  const colSum = w.days.map((_, i) => rows.reduce((s, r) => s + r.secs[i], 0))
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const st = data.states
  return (
    <div className="week">
      <div className="row between">
        <DayNav day={props.day} setDay={props.setDay} step={7} />
        <div className="row">
          {props.snap.sync.configured && (
            <button
              className="primary"
              disabled={st.open + st.error === 0}
              onClick={() => run(() => api.bookRange(first, last), (n) => `${n} Work Item(s) zum Buchen eingereiht`)}
            >
              Woche buchen{st.open + st.error ? ` (${st.open + st.error})` : ''}
            </button>
          )}
          <button onClick={() => run(() => api.exportCsv('entries', first, last), (p) => (p ? `Exportiert: ${p}` : 'Abgebrochen'))}>CSV Zeiten</button>
          <button onClick={() => run(() => api.exportCsv('attendance', first, last), (p) => (p ? `Exportiert: ${p}` : 'Abgebrochen'))}>
            CSV Arbeitszeit
          </button>
        </div>
      </div>
      <p className="muted">
        Einträge: {st.booked} gebucht · {st.pending} ausstehend · {st.open} offen · {st.error} Fehler · {st.unbookable} ohne Ticket · {st.local} lokal
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th>Tätigkeit</th>
            {w.days.map((d, i) => (
              <th key={d} className="num link" onClick={() => props.onOpenDay(d)}>
                {WD[i]} {d.slice(8)}.{d.slice(5, 7)}.
                {data.calendar[i]?.holiday && <span className="daytag">{data.calendar[i].holiday}</span>}
                {data.calendar[i]?.absence && data.calendar[i].workday && (
                  <span className="daytag vac">{data.calendar[i].absence!.half ? '½ Urlaub' : 'Urlaub'}</span>
                )}
              </th>
            ))}
            <th className="num">Summe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.p?.id ?? Math.random()}>
              <td>
                <Dot color={r.p?.color ?? '#888'} /> {r.p?.name ?? '?'}
              </td>
              {r.secs.map((s, i) => (
                <td key={i} className="num">
                  {s ? formatHM(s) : ''}
                </td>
              ))}
              <td className="num">
                <strong>{formatHM(total(r.secs))}</strong>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Tätigkeiten</td>
            {colSum.map((s, i) => (
              <td key={i} className="num">
                {s ? formatHM(s) : ''}
              </td>
            ))}
            <td className="num">{formatHM(total(colSum))}</td>
          </tr>
          <tr>
            <td>Netto-Arbeitszeit</td>
            {w.netPerDay.map((s, i) => (
              <td key={i} className="num">
                {s ? formatHM(s) : ''}
              </td>
            ))}
            <td className="num">
              <strong>{formatHM(total(w.netPerDay))}</strong>
            </td>
          </tr>
          <tr>
            <td>Soll</td>
            {w.targetPerDay.map((s, i) => (
              <td key={i} className="num">
                {s ? formatHM(s) : ''}
              </td>
            ))}
            <td className="num">{formatHM(total(w.targetPerDay))}</td>
          </tr>
          <tr>
            <td>Saldo</td>
            {w.creditedPerDay.map((c, i) => {
              const b = c - w.targetPerDay[i]
              return (
                <td key={i} className={`num ${b > 0 ? 'ok' : b < 0 ? 'err' : ''}`}>
                  {c || w.targetPerDay[i] ? formatSignedHM(b) : ''}
                </td>
              )
            })}
            <td className="num">
              <strong>{formatSignedHM(total(w.creditedPerDay) - total(w.targetPerDay))}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
