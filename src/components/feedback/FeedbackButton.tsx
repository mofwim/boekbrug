'use client'

// src/components/feedback/FeedbackButton.tsx
// [FEEDBACK] "Er ging iets mis" — op elke /dashboard/*-pagina, één keer gemonteerd in de layout.
//
// WAAROM IN DE LAYOUT EN NIET PER PAGINA
// Een knop die je per scherm moet toevoegen, staat na een half jaar op de helft van de schermen —
// en dan juist niet op het scherm waar iets misging, want dat is meestal het minst bezochte. Eén
// montagepunt is het verschil tussen "overal" en "overal waar iemand eraan dacht".
//
// WAT DE ONDERNEMER NIET HOEFT TE TYPEN
// De pagina. Die weet de app zelf (usePathname), en "op welke pagina was je?" is precies de vraag
// die iemand die vastloopt verkeerd beantwoordt. Hetzelfde geldt voor de browser: een bug die
// alleen op één telefoon gebeurt, is zonder die regel niet te reproduceren.
//
// WAT HET SCHERM NOOIT DOET
// Zeggen dat het gelukt is als dat niet zo is. De route weigert met een zin wanneer de melding niet
// kon worden opgeslagen; dit scherm toont die zin en LAAT HET BERICHT STAAN, zodat het opnieuw
// verstuurd kan worden. Een dialoog die zichzelf sluit met "bedankt!" over een mislukte opslag is
// de ergste variant: dan stopt de ondernemer met zich zorgen maken over iets wat niemand ooit ziet.

import { useState, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { FEEDBACK_MAX_CHARS, FEEDBACK_MAX_IMAGE_BYTES } from '@/lib/feedback'
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [FEEDBACK-SEND] The same helper every bottom sheet uses — here on the OVERLAY, not on the
// panel: it is the overlay that keeps the dialog's centring area clear of the BottomNav. See the
// note at the dialog itself.
import { sheetPaddingBottom } from '@/lib/design/tokens'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// `defaultOpen` exists for tests/render/feedback-dialog.test.tsx: a server render cannot tap the
// flag, and the open dialog is the part worth rendering. The layout mounts this without props.
export default function FeedbackButton({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = translator(useLocale())
  const pathname = usePathname()
  const [open, setOpen] = useState(defaultOpen)
  const [message, setMessage] = useState('')
  const [imageName, setImageName] = useState<string | null>(null)
  const [imageData, setImageData] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Declared BEFORE close, which calls it. Reading a const above its declaration from inside a
  // callback is legal only because the callback runs later — and this repo has a documented
  // incident (AGENTS.md) where exactly that shape type-checked, built, and threw on every render
  // once the closure ran during one. Order it so the question never arises.
  const reset = useCallback(() => {
    setMessage(''); setImageName(null); setImageData(null); setResult(null); setSending(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const close = useCallback(() => { setOpen(false); reset() }, [reset])

  // [BACK-CLOSES] De systeem-terugknop sluit deze dialoog, net als elke andere overlay in de app.
  // Zonder dit springt "terug" naar de VORIGE PAGINA achter de dialoog langs: het scherm waar de
  // ondernemer net iets over wilde melden is dan weg, inclusief zijn scrollpositie — en zijn half
  // getypte bericht ook. Op precies de knop die er is voor het moment dat er al iets misging.
  useCloseOnBack(open, close)

  function pickImage(file: File | null) {
    setResult(null)
    if (!file) { setImageName(null); setImageData(null); return }
    // [FEEDBACK] Dezelfde grens als de server, hier alleen om er meteen iets over te kunnen zeggen.
    // De server beslist — dit scherm mag geen tweede waarheid worden over wat mag.
    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) {
      setResult({ ok: false, text: t('fb.teGroot') })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setImageName(file.name)
      setImageData(typeof reader.result === 'string' ? reader.result : null)
    }
    // Stil falen zou hier betekenen: de ondernemer denkt dat de foto meegaat en dat is niet zo.
    reader.onerror = () => setResult({ ok: false, text: t('fb.nietLezen') })
    reader.readAsDataURL(file)
  }

  async function send() {
    if (sending || message.trim().length < 4) return
    setSending(true); setResult(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, path: pathname, image: imageData }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok) {
        setResult({ ok: true, text: typeof json?.message === 'string' ? json.message : t('fb.bedankt') })
        // Alleen het bericht wissen als het ECHT weg is. Zie de kop.
        setMessage(''); setImageName(null); setImageData(null)
        if (fileRef.current) fileRef.current.value = ''
      } else {
        setResult({
          ok: false,
          text: failureText(res.status, json, t('fb.mislukt')),
        })
      }
    } catch {
      setResult({ ok: false, text: t('fb.mislukt') })
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={t('fb.aria')}
        style={{
          position: 'fixed', insetInlineEnd: 16,
          // [FEEDBACK] Boven de BottomNav én boven de paginaknop. De vaste 88px botste
          // op mobiel exact met de upload-/plus-FAB: die staat op
          // 24px + var(--bottom-nav-h) = 24 + 64 = 88px, ook rechts — twee knoppen op
          // dezelfde plek (zichtbaar als een blauwe cirkel half achter deze witte).
          // 24px onderrand + 56px FAB + 12px lucht = 92px boven de balk.
          bottom: 'calc(92px + var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px))',
          zIndex: 40, width: 44, height: 44, borderRadius: 9999,
          border: '1px solid #dadce0', background: '#fff', color: '#5f6368',
          boxShadow: '0 2px 10px rgba(0,0,0,0.12)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>flag</span>
      </button>
    )
  }

  const tooShort = message.trim().length < 4

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('fb.titel')}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(32,33,36,0.45)',
        // [FEEDBACK-MIDDEN] A centred dialog, not a sheet glued to the bottom edge. The owner
        // asked for that, and the bottom edge was the worse place anyway: on a phone the
        // BottomNav (z-index 2000, ABOVE this overlay) sits exactly there, and this panel has
        // already once lost its send button behind that bar — see [FEEDBACK-SEND] below.
        //
        // The bar is kept clear HERE, on the overlay: its bottom padding is the same helper every
        // bottom sheet uses, so the box the panel is centred in ends where the bar begins. The
        // panel is capped at 100% of that box, so nothing inside it can reach behind the bar
        // however long the message gets.
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
        padding: 16, paddingBottom: sheetPaddingBottom(16),
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="sheet-scroll" style={{
        background: '#fff', width: '100%', maxWidth: 520, borderRadius: 16, padding: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
        // [FEEDBACK-SEND] The measured history of this panel's bottom edge. As a bottom sheet it
        // ended 48px BEHIND the BottomNav on mobile: the send button was drawn, and a tap on it
        // reached the bar and opened Bestanden instead (393x830: button ended at 814px, bar
        // started at 766px, elementFromPoint at the button's centre returned the bar). On this
        // panel that is the most expensive bug available — whoever opens it has already watched
        // something break, types it up, and then cannot send it, so we never hear about it.
        //
        // The reservation moved to the overlay above; what is left here is the ceiling. 100% of
        // the overlay's padded box rather than the class's 88dvh: the class does not know the bar
        // exists, and a flex item taller than the box it is centred in loses its TOP edge — the
        // title and the close button — off the screen. The overlay is position: fixed, so where
        // the viewport shrinks for the keyboard the box shrinks with it and the panel scrolls
        // inside; where it does not (iOS), the keyboard covers the lower part exactly as it
        // covered the old sheet, and the panel scrolls the same way.
        maxHeight: '100%', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong style={{ fontSize: 15, color: '#202124' }}>{t('fb.titel')}</strong>
          <button
            onClick={close}
            style={{ background: 'none', border: 'none', color: '#5f6368', fontSize: 13, cursor: 'pointer' }}
          >
            {t('fb.sluit')}
          </button>
        </div>

        <p style={{ fontSize: 12.5, color: '#5f6368', margin: '0 0 10px', lineHeight: 1.5 }}>
          {t('fb.uitleg')}
          {pathname && <> {t('fb.padMee', { path: pathname })}</>}
        </p>

        <textarea
          value={message}
          onChange={(e) => { setMessage(e.target.value.slice(0, FEEDBACK_MAX_CHARS)); setResult(null) }}
          placeholder={t('fb.voorbeeld')}
          rows={5}
          style={{
            width: '100%', boxSizing: 'border-box', border: '1px solid #E0E0E0', borderRadius: 10,
            padding: 10, fontSize: 15, fontFamily: FONT, color: '#202124', resize: 'vertical', outline: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
            style={{ display: 'none' }}
            id="feedback-image"
          />
          <label
            htmlFor="feedback-image"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500,
              color: '#0B57D0', border: '1px solid #dadce0', borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>image</span>
            {imageName ? t('fb.andereAfbeelding') : t('fb.afbeeldingToevoegen')}
          </label>
          {imageName && (
            <span style={{ fontSize: 12, color: '#5f6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {imageName}
            </span>
          )}
        </div>

        {result && (
          <div style={{
            marginTop: 10, fontSize: 12.5, lineHeight: 1.5, borderRadius: 8, padding: '8px 10px',
            background: result.ok ? '#E6F4EA' : '#FFF3E0', color: result.ok ? '#137333' : '#7A4B00',
          }}>
            {result.text}
          </div>
        )}

        <button
          onClick={() => void send()}
          disabled={sending || tooShort}
          style={{
            marginTop: 12, width: '100%', minHeight: 44, borderRadius: 10, border: 'none',
            background: sending || tooShort ? '#dadce0' : '#0B57D0', color: '#fff',
            fontSize: 14, fontWeight: 600, fontFamily: FONT,
            cursor: sending || tooShort ? 'default' : 'pointer',
          }}
        >
          {sending ? t('fb.versturenBezig') : t('fb.versturen')}
        </button>
      </div>
    </div>
  )
}
