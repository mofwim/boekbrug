// src/components/ui/Toast.tsx
// [MOTION] The one snackbar in the app.
//
// Six screens had each grown their own: a `toast` useState, a fixed <div>, and
// a locally-injected @keyframes. They disagreed on everything that matters —
// bottom offset (24 / 32 / 40 / 90), radius, whether the text could wrap, and
// none of them cleared the home indicator or announced themselves to a screen
// reader. Worse, each one is scoped to the screen that declared it, so an
// action that navigates away loses its own confirmation.
//
// Usage — mount <ToastProvider> once (it is in the root layout), then anywhere
// below it:
//
//   const toast = useToast()
//   toast('Factuur verstuurd')                      // neutral
//   toast('Opgeslagen', { tone: 'success' })
//   toast('Uploaden mislukt', { tone: 'error' })
//   toast('Verwijderd', { action: { label: 'Ongedaan maken', onClick: undo } })
//
// The call returns immediately; nothing to await, nothing to clean up.

'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { DUR, FONT, M3 } from '@/lib/design/tokens'
import { useIsMounted } from '@/hooks/useIsMounted'

export type ToastTone = 'neutral' | 'success' | 'error'

export type ToastOptions = {
  tone?: ToastTone
  /** Milliseconds on screen. Defaults to 3200, or 5200 when an action is set. */
  duration?: number
  /** A single inline action — "Ongedaan maken", "Opnieuw". Dismisses on click. */
  action?: { label: string; onClick: () => void }
}

type ToastRecord = ToastOptions & {
  id: number
  message: string
  /** Set when the exit animation starts; the node unmounts when it finishes. */
  leaving?: boolean
}

const ToastContext = createContext<((message: string, options?: ToastOptions) => void) | null>(null)

/**
 * Show a snackbar. Safe to call from anywhere under <ToastProvider>, including
 * from inside an async handler after an await.
 */
export function useToast() {
  const show = useContext(ToastContext)
  if (!show) {
    throw new Error('useToast must be used within <ToastProvider> (mounted in src/app/layout.tsx)')
  }
  return show
}

// At most this many at once. Beyond it the oldest is pushed out, so a burst of
// results from a bulk action cannot bury the screen.
const MAX_VISIBLE = 3
const EXIT_MS = DUR.fast

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const mounted = useIsMounted()
  const nextId = useRef(1)
  // Timers are tracked so a component unmounting mid-flight cannot leave one
  // running against a dead setState.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  const remove = useCallback((id: number) => {
    // Two-step: flag it as leaving so the exit animation can play, then drop it.
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      timers.current.delete(id)
    }, EXIT_MS)
    timers.current.set(id, timer)
  }, [])

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++
      const duration = options.duration ?? (options.action ? 5200 : 3200)
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { ...options, id, message }])
      const timer = setTimeout(() => remove(id), duration)
      timers.current.set(id, timer)
    },
    [remove],
  )

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            // [A11Y] The live region is always mounted, never conditionally
            // rendered — a screen reader only announces changes INSIDE a region
            // that already existed, so mounting the region together with its
            // first message announces nothing at all.
            aria-live="polite"
            aria-atomic="false"
            style={{
              position: 'fixed',
              // [ZIJBALK] Logical sides, and the start one clears the desktop rail — otherwise a
              // confirmation centres itself over the full window and sits half behind the rail.
              // --rail-w is 0px below 1024px, so this is a no-op on a phone.
              insetInlineStart: 'var(--rail-w)',
              insetInlineEnd: 0,
              // Clears the home indicator, and sits above the FABs (which are
              // at 24 + inset) so a confirmation never hides behind the button
              // that triggered it.
              bottom: 'calc(88px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
              zIndex: 2400,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              // The strip spans the viewport so toasts centre themselves, but it
              // must not swallow taps meant for the page underneath.
              pointerEvents: 'none',
              padding: '0 16px',
            }}
          >
            {toasts.map((t) => (
              <ToastNode key={t.id} toast={t} onDismiss={() => remove(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}

const TONE_STYLE: Record<ToastTone, { background: string; color: string }> = {
  // M3 inverse-surface: a dark pill on a light app. Deliberately NOT the brand
  // blue — a snackbar is a report, not a call to action.
  neutral: { background: '#202124', color: '#ffffff' },
  success: { background: M3.success, color: '#ffffff' },
  error: { background: M3.error, color: '#ffffff' },
}

function ToastNode({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const tone = TONE_STYLE[toast.tone ?? 'neutral']

  return (
    <div
      className={toast.leaving ? 'animate-rise-out' : 'animate-rise-in'}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'min(520px, 100%)',
        background: tone.background,
        color: tone.color,
        fontFamily: FONT,
        fontSize: 13.5,
        fontWeight: 500,
        lineHeight: 1.4,
        padding: toast.action ? '10px 8px 10px 16px' : '12px 18px',
        borderRadius: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.24)',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.onClick()
            onDismiss()
          }}
          style={{
            flexShrink: 0,
            background: 'none',
            border: 'none',
            color: tone.color,
            fontSize: 13.5,
            fontWeight: 700,
            // 44px minimum touch target — an inline action is the one thing in
            // a snackbar a user has to hit before it disappears.
            minHeight: 44,
            padding: '0 12px',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
