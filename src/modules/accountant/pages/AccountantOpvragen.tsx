'use client'

// src/modules/accountant/pages/AccountantOpvragen.tsx
// [OPVRAGEN] Stukken opvragen bij een klant — het scherm.
//
// HET PROBLEEM DAT DIT OPLOST
// Het najagen van papier is wat een boekhoudersmaand leegzuigt, en het gaat bijna altijd op
// dezelfde manier mis: een appje met "kun je de rest nog sturen?" waar de klant niets mee kan,
// omdat hij niet weet wat "de rest" is. BoekBrug kent de gaten wél — die staan in het
// readiness-rapport. Specifiek kunnen vragen ís de functie.
//
// WAAROM ALLEEN `missing` EN NIET `risks`
// Het rapport heeft twee lijsten. `missing` zijn gaten die de KLANT kan dichten: een bon, een
// kassastaat, een ontbrekend document. `risks` zijn aansluitverschillen die de BOEKHOUDER moet
// bekijken — een klant die daar een lijstje van krijgt, kan er niets mee en raakt alleen
// ongerust. Ze staan hier dus niet in, en dat is een keuze, geen omissie.
//
// WAAROM DE BOEKHOUDER MOET AANVINKEN
// Niet alles wat het rapport mist, hoort in een verzoek. Soms weet de boekhouder dat een bon
// onderweg is, of dat een gat zijn eigen werk is. Een knop die alles in één keer stuurt, stuurt
// vroeg of laat iets doms — en de klant leert het verzoek te negeren.

import { useEffect, useMemo, useState } from 'react'
import { M3, R, EL1, COLUMN } from '@/lib/design/tokens'
import { MAX_ITEMS, MAX_EXTRA, buildDocumentRequest } from '@/lib/document-request'

export interface OpvraagKlant {
  id: string
  naam: string
}

/** Eén punt uit report.missing — de vorm die /api/readiness teruggeeft. */
interface MissingItem {
  title: string
  detail?: string | null
}

interface Props {
  klanten: OpvraagKlant[]
  /** De kwartalen om uit te kiezen, nieuwste eerst. Bepaald op de server (klok buiten de render). */
  kwartalen: { year: number; quarter: number; label: string }[]
}

export default function AccountantOpvragen({ klanten, kwartalen }: Props) {
  const [klantId, setKlantId] = useState(klanten.length === 1 ? klanten[0].id : '')
  const [periode, setPeriode] = useState(kwartalen[0] ? `${kwartalen[0].year}-${kwartalen[0].quarter}` : '')
  const [extra, setExtra] = useState('')
  const [bezig, setBezig] = useState(false)

  const klant = klanten.find((k) => k.id === klantId) ?? null
  const kwartaal = kwartalen.find((q) => `${q.year}-${q.quarter}` === periode) ?? null

  /**
   * De huidige keuze, als één sleutel.
   *
   * ALLE opgehaalde toestand hangt aan deze sleutel in plaats van te worden GEWIST als de keuze
   * verandert. Dat is niet alleen om `react-hooks/set-state-in-effect` tevreden te stellen: wissen
   * in een effect betekent dat er één render bestaat waarin de nieuwe klant al gekozen is en de
   * oude gaten nog op het scherm staan. Bij een scherm waarvan de knop een mail naar een echte
   * ondernemer stuurt, is dat precies het frame waarin iemand op verzenden drukt. Nu kan het niet:
   * hoort de data niet bij de sleutel, dan is ze er domweg niet.
   */
  const sleutel = klantId && kwartaal ? `${klantId}|${kwartaal.year}-${kwartaal.quarter}` : ''

  const [geladen, setGeladen] = useState<{ sleutel: string; items: MissingItem[] } | null>(null)
  const [vinkjes, setVinkjes] = useState<{ sleutel: string; map: Record<string, boolean> }>({ sleutel: '', map: {} })
  const [status, setStatus] = useState<{ sleutel: string; fout?: string; verstuurd?: boolean }>({ sleutel: '' })

  // Afgeleid, niet opgeslagen — zie de uitleg bij `sleutel`.
  const gaten = geladen && geladen.sleutel === sleutel ? geladen.items : null
  // useMemo, niet een kale ternary: `{}` is elke render een nieuw object, en dan verandert de
  // afhankelijkheid van de useMemo hieronder bij iedere toetsaanslag in het tekstvak.
  const gekozen = useMemo(
    () => (vinkjes.sleutel === sleutel ? vinkjes.map : {}),
    [vinkjes, sleutel],
  )
  const fout = status.sleutel === sleutel ? status.fout : undefined
  const verstuurd = Boolean(status.sleutel === sleutel && status.verstuurd)
  const laden = Boolean(sleutel) && gaten === null && !fout

  // ── De gaten ophalen zodra klant én kwartaal vaststaan ─────────────────────
  useEffect(() => {
    if (!sleutel || !klantId || !kwartaal) return
    let afgebroken = false
    fetch(`/api/readiness?clientId=${encodeURIComponent(klantId)}&year=${kwartaal.year}&quarter=${kwartaal.quarter}`)
      .then((r) => r.json())
      .then((d) => {
        if (afgebroken) return
        if (!d?.ok || !d?.report) throw new Error(d?.error || 'Kon het kwartaal niet lezen.')
        const missing: MissingItem[] = Array.isArray(d.report.missing) ? d.report.missing : []
        setGeladen({ sleutel, items: missing })
        // Standaard alles aangevinkt: de boekhouder haalt weg wat hij al weet, in plaats van
        // twaalf vinkjes te moeten zetten voor het normale geval.
        const start: Record<string, boolean> = {}
        for (const m of missing) start[m.title] = true
        setVinkjes({ sleutel, map: start })
      })
      .catch((e) => {
        if (afgebroken) return
        setGeladen({ sleutel, items: [] })
        setStatus({ sleutel, fout: e instanceof Error ? e.message : 'Kon het kwartaal niet lezen.' })
      })
    return () => {
      afgebroken = true
    }
  }, [sleutel, klantId, kwartaal])

  const geselecteerd = useMemo(
    () => (gaten ?? []).filter((g) => gekozen[g.title]),
    [gaten, gekozen],
  )

  // De voorbeeldtekst komt uit dezelfde pure functie als de server gebruikt, dus wat hier staat is
  // letterlijk wat de klant krijgt — geen benadering die uit elkaar kan lopen.
  const voorbeeld = useMemo(() => {
    if (!kwartaal) return null
    return buildDocumentRequest({
      items: geselecteerd,
      quarterLabel: kwartaal.label,
      // Alleen voor het voorbeeld. De server ondertekent met de ECHTE naam uit het profiel en
      // negeert wat de browser hier ook maar stuurt.
      accountantName: 'Je naam',
      extra,
    })
  }, [geselecteerd, kwartaal, extra])

  async function verstuur() {
    if (!klant || !kwartaal) return
    setBezig(true)
    setStatus({ sleutel })
    try {
      const res = await fetch('/api/accountant/vraag-stukken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: klant.id,
          quarterLabel: kwartaal.label,
          items: geselecteerd.map((g) => ({ title: g.title, detail: g.detail ?? null })),
          extra: extra.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Versturen mislukt.')
      setStatus({ sleutel, verstuurd: true })
      setExtra('')
    } catch (e) {
      setStatus({ sleutel, fout: e instanceof Error ? e.message : 'Er ging iets mis.' })
    } finally {
      setBezig(false)
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
  const label: React.CSSProperties = { display: 'block', fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 6 }

  if (klanten.length === 0) {
    return (
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
          Stukken opvragen
        </h1>
        <div style={kaart}>
          <p style={{ margin: 0, color: M3.onSurface, lineHeight: 1.6 }}>
            Je hebt nog geen gekoppelde klanten. Nodig er een uit bij <strong>Klanten beheren</strong>.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: M3.onSurface, margin: '0 0 4px' }}>
        Stukken opvragen
      </h1>
      <p style={{ margin: '0 0 20px', color: M3.onSurfaceVariant, fontSize: 14.5 }}>
        Eén bericht met precies wat er nog mist — in zijn inbox en in zijn mail.
      </p>

      {/* ── Wie en welk kwartaal ─────────────────────────────────────────── */}
      <section style={kaart}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div>
            <label style={label} htmlFor="klant">Klant</label>
            <select id="klant" style={veld} value={klantId} onChange={(e) => setKlantId(e.target.value)}>
              <option value="">Kies een klant…</option>
              {klanten.map((k) => (
                <option key={k.id} value={k.id}>{k.naam}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label} htmlFor="kwartaal">Kwartaal</label>
            <select id="kwartaal" style={veld} value={periode} onChange={(e) => setPeriode(e.target.value)}>
              {kwartalen.map((q) => (
                <option key={`${q.year}-${q.quarter}`} value={`${q.year}-${q.quarter}`}>{q.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ── Wat er mist ──────────────────────────────────────────────────── */}
      {klantId && (
        <section style={kaart}>
          <h2 style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: '0 0 12px' }}>
            Wat BoekBrug mist in {kwartaal?.label}
          </h2>

          {laden && <p style={{ margin: 0, color: M3.mutedText, fontSize: 14 }}>Bezig met lezen…</p>}

          {!laden && gaten && gaten.length === 0 && (
            <p style={{ margin: 0, color: M3.onSurfaceVariant, fontSize: 14.5, lineHeight: 1.6 }}>
              BoekBrug ziet geen gaten in dit kwartaal. Dat betekent niet dat het compleet is — een
              bon die nooit is geüpload is voor ons onzichtbaar. Je kunt hieronder alsnog zelf iets
              vragen.
            </p>
          )}

          {!laden && gaten && gaten.length > 0 && (
            <>
              {gaten.map((g) => (
                <label
                  key={g.title}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: '10px 0',
                    borderTop: `1px solid ${M3.outlineVariant}`,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(gekozen[g.title])}
                    onChange={(e) => setVinkjes((v) => ({ sleutel, map: { ...(v.sleutel === sleutel ? v.map : {}), [g.title]: e.target.checked } }))}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ display: 'block', fontSize: 14.5, color: M3.onSurface }}>{g.title}</span>
                    {g.detail && (
                      <span style={{ display: 'block', fontSize: 12.5, color: M3.mutedText, marginTop: 2 }}>
                        {g.detail}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <p style={{ margin: '12px 0 0', fontSize: 12.5, color: M3.mutedText, lineHeight: 1.6 }}>
                Haal weg wat je al weet — een bon die onderweg is, of een gat dat jouw eigen werk is.
                Meer dan {MAX_ITEMS} punten in één bericht leest niemand.
              </p>
            </>
          )}
        </section>
      )}

      {/* ── Eigen zin + versturen ────────────────────────────────────────── */}
      {klantId && !laden && (
        <section style={kaart}>
          <label style={label} htmlFor="extra">Je eigen zin erbij (optioneel)</label>
          <textarea
            id="extra"
            rows={3}
            maxLength={MAX_EXTRA}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Bijvoorbeeld: de betaling van Jansen is binnen, top."
            style={{ ...veld, resize: 'vertical', fontFamily: 'inherit' }}
          />

          {voorbeeld?.ok && (
            <>
              <p style={{ ...label, marginTop: 16 }}>Dit krijgt {klant?.naam ?? 'je klant'} te zien</p>
              <pre
                style={{
                  margin: 0,
                  padding: 14,
                  background: M3.surfaceVariant,
                  borderRadius: R.sm,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  color: M3.onSurface,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  overflowX: 'auto',
                }}
              >
                {voorbeeld.text}
              </pre>
            </>
          )}

          {voorbeeld && !voorbeeld.ok && (
            <p style={{ marginTop: 14, marginBottom: 0, fontSize: 13.5, color: M3.mutedText, lineHeight: 1.5 }}>
              {voorbeeld.reason}
            </p>
          )}

          {fout && (
            <p
              role="alert"
              style={{
                marginTop: 14,
                marginBottom: 0,
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

          {verstuurd && (
            <p style={{ marginTop: 14, marginBottom: 0, fontSize: 14, color: M3.success }}>
              Verstuurd. Het staat in zijn inbox en is per mail gegaan.
            </p>
          )}

          <button
            type="button"
            onClick={verstuur}
            disabled={bezig || !voorbeeld?.ok}
            style={{
              marginTop: 16,
              width: '100%',
              padding: '12px 16px',
              background: bezig || !voorbeeld?.ok ? M3.surfaceVariant : M3.primary,
              color: bezig || !voorbeeld?.ok ? M3.mutedText : M3.onPrimary,
              border: 'none',
              borderRadius: R.md,
              fontSize: 15,
              fontWeight: 500,
              cursor: bezig || !voorbeeld?.ok ? 'default' : 'pointer',
            }}
          >
            {bezig ? 'Bezig met versturen…' : `Verstuur naar ${klant?.naam ?? 'je klant'}`}
          </button>
          <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: M3.mutedText, lineHeight: 1.5 }}>
            Het bericht staat op jouw naam en komt in dezelfde inbox als je gewone berichten. Hij
            kan er direct op antwoorden.
          </p>
        </section>
      )}
    </main>
  )
}
