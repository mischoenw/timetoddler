import { useState } from 'react'
import type { Snapshot } from '@shared/api'
import { holidays } from '@shared/holidays'
import { localDay } from '@shared/timecalc'
import type { Absence } from '@shared/types'
import { api, useLive } from '../api'
import { useAction } from '../ui'

const fmtDay = (d: string): string => `${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const fmtDays = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

function AbsenceRow({ a, days }: { a: Absence; days: number }) {
  const run = useAction()
  const [first, setFirst] = useState(a.firstDay)
  const [last, setLast] = useState(a.lastDay)
  const [half, setHalf] = useState(a.half)
  const [note, setNote] = useState(a.note)
  const dirty = first !== a.firstDay || last !== a.lastDay || half !== a.half || note !== a.note
  const past = a.lastDay < localDay(Date.now())
  return (
    <tr className={past ? 'archived' : undefined}>
      <td>
        <input type="date" value={first} onChange={(e) => (setFirst(e.target.value), last < e.target.value && setLast(e.target.value))} />
      </td>
      <td>
        <input type="date" value={last} min={first} onChange={(e) => setLast(e.target.value)} />
      </td>
      <td className="center">
        <input type="checkbox" checked={half} disabled={first !== last} onChange={(e) => setHalf(e.target.checked)} />
      </td>
      <td className="num">{fmtDays(days)}</td>
      <td>
        <input className="note" value={note} onChange={(e) => setNote(e.target.value)} />
      </td>
      <td className="actions">
        {dirty && (
          <button
            className="primary"
            onClick={() => run(() => api.updateAbsence(a.id, { kind: 'vacation', firstDay: first, lastDay: last, half: half && first === last, note }), 'Gespeichert')}
          >
            Speichern
          </button>
        )}
        <button className="danger" title="Löschen" onClick={() => confirm('Urlaub löschen?') && run(() => api.deleteAbsence(a.id), 'Gelöscht')}>
          ✕
        </button>
      </td>
    </tr>
  )
}

export function VacationView({ snap }: { snap: Snapshot }) {
  const run = useAction()
  const [year, setYear] = useState(new Date().getFullYear())
  const { data: acc } = useLive(() => api.vacationAccount(year), [year])
  const today = localDay(Date.now())
  const [first, setFirst] = useState(today)
  const [last, setLast] = useState(today)
  const [half, setHalf] = useState(false)
  const [note, setNote] = useState('')
  const [carry, setCarry] = useState<string | null>(null)
  const s = snap.settings
  const hol = holidays(year, s['work.state'], s['work.regionalHolidays'])

  if (!acc) return null
  return (
    <div className="vacation">
      <div className="row">
        <button onClick={() => setYear(year - 1)}>‹</button>
        <strong>{year}</strong>
        <button onClick={() => setYear(year + 1)}>›</button>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="v">{fmtDays(acc.entitlement)}</div>
          <div className="l">Anspruch</div>
        </div>
        <div className="stat">
          <input
            className="v"
            type="number"
            step={0.5}
            min={0}
            value={carry ?? String(acc.carryOver)}
            onChange={(e) => setCarry(e.target.value)}
            onBlur={() => {
              if (carry === null) return
              const n = Math.max(0, Math.round((Number(carry) || 0) * 2) / 2)
              run(() => api.setSettings({ 'vacation.carryOver': { ...s['vacation.carryOver'], [String(year)]: n } })).then(() => setCarry(null))
            }}
            title="Resturlaub aus dem Vorjahr"
          />
          <div className="l">Übertrag Vorjahr</div>
        </div>
        <div className="stat">
          <div className="v">{fmtDays(acc.taken)}</div>
          <div className="l">genommen</div>
        </div>
        <div className="stat">
          <div className="v">{fmtDays(acc.planned)}</div>
          <div className="l">geplant</div>
        </div>
        <div className={`stat main ${acc.remaining < 0 ? 'neg' : ''}`}>
          <div className="v">{fmtDays(acc.remaining)}</div>
          <div className="l">Rest</div>
        </div>
      </div>

      <section className="card">
        <h3>Urlaub eintragen</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => api.createAbsence({ kind: 'vacation', firstDay: first, lastDay: last, half: half && first === last, note }), 'Urlaub eingetragen').then(
              (r) => r && (setNote(''), setHalf(false))
            )
          }}
        >
          von <input type="date" value={first} onChange={(e) => (setFirst(e.target.value), last < e.target.value && setLast(e.target.value))} />
          bis <input type="date" value={last} min={first} onChange={(e) => setLast(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={half} disabled={first !== last} onChange={(e) => setHalf(e.target.checked)} /> halber Tag
          </label>
          <input className="grow" placeholder="Notiz" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" type="submit">
            Eintragen
          </button>
        </form>
        <p className="muted">
          Gezählt werden nur Arbeitstage; Wochenenden und Feiertage{s['work.state'] ? '' : ' (bundesweit – Bundesland in den Einstellungen wählen)'} kosten
          keinen Urlaub. Urlaub wird nicht nach YouTrack gebucht.
        </p>
        <table>
          <thead>
            <tr>
              <th>von</th>
              <th>bis</th>
              <th>½</th>
              <th className="num">Tage</th>
              <th>Notiz</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {acc.absences.map((a) => (
              <AbsenceRow key={`${a.id}-${a.firstDay}-${a.lastDay}-${a.half}-${a.note}`} a={a} days={a.days} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Feiertage {year}</h3>
        <table>
          <tbody>
            {hol.map((h) => (
              <tr key={h.day}>
                <td>{fmtDay(h.day)}</td>
                <td>
                  {h.name}
                  {h.regional && <span className="badge muted">regional</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
