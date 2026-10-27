import type { Snapshot } from './api'
import { clip, type DeviceMessage, type DisplayState } from './protocol'
import { tileOrder } from './tiles'
import type { Project, WorkMode } from './types'

/** Knob selection list: activities, then the attendance tiles. */
export type KnobTile = { kind: 'project'; project: Project } | { kind: 'pause' | 'resume' | 'go' | 'come' }

export const SELECT_TIMEOUT_MS = 5000
export const PAUSE_COLOR = '#f58231'
const ACTION_COLOR = '#ffffff'

export function knobTiles(projects: Project[], mode: WorkMode): KnobTile[] {
  const tiles: KnobTile[] = tileOrder(projects).map((project) => ({ kind: 'project', project }))
  if (mode === 'absent') tiles.push({ kind: 'come' })
  else tiles.push({ kind: mode === 'break' ? 'resume' : 'pause' }, { kind: 'go' })
  return tiles
}

const TILE_LABEL = { pause: 'Pause', resume: 'Pause beenden', go: 'Gehen', come: 'Kommen' } as const

export type KnobAction =
  | { type: 'toggle'; projectId: number }
  | { type: 'rebook'; projectId: number }
  | { type: 'pressDefault' | 'pauseStart' | 'pauseEnd' | 'togglePause' | 'go' | 'come' | 'toggleWindow' }

export interface KnobState {
  /** Index into the tile list while selecting, else null. */
  selected: number | null
  selectedAt: number
  /** Raw encoder steps not yet making up a full detent. */
  residual: number
}

export const initialKnob: KnobState = { selected: null, selectedAt: 0, residual: 0 }

export interface KnobContext {
  tiles: KnobTile[]
  runningProjectId: number | null
  stepsPerDetent: number
  reverse: boolean
  now: number
}

const mod = (a: number, n: number): number => ((a % n) + n) % n

export function expire(s: KnobState, now: number): KnobState {
  return s.selected !== null && now - s.selectedAt >= SELECT_TIMEOUT_MS ? { ...initialKnob } : s
}

function tileAction(tile: KnobTile, long: boolean): KnobAction {
  switch (tile.kind) {
    case 'project':
      return long ? { type: 'rebook', projectId: tile.project.id } : { type: 'toggle', projectId: tile.project.id }
    case 'pause':
      return { type: 'pauseStart' }
    case 'resume':
      return { type: 'pauseEnd' }
    case 'go':
      return { type: 'go' }
    case 'come':
      return { type: 'come' }
  }
}

/** Applies one device input; returns the new knob state and the actions to run. */
export function knobInput(prev: KnobState, msg: DeviceMessage, ctx: KnobContext): { state: KnobState; actions: KnobAction[] } {
  const s = expire(prev, ctx.now)
  const n = ctx.tiles.length
  const sel = s.selected !== null && n > 0 ? Math.min(s.selected, n - 1) : null
  const done = (actions: KnobAction[]) => ({ state: { ...initialKnob }, actions })

  switch (msg.t) {
    case 'rot': {
      const steps = Math.max(1, Math.round(ctx.stepsPerDetent))
      const residual = s.residual + (ctx.reverse ? -msg.c : msg.c)
      const detents = Math.trunc(residual / steps)
      const rest = residual - detents * steps
      if (detents === 0 || n === 0) return { state: { ...s, residual: rest }, actions: [] }
      const running = ctx.tiles.findIndex((t) => t.kind === 'project' && t.project.id === ctx.runningProjectId)
      const base = sel ?? (running >= 0 ? running : detents > 0 ? -1 : 0)
      return { state: { selected: mod(base + detents, n), selectedAt: ctx.now, residual: rest }, actions: [] }
    }
    case 'btn':
      if (msg.k === 'double') return done([{ type: 'togglePause' }])
      if (sel !== null) return done([tileAction(ctx.tiles[sel], msg.k === 'long')])
      return done(msg.k === 'short' ? [{ type: 'pressDefault' }] : [])
    case 'tap':
      return { state: s, actions: [{ type: 'toggleWindow' }] }
    default:
      return { state: s, actions: [] }
  }
}

/** What the round display and LED ring should show. */
export function displayState(snap: Snapshot, knob: KnobState, tiles: KnobTile[], now: number): DisplayState {
  const st = snap.state
  const live = (now - snap.now) / 1000
  const working = st.mode === 'running' || st.mode === 'idle'
  const day = Math.max(0, Math.floor(snap.todayNetSec + (working ? live : 0)))
  const running = st.running ? snap.projects.find((p) => p.id === st.running!.projectId) : undefined
  const elapsedOf = (start: number): number => Math.max(0, Math.floor((now - start) / 1000))
  const base = { t: 'state' as const, day, idx: 0, count: tiles.length }

  const k = expire(knob, now)
  if (k.selected !== null && tiles.length > 0) {
    const idx = Math.min(k.selected, tiles.length - 1)
    const tile = tiles[idx]
    const isRunning = tile.kind === 'project' && tile.project.id === st.running?.projectId
    return {
      ...base,
      mode: 'select',
      name: clip(tile.kind === 'project' ? tile.project.name : TILE_LABEL[tile.kind]),
      client: clip(tile.kind === 'project' ? tile.project.client : '', 32),
      color: tile.kind === 'project' ? tile.project.color : tile.kind === 'pause' || tile.kind === 'resume' ? PAUSE_COLOR : ACTION_COLOR,
      elapsed: isRunning && st.running ? elapsedOf(st.running.start) : 0,
      idx: idx + 1
    }
  }
  switch (st.mode) {
    case 'running':
      return {
        ...base,
        mode: 'running',
        name: clip(running?.name ?? ''),
        client: clip(running?.client ?? '', 32),
        color: running?.color ?? '#888888',
        elapsed: st.running ? elapsedOf(st.running.start) : 0
      }
    case 'break':
      return { ...base, mode: 'break', name: 'Pause', client: '', color: PAUSE_COLOR, elapsed: st.pause ? elapsedOf(st.pause.start) : 0 }
    case 'idle':
      return { ...base, mode: 'idle', name: 'Kein Timer', client: '', color: '#888888', elapsed: 0 }
    default:
      return { ...base, mode: 'absent', name: 'Abwesend', client: '', color: '#888888', elapsed: 0 }
  }
}
