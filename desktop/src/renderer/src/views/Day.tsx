import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/api'
import { addDays, dayRange, formatHM, localDay } from '@shared/timecalc'
import type { DayView, Project } from '@shared/types'
import { api, useLive } from '../api'
import { BookingBadge, DateTimeInput, useAction } from '../ui'

export function DayNav({ day, setDay, step }: { day: string; setDay: (d: string) => void; step: number }) {
  return (
    <div className="row daynav">
      <button onClick={() => setDay(addDays(day, -step))}>‹</button>
      <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
      <button onClick={() => setDay(addDays(day, step))}>›</button>
      <button onClick={() => setDay(localDay(Date.now()))}>Heute</button>
    </div>
  )
}

function Stat({ label, sec, cls }: { label: string; sec: number; cls?: string }) {
  return (
    <div className={`stat ${cls ?? ''}`}>
      <div className="v">{formatHM(sec)}</div>
      <div className="l">{label}</div>
    </div>
  )
}

/** Keeps local edits until blur, then saves. */
function useDraft<T>(value: T): [T, (v: T) => void, () => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return [draft, setDraft, () => setDraft(value)]
}

function IntervalRow(props: {
  kind: string
  start: number
  end: number | null
  overlap?: boolean
  onSave: (start: number, end: number | null) => Promise<unknown>
  onDelete: () => void
}) {
  const [start, setStart] = useDraft(props.start)
  const [end, setEnd] = useDraft(props.end)
  const dirty = start !== props.start || end !== props.end
  return (
    <tr className={props.overlap ? 'overlap' : undefined} title={props.overlap ? 'Überschneidet sich mit einer anderen Anwesenheit' : undefined}>
      <td>{props.kind}</td>
      <td>
        <DateTimeInput value={start} onChange={(v) => v !== null && setStart(v)} />
      </td>
      <td>
        <DateTimeInput value={end} onChange={setEnd} allowEmpty title="Leer = läuft noch" />
      </td>
      <td>{end === null ? 'läuft' : formatHM((end - start) / 1000)}</td>
      <td className="actions">
        {dirty && (
          <button className="primary" onClick={() => props.onSave(start, end)}>
            Speichern
          </button>
        )}
        <button className="danger" onClick={props.onDelete} title="Löschen">
          ✕
        </button>
      </td>
    </tr>
  )
}

function EntryRow({ e, projects, onSaved }: { e: DayView['entries'][number]; projects: Project[]; onSaved: () => void }) {
  const run = useAction()
  const [projectId, setProjectId] = useDraft(e.projectId)
  const [start, setStart] = useDraft(e.start)
  const [end, setEnd] = useDraft(e.end)
  const [issue, setIssue] = useDraft(e.ytIssue ?? '')
  const [note, setNote] = useDraft(e.note)
  const p = projects.find((x) => x.id === projectId)
  const dirty = projectId !== e.projectId || start !== e.start || end !== e.end || issue !== (e.ytIssue ?? '') || note !== e.note
  const save = () =>
    run(() => api.updateEntry(e.id, { projectId, start, end, ytIssue: issue.trim().toUpperCase() || null, note }), 'Gespeichert').then(onSaved)
  return (
    <tr>
      <td>
        <select value={projectId} onChange={(ev) => setProjectId(Number(ev.target.value))} style={{ borderLeft: `6px solid ${p?.color}` }}>
          {projects
            .filter((x) => !x.archived || x.id === e.projectId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </td>
      <td>
        <DateTimeInput value={start} onChange={(v) => v !== null && setStart(v)} />
      </td>
      <td>
        <DateTimeInput value={end} onChange={setEnd} allowEmpty title="Leer = läuft noch" />
      </td>
      <td>{end === null ? 'läuft' : formatHM((end - start) / 1000)}</td>
      <td>
        {p?.kind === 'youtrack' ? (
          <input className="issue" placeholder={p.ytIssue ?? 'Ticket'} value={issue} onChange={(ev) => setIssue(ev.target.value)} title="Leer = Ticket der Tätigkeit" />
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td>
        <input className="note" value={note} onChange={(ev) => setNote(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && dirty && save()} />
      </td>
      <td>
        <BookingBadge state={e.booking} error={e.bookingError} />
      </td>
      <td className="actions">
        {dirty && (
          <button className="primary" onClick={save}>
            Speichern
          </button>
        )}
        <button
          className="danger"
          title="Löschen"
          onClick={() =>
            (e.booking !== 'booked' || confirm('Eintrag ist in YouTrack gebucht. Dort ebenfalls löschen?')) &&
            run(() => api.deleteEntry(e.id), 'Gelöscht')
          }
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

export function DayViewPage({ snap, day, setDay }: { snap: Snapshot; day: string; setDay: (d: string) => void }) {
  const run = useAction()
  const { data, reload } = useLive(() => api.day(day), [day])
  const projects = snap.projects
  const [newProject, setNewProject] = useState<number | ''>('')

  if (!data) return <DayNav day={day} setDay={setDay} step={1} />
  const s = data.summary
  const lastEnd = data.entries.reduce((m, e) => Math.max(m, e.end ?? 0), 0)
  const [dayFrom] = dayRange(day)
  const defaultStart = lastEnd || dayFrom + 9 * 3600_000
  const addEntry = () => {
    const pid = newProject || projects.find((p) => !p.archived)?.id
    if (!pid) return
    const end = Math.min(Date.now(), defaultStart + 3600_000)
    run(() => api.createEntry({ projectId: pid, start: Math.min(defaultStart, end - 60_000), end, note: '', ytIssue: null }), 'Eintrag angelegt')
  }
  const intervals = [
    ...data.presences.map((p) => ({ kind: 'Anwesenheit' as const, ...p })),
    ...data.pauses.map((p) => ({ kind: 'Pause' as const, ...p }))
  ].sort((a, b) => a.start - b.start)
  const bookable = data.entries.filter((e) => e.booking === 'open' || e.booking === 'error').length

  return (
    <div className="day">
      <div className="row between">
        <DayNav day={day} setDay={setDay} step={1} />
        <div className="row">
          {snap.sync.configured && (
            <button
              className="primary"
              disabled={bookable === 0}
              onClick={() => run(() => api.bookRange(day, day), (n) => `${n} Work Item(s) zum Buchen eingereiht`)}
            >
              Tag buchen{bookable ? ` (${bookable})` : ''}
            </button>
          )}
          <button onClick={() => run(() => api.exportCsv('entries', day, day), (p) => (p ? `Exportiert: ${p}` : 'Abgebrochen'))}>CSV Zeiten</button>
          <button onClick={() => run(() => api.exportCsv('attendance', day, day), (p) => (p ? `Exportiert: ${p}` : 'Abgebrochen'))}>
            CSV Arbeitszeit
          </button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Anwesenheit" sec={s.presenceSec} />
        <Stat label="Pausen" sec={s.pauseSec} />
        <Stat label="Netto-Arbeitszeit" sec={s.netSec} cls="main" />
        <Stat label="Tätigkeiten" sec={s.entriesSec} />
        <Stat label="nicht zugeordnet" sec={s.unassignedSec} cls={s.unassignedSec > 900 ? 'warn' : ''} />
      </div>
      {s.hints.length > 0 && (
        <div className="hints">
          {s.hints.map((h) => (
            <div key={h.text} className={h.level}>
              {h.text}
            </div>
          ))}
        </div>
      )}

      <h3>Arbeitszeit</h3>
      <table>
        <thead>
          <tr>
            <th>Art</th>
            <th>Start</th>
            <th>Ende</th>
            <th>Dauer</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {intervals.map((i) => (
            <IntervalRow
              key={`${i.kind}-${i.id}`}
              kind={i.kind}
              start={i.start}
              end={i.end}
              overlap={i.kind === 'Anwesenheit' && s.overlapPresenceIds.includes(i.id)}
              onSave={(st, en) =>
                run(() => (i.kind === 'Pause' ? api.updatePause(i.id, st, en) : api.updatePresence(i.id, st, en)), 'Gespeichert')
              }
              onDelete={() =>
                confirm(`${i.kind} löschen?${i.kind === 'Anwesenheit' ? ' Zugehörige Pausen werden mitgelöscht.' : ''}`) &&
                run(() => (i.kind === 'Pause' ? api.deletePause(i.id) : api.deletePresence(i.id)), 'Gelöscht')
              }
            />
          ))}
        </tbody>
      </table>
      <div className="row">
        <button
          onClick={() =>
            run(() => api.createPresence(dayFrom + 8 * 3600_000, Math.min(Date.now(), dayFrom + 16 * 3600_000)), 'Anwesenheit angelegt')
          }
        >
          + Anwesenheit
        </button>
        <button
          disabled={data.presences.length === 0}
          onClick={() => {
            const p = data.presences[0]
            const st = Math.max(p.start, dayFrom + 12 * 3600_000)
            run(() => api.createPause(st, st + 30 * 60_000), 'Pause angelegt')
          }}
        >
          + Pause
        </button>
      </div>

      <h3>Tätigkeiten</h3>
      <table>
        <thead>
          <tr>
            <th>Tätigkeit</th>
            <th>Start</th>
            <th>Ende</th>
            <th>Dauer</th>
            <th>Ticket</th>
            <th>Notiz</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <EntryRow key={e.id} e={e} projects={projects} onSaved={reload} />
          ))}
        </tbody>
      </table>
      <div className="row">
        <select value={newProject} onChange={(e) => setNewProject(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Tätigkeit wählen…</option>
          {projects
            .filter((p) => !p.archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button onClick={addEntry} disabled={projects.length === 0}>
          + Eintrag
        </button>
        <span className="muted">Summe je Tätigkeit: {Object.entries(s.perProject).map(([pid, sec]) => `${projects.find((p) => p.id === Number(pid))?.name ?? '?'} ${formatHM(sec)}`).join(' · ') || '–'}</span>
      </div>
    </div>
  )
}
