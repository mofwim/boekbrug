'use client'

// src/app/dashboard/aangifte/AangifteClient.tsx
// [AANGIFTE] The concept BTW-aangifte, in the Belastingdienst rubriek layout. Every
// figure is derived from the owner's own imported data (see /api/aangifte); the notes
// state exactly what each depends on. It is loudly a CONCEPT — never a filing.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { quarterFromParams } from '@/lib/quarter'
// [TZ] Amsterdam's day/year, never the device's — see format-nl.ts. formatDateNL renders the
// filing timestamp as DD-MM-YYYY, pinned to the same zone.
import { amsterdamToday, formatDateNL } from '@/lib/format-nl'
import { filedNotice } from '@/lib/aangifte-filed-notice'
// [DEADLINE] De datum waarop dit ingediend moet zijn, en hoeveel dagen dat nog is.
import { deadlineNotice } from '@/lib/btw-deadline-notice'
import type { QuarterNo } from '@/lib/btw-reservation'
import { M3, FONT, FONT_NUM, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

interface Row { code: string; label: string; omzet: number; btw: number }
interface Aangifte {
  quarterLabel: string
  rows: Row[]
  verschuldigd: number; voorbelasting: number; saldo: number
  cashOmzetZonderBtw: number
  notes: string[]
}

// [BAD-DEBT] Art. 29 Wet OB, both directions — reported alongside the concept, never inside it.
// Neither figure is booked: the rubrieken above are what the owner's data says, these two are
// what the CALENDAR says on top of it, and the period they land in is the accountant's call.
interface Art29 {
  vatClawbackBtw: number   // lid 7 — deducted voorbelasting that became payable again (you owe)
  vatClawbackCount: number
  badDebtReclaimableBtw: number // lid 1 — BTW on sales nobody paid (you get back)
  badDebtCount: number
}

// [ICP] The ICP-opgaaf that belongs with this quarter. It is a SEPARATE declaration, so it gets
// its own block below the rubrieken — never a row inside them, which is how someone comes to
// believe the app filed it along with the aangifte.
interface IcpLine { vatNumber: string; country: string; clientName: string | null; amountExBtw: number; invoiceCount: number }
interface IcpProblem { kind: string; invoiceNumber: string | null; clientName: string | null; vatNumber: string; detail: string }
interface Icp { lines: IcpLine[]; totalExBtw: number; problems: IcpProblem[] }

// [FILED-QUARTER] The frozen figures of an aangifte this owner already marked as ingediend, when
// this quarter is one of them. Everything else on this page is recomputed LIVE, so without this
// the screen shows a fresh concept for a closed quarter and says nothing about it.
interface Filed {
  filedAt: string; verschuldigd: number; voorbelasting: number; saldo: number
  /**
   * [SUPPLETIE-FANTOOM] Wat er sinds het indienen bij is gekomen of af is gegaan, berekend op de
   * server uit de ONafgeronde cijfers. Niet hier uit twee afgeronde bedragen af te trekken: het
   * concept-5g is de som van per rubriek afgeronde bedragen en het ingediende saldo is in één keer
   * afgerond, dus dat verschil bestond ook op een kwartaal waar niemand iets aan veranderde.
   */
  saldoDelta: number
}

// [SUPPLETIE-VERREKEND] A correction from an EARLIER filed quarter, €1.000 or less, that has not
// been declared anywhere yet. The Belastingdienst allows those to be processed in the next regular
// aangifte — which this app has been advising on two screens without ever producing the number.
//
// Its own block, never a rubriek: a correction from a previous quarter reconciles with no invoice
// of this one, and a total that cannot be traced back to a document is the shape of number nobody
// trusts. The owner or their accountant places it on the form.
interface Correction { quarter: string; filedAt: string; btwSaldoDelta: number; carriedSaldo: number; outstanding: number }

export default function AangifteClient({ hasAccountant = null }: {
  /**
   * [ZELF-INDIENEN] Is er een boekhouder aan dit account gekoppeld?
   *
   * true → hij controleert en dient in, en de zin die dat zegt klopt.
   * false → NIEMAND doet dat behalve de eigenaar zelf, en tot nu toe stond er dat zijn boekhouder
   *   het zou doen — tegen iedereen, onvoorwaardelijk. Zie het paneel verderop.
   * null → de lezing mislukte. Dan zegt de banner alleen wat hij zeker weet: dit is een concept.
   *   Wie hem indient is dan een bewering die we niet kunnen doen, en dit is niet het scherm om te
   *   gokken wie er verantwoordelijk is voor een belastingaangifte.
   */
  hasAccountant?: boolean | null
}) {
  const t = translator(useLocale())
  const sp = useSearchParams()
  // [QUARTER] Honour ?year&quarter (e.g. from the readiness card's link), else default to
  // the last COMPLETED quarter — the same default klaar uses — so the two never disagree.
  const initial = quarterFromParams((k) => sp.get(k))
  const [year, setYear] = useState(initial.year)
  const [quarter, setQuarter] = useState<number>(initial.quarter)
  const [data, setData] = useState<Aangifte | null>(null)
  const [art29, setArt29] = useState<Art29 | null>(null)
  const [icp, setIcp] = useState<Icp | null>(null)
  const [filed, setFiled] = useState<Filed | null>(null)
  const [filedUnknown, setFiledUnknown] = useState(false)
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [correctionsUnknown, setCorrectionsUnknown] = useState(false)
  // [SUPPLETIE-VERREKEND] Which correction the owner is currently marking as processed, and what
  // the server said about the last one. The tick is a deliberate act (see /api/btw/carry): the app
  // may not infer that a correction was included in a return it did not file.
  const [carrying, setCarrying] = useState<string | null>(null)
  const [carryNote, setCarryNote] = useState<string | null>(null)
  // [LOAD-REASON] Why the concept is not on screen. "Kon de concept-aangifte niet laden" was the
  // answer to every failure, including an expired session — which the owner cannot fix by
  // refreshing, and which is the most common one of the set.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // [TZ] The Amsterdam year, not the device's. This caps the year picker, and a traveller's phone
  // (or one with a wrong clock) must not be able to open — or hide — a quarter the rest of the app
  // judges by the Dutch calendar.
  const curYear = Number(amsterdamToday().slice(0, 4))
  // [DEADLINE] Wanneer dit kwartaal ingediend moet zijn, gezien vanaf vandaag — de Amsterdamse
  // dag, niet die van het toestel: een deadline is een Nederlandse kalenderdatum. De rekensom
  // staat in btw-deadline-notice.ts, zodat dit scherm, klaar en de herinneringscron nooit een
  // andere dag tellen.
  const deadline = deadlineNotice(year, quarter as QuarterNo, amsterdamToday())

  /**
   * [SUPPLETIE-VERREKEND] "Ik heb deze correctie in deze aangifte verwerkt."
   *
   * The amount is NOT sent — the server recomputes it from the same engine that produced the line,
   * so a screen left open while the books moved cannot record a carry that no longer matches. All
   * this posts is which quarter goes into which.
   *
   * The row is removed only on the server's ok. Removing it optimistically would hide a correction
   * that is still owed, on the screen the owner fills a tax return from.
   */
  async function markCarried(c: Correction) {
    if (carrying) return
    setCarrying(c.quarter); setCarryNote(null)
    try {
      const res = await fetch('/api/btw/carry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { year: Number(c.quarter.slice(0, 4)), quarter: Number(c.quarter.slice(6)) },
          into: { year, quarter },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setCarryNote(typeof json.error === 'string'
          ? json.error
          : t('aang.correcties.mislukt'))
        return
      }
      setCorrections((prev) => prev.filter((x) => x.quarter !== c.quarter))
    } catch {
      setCarryNote(t('aang.correcties.geenVerbinding'))
    } finally {
      setCarrying(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // De reset staat binnen de async-functie maar vóór de eerste await: hij draait dus in
      // dezelfde tick als voorheen. Het verschil is dat de compiler nu kan zien dat er geen
      // synchrone setState in de effect-body zelf zit.
      setLoading(true); setData(null); setArt29(null); setIcp(null)
      setFiled(null); setFiledUnknown(false); setLoadError(null)
      setCorrections([]); setCorrectionsUnknown(false); setCarryNote(null)
      try {
        const res = await fetch(`/api/aangifte?year=${year}&quarter=${quarter}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          // The route writes a Dutch `detail` for the refusals it decides itself (a regime it
          // could not read); a 5xx without one keeps our own sentence rather than a raw
          // Postgres/English message.
          setLoadError(
            res.status === 401
              ? t('aang.sessieVerlopen')
              : (typeof json?.detail === 'string' && json.detail.trim())
                ? json.detail.trim()
                : t('aang.ladenMislukt'),
          )
          return
        }
        setData(json.aangifte)
        setArt29({
          vatClawbackBtw: Number(json.vatClawbackBtw) || 0,
          vatClawbackCount: Number(json.vatClawbackCount) || 0,
          badDebtReclaimableBtw: Number(json.badDebtReclaimableBtw) || 0,
          badDebtCount: Number(json.badDebtCount) || 0,
        })
        setIcp(json.icp ?? null)
        setCorrections(Array.isArray(json.corrections) ? json.corrections : [])
        setCorrectionsUnknown(json.correctionsUnknown === true)
        setFiled((json.filed as Filed | null) ?? null)
        setFiledUnknown(json.filedUnknown === true)
      } catch {
        if (!cancelled) setLoadError(t('aang.geenVerbinding'))
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [year, quarter])

  const teBetalen = data ? data.saldo >= 0 : true
  // [FILED-QUARTER] The difference between what was handed in and what this quarter's data says
  // NOW. Both sides are whole euros already (the route rounds, and 5g is a subtraction of two
  // rounded figures), so this is exact — no epsilon, no "verschil van € 0" from a float.
  // [SUPPLETIE-FANTOOM] Het verschil komt van de SERVER, uit de onafgeronde cijfers. Hier stond
  // `data.saldo - filed.saldo`: het concept-5g (de som van de per rubriek afgeronde bedragen) min
  // een saldo dat in één keer was afgerond. Twee verschillende bewerkingen, dus op een kwartaal
  // waar niemand iets aan veranderde stond hier tot een paar euro — en dan las de eigenaar dat er
  // iets "bij komt" op een aangifte die hij al had ingediend.
  const filedDelta = filed?.saldoDelta ?? 0
  // [AANGIFTE-INGEDIEND] De banner als sleutels — welke zin, beslist door een pure functie.
  // `filed` kan null zijn; dan wordt de banner hieronder toch niet gerenderd en is dit een
  // onschuldige nulwaarde die nergens terechtkomt.
  const bericht = filedNotice({ saldo: filed?.saldo ?? 0, delta: filedDelta })

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 64px' }}>
        {/* [HEADER-SYSTEM] Title "Aangifte" + back live in the shared sub-page bar;
            the in-body h1 was removed. The quarter is shown by the picker below. */}

        {/* [QUARTER] Quarter picker — parity with klaar/resultaat, so a figure and the page
            it links from always refer to the same quarter. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '0 0 16px' }}>
          {[1, 2, 3, 4].map((q) => {
            const active = quarter === q
            return (
              <button key={q} onClick={() => setQuarter(q)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, border: `1px solid ${active ? M3.primary : M3.outlineVariant}`, background: active ? M3.primary : M3.surface, color: active ? '#fff' : M3.onSurface, fontFamily: FONT }}>Q{q}</button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingInlineStart: 6 }}>
            <button onClick={() => setYear((y) => Math.max(2000, y - 1))} title={t('wh.vorigJaar')} style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary, fontSize: 18, lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, minWidth: 38, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear((y) => Math.min(y + 1, curYear))} disabled={year >= curYear} style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: year >= curYear ? 'default' : 'pointer', color: year >= curYear ? M3.outlineVariant : M3.primary, fontSize: 18, lineHeight: 1, opacity: year >= curYear ? 0.5 : 1 }}>›</button>
          </div>
        </div>

        {/* Concept banner — this is NOT a filing.
            [ZELF-INDIENEN] De tweede zin zei tegen iedereen "Je boekhouder controleert en dient
            in", ook tegen de kapster zonder boekhouder. Zij heeft er geen. En geen enkel scherm in
            de app noemde waar of hoe je het dan wél doet: er staat nergens een verwijzing naar
            Mijn Belastingdienst Zakelijk, terwijl de rubriekentabel hieronder het formulier van de
            Belastingdienst letterlijk naspreekt. De hele keten was af op één stap na, en dat was
            de stap waar het geld daadwerkelijk wordt aangegeven.
            [TAAL] En de zin staat nu in de catalogus, waar hij hoort — hij was hard-gecodeerd op
            een scherm dat verder volledig vertaald is. */}
        <div style={{ background: M3.warningContainer, color: M3.warning, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, fontWeight: 600, margin: '10px 0 20px', lineHeight: 1.5 }}>
          ⚠ {t('aang.concept')}{' '}
          {hasAccountant === true ? t('aang.conceptBoekhouder')
            : hasAccountant === false ? t('aang.conceptZelf')
            : ''}
        </div>

        {/* [DEADLINE] Wanneer dit ingediend moet zijn. Het enige scherm dat de datum ooit noemde
            was de reserveringskaart op /dashboard/vandaag — niet in de onderbalk, niet in de
            mobiele kop, en alleen gelinkt vanaf de home als er al iets te laat is. Op het toestel
            dat deze ondernemers werkelijk vasthouden stond de deadline dus nergens.
            Alleen voor een kwartaal dat nog NIET is ingediend: voor een ingediend kwartaal staat
            de banner hierboven al, en die is het echte antwoord. */}
        {!filed && deadline && (
          <div style={{
            background: deadline.state === 'voorbij' ? M3.errorContainer : deadline.state === 'ruim' ? M3.surfaceVariant : M3.warningContainer,
            color: deadline.state === 'voorbij' ? M3.error : deadline.state === 'ruim' ? M3.onSurface : M3.warning,
            borderRadius: 10, padding: '12px 14px', fontSize: 13.5, margin: '0 0 12px', lineHeight: 1.55,
          }}>
            <strong style={{ fontWeight: 700 }}>
              {deadline.state === 'voorbij' ? t('aang.deadline.voorbij', { datum: formatDateNL(deadline.deadline) })
                : deadline.state === 'vandaag' ? t('aang.deadline.vandaag')
                : t('aang.deadline.nog', { datum: formatDateNL(deadline.deadline), dagen: deadline.days })}
            </strong>
          </div>
        )}

        {/* [ZELF-INDIENEN] Het paneel dat de laatste meter beschrijft. Alleen voor wie geen
            boekhouder heeft: wie er wel een heeft krijgt deze instructie niet, want die zou hem
            aanzetten tot iets wat een ander al doet — en twee mensen die dezelfde aangifte
            indienen is erger dan geen van beiden.
            De rubrieknummers staan er letterlijk in omdat ze letterlijk overgenomen moeten worden;
            de tabel hieronder draagt exact dezelfde nummers. */}
        {hasAccountant === false && !filed && (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 12, padding: '14px 16px', margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.6, color: M3.onSurface }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('aang.zelf.titel')}</div>
            <ol style={{ margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>
                {t('aang.zelf.stap1')}{' '}
                <a
                  href="https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/btw"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: M3.primary, fontWeight: 600 }}
                >
                  belastingdienst.nl
                </a>
              </li>
              <li>{t('aang.zelf.stap2')}</li>
              <li>{t('aang.zelf.stap3')}</li>
            </ol>
            <div style={{ marginTop: 8 }}>
              <Link href={`/dashboard/waarheid?year=${year}&quarter=${quarter}`} style={{ color: M3.primary, fontWeight: 700 }}>
                {t('aang.zelf.markeer')}
              </Link>
            </div>
          </div>
        )}

        {/* ── [FILED-QUARTER] Dit kwartaal is al ingediend ────────────────────────────────────
            Alles op deze pagina wordt LIVE herrekend. Voor een kwartaal dat al de deur uit is,
            is dat precies de informatie die ontbrak: de cijfers hieronder zijn niet meer per
            definitie de cijfers die de Belastingdienst heeft. Wijkt het af, dan staat het
            verschil er met naam en toenaam — en gaat de owner naar Waarheid, want daar hoort de
            beslissing (verrekenen of suppletie), niet hier. */}
        {/* `data &&` is not decoration: filedDelta is 0 without it, and 0 is the sentence "komt
            precies overeen" — a claim we cannot make while the concept itself is not loaded. */}
        {filed && data && (
          <div style={{ background: bericht.diverges ? M3.errorContainer : M3.surfaceVariant, color: bericht.diverges ? M3.error : M3.onSurface, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, margin: '0 0 12px', lineHeight: 1.55 }}>
            {/* [AANGIFTE-INGEDIEND] Welke zin hier staat, wordt buiten dit component beslist.
                De banner doet VIER uitspraken uit twee ONAFHANKELIJKE tekens — het ingediende
                saldo (betalen of terugkrijgen) en het verschil met de huidige berekening (erbij
                of eraf) — en één verkeerd gekozen sleutel zegt "te betalen" boven een bedrag dat
                de ondernemer juist terugkrijgt. Dat is geen opmaakfout maar een verkeerde
                uitspraak over geld, op het scherm dat hij opent om te zien of zijn ingediende
                aangifte nog klopt. Die keuze is nu een pure functie met een tabeltest.
                [TAAL] En hele zinnen. Hier stonden zes Nederlandse brokken op een scherm dat wél
                in de vertaalronde zit, en één zin was zelfs GESPLITST: t('aang.jeHebt') gevolgd
                door het letterlijke 'te betalen'. Dat werkt alleen in het Nederlands, en de helft
                die niet in de catalogus staat blijft in élke taal Nederlands. */}
            <strong style={{ fontWeight: 700 }}>
              {t(bericht.titelKey, { datum: formatDateNL(filed.filedAt) })}
            </strong>
            <div style={{ marginTop: 4 }}>
              {bericht.lines.map((r, i) => (
                <span key={r.key}>{i > 0 ? ' ' : ''}{t(r.key, { bedrag: eur.format(r.bedrag) })}</span>
              ))}
            </div>
            {bericht.diverges && (
              <div style={{ marginTop: 6 }}>
                <Link href={`/dashboard/waarheid?year=${year}&quarter=${quarter}`} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline' }}>
                  {t('aang.verschil')}
                </Link>
              </div>
            )}
          </div>
        )}
        {filedUnknown && (
          <div style={{ background: M3.surfaceVariant, color: M3.onSurface, borderRadius: 10, padding: '12px 14px', fontSize: 13, margin: '0 0 12px', lineHeight: 1.55 }}>
            We konden niet controleren of dit kwartaal al is ingediend. Ga er niet van uit dat het
            nog openstaat — ververs de pagina voordat je iets wijzigt.
          </div>
        )}

        {/* [BAD-DEBT] Art. 29 Wet OB — the two things the calendar adds to this quarter that the
            rubrieken above cannot show, because they are not in the invoices of this quarter at
            all. The one that COSTS money stands first and in the error tone: a deduction that
            became payable again grows belastingrente in silence, and this is usually the first
            and only place the owner ever hears about it. Both are amounts to DISCUSS, never
            amounts the app booked — the wording says so. */}
        {art29 && art29.vatClawbackCount > 0 && (
          <div style={{ background: M3.errorContainer, color: M3.error, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, margin: '0 0 12px', lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 700 }}>
              {t('aang.art29.terugbetalenKop', { amount: art29.vatClawbackBtw.toLocaleString('nl-NL') })}
            </strong>
            <div style={{ marginTop: 4 }}>
              {art29.vatClawbackCount === 1 ? t('aang.art29.openEen') : t('aang.art29.openMeer', { n: art29.vatClawbackCount })}
              {' '}{t('aang.art29.clawbackUitleg')}
            </div>
          </div>
        )}
        {art29 && art29.badDebtCount > 0 && (
          <div style={{ background: M3.successContainer, color: M3.success, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, margin: '0 0 12px', lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 700 }}>
              {t('aang.art29.terugvragenKop', { amount: art29.badDebtReclaimableBtw.toLocaleString('nl-NL') })}
            </strong>
            <div style={{ marginTop: 4 }}>
              {art29.badDebtCount === 1 ? t('aang.art29.onbetaaldEen') : t('aang.art29.onbetaaldMeer', { n: art29.badDebtCount })}
              {' '}{t('aang.art29.terugvraagUitleg')}
            </div>
          </div>
        )}

        {loading && <div style={{ color: M3.neutral, fontSize: 14 }}>{t('aang.berekenen')}</div>}

        {/* [LOAD-REASON] Say WHICH failure it was. A concept that cannot be built is not a
            detail: the reasons the route refuses on purpose (it could not read the owner's
            BTW-regeling) have a different answer than a dropped connection, and an expired
            session has one the owner can actually act on. */}
        {!loading && !data && (
          <div style={{ color: M3.neutral, fontSize: 14, lineHeight: 1.55 }}>
            {loadError ?? t('aang.ladenMisluktKort')}
          </div>
        )}

        {data && (
          <>
            {/* Rubrieken */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ background: '#F7F9FB', color: M3.neutral }}>
                      <th style={th}>{t('aang.rubriek')}</th>
                      <th style={{ ...th, textAlign: 'end', fontFamily: FONT_NUM }}>{t('aang.omzet')}</th>
                      <th style={{ ...th, textAlign: 'end', fontFamily: FONT_NUM }}>BTW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.code} style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
                        <td style={td}>
                          <span style={{ fontWeight: 700, fontFamily: FONT_NUM }}>{r.code}</span>
                          <span style={{ color: M3.neutral, marginInlineStart: 8, fontSize: 12.5 }}>{r.label}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'end', fontFamily: FONT_NUM }}>{eur.format(r.omzet)}</td>
                        <td style={{ ...td, textAlign: 'end', fontFamily: FONT_NUM }}>{r.btw ? eur.format(r.btw) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5a / 5b / 5g */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '4px 18px', marginBottom: 16 }}>
              <TotRow label={t('aang.5a')} value={eur.format(data.verschuldigd)} />
              <TotRow label="5b · Voorbelasting" value={`− ${eur.format(data.voorbelasting)}`} />
              <TotRow
                label={teBetalen ? '5g · Concept te betalen' : '5g · Concept terug te ontvangen'}
                value={eur.format(Math.abs(data.saldo))}
                strong color={teBetalen ? M3.onSurface : M3.success}
              />
            </div>

            {/* [SUPPLETIE-VERREKEND] Corrections from earlier quarters that are already at the
                Belastingdienst. Under €1.000 they may be processed in this return — the app has
                been saying so for a while without ever producing the number, which left the owner
                to work out what to carry and from where.

                Its own block, above the ICP one and below the totals, for the same reason ICP has
                one: it is not a rubriek of THIS quarter, and a figure folded into a total that
                reconciles with no invoice of this period is a figure nobody trusts. It is named,
                dated to its source quarter, and placed on the form by the owner or their
                accountant — the app never files anything. */}
            {(corrections.length > 0 || correctionsUnknown) && (
              <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                  {t('aang.correcties')}
                </div>
                {corrections.length > 0 && (
                  <div style={{ fontSize: 13, color: M3.neutral, lineHeight: 1.55, marginBottom: 12 }}>
                    {t('aang.correcties.uitleg')}
                  </div>
                )}
                {corrections.map((c) => (
                  <div key={c.quarter} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: `1px solid ${M3.outlineVariant}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>{c.quarter}</div>
                      <div style={{ fontSize: 12.5, color: M3.neutral }}>
                        {c.outstanding > 0 ? t('aang.correcties.meer') : t('aang.correcties.minder')}
                        {/* What was already carried, when part of this quarter has been. Without it
                            the line and the Waarheid page appear to disagree about the same
                            quarter — one showing the whole movement, the other what is left. */}
                        {Math.abs(c.carriedSaldo) > 0.005 && ` · ${t('aang.correcties.eerderVerwerkt', { amount: eur.format(Math.abs(c.carriedSaldo)) })}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM, whiteSpace: 'nowrap' }}>
                        {eur.format(Math.abs(c.outstanding))}
                      </span>
                      {/* The tick, and it is the owner's. Marking it automatically when this
                          quarter is filed would assume they included it — and when they did not,
                          the app would have closed a duty at the Belastingdienst that still
                          stands. One press, with the amount beside it. */}
                      <button
                        onClick={() => void markCarried(c)}
                        disabled={carrying !== null}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface, fontSize: 12.5, fontWeight: 600, cursor: carrying ? 'default' : 'pointer', opacity: carrying === c.quarter ? 0.6 : 1, whiteSpace: 'nowrap' }}
                      >
                        {carrying === c.quarter ? t('aang.correcties.bezig') : t('aang.correcties.verwerkt')}
                      </button>
                    </div>
                  </div>
                ))}
                {/* Whatever the server said about the last attempt — including its refusals, which
                    are states with a way out named in them ("meer dan €1.000 — dien een suppletie
                    in"). A generic failure line would send the owner at a button that cannot work. */}
                {carryNote && (
                  <div style={{ background: M3.errorContainer, color: M3.error, borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, marginTop: 10 }}>
                    {carryNote}
                  </div>
                )}
                {/* [NO-SILENT-EMPTY] An empty block means "there is nothing to carry". This is the
                    other answer, and on the screen a tax return is filled in from, the two may
                    never look the same. */}
                {correctionsUnknown && (
                  <div style={{ background: M3.errorContainer, color: M3.error, borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, marginTop: corrections.length > 0 ? 10 : 0 }}>
                    {t('aang.correcties.onbekend')}
                  </div>
                )}
              </div>
            )}

            {/* [ICP] The ICP-opgaaf — a SEPARATE declaration, so it gets its own block outside
                the rubriek list. Everything the form asks for is already here (land, BTW-nummer,
                bedrag per klant); what the app cannot do is submit it, and the header says so
                rather than letting a filled-in table imply otherwise. */}
            {icp && (icp.lines.length > 0 || icp.problems.length > 0) && (
              <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                  {t('aang.icp')}
                </div>
                <div style={{ fontSize: 13, color: M3.neutral, lineHeight: 1.55, marginBottom: 12 }}>
                  {t('aang.icp.uitleg1')} {t('aang.icp.uitleg2')}
                </div>
                {icp.lines.map((l) => (
                  <div key={l.vatNumber} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: `1px solid ${M3.outlineVariant}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.clientName ?? l.vatNumber}
                      </div>
                      <div style={{ fontSize: 12.5, color: M3.neutral, fontFamily: FONT_NUM }}>
                        {/* [TAAL] Het zelfstandig naamwoord is geen parameter — zie AGENTS.md. */}
                        {l.invoiceCount === 1
                          ? t('aang.ic.factuurEen', { btw: l.vatNumber })
                          : t('aang.ic.factuurMeer', { btw: l.vatNumber, aantal: l.invoiceCount })}
                      </div>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM, whiteSpace: 'nowrap' }}>
                      {eur.format(l.amountExBtw)}
                    </span>
                  </div>
                ))}
                {icp.lines.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface }}>{t('aang.totaal3b')}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: M3.onSurface, fontFamily: FONT_NUM }}>{eur.format(icp.totalExBtw)}</span>
                  </div>
                )}
                {icp.problems.map((p, i) => (
                  <div key={i} style={{ background: M3.errorContainer, color: M3.error, borderRadius: 10, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, marginTop: 10 }}>
                    <strong style={{ fontWeight: 700 }}>{p.invoiceNumber ?? 'Factuur'}{p.clientName ? ` · ${p.clientName}` : ''}</strong>
                    <div style={{ marginTop: 2 }}>{p.detail}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Honest notes — the trust layer */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '16px 18px' }}>
              <div style={{ fontSize: 12.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
                {t('aang.waarop')}
              </div>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {data.notes.map((n, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: M3.onSurface, lineHeight: 1.6, marginBottom: 6 }}>{n}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TotRow({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderBottom: '1px solid #f1f3f4' }}>
      <span style={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 700 : 500, color: color ?? '#202124' }}>{label}</span>
      <span style={{ fontSize: strong ? 20 : 15, fontWeight: strong ? 700 : 600, color: color ?? '#202124', fontFamily: FONT_NUM }}>{value}</span>
    </div>
  )
}

const th = { padding: '10px 14px', textAlign: 'start' as const, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.03em' }
const td = { padding: '11px 14px', color: '#202124', verticalAlign: 'top' as const }
