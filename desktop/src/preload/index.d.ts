import type { ApiMethod } from '../shared/api'

declare global {
  interface Window {
    tt: {
      invoke(method: ApiMethod, ...args: unknown[]): Promise<unknown>
      onChanged(cb: () => void): () => void
    }
  }
}

export {}
