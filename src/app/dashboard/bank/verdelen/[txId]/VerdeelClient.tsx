'use client'

// src/app/dashboard/bank/verdelen/[txId]/VerdeelClient.tsx
// [BETAALPLAN] Eén betaling, meerdere facturen, een bedrag per factuur — het scherm.
//
// WAT DIT OPLOST
// De bank kende maar één vorm van koppelen: deze betaling hoort bij DIE factuur, helemaal. De
// werkelijkheid van een winkel is anders. Een groothandel schrijft één bedrag af voor een week
// leveringen. Een klant maakt één som over voor vier facturen en houdt op de laatste €12 in. Een
// leverancier trekt een creditnota van de partij af voordat hij betaalt. Geen van die drie kon
// worden opgeschreven, dus werden ze opgelost door iets anders in te vullen dan wat er gebeurde.
//
// DE ENIGE ZIN DIE ER ECHT TOE DOET STAAT BOVENAAN
// "Nog te verdelen". Zolang dat getal niet nul is, is de betaling niet uitgelegd. Dat is de hele
// controle, en hij hoort in beeld te staan terwijl je typt — niet als foutmelding achteraf.
//
// EN WAT DIT SCHERM NIET DOET
// Beslissen wat een restant betekent. €12 die overblijft kan een bankkost zijn, een betaalkorting,
// of een factuur die er nog niet in staat. Die hebben alle drie een ander goed antwoord, en de app
// weet niet welke. Het bedrag wordt genoemd; de reden blijft van de ondernemer.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, R, EL1, COLUMN } from '@/lib/design/tokens'
import { resolvePaymentPlan, type PlanInvoice } from '@/lib/payment-plan'
import { formatEuroNL, formatDateNL } from '@/lib/format-nl'
import { round2 } from '@/lib/invoice-totals'

export interface VerdeelTransactie {
  id: string
  amount: number
  date: string | null
  description: string | null
  counterpartName: string | null
  /** Wat eerdere koppelingen al van deze regel hebben afgenomen. */
  alreadyAllocated: number
}

export interface VerdeelFactuur extends PlanInvoice {
  invoiceNumber: string | null
  partyName: string | null
  invoiceDate: string | null
  /** Wat er nog openstaat, als positief bedrag. Door de server berekend. */
  open: number
}

interface Props {
  transactie: VerdeelTransactie
  /** Alleen facturen in de JUISTE richting en met een openstaand bedrag. */
  facturen: VerdeelFactuur[]
}

export default function VerdeelClient({ transactie, facturen }: Props) {
  const router = useRouter()
  // invoiceId → wat de eigenaar heeft ingetypt. Afwezig = niet gekozen.
  const [bedragen, setBedragen] = useState<Record<string, string>>({})
  const [zoek, setZoek] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<string | null>(null)

  const geld = Math.abs(transactie.amount)
  const beschikbaar = Math.max(0, geld - Math.abs(transactie.alreadyAllocated))
  // [BETAALPLAN] Deze betaling is al helemaal verdeeld.
  //
  // Zonder deze regel opende het scherm gewoon: een lijst facturen, invulvelden, een knop — en elk
  // plan dat je maakte werd geweigerd met "je verdeelt X terwijl deze betaling nog € 0,00 te
  // vergeven heeft". Dat is waar, en het is het antwoord op de verkeerde vraag: je hebt niets fout
  // gedaan, er is hier niets meer te doen. Een doodlopende weg die pas na het typen zichtbaar wordt
  // is erger dan een dichte deur, want je bent er al doorheen gelopen.
  const helemaalVerdeeld = beschikbaar <= 0.005

  const regels = useMemo(
    () =>
      Object.entries(bedragen)
        .filter(([, v]) => v.trim() !== '')
        .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v.replace(',', '.')) })),
    [bedragen],
  )

  // [BETAALPLAN] Exact dezelfde functie die de server gebruikt om te weigeren. Eén rekensom, twee
  // plekken — anders zegt het scherm "kan" waar de server "kan niet" zegt, en dat is de fout die
  // een eigenaar op zijn duurste moment tegenkomt.
  const plan = useMemo(
    () =>
      resolvePaymentPlan({
        txAmount: transactie.amount,
        alreadyAllocated: transactie.alreadyAllocated,
        lines: regels,
        invoices: facturen,
      }),
    [regels, facturen, transactie],
  )

  const verdeeld = plan.ok ? plan.allocated : regels.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0)
  const restant = round2(beschikbaar - verdeeld)

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    if (!q) return facturen
    return facturen.filter(
      (f) =>
        (f.partyName ?? '').toLowerCase().includes(q) ||
        (f.invoiceNumber ?? '').toLowerCase().includes(q),
    )
  }, [facturen, zoek])

  function zetHeleBedrag(f: VerdeelFactuur) {
    setBedragen((b) => {
      const next = { ...b }
      if (next[f.id] != null) delete next[f.id]
      else next[f.id] = f.open.toFixed(2)
      return next
    })
  }

  async function boek() {
    if (!plan.ok) return
    setBezig(true)
    setFout(null)
    try {
      const res = await fetch('/api/bank/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: transactie.id, lines: regels }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'De verdeling is niet geboekt.')
      setKlaar(
        data.remainderNote ??
          `${data.applied?.length ?? regels.length} ${(data.applied?.length ?? regels.length) === 1 ? 'factuur' : 'facturen'} afgeboekt.`,
      )
      setTimeout(() => router.push('/dashboard/bank'), 1400)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Er ging iets mis.')
    } finally {
      setBezig(false)
    }
  }

  if (helemaalVerdeeld) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Betaling verdelen
        </h1>
        <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: R.lg, boxShadow: EL1, padding: 20 }}>
          <p style={{ margin: '0 0 12px', color: M3.onSurface, lineHeight: 1.6 }}>
            Deze betaling van {formatEuroNL(geld)} is al helemaal verdeeld over facturen.
          </p>
          <p style={{ margin: '0 0 16px', color: M3.onSurfaceVariant, fontSize: 14.5, lineHeight: 1.6 }}>
            Er valt hier niets meer toe te wijzen. Klopt de verdeling niet, ontkoppel dan eerst een
            factuur op de bankpagina — dan komt dat bedrag hier weer vrij.
          </p>
          <a
            href="/dashboard/bank"
            style={{
              display: 'inline-block', padding: '10px 20px', borderRadius: R.full,
              background: M3.primary, color: M3.onPrimary, textDecoration: 'none', fontSize: 15, fontWeight: 500,
            }}
          >
            Terug naar de bank
          </a>
        </div>
      </main>
    )
  }

  const kaart: React.CSSProperties = {
    background: M3.surface,
    border: `1px solid ${M3.outlineVariant}`,
    borderRadius: R.lg,
    boxShadow: EL1,
    padding: 18,
    marginBottom: 14,
  }

  const isUit = transactie.amount < 0

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        Betaling verdelen
      </h1>
      <p style={{ margin: '0 0 16px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        {isUit ? 'Geld dat wegging' : 'Geld dat binnenkwam'} — kies welke facturen hiermee betaald zijn.
      </p>

      {/* ── De betaling zelf ─────────────────────────────────────────── */}
      <section style={kaart}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15.5, fontWeight: 500, color: M3.onSurface }}>
              {transactie.counterpartName || 'Onbekende tegenpartij'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: M3.onSurfaceVariant }}>
              {formatDateNL(transactie.date)} · {transactie.description || 'geen omschrijving'}
            </p>
          </div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: M3.onSurface, flexShrink: 0 }}>
            {formatEuroNL(geld)}
          </p>
        </div>

        {/* [BETAALPLAN] Het enige getal dat er echt toe doet, in beeld terwijl je typt. */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${M3.outlineVariant}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span style={{ fontSize: 14, color: M3.onSurfaceVariant }}>Nog te verdelen</span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: Math.abs(restant) < 0.005 ? M3.success : restant < 0 ? M3.error : M3.onSurface,
            }}
          >
            {formatEuroNL(restant)}
          </span>
        </div>
        {transactie.alreadyAllocated > 0.005 && (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: M3.mutedText }}>
            {formatEuroNL(transactie.alreadyAllocated)} van deze betaling was al gekoppeld.
          </p>
        )}
      </section>

      {/* ── Wat er misgaat, terwijl je typt ──────────────────────────── */}
      {!plan.ok && regels.length > 0 && (
        <p
          role="alert"
          style={{
            ...kaart,
            marginBottom: 14,
            background: M3.errorContainer,
            color: M3.error,
            fontSize: 13.5,
            lineHeight: 1.55,
          }}
        >
          {plan.message}
        </p>
      )}
      {plan.ok && plan.remainderNote && (
        <p style={{ ...kaart, background: M3.warningContainer, color: M3.warning, fontSize: 13.5, lineHeight: 1.55 }}>
          {plan.remainderNote}
        </p>
      )}

      {/* ── De facturen ──────────────────────────────────────────────── */}
      <input
        value={zoek}
        onChange={(e) => setZoek(e.target.value)}
        placeholder="Zoek op leverancier of factuurnummer…"
        aria-label="Facturen zoeken"
        style={{
          width: '100%',
          padding: '10px 12px',
          marginBottom: 12,
          border: `1px solid ${M3.outline}`,
          borderRadius: R.sm,
          fontSize: 14.5,
          boxSizing: 'border-box',
        }}
      />

      {zichtbaar.length === 0 ? (
        <p style={{ ...kaart, color: M3.onSurfaceVariant, fontSize: 14.5, lineHeight: 1.6 }}>
          {facturen.length === 0
            ? `Er staat geen enkele ${isUit ? 'inkoopfactuur' : 'verkoopfactuur'} open. Staat de factuur er nog niet in, voeg hem dan eerst toe — deze betaling blijft zolang gewoon staan.`
            : 'Geen factuur die daaraan voldoet.'}
        </p>
      ) : (
        zichtbaar.map((f) => {
          const gekozen = bedragen[f.id] != null
          const isCredit = (f.invoiceType ?? 'factuur') === 'creditnota' || (f.totalIncBtw ?? 0) < 0
          return (
            <section key={f.id} style={{ ...kaart, padding: 14, borderColor: gekozen ? M3.primary : M3.outlineVariant }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={gekozen}
                  onChange={() => zetHeleBedrag(f)}
                  aria-label={`${f.partyName ?? 'factuur'} kiezen`}
                  style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, color: M3.onSurface, fontWeight: 500 }}>
                    {f.partyName || 'Onbekend'}
                    {isCredit && (
                      <span style={{ color: M3.success, fontWeight: 600, marginInlineStart: 8, fontSize: 12.5 }}>
                        creditnota — gaat eraf
                      </span>
                    )}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: M3.onSurfaceVariant }}>
                    {f.invoiceNumber || 'zonder nummer'} · {formatDateNL(f.invoiceDate)} · nog open{' '}
                    {formatEuroNL(f.open)}
                  </p>
                </div>

                {/* Het bedrag PER factuur. Voorgevuld met het hele openstaande bedrag, want dat is
                    negen van de tien keer het antwoord — en overschrijfbaar, want de tiende keer
                    is precies waarom dit scherm bestaat. */}
                {gekozen && (
                  <div style={{ flexShrink: 0, textAlign: 'end' }}>
                    <input
                      value={bedragen[f.id]}
                      onChange={(e) => setBedragen((b) => ({ ...b, [f.id]: e.target.value }))}
                      inputMode="decimal"
                      aria-label={`Bedrag voor ${f.partyName ?? 'deze factuur'}`}
                      style={{
                        width: 110,
                        padding: '8px 10px',
                        border: `1px solid ${M3.outline}`,
                        borderRadius: R.sm,
                        fontSize: 14.5,
                        textAlign: 'end',
                        boxSizing: 'border-box',
                      }}
                    />
                    {Number(bedragen[f.id].replace(',', '.')) < f.open - 0.005 && (
                      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: M3.mutedText }}>
                        blijft {formatEuroNL(f.open - (Number(bedragen[f.id].replace(',', '.')) || 0))} open
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })
      )}

      {/* ── Boeken ───────────────────────────────────────────────────── */}
      {fout && (
        <p role="alert" style={{ ...kaart, background: M3.errorContainer, color: M3.error, fontSize: 13.5 }}>
          {fout}
        </p>
      )}
      {klaar && (
        <p style={{ ...kaart, background: M3.successContainer, color: M3.success, fontSize: 13.5 }}>{klaar}</p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={boek}
          disabled={!plan.ok || bezig || Boolean(klaar)}
          style={{
            padding: '11px 22px',
            background: plan.ok && !bezig && !klaar ? M3.primary : M3.surfaceVariant,
            color: plan.ok && !bezig && !klaar ? M3.onPrimary : M3.mutedText,
            border: 'none',
            borderRadius: R.full,
            fontSize: 15,
            fontWeight: 500,
            cursor: plan.ok && !bezig && !klaar ? 'pointer' : 'default',
          }}
        >
          {bezig ? 'Bezig…' : klaar ? 'Geboekt' : `Boek ${regels.length || 0} ${regels.length === 1 ? 'factuur' : 'facturen'}`}
        </button>
        <a
          href="/dashboard/bank"
          style={{
            padding: '11px 20px',
            border: `1px solid ${M3.outline}`,
            borderRadius: R.full,
            fontSize: 15,
            color: M3.onSurfaceVariant,
            textDecoration: 'none',
          }}
        >
          Terug
        </a>
      </div>

      <p style={{ fontSize: 12.5, color: M3.mutedText, lineHeight: 1.6, margin: '16px 0 0' }}>
        Een factuur die maar deels betaald is, blijft voor de rest openstaan — er wordt niets
        weggeschreven. Wat er van de betaling overblijft blijft ook staan; ontkoppelen kan altijd.
      </p>
    </main>
  )
}
