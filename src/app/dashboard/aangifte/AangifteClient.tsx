'use client'

// src/app/dashboard/aangifte/AangifteClient.tsx
// [AANGIFTE] The concept BTW-aangifte, in the Belastingdienst rubriek layout. Every
// figure is derived from the owner's own imported data (see /api/aangifte); the notes
// state exactly what each depends on. It is loudly a CONCEPT — never a filing.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { quarterFromParams } from '@/lib/quarter'
import { M3, FONT, FONT_NUM } from '@/lib/design/tokens'

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

export default function AangifteClient() {
  const sp = useSearchParams()
  // [QUARTER] Honour ?year&quarter (e.g. from the readiness card's link), else default to
  // the last COMPLETED quarter — the same default klaar uses — so the two never disagree.
  const initial = quarterFromParams((k) => sp.get(k))
  const [year, setYear] = useState(initial.year)
  const [quarter, setQuarter] = useState<number>(initial.quarter)
  const [data, setData] = useState<Aangifte | null>(null)
  const [art29, setArt29] = useState<Art29 | null>(null)
  const [icp, setIcp] = useState<Icp | null>(null)
  const [loading, setLoading] = useState(true)
  const curYear = new Date().getFullYear()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // De reset staat binnen de async-functie maar vóór de eerste await: hij draait dus in
      // dezelfde tick als voorheen. Het verschil is dat de compiler nu kan zien dat er geen
      // synchrone setState in de effect-body zelf zit.
      setLoading(true); setData(null); setArt29(null); setIcp(null)
      try {
        const res = await fetch(`/api/aangifte?year=${year}&quarter=${quarter}`)
        const json = await res.json()
        if (!cancelled && res.ok) {
          setData(json.aangifte)
          setArt29({
            vatClawbackBtw: Number(json.vatClawbackBtw) || 0,
            vatClawbackCount: Number(json.vatClawbackCount) || 0,
            badDebtReclaimableBtw: Number(json.badDebtReclaimableBtw) || 0,
            badDebtCount: Number(json.badDebtCount) || 0,
          })
          setIcp(json.icp ?? null)
        }
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [year, quarter])

  const teBetalen = data ? data.saldo >= 0 : true

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6 }}>
            <button onClick={() => setYear((y) => Math.max(2000, y - 1))} title="Vorig jaar" style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary, fontSize: 18, lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, minWidth: 38, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear((y) => Math.min(y + 1, curYear))} disabled={year >= curYear} style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: year >= curYear ? 'default' : 'pointer', color: year >= curYear ? M3.outlineVariant : M3.primary, fontSize: 18, lineHeight: 1, opacity: year >= curYear ? 0.5 : 1 }}>›</button>
          </div>
        </div>

        {/* Concept banner — this is NOT a filing. */}
        <div style={{ background: M3.warningContainer, color: M3.warning, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, fontWeight: 600, margin: '10px 0 20px', lineHeight: 1.5 }}>
          ⚠ Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte.
          Je boekhouder controleert en dient in.
        </div>

        {/* [BAD-DEBT] Art. 29 Wet OB — the two things the calendar adds to this quarter that the
            rubrieken above cannot show, because they are not in the invoices of this quarter at
            all. The one that COSTS money stands first and in the error tone: a deduction that
            became payable again grows belastingrente in silence, and this is usually the first
            and only place the owner ever hears about it. Both are amounts to DISCUSS, never
            amounts the app booked — the wording says so. */}
        {art29 && art29.vatClawbackCount > 0 && (
          <div style={{ background: M3.errorContainer, color: M3.error, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, margin: '0 0 12px', lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 700 }}>
              €{art29.vatClawbackBtw.toLocaleString('nl-NL')} voorbelasting terugbetalen
            </strong>
            <div style={{ marginTop: 4 }}>
              {art29.vatClawbackCount === 1 ? '1 inkoopfactuur staat' : `${art29.vatClawbackCount} inkoopfacturen staan`}
              {' '}meer dan een jaar na de vervaldatum open. De BTW die je hierover in aftrek bracht wordt
              dan weer verschuldigd (art. 29 lid 7 Wet OB). Heb je ze wél betaald? Koppel de betaling of zet
              ze op betaald. Dit bedrag zit <strong>niet</strong> in de rubrieken hierboven.
            </div>
          </div>
        )}
        {art29 && art29.badDebtCount > 0 && (
          <div style={{ background: M3.successContainer, color: M3.success, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, margin: '0 0 12px', lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 700 }}>
              €{art29.badDebtReclaimableBtw.toLocaleString('nl-NL')} BTW terug te vragen
            </strong>
            <div style={{ marginTop: 4 }}>
              {art29.badDebtCount === 1 ? '1 verkoopfactuur staat' : `${art29.badDebtCount} verkoopfacturen staan`}
              {' '}meer dan een jaar na de vervaldatum onbetaald. De BTW die je hierover afdroeg kun je
              terugvragen (oninbare vordering, art. 29 Wet OB). Ook dit bedrag zit <strong>niet</strong> in
              de rubrieken hierboven — bespreek het tijdvak met je boekhouder.
            </div>
          </div>
        )}

        {loading && <div style={{ color: M3.neutral, fontSize: 14 }}>Berekenen…</div>}

        {!loading && !data && (
          <div style={{ color: M3.neutral, fontSize: 14 }}>Kon de concept-aangifte niet laden.</div>
        )}

        {data && (
          <>
            {/* Rubrieken */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ background: '#F7F9FB', color: M3.neutral }}>
                      <th style={th}>Rubriek</th>
                      <th style={{ ...th, textAlign: 'right', fontFamily: FONT_NUM }}>Omzet</th>
                      <th style={{ ...th, textAlign: 'right', fontFamily: FONT_NUM }}>BTW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.code} style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
                        <td style={td}>
                          <span style={{ fontWeight: 700, fontFamily: FONT_NUM }}>{r.code}</span>
                          <span style={{ color: M3.neutral, marginInlineStart: 8, fontSize: 12.5 }}>{r.label}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: FONT_NUM }}>{eur.format(r.omzet)}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: FONT_NUM }}>{r.btw ? eur.format(r.btw) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5a / 5b / 5g */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '4px 18px', marginBottom: 16 }}>
              <TotRow label="5a · Verschuldigde omzetbelasting" value={eur.format(data.verschuldigd)} />
              <TotRow label="5b · Voorbelasting" value={`− ${eur.format(data.voorbelasting)}`} />
              <TotRow
                label={teBetalen ? '5g · Concept te betalen' : '5g · Concept terug te ontvangen'}
                value={eur.format(Math.abs(data.saldo))}
                strong color={teBetalen ? M3.onSurface : M3.success}
              />
            </div>

            {/* [ICP] The ICP-opgaaf — a SEPARATE declaration, so it gets its own block outside
                the rubriek list. Everything the form asks for is already here (land, BTW-nummer,
                bedrag per klant); what the app cannot do is submit it, and the header says so
                rather than letting a filled-in table imply otherwise. */}
            {icp && (icp.lines.length > 0 || icp.problems.length > 0) && (
              <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                  ICP-opgaaf · aparte aangifte
                </div>
                <div style={{ fontSize: 13, color: M3.neutral, lineHeight: 1.55, marginBottom: 12 }}>
                  Leveringen aan ondernemers in de EU (rubriek 3b hierboven) moet je óók per BTW-nummer opgeven.
                  Dit is <strong>geen onderdeel</strong> van de BTW-aangifte en wordt hier <strong>niet</strong> ingediend.
                </div>
                {icp.lines.map((l) => (
                  <div key={l.vatNumber} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: `1px solid ${M3.outlineVariant}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.clientName ?? l.vatNumber}
                      </div>
                      <div style={{ fontSize: 12.5, color: M3.neutral, fontFamily: FONT_NUM }}>
                        {l.vatNumber} · {l.invoiceCount} {l.invoiceCount === 1 ? 'factuur' : 'facturen'}
                      </div>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM, whiteSpace: 'nowrap' }}>
                      {eur.format(l.amountExBtw)}
                    </span>
                  </div>
                ))}
                {icp.lines.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface }}>Totaal · gelijk aan 3b</span>
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
                Waar dit op gebaseerd is
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

const th = { padding: '10px 14px', textAlign: 'left' as const, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.03em' }
const td = { padding: '11px 14px', color: '#202124', verticalAlign: 'top' as const }
