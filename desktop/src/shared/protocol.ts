/** USB line protocol between app and knob (see docs/specs, "Protokoll"). */

export const USB_VENDOR_ID = 0x303a
/** Development PID (TinyUSB scheme CDC + vendor). Replace with an allocated Espressif PID before shipping devices. */
export const USB_PRODUCT_ID = 0x4011
export const PROTO_VERSION = 1
export const MAX_LINE = 512

export type DeviceMessage =
  | { t: 'hello'; proto: number; fw: string; serial: string }
  | { t: 'rot'; c: number }
  | { t: 'btn'; k: 'short' | 'long' | 'double' }
  | { t: 'tap' }

export type DisplayMode = 'absent' | 'idle' | 'running' | 'break' | 'select'

export interface DisplayState {
  t: 'state'
  mode: DisplayMode
  name: string
  client: string
  color: string
  /** Seconds of the running entry or pause; the device keeps counting. */
  elapsed: number
  /** Net work time today in seconds; the device keeps counting unless in a pause/absent. */
  day: number
  idx: number
  count: number
}

export type HostMessage = { t: 'hello?' } | DisplayState | { t: 'cfg'; brightness: number; led: number }

/** Cuts names so a state line stays well below MAX_LINE even with multibyte characters. */
export function clip(s: string, max = 48): string {
  const chars = [...s]
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…'
}

export function encode(msg: HostMessage): string {
  return JSON.stringify(msg) + '\n'
}

/** Parses one line from the device; unknown or malformed lines yield null. */
export function decode(line: string): DeviceMessage | null {
  let m: Record<string, unknown>
  try {
    m = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  switch (m.t) {
    case 'hello':
      return {
        t: 'hello',
        proto: Number(m.proto) || 0,
        fw: String(m.fw ?? ''),
        serial: String(m.serial ?? '')
      }
    case 'rot':
      return Number.isInteger(m.c) && m.c !== 0 ? { t: 'rot', c: m.c as number } : null
    case 'btn':
      return m.k === 'short' || m.k === 'long' || m.k === 'double' ? { t: 'btn', k: m.k } : null
    case 'tap':
      return { t: 'tap' }
    default:
      return null
  }
}

/** Splits a byte stream into lines; drops over-long lines instead of growing without bound. */
export class LineSplitter {
  private buf = ''
  private readonly decoder = new TextDecoder()

  push(chunk: Uint8Array): string[] {
    this.buf += this.decoder.decode(chunk, { stream: true })
    const lines: string[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')
      this.buf = this.buf.slice(i + 1)
      if (line) lines.push(line)
    }
    if (this.buf.length > MAX_LINE) this.buf = ''
    return lines
  }
}
