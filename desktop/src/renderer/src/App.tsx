import { useState } from 'react'
import { localDay } from '@shared/timecalc'
import { api, useSnapshot } from './api'
import { DateTimeInput, Modal, ToastProvider, useAction } from './ui'
import { TrackView } from './views/Track'
import { DayViewPage } from './views/Day'
import { WeekViewPage } from './views/Week'
import { ProjectsView } from './views/Projects'
import { SettingsView } from './views/Settings'

type Tab = 'track' | 'day' | 'week' | 'projects' | 'settings'

const TABS: [Tab, string][] = [
  ['track', 'Erfassen'],
  ['day', 'Tag'],
  ['week', 'Woche'],
  ['projects', 'Tätigkeiten'],
  ['settings', 'Einstellungen']
]

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>('track')
  const [day, setDay] = useState(localDay(Date.now()))
  const snap = useSnapshot()
  if (!snap) return <div className="loading">Lade…</div>
  const sync = snap.sync
  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        {sync.configured && (
          <span
            className={`sync ${sync.authError || sync.errors ? 'err' : sync.pending ? 'pending' : 'ok'}`}
            title={sync.lastError ?? undefined}
            onClick={() => setTab('settings')}
          >
            YouTrack:{' '}
            {sync.authError ? 'Token prüfen' : sync.errors ? `${sync.errors} Fehler` : sync.pending ? `${sync.pending} ausstehend` : 'synchron'}
          </span>
        )}
      </nav>
      <main>
        {tab === 'track' && <TrackView snap={snap} onOpenDay={(d) => (setDay(d), setTab('day'))} />}
        {tab === 'day' && <DayViewPage snap={snap} day={day} setDay={setDay} />}
        {tab === 'week' && <WeekViewPage snap={snap} day={day} setDay={setDay} onOpenDay={(d) => (setDay(d), setTab('day'))} />}
        {tab === 'projects' && <ProjectsView snap={snap} />}
        {tab === 'settings' && <SettingsView snap={snap} />}
      </main>
      <ForgottenDay presenceStart={snap.state.presence?.start ?? null} lastEnd={snap.state.running?.start ?? null} />
    </div>
  )
}

/** An attendance block still open from a previous day: ask for the leave time. */
function ForgottenDay({ presenceStart, lastEnd }: { presenceStart: number | null; lastEnd: number | null }) {
  const run = useAction()
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [at, setAt] = useState<number | null>(null)
  if (presenceStart === null || localDay(presenceStart) === localDay(Date.now()) || dismissed === presenceStart) return null
  const d = new Date(presenceStart)
  const suggestion = at ?? Math.max(lastEnd ?? 0, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0).getTime(), presenceStart + 60_000)
  return (
    <Modal title="Gehen vergessen?">
      <p>
        Die Anwesenheit vom {d.toLocaleDateString('de-DE')} ({d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}) ist noch
        offen. Wann bist du gegangen?
      </p>
      <DateTimeInput value={suggestion} onChange={setAt} />
      <div className="row end">
        <button onClick={() => setDismissed(presenceStart)}>Später</button>
        <button className="primary" onClick={() => run(() => api.goAt(suggestion), 'Tag abgeschlossen')}>
          Gehen eintragen
        </button>
      </div>
    </Modal>
  )
}
