'use client'

// src/app/dashboard/vragen/VragenClient.tsx
// [BRUG-RETOUR] De vragenlijst van de ondernemer.
//
// Eén kaart per openstaande vraag: waar hij over gaat, wat er gevraagd is, en één veld om
// te antwoorden. Het antwoord gaat via /api/messages — hetzelfde kanaal met koppelingscheck,
// in-app notificatie en e-mail dat het berichtenscherm gebruikt.
//
// WAT DIT SCHERM BEWUST NIET DOET
// Het vinkt niets af. De klant kan de status van zijn boekhouder niet schrijven (RLS staat
// het niet toe, en het hoort ook niet: een status is diens bewering). Daarom staat er na
// het versturen géén "afgehandeld", maar precies wat er is gebeurd: je antwoord is verstuurd,
// en de vraag blijft staan tot je boekhouder hem zelf afvinkt.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FONT, M3, R, COLUMN } from '@/lib/design/tokens'
import { bouwAntwoordBericht, type OpenVraag } from '@/lib/vragen'

const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

export interface VraagView extends OpenVraag {
  /** Ondertekende URL naar het bestand, of null als er niets te openen valt. */
  fileUrl: string | null
}

// Datum uit een ISO-string zonder tijdzonegedoe en zonder klok in de render
// (react-hooks/purity: new Date() tijdens renderen is een fout, en hier ook niet nodig).
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
function datumNL(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]} ${m[1]}`
}

export default function VragenClient({
  vragen,
  accountantId,
  accountantNaam,
  loadFailed,
}: {
  vragen: VraagView[]
  accountantId: string | null
  accountantNaam: string | null
  loadFailed: boolean
}) {
  const router = useRouter()
  const boekhouder = accountantNaam ?? 'je boekhouder'

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* [HEADER-SYSTEM] De titel woont in de gedeelde sub-paginabalk; hier alleen de uitleg. */}
        <header style={{ margin: '16px 0 18px' }}>
          <p style={{ fontSize: 14.5, color: M3.neutral, margin: 0, lineHeight: 1.55 }}>
            Als {boekhouder} iets mist of niet begrijpt bij een van je bestanden, staat de vraag
            hier. Je antwoord komt bij {accountantNaam ? 'hem of haar' : 'je boekhouder'} binnen als
            bericht — je hoeft er geen app voor te wisselen.
          </p>
        </header>

        {/* [NO-FALSE-CLEAR] Een mislukte lezing mag nooit als "geen vragen" lezen. */}
        {loadFailed ? (
          <div style={{ background: M3.warningContainer, borderRadius: R.lg, padding: '16px', boxShadow: EL1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: '#7a4f00' }}>Kon je vragen niet ophalen</div>
            <div style={{ fontSize: 13.5, color: '#7a4f00', margin: '4px 0 12px', lineHeight: 1.5 }}>
              Dit betekent <strong>niet</strong> dat er niets openstaat — we konden de lijst even
              niet lezen.
            </div>
            <button
              onClick={() => router.refresh()}
              style={{ background: '#7a4f00', color: '#fff', border: 'none', borderRadius: 980, padding: '8px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
            >
              Opnieuw proberen
            </button>
          </div>
        ) : vragen.length === 0 ? (
          <div style={{ background: M3.successContainer, borderRadius: R.lg, padding: '20px 18px', boxShadow: EL1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: '#0B5345' }}>Geen openstaande vragen</div>
            <div style={{ fontSize: 13.5, color: '#0B5345', marginTop: 4, lineHeight: 1.55 }}>
              {accountantId
                ? 'Er staat op dit moment niets van je boekhouder open. Zodra er een vraag komt, krijg je er bericht van en staat hij hier.'
                : 'Je hebt nog geen boekhouder gekoppeld. Zodra dat gebeurt, komen zijn vragen hier binnen.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {vragen.map((v) => (
              <VraagKaart key={v.documentId} vraag={v} accountantId={accountantId} />
            ))}
          </div>
        )}

        {/* Wat een vraag meestal is: een ontbrekend bestand. Eén tik naar de plek die dat oplost. */}
        {!loadFailed && vragen.length > 0 && (
          <button
            onClick={() => router.push('/dashboard/upload')}
            style={{
              marginTop: 20, width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
              background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: R.lg,
              padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: EL1,
            }}
          >
            <span className="material-symbols-outlined" style={{ color: M3.primary, fontSize: 22 }}>upload_file</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: M3.onSurface }}>Mist er een bon?</span>
              <span style={{ display: 'block', fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>Voeg hem toe — de app sorteert hem</span>
            </span>
            <span className="material-symbols-outlined" style={{ color: '#9aa0a6', fontSize: 20 }}>chevron_right</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function VraagKaart({ vraag, accountantId }: { vraag: VraagView; accountantId: string | null }) {
  const [antwoord, setAntwoord] = useState('')
  const [bezig, setBezig] = useState(false)
  const [verstuurd, setVerstuurd] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const datum = datumNL(vraag.askedAt)
  // [FACTUURVRAAG] Een vraag gaat over een BESTAND of over een FACTUUR, en de terugvalzin moet dat
  // zeggen: "naamloos bestand" boven een vraag over een inkoopfactuur van € 2.265 is precies de
  // verwarring die dit scherm komt opheffen.
  const isFactuur = vraag.subjectType === 'invoice'
  const naam = vraag.documentName ?? (
    isFactuur
      ? (vraag.documentMissing ? 'Een factuur die we niet meer kunnen tonen' : 'Factuur')
      : (vraag.documentMissing ? 'Een bestand dat we niet meer kunnen tonen' : 'Naamloos bestand')
  )
  // De factuur zelf, met ?focus= — dezelfde deep-link die een melding gebruikt: hij klapt de rij
  // open, scrollt hem in beeld en licht hem even op. Alleen wanneer wij de factuur ook echt konden
  // lezen; een link naar een rij die er niet is, is erger dan geen link.
  const factuurHref = isFactuur && !vraag.documentMissing
    ? `/dashboard/incoming/manage?focus=${encodeURIComponent(vraag.documentId)}`
    : null

  async function verstuur() {
    const bericht = bouwAntwoordBericht(vraag.documentName, antwoord)
    if (!bericht || !accountantId) return
    setBezig(true); setFout(null)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_id: accountantId, content: bericht }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFout(json?.error || 'Versturen mislukt. Probeer het opnieuw.')
      } else {
        setVerstuurd(true)
        setAntwoord('')
      }
    } catch {
      setFout('Versturen mislukt. Probeer het opnieuw.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <article style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
      {/* Waar de vraag over gaat */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span className="material-symbols-outlined" style={{ color: M3.warn, fontSize: 22, marginTop: 1 }}>help</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, wordBreak: 'break-word' }}>{naam}</div>
            <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>
              {datum ? `Gevraagd op ${datum}` : 'Datum onbekend'}
              {vraag.documentTrashed && ' · ligt in je prullenbak'}
            </div>
          </div>
          {vraag.fileUrl && (
            <a
              href={vraag.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: M3.primary, textDecoration: 'none', padding: '4px 2px' }}
            >
              Bekijk
            </a>
          )}
          {/* [FACTUURVRAAG] Dezelfde plek, dezelfde belofte: de vraag brengt je bij het ding waar
              hij over gaat. Zonder dit moet de klant zelf gaan zoeken welke van zijn vierhonderd
              facturen bedoeld wordt — en dan verhuist het gesprek alsnog naar WhatsApp. */}
          {factuurHref && (
            <a
              href={factuurHref}
              style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: M3.primary, textDecoration: 'none', padding: '4px 2px' }}
            >
              Bekijk
            </a>
          )}
        </div>
      </div>

      {/* De vraag zelf — of de eerlijke vaststelling dat er geen tekst bij zat */}
      <div style={{ margin: '0 16px 14px', padding: '12px 14px', background: M3.warnContainer, borderRadius: R.md }}>
        {vraag.question ? (
          <p style={{ margin: 0, fontSize: 14.5, color: '#5a3e00', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {vraag.question}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: '#5a3e00', lineHeight: 1.55 }}>
            Je boekhouder heeft dit bestand als vraag gemarkeerd, maar er geen toelichting bij
            geschreven. Vraag gerust wat hij precies nodig heeft.
          </p>
        )}
      </div>

      {/* Antwoorden */}
      <div style={{ padding: '0 16px 16px' }}>
        {!accountantId ? (
          <p style={{ margin: 0, fontSize: 13, color: M3.neutral, lineHeight: 1.5 }}>
            Er is op dit moment geen boekhouder aan je account gekoppeld, dus we kunnen je antwoord
            nergens naartoe sturen.
          </p>
        ) : verstuurd ? (
          <div style={{ background: M3.successContainer, borderRadius: R.md, padding: '12px 14px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0B5345' }}>Je antwoord is verstuurd</div>
            <div style={{ fontSize: 12.5, color: '#0B5345', marginTop: 3, lineHeight: 1.5 }}>
              De vraag blijft hier staan tot je boekhouder hem zelf afvinkt — wij zetten geen vinkje
              namens hem.
            </div>
          </div>
        ) : (
          <>
            <label htmlFor={`antwoord-${vraag.documentId}`} style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: M3.neutral, marginBottom: 6 }}>
              Jouw antwoord
            </label>
            <textarea
              id={`antwoord-${vraag.documentId}`}
              value={antwoord}
              onChange={(e) => setAntwoord(e.target.value)}
              rows={3}
              placeholder="Bijvoorbeeld: die bon zit in de map van juni, ik stuur hem vandaag."
              style={{
                width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 14.5,
                color: M3.onSurface, padding: '10px 12px', lineHeight: 1.5,
                border: `1px solid ${M3.outlineVariant}`, borderRadius: R.md, resize: 'vertical',
                background: '#fff',
              }}
            />
            {fout && (
              <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: M3.error }}>{fout}</p>
            )}
            <button
              onClick={verstuur}
              disabled={bezig || antwoord.trim().length === 0}
              style={{
                marginTop: 10, border: 'none', borderRadius: 980, padding: '9px 20px',
                fontSize: 14, fontWeight: 600, fontFamily: FONT,
                cursor: bezig || antwoord.trim().length === 0 ? 'default' : 'pointer',
                background: antwoord.trim().length === 0 ? M3.surfaceVariant : M3.primary,
                color: antwoord.trim().length === 0 ? M3.neutral : '#fff',
              }}
            >
              {bezig ? 'Versturen…' : 'Antwoord versturen'}
            </button>
          </>
        )}
      </div>
    </article>
  )
}
