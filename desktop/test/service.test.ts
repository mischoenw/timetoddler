import { describe, expect, it } from 'vitest'
import { at, setup } from './helpers'

describe('tracking rules', () => {
  it('starting an activity auto-comes and switching stops the previous one', async () => {
    const { clock, svc, repo } = await setup()
    const a = svc.createProject({ name: 'A' })
    const b = svc.createProject({ name: 'B' })
    svc.start(a.id)
    expect(svc.state().mode).toBe('running')
    expect(svc.state().presence).not.toBeNull()
    clock.set('2026-10-21 09:00')
    svc.start(b.id)
    const entries = repo.entriesBetween(0, Infinity)
    expect(entries).toHaveLength(2)
    expect(entries[0].end).toBe(clock.t)
    expect(svc.state().running?.projectId).toBe(b.id)
  })

  it('does not auto-come when disabled', async () => {
    const { svc } = await setup()
    svc.setSettings({ 'work.autoCome': false })
    svc.start(svc.createProject({ name: 'A' }).id)
    expect(svc.state().presence).toBeNull()
  })

  it('toggle on the running activity stops it; tiny entries are dropped', async () => {
    const { clock, svc, repo } = await setup()
    const a = svc.createProject({ name: 'A' })
    svc.toggle(a.id)
    clock.t += 5000
    svc.toggle(a.id)
    expect(repo.entriesBetween(0, Infinity)).toHaveLength(0)
    svc.toggle(a.id)
    clock.t += 60000
    svc.toggle(a.id)
    expect(repo.entriesBetween(0, Infinity)).toHaveLength(1)
    expect(svc.state().mode).toBe('idle')
  })

  it('rebook keeps the start time', async () => {
    const { clock, svc } = await setup()
    const a = svc.createProject({ name: 'A' })
    const b = svc.createProject({ name: 'B' })
    const e = svc.start(a.id)
    clock.t += 600000
    svc.rebook(b.id)
    expect(svc.state().running).toMatchObject({ id: e.id, projectId: b.id, start: e.start })
  })

  it('pause stops and resumes the activity', async () => {
    const { clock, svc, repo } = await setup()
    const a = svc.createProject({ name: 'A' })
    svc.start(a.id)
    clock.set('2026-10-21 12:00')
    svc.togglePause()
    expect(svc.state().mode).toBe('break')
    expect(svc.state().running).toBeNull()
    clock.set('2026-10-21 12:30')
    svc.togglePause()
    expect(svc.state().running?.projectId).toBe(a.id)
    expect(repo.entriesBetween(0, Infinity)).toHaveLength(2)
    const day = svc.day('2026-10-21')
    expect(day.summary.pauseSec).toBe(1800)
  })

  it('does not resume when disabled; starting ends the pause', async () => {
    const { clock, svc } = await setup()
    svc.setSettings({ 'work.resumeAfterBreak': false })
    const a = svc.createProject({ name: 'A' })
    svc.start(a.id)
    clock.t += 3600000
    svc.pauseStart()
    clock.t += 600000
    svc.pauseEnd()
    expect(svc.state().mode).toBe('idle')
    svc.pauseStart()
    clock.t += 600000
    svc.start(a.id)
    expect(svc.state().pause).toBeNull()
    expect(svc.state().mode).toBe('running')
  })

  it('go ends entry, pause and presence', async () => {
    const { clock, svc } = await setup()
    svc.come()
    svc.start(svc.createProject({ name: 'A' }).id)
    clock.t += 3600000
    svc.pauseStart()
    clock.t += 60000
    svc.go()
    const s = svc.state()
    expect(s.mode).toBe('absent')
    expect(s.pause).toBeNull()
    expect(s.presence).toBeNull()
  })

  it('validates manual entries', async () => {
    const { svc } = await setup()
    const a = svc.createProject({ name: 'A' })
    expect(() => svc.createEntry({ projectId: a.id, start: 2000, end: 1000, note: '', ytIssue: null })).toThrow(/Ende/)
    svc.start(a.id)
    expect(() => svc.createEntry({ projectId: a.id, start: 1000, end: null, note: '', ytIssue: null })).toThrow(/läuft/)
  })

  it('deleting a used activity archives it', async () => {
    const { clock, svc } = await setup()
    const a = svc.createProject({ name: 'A' })
    const b = svc.createProject({ name: 'B' })
    svc.start(a.id)
    clock.t += 60000
    svc.stop()
    expect(svc.deleteProject(a.id)).toBe('archived')
    expect(svc.deleteProject(b.id)).toBe('deleted')
    expect(() => svc.start(a.id)).toThrow(/archiviert/)
  })

  it('imports remote issues once', async () => {
    const { svc } = await setup()
    const issue = { id: '2-1', key: 'ABC-1', summary: 'Login', resolved: false, projectId: '0-1', projectKey: 'ABC' }
    expect(svc.importRemoteIssues([issue])).toHaveLength(1)
    expect(svc.importRemoteIssues([issue])).toHaveLength(0)
    const p = svc.projects()[0]
    expect(p).toMatchObject({ kind: 'youtrack', ytIssue: 'ABC-1', name: 'ABC-1 Login' })
    svc.markStale([], new Set(['ABC-1']))
    expect(svc.projects()[0].ytStale).toBe(true)
  })

  it('rejects overlapping presences', async () => {
    const { svc } = await setup('2026-10-21 18:00')
    const a = svc.createPresence(at('2026-10-21 08:00'), at('2026-10-21 12:00'))
    expect(() => svc.createPresence(at('2026-10-21 11:00'), at('2026-10-21 13:00'))).toThrow('überschneidet')
    const b = svc.createPresence(at('2026-10-21 12:00'), at('2026-10-21 16:00'))
    expect(() => svc.updatePresence(b.id, at('2026-10-21 11:59'), at('2026-10-21 16:00'))).toThrow('überschneidet')
    svc.updatePresence(a.id, at('2026-10-21 07:30'), at('2026-10-21 12:00'))
    expect(() => svc.createPresence(at('2026-10-21 15:00'), null)).toThrow('überschneidet')
  })
})
