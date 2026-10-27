import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Snapshot } from '@shared/api'
import { displayState, initialKnob, knobInput, knobTiles, SELECT_TIMEOUT_MS, type KnobAction, type KnobState } from '@shared/knob'
import { PROTO_VERSION, type DeviceMessage, type DisplayState } from '@shared/protocol'
import { api } from '../api'
import { useToast } from '../ui'
import { UsbLink, type LinkStatus } from './link'

const HEARTBEAT_MS = 2000

export interface DeviceInfo {
  connected: boolean
  fw: string | null
  serial: string | null
  error: string | null
  /** Last state sent (or that would be sent) to the display. */
  display: DisplayState | null
  simulate: (m: DeviceMessage) => void
}

const Ctx = createContext<DeviceInfo>({ connected: false, fw: null, serial: null, error: null, display: null, simulate: () => undefined })

export const useDevice = (): DeviceInfo => useContext(Ctx)

function run(a: KnobAction): Promise<unknown> {
  switch (a.type) {
    case 'toggle':
      return api.toggle(a.projectId)
    case 'rebook':
      return api.rebook(a.projectId)
    case 'pressDefault':
      return api.pressDefault()
    case 'pauseStart':
      return api.pauseStart()
    case 'pauseEnd':
      return api.pauseEnd()
    case 'togglePause':
      return api.togglePause()
    case 'go':
      return api.go()
    case 'come':
      return api.come()
    case 'toggleWindow':
      return api.toggleWindow()
  }
}

/** Owns the knob: USB link, selection state, and pushing the display state. */
export function DeviceProvider({ snap, children }: { snap: Snapshot; children: ReactNode }) {
  const { show } = useToast()
  const snapRef = useRef(snap)
  snapRef.current = snap
  const knob = useRef<KnobState>({ ...initialKnob })
  const link = useRef<UsbLink | null>(null)
  const [status, setStatus] = useState<LinkStatus>({ connected: false, error: null })
  const [hello, setHello] = useState<{ fw: string; serial: string } | null>(null)
  const [display, setDisplay] = useState<DisplayState | null>(null)
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null)

  const push = useCallback(() => {
    const s = snapRef.current
    const st = displayState(s, knob.current, knobTiles(s.projects, s.state.mode), Date.now())
    setDisplay(st)
    void link.current?.send(st)
  }, [])

  const sendCfg = useCallback(() => {
    const s = snapRef.current.settings
    void link.current?.send({ t: 'cfg', brightness: s['device.brightness'], led: s['device.led'] })
  }, [])

  const handle = useCallback(
    (m: DeviceMessage) => {
      if (m.t === 'hello') {
        setHello({ fw: m.fw, serial: m.serial })
        if (m.proto !== PROTO_VERSION) show(`Knopf-Firmware spricht Protokoll ${m.proto}, App erwartet ${PROTO_VERSION}. Bitte aktualisieren.`, true)
        sendCfg()
        push()
        return
      }
      const s = snapRef.current
      const settings = s.settings
      const r = knobInput(knob.current, m, {
        tiles: knobTiles(s.projects, s.state.mode),
        runningProjectId: s.state.running?.projectId ?? null,
        stepsPerDetent: settings['encoder.stepsPerDetent'],
        reverse: settings['encoder.reverse'],
        now: Date.now()
      })
      knob.current = r.state
      if (expiry.current) clearTimeout(expiry.current)
      if (r.state.selected !== null) expiry.current = setTimeout(push, SELECT_TIMEOUT_MS + 50)
      push()
      for (const a of r.actions) void run(a).catch((e: Error) => show(e.message, true))
    },
    [push, sendCfg, show]
  )

  useEffect(() => {
    const l = new UsbLink(
      (m) => handle(m),
      (st) => {
        setStatus(st)
        if (!st.connected) setHello(null)
      }
    )
    link.current = l
    const stop = l.start()
    const hb = setInterval(push, HEARTBEAT_MS)
    return () => {
      clearInterval(hb)
      stop()
      link.current = null
    }
  }, [handle, push])

  // Every data change (also from the UI or tray) goes to the display right away.
  useEffect(push, [snap, push])
  useEffect(sendCfg, [snap.settings['device.brightness'], snap.settings['device.led'], sendCfg])

  return (
    <Ctx.Provider value={{ connected: status.connected, fw: hello?.fw ?? null, serial: hello?.serial ?? null, error: status.error, display, simulate: handle }}>
      {children}
    </Ctx.Provider>
  )
}
