'use client'

// src/components/settings/VakCard.tsx
// [VAK-KIEZEN] The owner's trade, chosen or changed from Instellingen.
//
// The trade used to be set in exactly two places: the querystring of a public door
// (/voor-garage → /register?vak=automonteur) and the onboarding wizard. An account that skipped
// the wizard, or registered before the doors existed, had no way to say what it does — and the
// work layer (werk.ts) hangs on precisely that answer. This card is the third door and the only
// one that is always open.
//
// The rule from vak-profile.ts holds unchanged: a trade is an OFFER, never a filter. Choosing
// "automonteur" adds the Werkorders screen to the bar and offers the garage's lines; it locks
// nothing, and choosing "geen" takes the screen away again and touches no row of work — the
// werkorders keep their vak on the row (work_items.vak) and come back the moment the trade does.
//
// Written straight to profiles.vak on the session client, the same way LanguageCard writes
// preferred_language: RLS allows an owner to update their own profile row, and there is nothing
// to validate that parseVak does not already do. Then router.refresh(): the bar is drawn by the
// server layout, which reads the trade once per request.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { parseVak } from '@/lib/vak-profile'
import { vakOpties } from '@/lib/vak-sjablonen'
import { hasWorkLayer, workSkin } from '@/lib/werk'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

export function VakCard() {
  // The skin's plural is a key the catalogue holds but the type cannot narrow (it is data in werk.ts).
  const t = translator(useLocale()) as unknown as (key: string, vars?: Record<string, string | number>) => string
  const router = useRouter()
  const [vak, setVak] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<'saved' | 'failed' | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).from('profiles').select('vak').eq('id', user.id).maybeSingle()
        if (!cancelled) setVak(parseVak((data as { vak?: string | null } | null)?.vak) ?? '')
      } catch {
        /* [DEPLOY-SAFE] no column yet → the select stays on "geen", which is true */
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [])

  async function kies(next: string) {
    const slug = parseVak(next)
    const before = vak
    setVak(slug ?? '')
    setBusy(true); setNote(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setVak(before); setNote('failed'); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('profiles').update({ vak: slug }).eq('id', user.id)
      // The select shows what the account HAS, so a failed write puts the old trade back.
      if (error) { setVak(before); setNote('failed'); return }
      setNote('saved')
      router.refresh()
    } catch {
      setVak(before); setNote('failed')
    } finally {
      setBusy(false)
    }
  }

  return <VakCardView vak={vak} loaded={loaded} busy={busy} note={note} onChoose={(v) => { void kies(v) }} t={t} />
}

/** The card as drawn — no hooks, so the render line can hand it a state and read the result. */
export function VakCardView({ vak, loaded, busy, note, onChoose, t }: { vak: string; loaded: boolean; busy: boolean; note: 'saved' | 'failed' | null; onChoose: (v: string) => void; t: (key: string, vars?: Record<string, string | number>) => string }) {
  const skin = workSkin(vak)
  return (
    <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="vak-card">
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#202124', margin: 0 }}>{t('inst.vak.kop')}</h2>
        <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.6, margin: '6px 0 0' }}>{t('inst.vak.uitleg')}</p>
      </div>
      <select
        value={vak}
        disabled={!loaded || busy}
        aria-label={t('inst.vak.kop')}
        onChange={(e) => onChoose(e.target.value)}
        style={{ minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid #DADCE0', background: 'white', color: '#202124', fontSize: 15 }}
      >
        <option value="">{t('inst.vak.geen')}</option>
        {vakOpties().map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
      </select>
      {hasWorkLayer(vak) && skin && (
        <p style={{ fontSize: 13, color: '#137333', margin: 0 }}>{t('inst.vak.werklaag', { plural: t(skin.pluralKey) })}</p>
      )}
      {note === 'saved' && <p role="status" style={{ fontSize: 13, color: '#137333', margin: 0 }}>{t('inst.vak.opgeslagen')}</p>}
      {note === 'failed' && <p role="alert" style={{ fontSize: 13, color: '#B3261E', margin: 0 }}>{t('inst.vak.mislukt')}</p>}
    </div>
  )
}
