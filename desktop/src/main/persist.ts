import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export function readFileOrUndefined(path: string): Uint8Array | undefined {
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined
}

/** Write via temp file + rename so a crash never leaves a half-written database. */
export function writeAtomic(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${Date.now()}.tmp`)
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

/** Coalesces bursts of changes into one save; `flush` for shutdown. */
export class DebouncedSaver {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly save: () => void,
    private readonly delayMs = 300
  ) {}

  schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.save()
    }, this.delayMs)
  }

  flush(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
    this.save()
  }
}
