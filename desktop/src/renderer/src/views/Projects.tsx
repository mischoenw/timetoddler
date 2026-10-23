import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/api'
import type { Project, RemoteIssue, RemoteProject, RemoteWorkType } from '@shared/types'
import { api } from '../api'
import { QueryInput, useAction } from '../ui'

function ProjectRow({ p, configured }: { p: Project; configured: boolean }) {
  const run = useAction()
  const [name, setName] = useState(p.name)
  const [client, setClient] = useState(p.client)
  const [issue, setIssue] = useState(p.ytIssue ?? '')
  const [types, setTypes] = useState<RemoteWorkType[] | null>(null)
  useEffect(() => {
    setName(p.name)
    setClient(p.client)
    setIssue(p.ytIssue ?? '')
  }, [p.name, p.client, p.ytIssue])

  const save = (patch: Partial<Project>, msg?: string) => run(() => api.updateProject(p.id, patch), msg)

  const saveIssue = async () => {
    const key = issue.trim().toUpperCase()
    if (key === (p.ytIssue ?? '')) return
    if (!key) return save({ ytIssue: null }, 'Ticket entfernt')
    if (configured) {
      // validate and pick up the YouTrack project of the ticket
      const ri = await run(() => api.ytIssue(key))
      if (!ri) return
      return save({ kind: 'youtrack', ytIssue: ri.key, ytProjectId: ri.projectId }, `Verknüpft mit ${ri.key}`)
    }
    return save({ kind: 'youtrack', ytIssue: key }, `Verknüpft mit ${key}`)
  }

  const loadTypes = () => p.ytProjectId && run(() => api.ytWorkTypes(p.ytProjectId!)).then((t) => t && setTypes(t))

  return (
    <tr className={p.archived ? 'archived' : ''}>
      <td>
        <input type="color" value={p.color} onChange={(e) => save({ color: e.target.value })} />
      </td>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== p.name && save({ name })} />
        {p.ytStale && <span className="badge warn" title="In YouTrack archiviert bzw. erledigt">erledigt</span>}
      </td>
      <td>
        <input value={client} onChange={(e) => setClient(e.target.value)} onBlur={() => client !== p.client && save({ client })} />
      </td>
      <td>
        <select value={p.kind} onChange={(e) => save({ kind: e.target.value as Project['kind'] })}>
          <option value="local">lokal</option>
          <option value="youtrack">YouTrack</option>
        </select>
      </td>
      <td>
        {p.kind === 'youtrack' ? (
          <input
            className="issue"
            placeholder="ABC-123"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            onBlur={saveIssue}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="muted">wird nicht gebucht</span>
        )}
      </td>
      <td>
        {p.kind === 'youtrack' && configured && p.ytProjectId ? (
          <select
            value={p.ytWorkTypeId ?? ''}
            onFocus={() => types === null && loadTypes()}
            onChange={(e) => save({ ytWorkTypeId: e.target.value || null })}
          >
            <option value="">(kein Typ)</option>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {types === null && p.ytWorkTypeId && <option value={p.ytWorkTypeId}>{p.ytWorkTypeId}</option>}
          </select>
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td className="center">
        <input type="checkbox" checked={p.favorite} onChange={(e) => save({ favorite: e.target.checked })} />
      </td>
      <td className="center">
        <input type="checkbox" checked={p.archived} onChange={(e) => save({ archived: e.target.checked })} />
      </td>
      <td className="actions">
        <button
          className="danger"
          title="Löschen (mit Einträgen: archivieren)"
          onClick={() =>
            confirm(`„${p.name}“ löschen? Hat sie Einträge, wird sie nur archiviert.`) &&
            run(() => api.deleteProject(p.id), (r) => (r === 'archived' ? 'Hat Einträge – archiviert' : 'Gelöscht'))
          }
        >
          ✕
        </button>
      </td>
    </tr>
  )
}

function YouTrackImport({ snap }: { snap: Snapshot }) {
  const run = useAction()
  const [projects, setProjects] = useState<RemoteProject[] | null>(null)
  const [issues, setIssues] = useState<RemoteIssue[] | null>(null)
  const [query, setQuery] = useState(snap.settings['youtrack.issueQuery'])
  const [showResolved, setShowResolved] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setSel((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s.add(k))))
  const linkedIssues = new Set(snap.projects.map((p) => p.ytIssue).filter(Boolean))
  const linkedProjects = new Set(snap.projects.filter((p) => !p.ytIssue).map((p) => p.ytProjectId).filter(Boolean))
  const search = () =>
    run(() => api.ytSearchIssues(showResolved ? query : `${query} #Unresolved`)).then((r) => r && (setIssues(r), setProjects(null), setSel(new Set())))

  return (
    <section className="card">
      <h3>Aus YouTrack übernehmen</h3>
      <p className="muted">
        YouTrack bucht Zeit auf Tickets. Übernimm Tickets direkt als Kacheln, oder Projekte und hinterlege danach ein Standard-Ticket.
      </p>
      <div className="row">
        <QueryInput className="grow" value={query} onChange={setQuery} onEnter={search} placeholder="YouTrack-Suche, # für Vorschläge" />
        <label className="row">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Erledigte zeigen
        </label>
        <button onClick={search}>Tickets suchen</button>
        <button onClick={() => run(() => api.ytProjects()).then((r) => r && (setProjects(r), setIssues(null), setSel(new Set())))}>
          Projekte laden
        </button>
      </div>
      {issues && (
        <div className="picklist">
          {issues.length === 0 && <div className="muted">Keine Tickets gefunden.</div>}
          {issues.map((i) => (
            <label key={i.key} className={linkedIssues.has(i.key) ? 'done' : ''}>
              <input type="checkbox" disabled={linkedIssues.has(i.key)} checked={sel.has(i.key)} onChange={() => toggle(i.key)} />
              <strong>{i.key}</strong> {i.summary} {i.resolved && <span className="badge muted">erledigt</span>}
            </label>
          ))}
          <button
            className="primary"
            disabled={sel.size === 0}
            onClick={() => run(() => api.ytImportIssues(issues.filter((i) => sel.has(i.key))), (r) => `${r.length} Kachel(n) angelegt`).then(() => setSel(new Set()))}
          >
            Ausgewählte als Kacheln anlegen
          </button>
        </div>
      )}
      {projects && (
        <div className="picklist">
          {projects
            .filter((p) => !p.archived)
            .map((p) => (
              <label key={p.id} className={linkedProjects.has(p.id) ? 'done' : ''}>
                <input type="checkbox" disabled={linkedProjects.has(p.id)} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                <strong>{p.key}</strong> {p.name}
              </label>
            ))}
          <button
            className="primary"
            disabled={sel.size === 0}
            onClick={() =>
              run(() => api.ytImportProjects(projects.filter((p) => sel.has(p.id))), (r) => `${r.length} Kachel(n) angelegt – Standard-Ticket noch eintragen`).then(() =>
                setSel(new Set())
              )
            }
          >
            Ausgewählte als Kacheln anlegen
          </button>
        </div>
      )}
    </section>
  )
}

export function ProjectsView({ snap }: { snap: Snapshot }) {
  const run = useAction()
  const [name, setName] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const list = snap.projects.filter((p) => showArchived || !p.archived)
  return (
    <div className="projects">
      <section className="card">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) run(() => api.createProject({ name, kind: 'local' }), 'Tätigkeit angelegt').then(() => setName(''))
          }}
        >
          <input className="grow" placeholder="Neue lokale Tätigkeit, z. B. Besprechung, Team-Meeting" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" type="submit">
            Anlegen
          </button>
          <label className="row">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte zeigen
          </label>
        </form>
        <table>
          <thead>
            <tr>
              <th>Farbe</th>
              <th>Name</th>
              <th>Kunde</th>
              <th>Art</th>
              <th>Standard-Ticket</th>
              <th>Arbeitstyp</th>
              <th>Favorit</th>
              <th>Archiv</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <ProjectRow key={p.id} p={p} configured={snap.sync.configured} />
            ))}
          </tbody>
        </table>
      </section>
      {snap.sync.configured ? <YouTrackImport snap={snap} /> : <p className="muted">YouTrack in den Einstellungen verbinden, um Projekte und Tickets zu übernehmen.</p>}
    </div>
  )
}
