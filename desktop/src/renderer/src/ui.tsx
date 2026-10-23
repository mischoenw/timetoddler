import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { EntryBookingState, QuerySuggestion } from '@shared/types'
import { api } from './api'

const pad = (n: number): string => String(n).padStart(2, '0')

export function toLocalInput(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

export function DateTimeInput(props: { value: number | null; onChange: (ms: number | null) => void; allowEmpty?: boolean; title?: string }) {
  return (
    <input
      type="datetime-local"
      title={props.title}
      value={toLocalInput(props.value)}
      onChange={(e) => {
        const v = fromLocalInput(e.target.value)
        if (v !== null || props.allowEmpty) props.onChange(v)
      }}
    />
  )
}

const BADGE: Record<EntryBookingState, [string, string]> = {
  running: ['läuft', 'run'],
  local: ['lokal', 'muted'],
  unbookable: ['kein Ticket', 'warn'],
  open: ['offen', 'open'],
  pending: ['ausstehend', 'pending'],
  booked: ['gebucht', 'ok'],
  error: ['Fehler', 'err']
}

export function BookingBadge({ state, error }: { state: EntryBookingState; error?: string | null }) {
  const [label, cls] = BADGE[state]
  return (
    <span className={`badge ${cls}`} title={error ?? undefined}>
      {label}
    </span>
  )
}

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />
}

// ---- toasts ----------------------------------------------------------------

interface Toast {
  id: number
  text: string
  error: boolean
}

const ToastCtx = createContext<{ show: (text: string, error?: boolean) => void }>({ show: () => undefined })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/** Wraps an async action: shows errors as toast, optional success text. */
export function useAction() {
  const { show } = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      try {
        const r = await fn()
        if (success) show(typeof success === 'function' ? success(r) : success)
        return r
      } catch (e) {
        show((e as Error).message, true)
        return undefined
      }
    },
    [show]
  )
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** YouTrack search field; suggests completions from YouTrack while the word at the caret starts with `#`. */
export function QueryInput(props: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  onEnter?: () => void
  className?: string
  placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<QuerySuggestion[]>([])
  const [sel, setSel] = useState(0)
  const seq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const close = (): void => {
    seq.current++
    clearTimeout(timer.current)
    setItems([])
  }

  const suggest = (value: string, caret: number): void => {
    const word = value.slice(0, caret).split(/\s/).pop() ?? ''
    if (!word.replace(/^-/, '').startsWith('#')) return close()
    clearTimeout(timer.current)
    const my = ++seq.current
    timer.current = setTimeout(() => {
      api.ytAssist(value, caret).then(
        (r) => {
          if (my !== seq.current) return
          setItems(r.slice(0, 12))
          setSel(0)
        },
        () => my === seq.current && setItems([])
      )
    }, 150)
  }

  const apply = (s: QuerySuggestion): void => {
    const v = props.value
    const next = v.slice(0, s.completionStart) + s.prefix + s.option + s.suffix + v.slice(s.completionEnd)
    props.onChange(next)
    close()
    requestAnimationFrame(() => ref.current?.setSelectionRange(s.caret, s.caret))
  }

  return (
    <div className={`suggest ${props.className ?? ''}`}>
      <input
        ref={ref}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => {
          props.onChange(e.target.value)
          suggest(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onBlur={() => {
          close()
          props.onBlur?.()
        }}
        onKeyDown={(e) => {
          if (items.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              apply(items[sel])
              return
            }
            if (e.key === 'Escape') return close()
          }
          if (e.key === 'Enter') props.onEnter?.()
        }}
      />
      {items.length > 0 && (
        <ul className="suggestions">
          {items.map((s, i) => (
            <li key={i} className={i === sel ? 'sel' : ''} onMouseDown={(e) => (e.preventDefault(), apply(s))} onMouseEnter={() => setSel(i)}>
              {s.prefix}
              {s.option}
              {s.description && <span className="muted"> {s.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
