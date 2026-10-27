import { decode, encode, LineSplitter, USB_PRODUCT_ID, USB_VENDOR_ID, type DeviceMessage, type HostMessage } from '@shared/protocol'

const VENDOR_CLASS = 0xff

export interface LinkStatus {
  connected: boolean
  error: string | null
}

const isKnob = (d: USBDevice): boolean => d.vendorId === USB_VENDOR_ID && d.productId === USB_PRODUCT_ID

/** WebUSB transport to the knob: vendor interface, bulk endpoints, JSON lines. */
export class UsbLink {
  private dev: USBDevice | null = null
  private iface = -1
  private epIn = 0
  private epOut = 0
  private sending: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly onMessage: (m: DeviceMessage) => void,
    private readonly onStatus: (s: LinkStatus) => void
  ) {}

  start(): () => void {
    if (!('usb' in navigator)) {
      this.onStatus({ connected: false, error: 'WebUSB nicht verfügbar' })
      return () => undefined
    }
    const onConnect = (e: USBConnectionEvent): void => void this.open(e.device)
    const onDisconnect = (e: USBConnectionEvent): void => {
      if (e.device === this.dev) this.closed(null)
    }
    navigator.usb.addEventListener('connect', onConnect)
    navigator.usb.addEventListener('disconnect', onDisconnect)
    // The main process grants the knob, so no chooser is needed.
    void navigator.usb.getDevices().then((ds) => {
      const d = ds.find(isKnob)
      if (d) void this.open(d)
    })
    return () => {
      navigator.usb.removeEventListener('connect', onConnect)
      navigator.usb.removeEventListener('disconnect', onDisconnect)
      const d = this.dev
      this.dev = null
      void d?.close().catch(() => undefined)
    }
  }

  get connected(): boolean {
    return this.dev !== null
  }

  private async open(d: USBDevice): Promise<void> {
    if (!isKnob(d) || this.dev) return
    try {
      if (!d.opened) await d.open()
      if (d.configuration === null) await d.selectConfiguration(1)
      const iface = d.configuration!.interfaces.find((i) => i.alternates[0]?.interfaceClass === VENDOR_CLASS)
      if (!iface) throw new Error('Vendor-Interface fehlt (Firmware zu alt?)')
      await d.claimInterface(iface.interfaceNumber)
      const eps = iface.alternates[0].endpoints
      this.epIn = eps.find((e) => e.direction === 'in')!.endpointNumber
      this.epOut = eps.find((e) => e.direction === 'out')!.endpointNumber
      this.iface = iface.interfaceNumber
      this.dev = d
      this.onStatus({ connected: true, error: null })
      void this.readLoop(d)
      await this.send({ t: 'hello?' })
    } catch (err) {
      this.onStatus({ connected: false, error: (err as Error).message })
      await d.close().catch(() => undefined)
    }
  }

  private async readLoop(d: USBDevice): Promise<void> {
    const split = new LineSplitter()
    while (this.dev === d) {
      try {
        const r = await d.transferIn(this.epIn, 64)
        if (r.status === 'stall') {
          await d.clearHalt('in', this.epIn)
          continue
        }
        if (!r.data || r.data.byteLength === 0) continue
        for (const line of split.push(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength))) {
          const m = decode(line)
          if (m) this.onMessage(m)
        }
      } catch (err) {
        if (this.dev === d) this.closed((err as Error).message)
        return
      }
    }
  }

  private closed(error: string | null): void {
    const d = this.dev
    this.dev = null
    if (d && this.iface >= 0) void d.releaseInterface(this.iface).catch(() => undefined)
    this.onStatus({ connected: false, error })
  }

  /** Sends are serialised so lines never interleave. */
  send(msg: HostMessage): Promise<void> {
    const d = this.dev
    if (!d) return Promise.resolve()
    const data = new TextEncoder().encode(encode(msg))
    const p = this.sending.then(() => d.transferOut(this.epOut, data)).then(
      () => undefined,
      (err: Error) => {
        if (this.dev === d) this.onStatus({ connected: true, error: err.message })
      }
    )
    this.sending = p
    return p
  }
}
