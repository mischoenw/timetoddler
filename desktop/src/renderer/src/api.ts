import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiMethod, AsyncApi, Snapshot } from '@shared/api'

/** Typed proxy over the preload bridge: `api.start(3)` -> main process. */
export const api = new Proxy({} as AsyncApi, {
  get: (_t, method: string) => (...args: unknown[]) => window.tt.invoke(method as ApiMethod, ...args)
}) as AsyncApi

type Listener = () => void
const listeners = new Set<Listener>()
let subscribed = false

/** Re-runs whenever the main process reports a data change. */
export function useChanges(cb: Listener): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!subscribed) {
      subscribed = true
      window.tt.onChanged(() => listeners.forEach((l) => l()))
    }
    const l = (): void => ref.current()
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
}

/** Loads data and reloads it on every change. */
export function useLive<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; reload: () => void; error: string | null } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    const my = ++seq.current
    load().then(
      (d) => {
        if (my === seq.current) {
          setData(d)
          setError(null)
        }
      },
      (e: Error) => my === seq.current && setError(e.message)
    )
  }, deps)
  useEffect(reload, [reload])
  useChanges(reload)
  return { data, reload, error }
}

export function useSnapshot(): Snapshot | undefined {
  return useLive(() => api.snapshot(), []).data
}

/** Current time, ticking every second. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
