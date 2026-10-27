import { describe, expect, it } from 'vitest'
import { displayState, initialKnob, knobInput, knobTiles, SELECT_TIMEOUT_MS, type KnobState } from '@shared/knob'
import { decode, encode, LineSplitter } from '@shared/protocol'
import type { Snapshot } from '@shared/api'
import type { Project } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

const proj = (id: number, name: string, favorite = false): Project => ({
  id, kind: 'local', name, client: '', color: `#00000${id}`, favorite, archived: false,
  createdAt: 0, ytProjectId: null, ytIssue: null, ytWorkTypeId: null, ytStale: false
})
const projects = [proj(1, 'Alpha'), proj(2, 'Beta', true), proj(3, 'Gamma')]

function ctx(over: Partial<Parameters<typeof knobInput>[2]> = {}) {
  return { tiles: knobTiles(projects, 'idle'), runningProjectId: null, stepsPerDetent: 4, reverse: false, now: 1000, ...over }
}

describe('protocol', () => {
  it('decodes device messages and rejects junk', () => {
    expect(decode('{"t":"rot","c":-4}')).toEqual({ t: 'rot', c: -4 })
    expect(decode('{"t":"btn","k":"long"}')).toEqual({ t: 'btn', k: 'long' })
    expect(decode('{"t":"btn","k":"triple"}')).toBeNull()
    expect(decode('{"t":"rot","c":0}')).toBeNull()
    expect(decode('nope')).toBeNull()
    expect(encode({ t: 'hello?' })).toBe('{"t":"hello?"}\n')
  })

  it('splits lines across chunks including multibyte characters', () => {
    const s = new LineSplitter()
    const bytes = new TextEncoder().encode('{"t":"tap"}\n{"t":"hello","fw":"Ü')
    expect(s.push(bytes.slice(0, 15))).toEqual(['{"t":"tap"}'])
    expect(s.push(bytes.slice(15))).toEqual([])
    expect(s.push(new TextEncoder().encode('"}\r\n'))).toEqual(['{"t":"hello","fw":"Ü"}'])
  })
})

describe('knob', () => {
  it('orders tiles with favourites first and attendance tiles last', () => {
    const t = knobTiles(projects, 'idle').map((x) => (x.kind === 'project' ? x.project.name : x.kind))
    expect(t).toEqual(['Beta', 'Alpha', 'Gamma', 'pause', 'go'])
    expect(knobTiles(projects, 'break').slice(-2).map((x) => x.kind)).toEqual(['resume', 'go'])
    expect(knobTiles(projects, 'absent').slice(-1).map((x) => x.kind)).toEqual(['come'])
  })

  it('converts raw steps into detents and keeps the remainder', () => {
    let r = knobInput(initialKnob, { t: 'rot', c: 3 }, ctx())
    expect(r.state.selected).toBeNull()
    r = knobInput(r.state, { t: 'rot', c: 2 }, ctx())
    expect(r.state).toMatchObject({ selected: 0, residual: 1 })
    r = knobInput(r.state, { t: 'rot', c: 7 }, ctx())
    expect(r.state).toMatchObject({ selected: 2, residual: 0 })
    // wraps around, honours reverse
    r = knobInput(r.state, { t: 'rot', c: 4 }, ctx({ reverse: true }))
    expect(r.state.selected).toBe(1)
    r = knobInput({ ...initialKnob }, { t: 'rot', c: -1 }, ctx({ stepsPerDetent: 1 }))
    expect(r.state.selected).toBe(4)
  })

  it('starts selecting next to the running activity', () => {
    const r = knobInput(initialKnob, { t: 'rot', c: 1 }, ctx({ stepsPerDetent: 1, runningProjectId: 1 }))
    expect(r.state.selected).toBe(2) // Alpha is index 1
  })

  it('maps presses to actions', () => {
    const sel = (i: number): KnobState => ({ selected: i, selectedAt: 1000, residual: 0 })
    expect(knobInput(sel(1), { t: 'btn', k: 'short' }, ctx()).actions).toEqual([{ type: 'toggle', projectId: 1 }])
    expect(knobInput(sel(1), { t: 'btn', k: 'long' }, ctx()).actions).toEqual([{ type: 'rebook', projectId: 1 }])
    expect(knobInput(sel(3), { t: 'btn', k: 'short' }, ctx()).actions).toEqual([{ type: 'pauseStart' }])
    expect(knobInput(sel(4), { t: 'btn', k: 'long' }, ctx()).actions).toEqual([{ type: 'go' }])
    expect(knobInput(initialKnob, { t: 'btn', k: 'short' }, ctx()).actions).toEqual([{ type: 'pressDefault' }])
    expect(knobInput(initialKnob, { t: 'btn', k: 'long' }, ctx()).actions).toEqual([])
    expect(knobInput(sel(1), { t: 'btn', k: 'double' }, ctx()).actions).toEqual([{ type: 'togglePause' }])
    expect(knobInput(sel(1), { t: 'tap' }, ctx()).actions).toEqual([{ type: 'toggleWindow' }])
    expect(knobInput(sel(1), { t: 'btn', k: 'short' }, ctx()).state.selected).toBeNull()
  })

  it('selection expires after the timeout', () => {
    const r = knobInput({ selected: 1, selectedAt: 0, residual: 0 }, { t: 'btn', k: 'short' }, ctx({ now: SELECT_TIMEOUT_MS }))
    expect(r.actions).toEqual([{ type: 'pressDefault' }])
  })

  it('builds the display state', () => {
    const snap: Snapshot = {
      now: 10_000,
      state: { mode: 'running', running: { id: 9, projectId: 2, start: 4_000, end: null, note: '', ytIssue: null }, presence: { id: 1, start: 0, end: null }, pause: null },
      projects,
      settings: DEFAULT_SETTINGS,
      sync: { configured: false, hasToken: false, tokenProtection: 'os', authError: false, lastError: null, pending: 0, errors: 0, lastRun: null, lastPull: null },
      todayNetSec: 100
    }
    const tiles = knobTiles(projects, 'running')
    expect(displayState(snap, initialKnob, tiles, 12_000)).toMatchObject({ mode: 'running', name: 'Beta', elapsed: 8, day: 102, count: 5 })
    expect(displayState(snap, { selected: 3, selectedAt: 11_000, residual: 0 }, tiles, 12_000)).toMatchObject({
      mode: 'select', name: 'Pause', idx: 4, color: '#f58231'
    })
    // expired selection falls back to the running entry
    expect(displayState(snap, { selected: 3, selectedAt: 0, residual: 0 }, tiles, 12_000).mode).toBe('running')
  })
})
