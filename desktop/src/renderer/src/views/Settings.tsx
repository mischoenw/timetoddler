import { useState } from 'react'
import type { Snapshot } from '@shared/api'
import type { Settings } from '@shared/types'
import { api } from '../api'
import { QueryInput, useAction } from '../ui'

export function SettingsView({ snap }: { snap: Snapshot }) {
  const run = useAction()
  const s = snap.settings
  const sync = snap.sync
  const [url, setUrl] = useState(s['youtrack.baseUrl'])
  const [token, setToken] = useState('')
  const [query, setQuery] = useState(s['youtrack.issueQuery'])
  const [lunch, setLunch] = useState(String(s['work.minLunchBreakMin']))
  const set = (patch: Partial<Settings>) => run(() => api.setSettings(patch))

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
        </div>
      </section>

      <section className="card">
        <h3>Drehknopf</h3>
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
        <p className="muted">Wirkt, sobald das CrowPanel per USB verbunden ist (folgt mit der Firmware).</p>
      </section>
    </div>
  )
}
