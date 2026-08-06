'use client'

// src/modules/accountant/pages/AccountantBevestigen.tsx
// [BEVESTIGEN] De stapel die het kwartaal tegenhoudt — en die de boekhouder nu zelf kan wegwerken.
//
// WAT DIT SCHERM OPLOST
// closing-package.ts sluit 'processing' uit ("unverified must not reach the accountant") en
// readiness.ts houdt "klaar" tegen zolang er onbevestigde stukken zijn. Bevestigen kon alleen de
// ondernemer. Het pakket dat VOOR de boekhouder is gebouwd, wachtte dus op werk van de partij die
// in de praktijk juist op zijn boekhouder leunt. Deze lijst is de andere kant van dat slot.
//
// EN WAT HET NADRUKKELIJK NIET DOET
// Bedragen wijzigen. Bevestigen is hier "deze lezing klopt, boek hem". Klopt hij niet, dan is de
// juiste handeling NIET corrigeren maar navragen — vandaar de knop naar /opvragen bij elke rij die
// de boekhouder niet vertrouwt. De ondernemer blijft aansprakelijk voor zijn administratie
// (art. 52 AWR); een derde die de cijfers mag herschrijven maakt die aansprakelijkheid fictie.
//
// DE ONDERNEMER BLIJFT DE BAAS OVER ZIJN EIGEN SCHERM
// Alles wat hier gebeurt kan hij ook zelf, op zijn eigen scherm, precies zoals altijd. Dit voegt
// een tweede paar handen toe; het neemt geen enkele knop bij hem weg. Wie alles zelf doet, merkt
// van deze hele pagina niets — hij zet de machtiging simpelweg niet aan.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, R, EL1, COLUMN, sheetPaddingBottom } from '@/lib/design/tokens'
// [BACK-CLOSES] De vraag-sheet hoort op de terugstapel: op een telefoon is 'terug' hoe je een
// overlay sluit, en zonder dit verlaat die tik de hele pagina — inclusief de plek in de stapel.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BULK-BEVESTIG] Wat samen bevestigd mag worden, en wat één voor één blijft — zie bulk-confirm.ts.
import {
  planBulkConfirm, bulkConfirmable, bulkConfirmTitle, bulkConfirmWarnings, bulkConfirmResultText,
} from '@/lib/bulk-confirm'
import VraagMachtiging, { type KoppelKlant } from './VraagMachtiging'

export interface TeBevestigen {
  id: string
  clientId: string
  clientNaam: string
  leverancier: string
  factuurnummer: string | null
  datum: string | null
  totaalInc: number | null
  btw: number | null
  /** Wat de lezer NIET zeker wist. Leeg = niets aan de hand. */
  twijfels: string[]
}

interface Props {
  rijen: TeBevestigen[]
  /** Geen enkele klant heeft deze boekhouder gemachtigd om te bevestigen. */
  geenMandaat?: boolean
  /** [VRAAG-MACHTIGING] De GEKOPPELDE klanten — om te kunnen vragen wat er nog niet is. */
  gekoppeld?: KoppelKlant[]
}

function euro(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function datumNl(iso: string | null): string {
  if (!iso) return 'datum onbekend'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'datum onbekend'
    : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AccountantBevestigen({ rijen, geenMandaat = false, gekoppeld = [] }: Props) {
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<Record<string, boolean>>({})
  const [fout, setFout] = useState<Record<string, string>>({})
  // [FACTUURVRAAG] Welke rij een vraag krijgt, en de tekst. Eén tegelijk: een vraag stellen is een
  // zin schrijven, en twee half-getypte vragen naast elkaar leveren er meestal nul op.
  const [vraagVoor, setVraagVoor] = useState<TeBevestigen | null>(null)
  const [vraagTekst, setVraagTekst] = useState('')
  const [vraagBezig, setVraagBezig] = useState(false)
  const [vraagFout, setVraagFout] = useState<string | null>(null)
  const [gevraagd, setGevraagd] = useState<Record<string, boolean>>({})
  useCloseOnBack(!!vraagVoor, () => setVraagVoor(null))

  // [BULK-BEVESTIG] De selectie, en de bevestiging vóór de bevestiging.
  const [geselecteerd, setGeselecteerd] = useState<Set<string>>(new Set())
  const [bulkVraag, setBulkVraag] = useState(false)
  const [bulkBezig, setBulkBezig] = useState(false)
  const [bulkResultaat, setBulkResultaat] = useState<string | null>(null)
  useCloseOnBack(bulkVraag, () => setBulkVraag(false))

  const bulkPlan = planBulkConfirm(rijen, geselecteerd)

  async function bevestigSelectie() {
    setBulkBezig(true)
    let gelukt = 0
    let mislukt = 0
    // Dezelfde ENE route per factuur, en niet een tweede pad in SQL. Elke grens die zij draagt —
    // het mandaat, de compare-and-swap op status, confirmed_by, de melding aan de klant — wordt zo
    // geërfd in plaats van overgeschreven, en overschrijven is hoe twee paden uit elkaar lopen op
    // precies de invariant die telt.
    //
    // Vier tegelijk: vierhonderd achter elkaar duurt minuten, vierhonderd tegelijk is een stormloop
    // op de database van een klant. Vier is snel genoeg en blijft beleefd.
    const rest = [...bulkPlan.eligible]
    async function werker() {
      for (;;) {
        const rij = rest.shift()
        if (!rij) return
        try {
          const res = await fetch('/api/accountant/bevestig', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: rij.clientId, invoiceId: rij.id }),
          })
          if (!res.ok) { mislukt++; continue }
          gelukt++
          setKlaar((k) => ({ ...k, [rij.id]: true }))
        } catch {
          mislukt++
        }
      }
    }
    await Promise.all([werker(), werker(), werker(), werker()])
    setBulkBezig(false)
    setBulkVraag(false)
    setGeselecteerd(new Set())
    setBulkResultaat(bulkConfirmResultText(gelukt, mislukt))
    router.refresh()
  }

  async function stelVraag() {
    const rij = vraagVoor
    const tekst = vraagTekst.trim()
    if (!rij || !tekst) return
    setVraagBezig(true); setVraagFout(null)
    try {
      const res = await fetch('/api/accountant/invoice-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: rij.clientId, invoiceId: rij.id, question: tekst }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'De vraag kon niet worden verstuurd.')
      setGevraagd((g) => ({ ...g, [rij.id]: true }))
      setVraagVoor(null)
      setVraagTekst('')
      router.refresh()
    } catch (e) {
      setVraagFout(e instanceof Error ? e.message : 'Er ging iets mis.')
    } finally {
      setVraagBezig(false)
    }
  }

  async function bevestig(rij: TeBevestigen) {
    setBezig(rij.id)
    setFout((f) => ({ ...f, [rij.id]: '' }))
    try {
      const res = await fetch('/api/accountant/bevestig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: rij.clientId, invoiceId: rij.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Bevestigen mislukt.')
      setKlaar((k) => ({ ...k, [rij.id]: true }))
      router.refresh()
    } catch (e) {
      setFout((f) => ({ ...f, [rij.id]: e instanceof Error ? e.message : 'Er ging iets mis.' }))
    } finally {
      setBezig(null)
    }
  }

  const kaart: React.CSSProperties = {
    background: M3.surface,
    border: `1px solid ${M3.outlineVariant}`,
    borderRadius: R.lg,
    boxShadow: EL1,
    padding: 20,
    marginBottom: 16,
  }

  if (geenMandaat) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Bevestigen
        </h1>
        <div style={kaart}>
          <p style={{ margin: '0 0 12px', color: M3.onSurface, lineHeight: 1.6 }}>
            Nog geen enkele klant heeft je gemachtigd om zijn inkoopfacturen te bevestigen.
          </p>
          <p style={{ margin: '0 0 12px', color: M3.onSurfaceVariant, lineHeight: 1.6, fontSize: 14.5 }}>
            Dit is een andere machtiging dan die om te factureren — een klant kan er één geven en de
            ander niet. Hij zet het zelf aan bij <strong>Instellingen → Jouw boekhouder</strong>.
          </p>
          <p style={{ margin: 0, color: M3.mutedText, lineHeight: 1.6, fontSize: 13.5 }}>
            Waarom het uitmaakt: zolang een inkoopfactuur onbevestigd is, valt hij buiten het
            kwartaalpakket en blijft het kwartaal op &quot;niet klaar&quot; staan. Zonder deze
            machtiging kan alleen je klant dat slot openen.
          </p>
          <VraagMachtiging klanten={gekoppeld} kind="bevestigen" />
        </div>
      </main>
    )
  }

  const open = rijen.filter((r) => !klaar[r.id])

  if (rijen.length === 0) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Bevestigen
        </h1>
        <div style={kaart}>
          <p style={{ margin: 0, color: M3.onSurface, lineHeight: 1.6 }}>
            Er staat niets te wachten. Bij je gemachtigde klanten is elke inkoopfactuur bevestigd.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        Bevestigen
      </h1>
      <p style={{ margin: '0 0 16px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        Deze stukken houden een kwartaal tegen — bevestig wat klopt.
      </p>

      <section style={{ ...kaart, paddingTop: 16, paddingBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 26, fontWeight: 500, color: M3.onSurface }}>{open.length}</p>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: M3.onSurfaceVariant }}>
          {open.length === 1 ? 'stuk wacht op bevestiging' : 'stukken wachten op bevestiging'}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 13, color: M3.mutedText, lineHeight: 1.6 }}>
          Je bevestigt de lezing, je verandert er niets aan. Klopt een bedrag niet, bevestig dan
          niet en vraag het na bij je klant. Bij elke bevestiging komt jouw naam te staan en krijgt
          hij bericht — de verantwoordelijkheid blijft bij hem (art. 52 AWR).
        </p>
      </section>

      {/* [BULK-BEVESTIG] De balk verschijnt pas als er iets geselecteerd is — een lege balk is een
          knop die niets doet, en die staan er al genoeg in de wereld. Hij zegt bovendien hoeveel er
          NIET in kunnen, zodat de uitsluiting zichtbaar is en niet stil. */}
      {geselecteerd.size > 0 && (
        <section style={{ ...kaart, position: 'sticky', top: 8, zIndex: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: M3.onSurface, fontWeight: 500 }}>
            {bulkPlan.eligible.length === 1 ? '1 factuur geselecteerd' : `${bulkPlan.eligible.length} facturen geselecteerd`}
          </span>
          <span style={{ fontSize: 13, color: M3.onSurfaceVariant }}>{euro(bulkPlan.total)}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setGeselecteerd(new Set())}
            style={{ padding: '8px 14px', border: `1px solid ${M3.outline}`, borderRadius: R.full, fontSize: 13.5, background: M3.surface, color: M3.onSurfaceVariant, cursor: 'pointer' }}
          >
            Wis selectie
          </button>
          <button
            onClick={() => setBulkVraag(true)}
            disabled={bulkPlan.eligible.length === 0}
            style={{ padding: '8px 16px', border: 'none', borderRadius: R.full, fontSize: 13.5, fontWeight: 500, background: M3.primary, color: M3.onPrimary, cursor: 'pointer' }}
          >
            Bevestigen
          </button>
        </section>
      )}

      {/* [BULK-BEVESTIG] De uitkomst van een ronde, ook als hij half lukte. "Gelukt" over een
          halve ronde is precies de melding waar dit hele project tegen is gebouwd. */}
      {bulkResultaat && (
        <section style={{ ...kaart, background: M3.surfaceVariant }}>
          <p style={{ margin: 0, fontSize: 14, color: M3.onSurface }}>{bulkResultaat}</p>
        </section>
      )}

      {rijen.map((rij) => {
        const isKlaar = Boolean(klaar[rij.id])
        return (
          <section key={rij.id} style={{ ...kaart, opacity: isKlaar ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              {/* [BULK-BEVESTIG] Alleen op de rijen waar de lezer NIETS onzeker vond. Een vinkje op
                  een rij met twijfel nodigt uit om precies datgene mee te vegen waar de boekhouder
                  voor zit — en dat is de hele veiligheid van dit scherm, in één tik weg. Die rijen
                  houden hun eigen knop. */}
              {!isKlaar && bulkConfirmable(rij) && (
                <input
                  type="checkbox"
                  checked={geselecteerd.has(rij.id)}
                  onChange={() => setGeselecteerd((s) => {
                    const n = new Set(s)
                    if (n.has(rij.id)) n.delete(rij.id); else n.add(rij.id)
                    return n
                  })}
                  aria-label={`Selecteer ${rij.leverancier || 'factuur'} voor bevestigen`}
                  style={{ width: 18, height: 18, marginTop: 3, accentColor: M3.primary, cursor: 'pointer', flexShrink: 0 }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: M3.mutedText }}>{rij.clientNaam}</p>
                <p style={{ margin: '2px 0 0', fontSize: 15.5, color: M3.onSurface, fontWeight: 500 }}>
                  {rij.leverancier || 'Onbekende leverancier'}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: M3.onSurfaceVariant }}>
                  {rij.factuurnummer || 'zonder nummer'} · {datumNl(rij.datum)}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: M3.onSurface }}>
                  {euro(rij.totaalInc)}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: M3.mutedText }}>
                  waarvan {euro(rij.btw)} btw
                </p>
              </div>
            </div>

            {/* [BEVESTIGEN-TWIJFEL] Wat de lezer NIET zeker wist, staat er vóór de knop — niet
                erachter en niet kleiner. Een bevestigknop boven een verzwegen twijfel maakt van de
                boekhouder een stempel in plaats van een controle. */}
            {rij.twijfels.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: M3.warningContainer,
                  borderRadius: R.sm,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: M3.warning,
                }}
              >
                Dit konden wij niet zeker lezen: {rij.twijfels.join(' · ')}. Controleer het aan het
                document zelf voor je bevestigt.
              </div>
            )}

            {fout[rij.id] && (
              <p
                role="alert"
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  padding: '10px 12px',
                  background: M3.errorContainer,
                  color: M3.error,
                  borderRadius: R.sm,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                }}
              >
                {fout[rij.id]}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => bevestig(rij)}
                disabled={bezig === rij.id || isKlaar}
                style={{
                  padding: '9px 16px',
                  background: isKlaar ? M3.successContainer : M3.primary,
                  color: isKlaar ? M3.success : M3.onPrimary,
                  border: 'none',
                  borderRadius: R.full,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: bezig === rij.id || isKlaar ? 'default' : 'pointer',
                }}
              >
                {isKlaar ? 'Bevestigd' : bezig === rij.id ? 'Bezig…' : 'Bevestigen'}
              </button>
              {/* [FACTUURVRAAG] Was een kale link naar /opvragen: die navigeert wég van de factuur
                  naar een kwartaalscherm voor ontbrekende STUKKEN, en neemt niets mee — niet de
                  factuur, niet de klant, niet wat er mis was. De boekhouder keek naar ATAPACK
                  26302050 met twijfel over de BTW, tikte "navragen", en stond op een pagina die
                  vroeg wélke klant en wélke ontbrekende documenten. Daar eindigde het, en het
                  gesprek ging verder op WhatsApp.
                  Nu stelt hij de vraag hier, over déze factuur. */}
              {!isKlaar && gevraagd[rij.id] && (
                <span style={{
                  padding: '9px 16px', borderRadius: R.full, fontSize: 14,
                  background: M3.warnContainer ?? M3.surfaceVariant, color: M3.onSurfaceVariant,
                }}>
                  Vraag verstuurd
                </span>
              )}
              {!isKlaar && !gevraagd[rij.id] && (
                <button
                  onClick={() => { setVraagVoor(rij); setVraagTekst('') }}
                  style={{
                    padding: '9px 16px',
                    border: `1px solid ${M3.outline}`,
                    borderRadius: R.full,
                    fontSize: 14,
                    color: M3.onSurfaceVariant,
                    background: M3.surface,
                    cursor: 'pointer',
                  }}
                >
                  Klopt niet — vraag stellen
                </button>
              )}
            </div>
          </section>
        )
      })}

      {/* [BULK-BEVESTIG] Wat er staat te gebeuren, vóór het gebeurt. De vastgehouden rijen staan
          bovenaan: een uitsluiting die niemand ziet is geen uitsluiting. */}
      {bulkVraag && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!bulkBezig) setBulkVraag(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: M3.surface, borderRadius: `${R.lg}px ${R.lg}px 0 0`, width: '100%', maxWidth: COLUMN.work, padding: '20px 18px', paddingBottom: sheetPaddingBottom(24), boxShadow: EL1 }}
          >
            <div style={{ fontSize: 17, fontWeight: 600, color: M3.onSurface }}>
              {bulkConfirmTitle(bulkPlan)}
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bulkConfirmWarnings(bulkPlan).map((zin, i) => (
                <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: M3.onSurfaceVariant }}>{zin}</p>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setBulkVraag(false)}
                disabled={bulkBezig}
                style={{ padding: '9px 16px', border: `1px solid ${M3.outline}`, borderRadius: R.full, fontSize: 14, background: M3.surface, color: M3.onSurfaceVariant, cursor: bulkBezig ? 'default' : 'pointer' }}
              >
                Annuleren
              </button>
              <button
                onClick={() => void bevestigSelectie()}
                disabled={bulkBezig}
                style={{ padding: '9px 18px', border: 'none', borderRadius: R.full, fontSize: 14, fontWeight: 500, background: M3.primary, color: M3.onPrimary, cursor: bulkBezig ? 'default' : 'pointer' }}
              >
                {bulkBezig ? 'Bezig…' : 'Ja, bevestigen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [FACTUURVRAAG] De vraag zelf. Eén veld, en het zegt waar de vraag over gaat — de klant
          krijgt hem met leverancier, factuurnummer en bedrag erbij, en één tik brengt hem naar
          precies die regel. Dat is het verschil met de kale link die hier stond. */}
      {vraagVoor && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!vraagBezig) setVraagVoor(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 60,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: M3.surface, borderRadius: `${R.lg}px ${R.lg}px 0 0`,
              width: '100%', maxWidth: COLUMN.work, padding: '20px 18px', boxShadow: EL1,
              // [SHEET-BOTTOM] Anders eindigt het paneel ONDER de onderbalk en is de laatste knop
              // — "Vraag versturen" — niet aan te tikken op een telefoon.
              paddingBottom: sheetPaddingBottom(24),
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 600, color: M3.onSurface }}>
              Vraag over deze factuur
            </div>
            <div style={{ fontSize: 13, color: M3.onSurfaceVariant, marginTop: 4, marginBottom: 14 }}>
              {vraagVoor.leverancier}
              {vraagVoor.factuurnummer ? ` · factuur ${vraagVoor.factuurnummer}` : ''}
              {` · ${euro(vraagVoor.totaalInc)}`}
              {` — gaat naar ${vraagVoor.clientNaam}`}
            </div>
            <textarea
              value={vraagTekst}
              onChange={(e) => setVraagTekst(e.target.value.slice(0, 500))}
              rows={4}
              autoFocus
              placeholder="Bijvoorbeeld: is dit zakelijk of privé? Of: klopt het btw-bedrag hier?"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                border: `1px solid ${M3.outline}`, borderRadius: R.md,
                fontSize: 14, fontFamily: 'inherit', resize: 'vertical', color: M3.onSurface,
              }}
            />
            <div style={{ fontSize: 12, color: M3.onSurfaceVariant, marginTop: 6 }}>
              {vraagTekst.trim().length}/500 · je klant krijgt een melding en kan hier antwoorden
            </div>
            {vraagFout && (
              <div style={{ fontSize: 13, color: M3.error, marginTop: 10 }}>{vraagFout}</div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setVraagVoor(null)}
                disabled={vraagBezig}
                style={{
                  padding: '9px 16px', border: `1px solid ${M3.outline}`, borderRadius: R.full,
                  fontSize: 14, background: M3.surface, color: M3.onSurfaceVariant,
                  cursor: vraagBezig ? 'default' : 'pointer',
                }}
              >
                Annuleren
              </button>
              <button
                onClick={() => void stelVraag()}
                disabled={vraagBezig || vraagTekst.trim().length === 0}
                style={{
                  padding: '9px 18px', border: 'none', borderRadius: R.full, fontSize: 14, fontWeight: 500,
                  background: vraagTekst.trim().length === 0 ? M3.surfaceVariant : M3.primary,
                  color: vraagTekst.trim().length === 0 ? M3.onSurfaceVariant : M3.onPrimary,
                  cursor: vraagBezig || vraagTekst.trim().length === 0 ? 'default' : 'pointer',
                }}
              >
                {vraagBezig ? 'Bezig…' : 'Vraag versturen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
