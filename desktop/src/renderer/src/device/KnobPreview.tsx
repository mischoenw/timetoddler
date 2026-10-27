import { formatHM, formatHMS } from '@shared/timecalc'
import { useDevice } from './DeviceProvider'

/** Round preview of what the knob display shows; doubles as simulator. */
/** The display state is re-sent every 2 s, so the times shown here advance with it. */
export function KnobPreview({ steps }: { steps: number }) {
  const dev = useDevice()
  const d = dev.display
  if (!d) return null
  const counting = d.mode === 'running' || d.mode === 'break' || (d.mode === 'select' && d.elapsed > 0)
  return (
    <div className="knob">
      <div className={`knob-face ${d.mode}`} style={{ ['--c' as string]: d.color }}>
        {d.mode === 'select' && <div className="k-idx">{`${d.idx} / ${d.count}`}</div>}
        <div className="k-name">{d.name}</div>
        {d.client && <div className="k-client">{d.client}</div>}
        {counting && <div className="k-time">{formatHMS(d.elapsed)}</div>}
        <div className="k-day">Heute {formatHM(d.day)}</div>
      </div>
      <div className="col">
        <div className="row">
          <button onClick={() => dev.simulate({ t: 'rot', c: -steps })} title="Eine Rastung links">⟲</button>
          <button onClick={() => dev.simulate({ t: 'rot', c: steps })} title="Eine Rastung rechts">⟳</button>
        </div>
        <div className="row">
          <button onClick={() => dev.simulate({ t: 'btn', k: 'short' })}>Drücken</button>
          <button onClick={() => dev.simulate({ t: 'btn', k: 'long' })}>Lang</button>
          <button onClick={() => dev.simulate({ t: 'btn', k: 'double' })}>Doppelt</button>
          <button onClick={() => dev.simulate({ t: 'tap' })}>Tippen</button>
        </div>
        <span className="muted">Simulator: wirkt wie der echte Knopf.</span>
      </div>
    </div>
  )
}
