import { useState } from 'react'
import type { Snapshot } from '@shared/api'
import { formatHM, formatHMS, localDay } from '@shared/timecalc'
import { tileOrder } from '@shared/tiles'
import type { Project } from '@shared/types'
import { api, useLive, useNow } from '../api'
import { Dot, useAction } from '../ui'

export function WorkBar({ snap }: { snap: Snapshot }) {
  const run = useAction()
  const now = useNow()
  const { mode, pause } = snap.state
  // todayNetSec is computed at snapshot time; keep it ticking while working.
  const net = snap.todayNetSec + (mode !== 'absent' && mode !== 'break' ? (now - snap.now) / 1000 : 0)
  return (
    <div className={`workbar ${mode}`}>
      <div>
        <strong>{mode === 'absent' ? 'Abwesend' : mode === 'break' ? 'Pause' : 'Anwesend'}</strong>
        {mode === 'break' && pause && <span className="muted"> seit {formatHMS((now - pause.start) / 1000)}</span>}
        <span className="muted"> · Arbeitszeit heute {formatHM(net)}</span>
      </div>
      <div className="row">
        {mode === 'absent' ? (
          <button className="primary" onClick={() => run(() => api.come())}>
            Kommen
          </button>
        ) : (
          <>
            {mode === 'break' ? (
              <button className="primary" onClick={() => run(() => api.pauseEnd())}>
                Pause beenden
              </button>
            ) : (
              <button onClick={() => run(() => api.pauseStart())}>Pause</button>
            )}
            <button onClick={() => run(() => api.go())}>Gehen</button>
          </>
        )}
      </div>
    </div>
  )
}

function RunningCard({ snap, projects }: { snap: Snapshot; projects: Project[] }) {
  const run = useAction()
  const now = useNow()
  const r = snap.state.running
  const [note, setNote] = useState<string | null>(null)
  if (!r) return <div className="running idle">Kein Timer läuft – Kachel anklicken zum Starten.</div>
  const p = projects.find((x) => x.id === r.projectId)
  return (
    <div className="running" style={{ borderColor: p?.color }}>
      <div className="grow">
        <div className="title">
          <Dot color={p?.color ?? '#888'} /> {p?.name}
          {p?.client && <span className="muted"> · {p.client}</span>}
        </div>
        <input
          className="note"
          placeholder="Notiz zum laufenden Eintrag (wird in YouTrack als Text gebucht)"
          value={note ?? r.note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== null && run(() => api.setRunningNote(note)).then(() => setNote(null))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="clock">{formatHMS((now - r.start) / 1000)}</div>
      <div className="col">
        <button className="primary" onClick={() => run(() => api.stop())}>
          Stopp
        </button>
        <select
          value=""
          title="Laufenden Eintrag auf eine andere Tätigkeit umbuchen (Startzeit bleibt)"
          onChange={(e) => e.target.value && run(() => api.rebook(Number(e.target.value)), 'Umgebucht')}
        >
          <option value="">Umbuchen…</option>
          {projects
            .filter((x) => x.id !== r.projectId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  )
}

export function TrackView({ snap, onOpenDay }: { snap: Snapshot; onOpenDay: (day: string) => void }) {
  const run = useAction()
  const now = useNow()
  const today = localDay(now)
  const { data: day } = useLive(() => api.day(today), [today])
  const tiles = tileOrder(snap.projects)
  const r = snap.state.running
  const [newName, setNewName] = useState('')

  const todaySec = (id: number): number => {
    let s = day?.summary.perProject[id] ?? 0
    // the day view is loaded once per change; add the live part of the running entry
    if (r?.projectId === id && day) s += Math.max(0, (now - snap.now) / 1000)
    return s
  }

  return (
    <div className="track">
      <WorkBar snap={snap} />
      <RunningCard snap={snap} projects={tiles} />
      {day && day.summary.hints.length > 0 && (
        <div className="hints" onClick={() => onOpenDay(today)}>
          {day.summary.hints.map((h) => (
            <div key={h.text} className={h.level}>
              {h.text}
            </div>
          ))}
        </div>
      )}
      <div className="tiles">
        {tiles.map((p) => (
          <div
            key={p.id}
            className={`tile ${r?.projectId === p.id ? 'active' : ''} ${p.ytStale ? 'stale' : ''}`}
            style={{ ['--c' as string]: p.color }}
            onClick={() => run(() => api.toggle(p.id))}
            onContextMenu={(e) => {
              e.preventDefault()
              if (r && r.projectId !== p.id) run(() => api.rebook(p.id), `Umgebucht auf ${p.name}`)
            }}
            title={
              (r && r.projectId !== p.id ? 'Klick: starten · Rechtsklick: laufenden Eintrag hierauf umbuchen' : 'Klick: starten/stoppen') +
              (p.ytStale ? '\nIn YouTrack archiviert bzw. erledigt' : '')
            }
          >
            <button
              className={`star ${p.favorite ? 'on' : ''}`}
              title="Favorit"
              onClick={(e) => {
                e.stopPropagation()
                run(() => api.updateProject(p.id, { favorite: !p.favorite }))
              }}
            >
              ★
            </button>
            <div className="name">{p.name}</div>
            <div className="meta">
              {p.kind === 'local' ? 'lokal' : (p.ytIssue ?? p.client)}
              {p.kind === 'local' && p.client ? ` · ${p.client}` : ''}
            </div>
            <div className="time">{formatHM(todaySec(p.id))}</div>
          </div>
        ))}
        <form
          className="tile add"
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim()) run(() => api.createProject({ name: newName, kind: 'local' }), 'Tätigkeit angelegt').then(() => setNewName(''))
          }}
        >
          <input placeholder="+ lokale Tätigkeit (z. B. Besprechung)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </form>
      </div>
    </div>
  )
}
