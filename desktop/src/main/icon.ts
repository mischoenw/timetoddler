import { deflateSync } from 'node:zlib'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const v = m ? parseInt(m[1], 16) : 0x888888
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/**
 * Tray icon: a filled circle in the activity colour, or a ring when idle.
 * Rendered in code so the tray can follow the project colour without image assets.
 */
export function circlePng(size: number, color: string, filled: boolean): Buffer {
  const [r, g, b] = hexToRgb(color)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const c = (size - 1) / 2
  const outer = size / 2 - 0.5
  const inner = filled ? -1 : outer - Math.max(1.5, size / 8)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      // 1px anti-aliased edges
      const aOuter = Math.min(1, Math.max(0, outer - d + 0.5))
      const aInner = inner < 0 ? 1 : Math.min(1, Math.max(0, d - inner + 0.5))
      const a = Math.round(255 * aOuter * aInner)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
