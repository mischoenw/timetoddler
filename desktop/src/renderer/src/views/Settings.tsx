import { useState } from 'react'
import { STATES } from '@shared/holidays'
import type { Snapshot } from '@shared/api'
import type { Settings } from '@shared/types'
import { api } from '../api'
import { QueryInput, useAction } from '../ui'
import { useDevice } from '../device/DeviceProvider'
import { KnobPreview } from '../device/KnobPreview'

const WEEKDAYS: [number, string][] = [
  [1, 'Mo'],
  [2, 'Di'],
  [3, 'Mi'],
  [4, 'Do'],
  [5, 'Fr'],
  [6, 'Sa'],
  [0, 'So']
]

export function SettingsView({ snap }: { snap: Snapshot }) {
  const run = useAction()
  const s = snap.settings
  const sync = snap.sync
  const [url, setUrl] = useState(s['youtrack.baseUrl'])
  const [token, setToken] = useState('')
  const [query, setQuery] = useState(s['youtrack.issueQuery'])
  const [lunch, setLunch] = useState(String(s['work.minLunchBreakMin']))
  const [target, setTarget] = useState(
    `${String(Math.floor(s['work.dailyTargetMin'] / 60)).padStart(2, '0')}:${String(s['work.dailyTargetMin'] % 60).padStart(2, '0')}`
  )
  const [vacation, setVacation] = useState(String(s['vacation.daysPerYear']))
  const set = (patch: Partial<Settings>) => run(() => api.setSettings(patch))
  const dev = useDevice()

  return (
    <div className="settings">
      <section className="card">
        <h3>YouTrack</h3>
        <div className="form">
          <label>URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://firma.youtrack.cloud" />
          <label>Permanent Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={sync.hasToken ? '•••••••• (gespeichert, leer lassen zum Beibehalten)' : 'perm:…'}
          />
          <span />
          <div className="row">
            <button
              className="primary"
              onClick={() => run(() => api.ytConnect(url, token || null), (me) => `Verbunden als ${me.name}`).then((me) => me && setToken(''))}
            >
              Verbinden &amp; testen
            </button>
            {sync.hasToken && (
              <button onClick={() => confirm('Token löschen?') && run(() => api.ytDisconnect(), 'Token gelöscht')}>Trennen</button>
            )}
          </div>
          <label>Ticket-Suche</label>
          <QueryInput value={query} onChange={setQuery} onBlur={() => query !== s['youtrack.issueQuery'] && set({ 'youtrack.issueQuery': query })} />
          <label>Buchen</label>
          <select value={s['youtrack.bookingMode']} onChange={(e) => set({ 'youtrack.bookingMode': e.target.value as Settings['youtrack.bookingMode'] })}>
            <option value="manual">manuell („Tag/Woche buchen“)</option>
            <option value="onStop">automatisch beim Stoppen</option>
          </select>
          <span />
          <label className="check">
            <input type="checkbox" checked={s['youtrack.pull']} onChange={(e) => set({ 'youtrack.pull': e.target.checked })} />
            Buchungen aus YouTrack holen (eigene, letzte 31 Tage)
          </label>
        </div>
        <p className="muted">
          Token in YouTrack unter Profil → Konto-Sicherheit → Token anlegen (Bereich YouTrack). Er wird mit dem Schlüsselbund des Systems verschlüsselt
          gespeichert. Gebucht wird ein Work Item pro Eintrag und Tag, in ganzen Minuten; die Notiz wird zum Text.
        </p>
        {sync.tokenProtection === 'basic' && (
          <p className="err">
            Kein Schlüsselbund (Secret Service/KWallet) gefunden: Der Token wird nur verschleiert in einer nur für dich lesbaren Datei gespeichert.
          </p>
        )}
        {sync.configured && (
          <div className="row">
            <span>
              Status: {sync.authError ? <b className="err">Anmeldung abgelehnt – Token prüfen</b> : 'ok'} · {sync.pending} ausstehend · {sync.errors} Fehler
              {sync.lastRun && ` · zuletzt ${new Date(sync.lastRun).toLocaleTimeString('de-DE')}`}
              {sync.lastPull && ` · geholt ${new Date(sync.lastPull).toLocaleTimeString('de-DE')}`}
            </span>
            <button onClick={() => run(() => api.syncNow(), 'Synchronisiere…')}>Jetzt synchronisieren</button>
            {sync.errors > 0 && <button onClick={() => run(() => api.retryErrors(), (n) => `${n} erneut eingereiht`)}>Fehler erneut versuchen</button>}
            <button onClick={() => run(() => api.ytRefresh(), 'Projekte und Tickets aktualisiert')}>Stammdaten aktualisieren</button>
          </div>
        )}
        {sync.lastError && <p className="err">Letzter Fehler: {sync.lastError}</p>}
      </section>

      <section className="card">
        <h3>Arbeitszeit</h3>
        <label className="check">
          <input type="checkbox" checked={s['work.autoCome']} onChange={(e) => set({ 'work.autoCome': e.target.checked })} />
          Beim Start einer Tätigkeit automatisch „Kommen“
        </label>
        <label className="check">
          <input type="checkbox" checked={s['work.resumeAfterBreak']} onChange={(e) => set({ 'work.resumeAfterBreak': e.target.checked })} />
          Nach der Pause die vorherige Tätigkeit fortsetzen
        </label>
        <div className="form">
          <label>Mittagspause mind.</label>
          <div className="row">
            <input
              type="number"
              min={0}
              max={240}
              step={5}
              value={lunch}
              onChange={(e) => setLunch(e.target.value)}
              onBlur={() => {
                const n = Math.max(0, Math.min(240, Math.round(Number(lunch) || 0)))
                setLunch(String(n))
                if (n !== s['work.minLunchBreakMin']) set({ 'work.minLunchBreakMin': n })
              }}
            />
            min am Stück bei mehr als 6 h (0 = aus)
          </div>
          <label>Sollarbeitszeit</label>
          <div className="row">
            <input
              type="time"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={() => {
                const [h, m] = target.split(':').map(Number)
                const n = Math.max(0, Math.min(24 * 60, (h || 0) * 60 + (m || 0)))
                if (n !== s['work.dailyTargetMin']) set({ 'work.dailyTargetMin': n })
              }}
            />
            Stunden pro Arbeitstag
          </div>
          <label>Arbeitstage</label>
          <div className="row">
            {WEEKDAYS.map(([d, label]) => (
              <label key={d} className="check">
                <input
                  type="checkbox"
                  checked={s['work.workdays'].includes(d)}
                  onChange={(e) =>
                    set({ 'work.workdays': e.target.checked ? [...s['work.workdays'], d].sort() : s['work.workdays'].filter((x) => x !== d) })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>Bundesland (Feiertage)</label>
          <select value={s['work.state']} onChange={(e) => set({ 'work.state': e.target.value as Settings['work.state'] })}>
            <option value="">– nur bundesweite Feiertage –</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <span />
          <label className="check">
            <input type="checkbox" checked={s['work.regionalHolidays']} onChange={(e) => set({ 'work.regionalHolidays': e.target.checked })} />
            Regionale Feiertage einbeziehen (Mariä Himmelfahrt in Bayern, Fronleichnam in Teilen von Sachsen und Thüringen)
          </label>
          <label>Urlaubsanspruch</label>
          <div className="row">
            <input
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={vacation}
              onChange={(e) => setVacation(e.target.value)}
              onBlur={() => {
                const n = Math.max(0, Math.min(60, Math.round((Number(vacation) || 0) * 2) / 2))
                setVacation(String(n))
                if (n !== s['vacation.daysPerYear']) set({ 'vacation.daysPerYear': n })
              }}
            />
            Tage pro Jahr
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Drehknopf</h3>
        <p>
          {dev.connected ? (
            <>
              <b className="ok">Verbunden</b>
              {dev.fw && ` · Firmware ${dev.fw}`}
              {dev.serial && ` · Seriennummer ${dev.serial}`}
            </>
          ) : (
            <span className="muted">Nicht verbunden – CrowPanel per USB anschließen.</span>
          )}
          {dev.error && <span className="err"> · {dev.error}</span>}
        </p>
        <KnobPreview steps={s['encoder.stepsPerDetent']} />
        <div className="form">
          <label>Zählschritte pro Rastung</label>
          <select value={s['encoder.stepsPerDetent']} onChange={(e) => set({ 'encoder.stepsPerDetent': Number(e.target.value) })}>
            {[1, 2, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <label>Richtung</label>
          <label className="check">
            <input type="checkbox" checked={s['encoder.reverse']} onChange={(e) => set({ 'encoder.reverse': e.target.checked })} /> umkehren
          </label>
          <label>Display-Helligkeit</label>
          <input type="range" min={5} max={100} value={s['device.brightness']} onChange={(e) => set({ 'device.brightness': Number(e.target.value) })} />
          <label>LED-Ring</label>
          <input type="range" min={0} max={100} value={s['device.led']} onChange={(e) => set({ 'device.led': Number(e.target.value) })} />
        </div>
        <p className="muted">
          Bedienung: drehen wählt (nach 5 s ohne Eingabe zurück), drücken startet/stoppt, lang drücken bucht den laufenden Eintrag um,
          doppelt drücken startet/beendet die Pause, aufs Display tippen holt das Fenster nach vorn. Unter Linux ist eine udev-Regel nötig
          (siehe README).
        </p>
      </section>
    </div>
  )
}
