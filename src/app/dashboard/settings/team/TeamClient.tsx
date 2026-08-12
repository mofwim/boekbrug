'use client'

// [ACTING-FOR] Uitnodigen en intrekken. Bewust saai: één veld, één knop, en een lijst waarin je
// per persoon kunt zien sinds wanneer hij mag factureren.

import { useCallback, useEffect, useState } from 'react'
import { FONT, M3, R } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

interface Lid {
  id: string
  naam: string
  email: string | null
  sinds: string
  ingetrokken: string | null
}
interface Uitnodiging {
  id: string
  email: string
  created_at: string
  expires_at: string
}

const datum = (s: string) => {
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('nl-NL') : '—'
}

export default function TeamClient() {
  const t = translator(useLocale())
  const [leden, setLeden] = useState<Lid[]>([])
  const [open, setOpen] = useState<Uitnodiging[]>([])
  const [email, setEmail] = useState('')
  const [bezig, setBezig] = useState(false)
  const [laden, setLaden] = useState(true)
  // null = nog niet geladen. false = de migratie staat nog open; dan is "geen team" een
  // ANDERE mededeling dan "niemand uitgenodigd", en die twee mogen niet op elkaar lijken.
  const [beschikbaar, setBeschikbaar] = useState<boolean | null>(null)
  const [fout, setFout] = useState('')
  const [gelukt, setGelukt] = useState('')

  // Ophalen zonder setState — die hoort bij de aanroeper. Zo blijft het effect hieronder vrij
  // van een synchrone setState (react-hooks/set-state-in-effect), en kan hetzelfde ophalen
  // worden hergebruikt door de knoppen.
  const haal = useCallback(async (): Promise<
    { ok: true; leden: Lid[]; open: Uitnodiging[]; beschikbaar: boolean } | { ok: false; fout: string }
  > => {
    try {
      const res = await fetch('/api/company/members')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Meestal: de migratie staat er nog niet. Dat is iets anders dan "je hebt geen team",
        // en die twee moeten niet op elkaar lijken.
        return { ok: false, fout: json?.error || 'Kon het team niet laden' }
      }
      return { ok: true, leden: json.leden ?? [], open: json.uitnodigingen ?? [], beschikbaar: json.beschikbaar !== false }
    } catch {
      return { ok: false, fout: 'Kon het team niet laden' }
    }
  }, [])

  const toon = useCallback((r: Awaited<ReturnType<typeof haal>>) => {
    if (r.ok) { setLeden(r.leden); setOpen(r.open); setBeschikbaar(r.beschikbaar) } else { setFout(r.fout) }
    setLaden(false)
  }, [])

  useEffect(() => {
    // `levend` voorkomt een setState nadat het scherm alweer weg is — de gebruiker die meteen
    // terugtikt hoort geen React-waarschuwing te veroorzaken.
    let levend = true
    haal().then((r) => { if (levend) toon(r) })
    return () => { levend = false }
  }, [haal, toon])

  const laad = useCallback(async () => { toon(await haal()) }, [haal, toon])

  async function nodigUit(e: React.FormEvent) {
    e.preventDefault()
    setBezig(true); setFout(''); setGelukt('')
    try {
      const res = await fetch('/api/company/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFout(json?.error || 'Uitnodigen mislukt'); return }
      setGelukt(`Uitnodiging verstuurd naar ${email}`)
      setEmail('')
      await laad()
    } catch {
      setFout('Uitnodigen mislukt')
    } finally {
      setBezig(false)
    }
  }

  async function trekIn(payload: { memberRowId?: string; inviteId?: string }) {
    setFout(''); setGelukt('')
    try {
      const res = await fetch('/api/company/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { setFout('Intrekken mislukt'); return }
      await laad()
    } catch {
      setFout('Intrekken mislukt')
    }
  }

  const kaart: React.CSSProperties = {
    background: M3.surface, border: `1px solid ${M3.hairline}`,
    borderRadius: R.lg, padding: 20, marginBottom: 16,
  }

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 48px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>{t('team.titel')}</h1>
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 20px', lineHeight: 1.6 }}>
          Iemand die je hier toevoegt kan verkoopfacturen maken en versturen die uitgaan op
          jouw naam en BTW-nummer, met jouw doorlopende factuurnummers. Hij ziet <strong>alleen
          wat hij zelf aanmaakt</strong> — niet je bank, niet je omzet, niet je andere facturen.
        </p>

        {fout && (
          <p style={{ fontSize: 14, color: M3.error, background: M3.errorContainer, padding: '10px 12px', borderRadius: R.sm, lineHeight: 1.5 }}>{fout}</p>
        )}
        {gelukt && (
          <p style={{ fontSize: 14, color: M3.success, background: M3.successContainer, padding: '10px 12px', borderRadius: R.sm, lineHeight: 1.5 }}>{gelukt}</p>
        )}

        {beschikbaar === false && (
          /* Eerlijk over de toestand in plaats van een leeg team plus een knop die niet kan
             werken. De eigenaar kan hier zelf iets aan doen, dus staat er wat hij moet doen. */
          <div style={{ ...kaart, borderColor: M3.warning, background: M3.warnContainer }}>
            <p style={{ fontSize: 14.5, color: M3.onSurface, margin: 0, lineHeight: 1.6 }}>
              <strong>{t('team.nietAan')}</strong> De databasemigratie
              <code style={{ fontSize: 13 }}> company_members_sales_role.sql </code>
              moet nog worden toegepast. Zolang dat niet is gebeurd kun je niemand uitnodigen —
              en verandert er verder niets: je facturen, je bank en je aangifte werken gewoon door.
            </p>
          </div>
        )}

        {beschikbaar !== false && (
        <form onSubmit={nodigUit} style={kaart}>
          <label htmlFor="team-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: M3.onSurfaceVariant, marginBottom: 8 }}>
            {t('team.email')}
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              id="team-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="naam@voorbeeld.nl"
              style={{
                flex: '1 1 220px', minWidth: 0, padding: '11px 13px', fontSize: 15,
                border: `1px solid ${M3.outlineVariant}`, borderRadius: R.md, fontFamily: FONT,
              }}
            />
            <button
              type="submit"
              disabled={bezig}
              style={{
                background: bezig ? M3.outline : M3.primary, color: M3.onPrimary, border: 'none',
                padding: '11px 22px', borderRadius: R.md, fontSize: 15, fontWeight: 600,
                cursor: bezig ? 'default' : 'pointer', fontFamily: FONT,
              }}
            >
              {bezig ? 'Bezig…' : 'Uitnodigen'}
            </button>
          </div>
          <p style={{ fontSize: 12.5, color: M3.mutedText, margin: '10px 0 0', lineHeight: 1.6 }}>
            Hij krijgt een e-mail met wat hij aanneemt. Accepteren kan alleen met dít adres — een
            doorgestuurde link werkt niet. De uitnodiging verloopt na 14 dagen.
          </p>
        </form>
        )}

        {laden || beschikbaar === false ? null : (
          <>
            {open.length > 0 && (
              <div style={kaart}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, margin: '0 0 12px' }}>
                  {t('team.nietGeaccepteerd')}
                </h2>
                {open.map((u) => (
                  <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
                      <div style={{ fontSize: 12.5, color: M3.mutedText }}>verloopt {datum(u.expires_at)}</div>
                    </div>
                    <button
                      onClick={() => trekIn({ inviteId: u.id })}
                      style={{ background: 'none', border: `1px solid ${M3.outlineVariant}`, color: M3.neutral, padding: '7px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}
                    >
                      {t('team.intrekken')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={kaart}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, margin: '0 0 12px' }}>
                {t('team.magFactureren')}
              </h2>
              {leden.filter((l) => !l.ingetrokken).length === 0 ? (
                <p style={{ fontSize: 14, color: M3.neutral, margin: 0, lineHeight: 1.6 }}>
                  {t('team.niemand')}
                </p>
              ) : (
                leden.filter((l) => !l.ingetrokken).map((l) => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface }}>{l.naam}</div>
                      <div style={{ fontSize: 12.5, color: M3.mutedText }}>
                        {l.email ? `${l.email} · ` : ''}sinds {datum(l.sinds)}
                      </div>
                    </div>
                    <button
                      onClick={() => trekIn({ memberRowId: l.id })}
                      style={{ background: 'none', border: `1px solid ${M3.error}`, color: M3.error, padding: '7px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}
                    >
                      {t('team.intrekken')}
                    </button>
                  </div>
                ))
              )}
            </div>

            {leden.some((l) => l.ingetrokken) && (
              <div style={kaart}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>{t('team.eerder')}</h2>
                {/* Ingetrokken leden blijven staan, en dat is geen slordigheid: de facturen die
                    zij maakten bestaan nog en moeten toewijsbaar blijven aan een mens. */}
                <p style={{ fontSize: 12.5, color: M3.mutedText, margin: '0 0 10px', lineHeight: 1.6 }}>
                  Deze mensen kunnen niets meer. Ze blijven in de lijst staan omdat de facturen die
                  ze maakten nog bestaan en op naam moeten blijven.
                </p>
                {leden.filter((l) => l.ingetrokken).map((l) => (
                  <div key={l.id} style={{ fontSize: 14, color: M3.neutral, padding: '5px 0' }}>
                    {l.naam} — ingetrokken op {datum(l.ingetrokken!)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <p style={{ fontSize: 12.5, color: M3.mutedText, lineHeight: 1.6, marginTop: 4 }}>
          Intrekken werkt onmiddellijk: bij zijn volgende klik kan hij niets meer. Facturen die hij
          al verstuurde blijven staan — die hebben een wettelijk nummer en horen bij je boekhouding.
        </p>
      </div>
    </div>
  )
}
