// src/components/ui/Dialog.tsx
// [MOTION] In-app replacements for window.alert / confirm / prompt.
//
// The app had 22 alert(), 16 confirm() and 2 prompt() calls, and they sat on
// exactly the decisions that deserved the most care: unlinking an accountant
// from a client, permanently emptying the trash, linking a bank transaction to
// an invoice that might be a duplicate. A native dialog freezes the main thread,
// renders in the OS's chrome rather than the app's, cannot show an amount or a
// supplier name in anything but plain text, and on a phone in standalone PWA
// mode announces itself with the browser's origin — which is the moment a
// financial app looks least trustworthy.
//
// The API is promise-based and deliberately mirrors the native one, so a call
// site usually changes by one word:
//
//   -  if (!confirm('Weet je het zeker?')) return
//   +  if (!await dialog.confirm({ message: 'Weet je het zeker?' })) return
//
//   -  alert('Uploaden mislukt')
//   +  await dialog.alert({ message: 'Uploaden mislukt', tone: 'error' })
//
//   -  const q = prompt('Je vraag?')
//   +  const q = await dialog.prompt({ message: 'Je vraag?', multiline: true })
//
// alert() resolves to void, confirm() to boolean, prompt() to string | null —
// the same shapes the native calls returned, so surrounding logic is unchanged.
//
// For a plain informational message with no decision attached, prefer useToast()
// over dialog.alert() — a dialog demands an acknowledgement, and most of the
// old alert() calls were really just reporting a result.

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

export type DialogTone = 'neutral' | 'danger' | 'error'

export type AlertOptions = {
  title?: string
  message: string
  confirmLabel?: string
  tone?: DialogTone
}

export type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the primary action as destructive (red). Use for anything that deletes. */
  danger?: boolean
}

export type PromptOptions = {
  title?: string
  message: string
  placeholder?: string
  defaultValue?: string
  /** Renders a textarea instead of an input — for anything a person reads later. */
  multiline?: boolean
  maxLength?: number
  confirmLabel?: string
  cancelLabel?: string
  /** Reject an empty value instead of resolving with ''. Defaults to true. */
  required?: boolean
}

type DialogApi = {
  alert: (options: AlertOptions) => Promise<void>
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
}

// `id` exists so the exit timer can tell whether the dialog it was scheduled to
// tear down is still the one on screen. See the note on `close` below.
type Request = { id: number } & (
  | { kind: 'alert'; options: AlertOptions; resolve: (v: void) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void }
)

const DialogContext = createContext<DialogApi | null>(null)

/**
 * In-app alert / confirm / prompt. Must be called under <DialogProvider>
 * (mounted in src/app/layout.tsx).
 */
export function useDialog() {
  const api = useContext(DialogContext)
  if (!api) {
    throw new Error('useDialog must be used within <DialogProvider> (mounted in src/app/layout.tsx)')
  }
  return api
}

const EXIT_MS = DUR.fast

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const [leaving, setLeaving] = useState(false)
  const mounted = useIsMounted()
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextId = useRef(1)
  useEffect(() => () => { if (exitTimer.current) clearTimeout(exitTimer.current) }, [])

  // Close plays the exit animation first, then drops the node. The promise is
  // settled immediately rather than after the animation, so a caller that
  // navigates on confirm does not sit through 140ms of fade.
  //
  // The `id` guard is not defensive tidiness — without it two dialogs in a row
  // hung the caller permanently. The sequence: dialog A resolves, close()
  // schedules a teardown 140ms out; the awaiting code continues and immediately
  // opens dialog B; A's timer then fires and clears the request, so B vanishes
  // from the screen while its promise is left un-settled — and the `await`
  // behind it never returns. Verified in Chromium, and the reachable shape is
  // ordinary: any two sequential prompts with no network call between them.
  const close = useCallback((id: number) => {
    setLeaving(true)
    exitTimer.current = setTimeout(() => {
      // Only tear down if the dialog on screen is still the one this timer was
      // scheduled for.
      setRequest((current) => (current && current.id === id ? null : current))
      setLeaving((wasLeaving) => (wasLeaving ? false : wasLeaving))
    }, EXIT_MS)
  }, [])

  // Opening a dialog cancels any pending exit animation, so a queued teardown
  // from the previous one cannot land on this one.
  const open = useCallback(<T,>(build: (id: number, resolve: (v: T) => void) => Request) => {
    return new Promise<T>((resolve) => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current)
        exitTimer.current = null
      }
      setLeaving(false)
      setRequest(build(nextId.current++, resolve))
    })
  }, [])

  const api = useMemo<DialogApi>(() => ({
    alert: (options) => open<void>((id, resolve) => ({ id, kind: 'alert', options, resolve })),
    confirm: (options) => open<boolean>((id, resolve) => ({ id, kind: 'confirm', options, resolve })),
    prompt: (options) => open<string | null>((id, resolve) => ({ id, kind: 'prompt', options, resolve })),
  }), [open])

  return (
    <DialogContext.Provider value={api}>
      {children}
      {mounted && request &&
        createPortal(
          <DialogSurface
            // Remounts per request, so a second dialog gets fresh focus
            // handling and a fresh input value instead of inheriting the first's.
            key={request.id}
            request={request}
            leaving={leaving}
            onSettle={(value) => {
              // Each branch is narrowed so the resolver gets its own value type.
              if (request.kind === 'alert') request.resolve(undefined)
              else if (request.kind === 'confirm') request.resolve(value as boolean)
              else request.resolve(value as string | null)
              close(request.id)
            }}
          />,
          document.body,
        )}
    </DialogContext.Provider>
  )
}

function DialogSurface({
  request,
  leaving,
  onSettle,
}: {
  request: Request
  leaving: boolean
  onSettle: (value: boolean | string | null) => void
}) {
  const { kind, options } = request
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [value, setValue] = useState(kind === 'prompt' ? (options as PromptOptions).defaultValue ?? '' : '')

  // The value a cancel/Escape/backdrop-dismiss resolves with, per kind.
  const cancelValue = kind === 'confirm' ? false : kind === 'prompt' ? null : undefined
  const dismiss = useCallback(() => onSettle(cancelValue as boolean | string | null), [onSettle, cancelValue])

  const required = kind === 'prompt' ? (options as PromptOptions).required !== false : false
  const canSubmit = kind !== 'prompt' || !required || value.trim().length > 0

  const submit = useCallback(() => {
    if (kind === 'prompt') {
      if (!canSubmit) return
      onSettle(value.trim())
    } else if (kind === 'confirm') {
      onSettle(true)
    } else {
      onSettle(undefined as unknown as boolean)
    }
  }, [kind, canSubmit, value, onSettle])

  // [A11Y] Focus management. Move focus into the dialog on open and put it back
  // where it was on close — without this, dismissing a dialog drops keyboard
  // focus onto <body> and the next Tab restarts from the top of the page.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const target = inputRef.current ?? panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    target?.focus()
    if (target === inputRef.current && inputRef.current) inputRef.current.select()
    return () => previous?.focus?.()
  }, [])

  // Escape cancels; Tab is trapped inside the panel so the dialog behaves like
  // the native one it replaces.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables?.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  // Freeze the page behind the dialog. Without this the body scrolls under the
  // scrim on mobile, which makes the dialog look like it is floating away.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  const danger =
    (kind === 'confirm' && (options as ConfirmOptions).danger) ||
    (kind === 'alert' && ((options as AlertOptions).tone === 'danger' || (options as AlertOptions).tone === 'error'))

  const primaryLabel =
    ('confirmLabel' in options && options.confirmLabel) ||
    (kind === 'alert' ? 'Oké' : kind === 'confirm' ? 'Doorgaan' : 'Versturen')

  const cancelLabel = (kind !== 'alert' && (options as ConfirmOptions).cancelLabel) || 'Annuleren'

  return (
    <div
      className={leaving ? 'animate-backdrop-out' : 'animate-backdrop-in'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        background: 'rgba(32,33,36,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))',
        fontFamily: FONT,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={options.title ?? options.message}
        className={leaving ? '' : 'animate-scale-in'}
        style={{
          width: '100%',
          maxWidth: 400,
          maxHeight: '100%',
          overflowY: 'auto',
          background: M3.surface,
          // M3 dialog radius — deliberately rounder than a card, so a dialog
          // reads as a separate object rather than a panel of the page.
          borderRadius: 28,
          boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
          padding: 24,
        }}
      >
        {options.title && (
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: M3.onSurface, lineHeight: 1.35 }}>
            {options.title}
          </h2>
        )}

        <p
          style={{
            margin: options.title ? '10px 0 0' : 0,
            fontSize: 14.5,
            lineHeight: 1.55,
            color: options.title ? M3.onSurfaceVariant : M3.onSurface,
            // Messages built with \n (several were, when the native dialog was
            // the only formatting available) keep their line breaks.
            whiteSpace: 'pre-line',
          }}
        >
          {options.message}
        </p>

        {kind === 'prompt' && (
          (options as PromptOptions).multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={(options as PromptOptions).placeholder}
              maxLength={(options as PromptOptions).maxLength}
              rows={4}
              style={{ width: '100%', marginTop: 16, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={(options as PromptOptions).placeholder}
              maxLength={(options as PromptOptions).maxLength}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
              style={{ width: '100%', marginTop: 16, padding: '10px 12px' }}
            />
          )
        )}

        {kind === 'prompt' && (options as PromptOptions).maxLength && (
          <div style={{ marginTop: 6, fontSize: 12, color: M3.onSurfaceVariant, textAlign: 'right' }}>
            {value.length} / {(options as PromptOptions).maxLength}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, flexWrap: 'wrap' }}>
          {kind !== 'alert' && (
            <button
              onClick={dismiss}
              style={{
                minHeight: 44,
                padding: '0 20px',
                background: 'none',
                border: 'none',
                color: M3.primary,
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 999,
              }}
            >
              {cancelLabel}
            </button>
          )}
          <button
            data-autofocus
            onClick={submit}
            disabled={!canSubmit}
            style={{
              minHeight: 44,
              padding: '0 24px',
              background: danger ? M3.error : M3.primary,
              border: 'none',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 999,
            }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
