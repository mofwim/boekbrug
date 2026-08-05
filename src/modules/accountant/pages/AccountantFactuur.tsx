'use client'

// src/modules/accountant/pages/AccountantFactuur.tsx
// [MANDAAT] Factureren namens een klant — het scherm.
//
// WAT DIT SCHERM IS, EN VOORAL WAT HET NIET IS
// Het is niet /dashboard/invoice/new voor iemand anders. Dat scherm is van de ondernemer: het kent
// zijn artikelen, zijn sjablonen, zijn laatste klanten. Dit scherm doet één ding — een factuur op
// naam van een klant de deur uit — en toont bij elke stap van WIE die factuur is. Dat is geen
// versobering maar het hele punt: de boekhouder moet nooit even vergeten in wiens boeken hij zit.
//
// DE DRIE ZINNEN DIE HIER NIET WEG MOGEN
// Art. 35 lid 1 Wet OB staat toe dat een derde de factuur uitreikt "in zijn naam en voor zijn
// rekening". Art. 35a verplaatst de verantwoordelijkheid daarbij NIET: de ondernemer blijft
// aansprakelijk. Daarom staat op dit scherm altijd, in gewoon Nederlands:
//   1. deze factuur komt op naam van <klant>, in zijn nummerreeks;
//   2. hij krijgt er bericht van zodra hij verstuurd is;
//   3. hij kan de machtiging op elk moment zelf intrekken.
// Een knop die dit weglaat verkoopt de boekhouder een bevoegdheid die hij niet heeft.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, R, EL1, COLUMN } from '@/lib/design/tokens'
import { UNITS, DEFAULT_UNIT_CODE, unitLabel } from '@/lib/units'
import VraagMachtiging, { type KoppelKlant } from './VraagMachtiging'

/** Eén klant die deze boekhouder gemachtigd heeft. */
export interface GemachtigdeKlant {
  id: string
  naam: string
  btwNummer: string | null
}

interface Regel {
  description: string
  quantity: string
  unit_price: string
  btw_rate: number
  unit: string
}

interface Props {
  klanten: GemachtigdeKlant[]
  /** [VRAAG-MACHTIGING] De GEKOPPELDE klanten — om te kunnen vragen wat er nog niet is. */
  gekoppeld?: KoppelKlant[]
}

const BTW_TARIEVEN = [21, 9, 0] as const

const legeRegel = (): Regel => ({
  description: '',
  quantity: '1',
  unit_price: '',
  btw_rate: 21,
  unit: DEFAULT_UNIT_CODE,
})

/** Een bedrag zoals een Nederlander het intikt: komma of punt, allebei goed. */
function naarGetal(v: string): number {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

function euro(n: number): string {
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AccountantFactuur({ klanten, gekoppeld = [] }: Props) {
  const router = useRouter()
  const [klantId, setKlantId] = useState<string>(klanten.length === 1 ? klanten[0].id : '')
  const [naam, setNaam] = useState('')
  const [email, setEmail] = useState('')
  const [adres, setAdres] = useState('')
  const [postcode, setPostcode] = useState('')
  const [plaats, setPlaats] = useState('')
  const [btwNummer, setBtwNummer] = useState('')
  const [factuurdatum, setFactuurdatum] = useState(() => new Date().toISOString().slice(0, 10))
  const [regels, setRegels] = useState<Regel[]>([legeRegel()])
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const klant = useMemo(() => klanten.find((k) => k.id === klantId) ?? null, [klanten, klantId])

  // Zelfde rekensom als draft-totals.ts, alleen om te TONEN. De server rekent hem opnieuw en die
  // uitkomst telt — een browser die zijn eigen totaal mag opsturen is precies wat /api/invoice/draft
  // heeft afgeschaft.
  const totalen = useMemo(() => {
    let ex = 0
    let btw = 0
    for (const r of regels) {
      const regelEx = naarGetal(r.quantity) * naarGetal(r.unit_price)
      ex += regelEx
      btw += (regelEx * r.btw_rate) / 100
    }
    return { ex, btw, inc: ex + btw }
  }, [regels])

  function pasRegelAan(i: number, veld: keyof Regel, waarde: string | number) {
    setRegels((oud) => oud.map((r, j) => (i === j ? { ...r, [veld]: waarde } : r)))
  }

  async function verstuur() {
    setFout(null)
    if (!klant) return setFout('Kies eerst voor welke klant je factureert.')
    if (!naam.trim()) return setFout('Vul in aan wie de factuur gericht is.')
    const bruikbaar = regels.filter((r) => r.description.trim() && naarGetal(r.unit_price) !== 0)
    if (bruikbaar.length === 0) return setFout('Vul minstens één regel in met een omschrijving en een bedrag.')

    setBezig(true)
    try {
      // Stap 1 — het concept. De server bepaalt de eigenaar; wij sturen alleen namens WIE.
      const concept = await fetch('/api/invoice/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namens_klant_id: klant.id,
          invoiceType: 'factuur',
          client_name: naam.trim(),
          client_email: email.trim() || null,
          client_address: adres.trim() || null,
          client_postal_code: postcode.trim() || null,
          client_city: plaats.trim() || null,
          client_btw_number: btwNummer.trim() || null,
          invoice_date: factuurdatum || null,
          lines: bruikbaar.map((r) => ({
            description: r.description.trim(),
            quantity: naarGetal(r.quantity),
            unit_price: naarGetal(r.unit_price),
            btw_rate: r.btw_rate,
            unit: r.unit,
          })),
        }),
      })
      const conceptData = await concept.json().catch(() => ({}))
      if (!concept.ok || !conceptData?.invoiceId) {
        throw new Error(conceptData?.error || 'Het concept kon niet worden aangemaakt.')
      }

      // Stap 2 — uitgeven. Hier valt het nummer uit de reeks van de KLANT (art. 35), krijgt hij
      // zijn melding, en gaat de mail naar de ontvanger.
      const verzonden = await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: conceptData.invoiceId, namens_klant_id: klant.id }),
      })
      const verzondenData = await verzonden.json().catch(() => ({}))
      if (!verzonden.ok) {
        throw new Error(
          verzondenData?.error ||
            'Het concept staat klaar, maar versturen lukte niet. Probeer het opnieuw vanaf de factuur zelf.',
        )
      }

      router.push(`/dashboard/invoice/${conceptData.invoiceId}`)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Er ging iets mis. Probeer het opnieuw.')
      setBezig(false)
    }
  }

  // ── Nog niemand heeft je gemachtigd ────────────────────────────────────────
  if (klanten.length === 0) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Factureren namens een klant
        </h1>
        <div
          style={{
            background: M3.surface,
            border: `1px solid ${M3.outlineVariant}`,
            borderRadius: R.lg,
            padding: 20,
            boxShadow: EL1,
          }}
        >
          <p style={{ margin: '0 0 12px', color: M3.onSurface, lineHeight: 1.6 }}>
            Nog geen enkele klant heeft je hiervoor gemachtigd.
          </p>
          <p style={{ margin: '0 0 12px', color: M3.onSurfaceVariant, lineHeight: 1.6, fontSize: 14.5 }}>
            Facturen maken namens iemand is iets anders dan zijn administratie inzien. Je klant zet
            het zelf aan bij <strong>Instellingen → Mijn boekhouder</strong>. Hij kan het daar ook
            weer uitzetten, wanneer hij wil.
          </p>
          <p style={{ margin: 0, color: M3.mutedText, lineHeight: 1.6, fontSize: 13.5 }}>
            De factuur komt daarna op zijn naam, in zijn nummerreeks en onder zijn BTW-nummer — hij
            blijft er zelf verantwoordelijk voor (art. 35a Wet OB). Daarom vraagt de app het hem, en
            niet jou.
          </p>
          <VraagMachtiging klanten={gekoppeld} kind="facturen" />
        </div>
      </main>
    )
  }

  const veld: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${M3.outline}`,
    borderRadius: R.sm,
    fontSize: 15,
    color: M3.onSurface,
    background: M3.surface,
    boxSizing: 'border-box',
  }
  const label: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    color: M3.onSurfaceVariant,
    marginBottom: 6,
  }

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        Factureren namens een klant
      </h1>
      <p style={{ margin: '0 0 20px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        De factuur gaat uit op naam van je klant, niet op die van jou.
      </p>

      {/* ── Namens wie ─────────────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
          marginBottom: 16,
        }}
      >
        <label style={label} htmlFor="namens">Namens welke klant?</label>
        <select
          id="namens"
          value={klantId}
          onChange={(e) => setKlantId(e.target.value)}
          style={veld}
        >
          <option value="">Kies een klant…</option>
          {klanten.map((k) => (
            <option key={k.id} value={k.id}>{k.naam}</option>
          ))}
        </select>

        {klant && (
          // De drie zinnen uit de kop van dit bestand. Ze staan hier ONDER de keuze, zodat ze
          // veranderen zodra de naam verandert — een waarschuwing die altijd hetzelfde zegt, leest
          // niemand meer na de tweede keer.
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              background: M3.primaryContainer,
              borderRadius: R.sm,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: M3.onPrimaryContainer,
            }}
          >
            Deze factuur komt op naam van <strong>{klant.naam}</strong>, met zijn nummerreeks
            {klant.btwNummer ? ` en BTW-nummer ${klant.btwNummer}` : ''}. Hij krijgt bericht zodra
            hij verstuurd is, en kan de machtiging op elk moment zelf intrekken.
          </div>
        )}
      </section>

      {/* ── Aan wie ────────────────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: '0 0 14px' }}>
          Aan wie stuurt {klant ? klant.naam : 'je klant'} deze factuur?
        </h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={label} htmlFor="ontvanger">Naam</label>
            <input id="ontvanger" style={veld} value={naam} onChange={(e) => setNaam(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="ontvanger-mail">E-mailadres</label>
            <input id="ontvanger-mail" type="email" style={veld} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="ontvanger-adres">Adres</label>
            <input id="ontvanger-adres" style={veld} value={adres} onChange={(e) => setAdres(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label style={label} htmlFor="ontvanger-pc">Postcode</label>
              <input id="ontvanger-pc" style={veld} value={postcode} onChange={(e) => setPostcode(e.target.value)} />
            </div>
            <div>
              <label style={label} htmlFor="ontvanger-plaats">Plaats</label>
              <input id="ontvanger-plaats" style={veld} value={plaats} onChange={(e) => setPlaats(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label} htmlFor="ontvanger-btw">BTW-nummer (optioneel)</label>
              <input id="ontvanger-btw" style={veld} value={btwNummer} onChange={(e) => setBtwNummer(e.target.value)} />
            </div>
            <div>
              <label style={label} htmlFor="factuurdatum">Factuurdatum</label>
              <input id="factuurdatum" type="date" style={veld} value={factuurdatum} onChange={(e) => setFactuurdatum(e.target.value)} />
            </div>
          </div>
        </div>
      </section>

      {/* ── De regels ──────────────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: '0 0 14px' }}>
          Wat is er geleverd?
        </h2>
        {regels.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gap: 10,
              paddingBottom: 14,
              marginBottom: 14,
              borderBottom: i === regels.length - 1 ? 'none' : `1px solid ${M3.outlineVariant}`,
            }}
          >
            <input
              style={veld}
              placeholder="Omschrijving"
              aria-label={`Omschrijving regel ${i + 1}`}
              value={r.description}
              onChange={(e) => pasRegelAan(i, 'description', e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              <input
                style={veld}
                inputMode="decimal"
                placeholder="Aantal"
                aria-label={`Aantal regel ${i + 1}`}
                value={r.quantity}
                onChange={(e) => pasRegelAan(i, 'quantity', e.target.value)}
              />
              <select
                style={veld}
                aria-label={`Eenheid regel ${i + 1}`}
                value={r.unit}
                onChange={(e) => pasRegelAan(i, 'unit', e.target.value)}
              >
                {UNITS.map((u) => (
                  <option key={u.code} value={u.name}>{unitLabel(u.name)}</option>
                ))}
              </select>
              <input
                style={veld}
                inputMode="decimal"
                placeholder="Prijs"
                aria-label={`Prijs regel ${i + 1}`}
                value={r.unit_price}
                onChange={(e) => pasRegelAan(i, 'unit_price', e.target.value)}
              />
              <select
                style={veld}
                aria-label={`BTW regel ${i + 1}`}
                value={r.btw_rate}
                onChange={(e) => pasRegelAan(i, 'btw_rate', Number(e.target.value))}
              >
                {BTW_TARIEVEN.map((t) => (
                  <option key={t} value={t}>{t}% BTW</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRegels((oud) => [...oud, legeRegel()])}
          style={{
            background: 'none',
            border: 'none',
            color: M3.primary,
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          + Regel erbij
        </button>
      </section>

      {/* ── Totaal en versturen ────────────────────────────────────────────── */}
      <section
        style={{
          background: M3.surface,
          border: `1px solid ${M3.outlineVariant}`,
          borderRadius: R.lg,
          padding: 20,
          boxShadow: EL1,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: M3.onSurfaceVariant }}>
          <span>Subtotaal</span><span>{euro(totalen.ex)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: M3.onSurfaceVariant, marginTop: 6 }}>
          <span>BTW</span><span>{euro(totalen.btw)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 17,
            fontWeight: 500,
            color: M3.onSurface,
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${M3.outlineVariant}`,
          }}
        >
          <span>Totaal</span><span>{euro(totalen.inc)}</span>
        </div>

        {fout && (
          <p
            role="alert"
            style={{
              marginTop: 16,
              padding: '10px 12px',
              background: M3.errorContainer,
              color: M3.error,
              borderRadius: R.sm,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {fout}
          </p>
        )}

        <button
          type="button"
          onClick={verstuur}
          disabled={bezig || !klant}
          style={{
            marginTop: 16,
            width: '100%',
            padding: '12px 16px',
            background: bezig || !klant ? M3.surfaceVariant : M3.primary,
            color: bezig || !klant ? M3.mutedText : M3.onPrimary,
            border: 'none',
            borderRadius: R.md,
            fontSize: 15,
            fontWeight: 500,
            cursor: bezig || !klant ? 'default' : 'pointer',
          }}
        >
          {bezig
            ? 'Bezig met versturen…'
            : klant
              ? `Verstuur namens ${klant.naam}`
              : 'Kies eerst een klant'}
        </button>
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: M3.mutedText, lineHeight: 1.5 }}>
          Versturen geeft het factuurnummer uit. Dat kan niet ongedaan gemaakt worden — een
          uitgegeven nummer blijft uitgegeven (art. 35 Wet OB). Corrigeren gaat met een creditnota.
        </p>
      </section>
    </main>
  )
}
