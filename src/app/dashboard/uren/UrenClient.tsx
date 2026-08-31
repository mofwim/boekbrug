'use client'

// src/app/dashboard/uren/UrenClient.tsx
// [UREN] De gewerkte uren, en wat ervan nog te factureren valt.
//
// WAT DIT SCHERM DOET, EN WAAROM HET ZO WEINIG IS
//
// Opschrijven, en in één keer omzetten in een factuur. Geen projecten, geen budgetten, geen timer
// die meeloopt — zie de kop van de migratie voor waarom die bij een ander product horen. Het lek
// dat dit dicht is klein en duur: uren die in een schrift staan worden overgetikt, en overtikken
// lekt maar één kant op. Een vergeten uur wordt nooit gefactureerd.
//
// TWEE DINGEN DIE HIER GEEN AANNAME ZIJN
//
// 1. "Nog te factureren" komt van de KOLOM (invoice_id), niet van een berekening over datums of
//    statussen. Dit scherm rekent er alleen omheen; uren.ts doet de som en de database bewaart het
//    antwoord. Zo kan dezelfde vraag niet op twee plekken twee antwoorden krijgen.
// 2. Een bedrag dat een uur zonder tarief weglaat ZEGT DAT. `withoutRate` staat naast het totaal,
//    want een bedrag dat de ondernemer niet kan narekenen tegen de lijst eronder is erger dan geen
//    bedrag.
//
// [TAAL] Dit onderdeel heeft geen eigen taal: elke zin komt uit messages.ts en de richting reist
// mee met de woorden. De rijen komen als props binnen, zodat tests/render het kan aanroepen zonder
// sessie en zonder database — en dan met rijen die de takken écht raken.

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { M3, R, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
import { localeDir } from '@/lib/i18n/locale'
import { useToast } from '@/components/ui/Toast'
import { useDialog } from '@/components/ui/Dialog'
import { failureText } from '@/lib/server-message'
// [TZ] De kalender van de ondernemer (Europe/Amsterdam), nooit de UTC-dag van de server.
import { amsterdamToday } from '@/lib/format-nl'
import { URENCRITERIUM_HOURS, type UrencriteriumLevel, type UrencriteriumStatus } from '@/lib/urencriterium'
// [DATE-NL] Een native date-input volgt de taal van de BROWSER voor de volgorde van zijn
// segmenten, dus een ondernemer op een Engelstalig systeem tikt mm-dd-jjjj in een Nederlands
// veld. Dit veld typt in dd-mm-jjjj en zegt terug welke datum het begrepen heeft.
import DateFieldNL from '@/components/ui/DateFieldNL'
import { groupBillable, entryValue, isBillable, MAX_HOURS_PER_ENTRY, type TimeEntry } from '@/lib/uren'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

/** A customer card, in the shape the picker needs. */
export interface UrenClientCard { id: string; name: string }

type Tab = 'open' | 'billed'
type Form = { id: string | null; client_id: string; worked_on: string; description: string; hours: string; hourly_rate: string }

// [TZ] amsterdamToday, niet toISOString(). Tussen middernacht en 02:00 zomertijd is de UTC-dag de
// VORIGE dag, dus een uur dat om 00:30 wordt opgeschreven zou op gisteren worden geboekt — en de
// datum van dit uur wordt straks de datum op de factuurregel van de klant.
const emptyForm = (): Form => ({
  id: null, client_id: '', worked_on: amsterdamToday(),
  description: '', hours: '', hourly_rate: '',
})

/**
 * [URENCRITERIUM] One sentence per state, never one sentence with the state pasted into it.
 *
 * Typed against MessageKey so a key that does not exist is a build error rather than a screen that
 * renders `uren.criterium.achter` to an owner reading Turkish.
 */
const URENCRITERIUM_SENTENCE: Record<UrencriteriumLevel, MessageKey> = {
  unknown: 'uren.criterium.onbekend',
  not_tracked: 'uren.criterium.nietbijgehouden',
  met: 'uren.criterium.gehaald',
  too_early: 'uren.criterium.tevroeg',
  on_track: 'uren.criterium.opkoers',
  behind: 'uren.criterium.achter',
  critical: 'uren.criterium.kritiek',
  unreachable: 'uren.criterium.onhaalbaar',
  closed_met: 'uren.criterium.afgeslotengehaald',
  closed_missed: 'uren.criterium.afgeslotengemist',
}

export default function UrenClient({
  initialEntries, clients, loadFailed = false, urencriterium = null,
}: {
  initialEntries: TimeEntry[]
  clients: UrenClientCard[]
  /** [NO-SILENT-EMPTY] The server could not READ. That is not an empty week. */
  loadFailed?: boolean
  /** [URENCRITERIUM] Where the year stands against the 1.225 hours. Decided in urencriterium.ts. */
  urencriterium?: UrencriteriumStatus | null
}) {
  const router = useRouter()
  const locale = useLocale()
  const t = translator(locale)
  const dir = localeDir(locale)
  const toast = useToast()
  const dialog = useDialog()

  const [entries, setEntries] = useState<TimeEntry[]>(initialEntries)
  const [failed, setFailed] = useState(loadFailed)
  const [tab, setTab] = useState<Tab>('open')
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  // The owner's own currency and number formats. Amounts are Dutch money whatever the language is.
  const eur = useMemo(() => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }), [])
  const nameOf = useCallback(
    (id: string | null) => clients.find((c) => c.id === id)?.name ?? t('uren.veld.geenKlant'),
    [clients, t],
  )

  // [REACT] Afgeleid tijdens de RENDER, niet in een effect. Zodra de server nieuwe rijen stuurt
  // (een refresh van de pagina) is de oude lijst betekenisloos, en `setState` in een effect zet
  // eerst de oude op het scherm en daarna de nieuwe — eslint noemt dat cascading renders, en de
  // ondernemer ziet zijn urenlijst één frame lang verkeerd. Zelfde patroon als SearchBar.
  const [seeded, setSeeded] = useState(initialEntries)
  if (seeded !== initialEntries) {
    setSeeded(initialEntries)
    setEntries(initialEntries)
    setFailed(loadFailed)
  }

  const groups = useMemo(() => groupBillable(entries), [entries])
  const billed = useMemo(() => entries.filter((e) => !isBillable(e)), [entries])

  async function reload() {
    try {
      const res = await fetch('/api/uren?all=1')
      const json = await res.json()
      if (!res.ok) { setFailed(true); return }
      setEntries(json.entries ?? [])
      setFailed(false)
    } catch { setFailed(true) }
  }

  async function save() {
    if (!form) return
    setBusy(true)
    try {
      const payload = {
        id: form.id ?? undefined,
        client_id: form.client_id || null,
        worked_on: form.worked_on,
        description: form.description,
        // A Dutch keyboard types 1,5 — accepting only 1.5 would refuse the number the owner meant.
        hours: form.hours.replace(',', '.'),
        hourly_rate: form.hourly_rate.trim() === '' ? null : form.hourly_rate.replace(',', '.'),
      }
      const res = await fetch('/api/uren', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // [SERVER-ZIN] The server's sentence when it has one — it names the field. Never a code.
        toast(failureText(res.status, json, t('uren.fout.opslaan')), { tone: 'error' })
        return
      }
      setForm(null)
      await reload()
    } catch {
      toast(t('uren.fout.opslaan'), { tone: 'error' })
    } finally { setBusy(false) }
  }

  async function remove(entry: TimeEntry) {
    const sure = await dialog.confirm({
      title: t('uren.verwijderen.vraag'),
      message: t('uren.verwijderen.uitleg'),
      confirmLabel: t('uren.verwijderen'),
      cancelLabel: t('uren.annuleren'),
      danger: true,
    })
    if (!sure) return
    setBusy(true)
    try {
      const res = await fetch(`/api/uren?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast(failureText(res.status, json, t('uren.fout.opslaan')), { tone: 'error' }); return }
      await reload()
    } catch { toast(t('uren.fout.opslaan'), { tone: 'error' }) } finally { setBusy(false) }
  }

  /**
   * Turn one customer's unbilled hours into a concept invoice.
   *
   * Only the ids travel. The SERVER builds the lines from the stored hours and stamps them in the
   * same request, so the invoice and "these hours are billed" are one outcome instead of two —
   * see the [UREN-EENMALIG] block in /api/invoice/draft.
   */
  async function invoice(clientId: string | null, ids: string[]) {
    setBusy(true)
    try {
      const res = await fetch('/api/invoice/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time_entry_ids: ids,
          client_id: clientId,
          client_name: nameOf(clientId),
          // The route needs these to exist; it applies its own checks to both.
          invoice_date: amsterdamToday(),
          lines: [],
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.invoiceId) {
        toast(failureText(res.status, json, t('uren.fout.factuur')), { tone: 'error' })
        await reload()
        return
      }
      router.push(`/dashboard/invoice/${json.invoiceId}/edit`)
    } catch {
      toast(t('uren.fout.factuur'), { tone: 'error' })
    } finally { setBusy(false) }
  }

  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: M3.neutral, marginBottom: 4, textAlign: 'start' }
  const input: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
    fontFamily: FONT, fontSize: 15, textAlign: 'start', background: '#fff', color: '#202124',
  }

  return (
    <div dir={dir} style={{
      // [COLUMN-LADDER] maxWidth, niet een spread van COLUMN: dat object is `{ hub, work }`
      // en spreiden zette er `hub:480px;work:680px` in de stijl — geen geldige CSS, en dus
      // een pagina zonder kolom. De render-gate ving dat; zie tokens.ts voor de ladder.
      maxWidth: COLUMN.work, margin: '0 auto', fontFamily: FONT, padding: '16px 16px 96px',
    }}>
      {/* [DEUR] De naam van het scherm staat in de gedeelde balk (chrome.uren in DashboardChrome),
          precies zoals bij Kas en Artikelen — twee koppen boven elkaar is wat je krijgt als je er
          één toevoegt zonder de andere weg te halen. De ondertitel blijft: die zegt iets wat de
          balk niet kan zeggen. */}
      <p style={{ fontSize: 14, color: M3.neutral, margin: '0 0 16px', textAlign: 'start' }}>{t('uren.subtitel')}</p>

      {/* [NO-SILENT-EMPTY] A read that failed says so. "Je hebt niets openstaan" on a broken
          database is the one message the owner should never have trusted. */}
      {failed && (
        <div role="alert" style={{
          padding: '10px 12px', borderRadius: R.sm, background: '#FFF8E1',
          borderInlineStart: `3px solid ${M3.warning}`, marginBottom: 12, fontSize: 13, textAlign: 'start',
        }}>{t('uren.fout.laden')}</div>
      )}

      {/* [URENCRITERIUM] Waar het jaar staat tegenover de 1.225 uur, zolang er nog iets aan te
          doen is. Boven de knoppen: dit is de reden om uren op te schrijven die je niet factureert,
          en onder de lijst zou niemand het lezen.

          Het onderdeel heeft geen eigen taal en geen eigen rekenwerk — urencriterium.ts bepaalt de
          stand, messages.ts levert de zin, en elke stand heeft een EIGEN sleutel. */}
      {urencriterium && (
        <section style={{
          padding: '12px 14px', borderRadius: R.sm, marginBottom: 16, fontSize: 13, textAlign: 'start',
          background: urencriterium.warn ? '#FFF8E1' : '#F1F8F4',
          borderInlineStart: `3px solid ${urencriterium.warn ? M3.warning : M3.primary}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('uren.criterium.titel')}</div>
          {/* [NO-SILENT-EMPTY] Bij een mislukte lezing is er geen getal en geen balk — een balk op
              nul zou zeggen "je hebt niets gewerkt", en dat is niet wat er gebeurd is. */}
          {urencriterium.hours !== null && (
            <>
              <div style={{ color: M3.neutral, marginBottom: 6 }}>
                {t('uren.criterium.voortgang', {
                  uren: urencriterium.hours.toLocaleString('nl-NL'),
                  jaar: urencriterium.year,
                })}
              </div>
              {/* Een balk zegt in één blik wat een zin in drie regels zegt. aria-hidden: de zin
                  eronder draagt dezelfde informatie voor wie hem niet ziet. */}
              <div aria-hidden style={{ height: 6, borderRadius: 3, background: '#E0E0E0', marginBottom: 8 }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${Math.min(100, Math.round((urencriterium.hours / URENCRITERIUM_HOURS) * 100))}%`,
                  background: urencriterium.warn ? M3.warning : M3.primary,
                }} />
              </div>
            </>
          )}
          <p style={{ margin: '0 0 6px' }}>
            {t(URENCRITERIUM_SENTENCE[urencriterium.level], {
              verwacht: (urencriterium.projected ?? 0).toLocaleString('nl-NL'),
              resterend: urencriterium.remaining.toLocaleString('nl-NL'),
              dagen: urencriterium.daysLeft,
              perweek: (urencriterium.neededPerWeek ?? 0).toLocaleString('nl-NL'),
              jaar: urencriterium.year,
            })}
          </p>
          {/* Staan er ALTIJD bij, ook bij 'gehaald': wie het dit jaar haalde neemt volgend jaar
              dezelfde aanname mee, en dit zijn de twee die het duurst zijn. */}
          <p style={{ margin: '0 0 4px', color: M3.neutral }}>{t('uren.criterium.tellenmee')}</p>
          <p style={{ margin: 0, color: M3.neutral }}>{t('uren.criterium.geendeeljaar')}</p>
        </section>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setForm(emptyForm())} disabled={busy} style={{
          padding: '10px 16px', borderRadius: R.sm, border: 'none', background: M3.primary,
          color: '#fff', fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>{t('uren.nieuw')}</button>
        {(['open', 'billed'] as Tab[]).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={{
            padding: '10px 14px', borderRadius: R.sm, cursor: 'pointer', fontFamily: FONT, fontSize: 14,
            border: `1px solid ${tab === k ? M3.primary : M3.outline}`,
            background: tab === k ? '#E8F0FE' : '#fff', color: tab === k ? M3.primary : M3.neutral,
          }}>{k === 'open' ? t('uren.teFactureren') : t('uren.gefactureerd')}</button>
        ))}
      </div>

      {form && (
        <div style={{ background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <div>
              <label style={label} htmlFor="uren-datum">{t('uren.veld.datum')}</label>
              <DateFieldNL id="uren-datum" value={form.worked_on} style={input}
                onChange={(v) => setForm({ ...form, worked_on: v })} />
            </div>
            <div>
              <label style={label} htmlFor="uren-klant">{t('uren.veld.klant')}</label>
              <select id="uren-klant" value={form.client_id} style={input}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">{t('uren.veld.geenKlant')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={label} htmlFor="uren-aantal">{t('uren.veld.uren')}</label>
              <input id="uren-aantal" inputMode="decimal" value={form.hours} style={input}
                max={MAX_HOURS_PER_ENTRY}
                onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="uren-tarief">{t('uren.veld.tarief')}</label>
              <input id="uren-tarief" inputMode="decimal" value={form.hourly_rate} style={input}
                onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} />
              <span style={{ fontSize: 11, color: M3.neutral, display: 'block', marginTop: 4, textAlign: 'start' }}>
                {t('uren.veld.tariefHint')}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label} htmlFor="uren-omschrijving">{t('uren.veld.omschrijving')}</label>
            <input id="uren-omschrijving" value={form.description} style={input}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <span style={{ fontSize: 11, color: M3.neutral, display: 'block', marginTop: 4, textAlign: 'start' }}>
              {t('uren.veld.omschrijvingHint')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={save} disabled={busy} style={{
              padding: '10px 16px', borderRadius: R.sm, border: 'none', background: M3.primary,
              color: '#fff', fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}>{busy ? t('uren.bezig') : t('uren.opslaan')}</button>
            <button type="button" onClick={() => setForm(null)} disabled={busy} style={{
              padding: '10px 16px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
              background: '#fff', color: M3.neutral, fontFamily: FONT, fontSize: 14, cursor: 'pointer',
            }}>{t('uren.annuleren')}</button>
          </div>
        </div>
      )}

      {tab === 'open' && groups.length === 0 && !failed && (
        <div style={{ background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 24, textAlign: 'start' }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{t('uren.leeg.titel')}</div>
          <div style={{ fontSize: 14, color: M3.neutral }}>{t('uren.leeg.uitleg')}</div>
        </div>
      )}

      {tab === 'open' && groups.map((g) => (
        <section key={g.clientId ?? 'geen'} style={{
          background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 16, marginBottom: 12,
        }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div style={{ fontSize: 16, fontWeight: 600, textAlign: 'start' }}>{nameOf(g.clientId)}</div>
            <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 600, textAlign: 'end' }}>
              {eur.format(g.amountExBtw)}
            </div>
          </header>
          <div style={{ fontSize: 12, color: M3.neutral, marginTop: 2, textAlign: 'start' }}>
            {g.hours} {t('uren.urenKort')}
          </div>

          {/* The amount above deliberately EXCLUDES entries without a rate. Saying so is the whole
              point: a total the owner cannot reconcile against the list below it is worse than none. */}
          {g.withoutRate > 0 && (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: R.sm, background: '#FFF8E1',
              borderInlineStart: `3px solid ${M3.warning}`, fontSize: 12, textAlign: 'start',
            }}>
              {g.withoutRate === 1 ? t('uren.zonderTarief.een') : t('uren.zonderTarief.meer', { n: g.withoutRate })}
            </div>
          )}

          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {g.entries.map((e) => {
              const value = entryValue(e)
              return (
                <li key={e.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline',
                  padding: '8px 0', borderTop: `1px solid ${M3.surfaceVariant}`, flexWrap: 'wrap',
                }}>
                  <div style={{ flex: '1 1 200px', textAlign: 'start' }}>
                    <div style={{ fontSize: 14 }}>{e.description}</div>
                    <div style={{ fontSize: 12, color: M3.neutral, fontFamily: FONT_NUM }}>
                      {e.worked_on} · {e.hours} {t('uren.urenKort')}
                    </div>
                  </div>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 14, textAlign: 'end' }}>
                    {value === null ? t('uren.geenTarief') : eur.format(value)}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" disabled={busy} onClick={() => setForm({
                      id: e.id, client_id: e.client_id ?? '', worked_on: e.worked_on,
                      description: e.description, hours: String(e.hours),
                      hourly_rate: e.hourly_rate === null ? '' : String(e.hourly_rate),
                    })} style={{
                      padding: '6px 10px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
                      background: '#fff', color: M3.neutral, fontFamily: FONT, fontSize: 12, cursor: 'pointer',
                    }}>{t('uren.bewerken')}</button>
                    <button type="button" disabled={busy} onClick={() => remove(e)} style={{
                      padding: '6px 10px', borderRadius: R.sm, border: `1px solid ${M3.outline}`,
                      background: '#fff', color: M3.neutral, fontFamily: FONT, fontSize: 12, cursor: 'pointer',
                    }}>{t('uren.verwijderen')}</button>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Only the entries that CAN be billed travel. An hour without a rate stays here rather
              than going out at zero — see linesFromEntries. */}
          <button
            type="button"
            disabled={busy || g.entries.length === g.withoutRate}
            onClick={() => invoice(g.clientId, g.entries.filter((e) => entryValue(e) !== null).map((e) => e.id))}
            style={{
              marginTop: 12, padding: '10px 16px', borderRadius: R.sm, border: 'none',
              background: g.entries.length === g.withoutRate ? M3.surfaceVariant : M3.primary,
              color: g.entries.length === g.withoutRate ? M3.neutral : '#fff',
              fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >{t('uren.maakFactuur')}</button>
        </section>
      ))}

      {tab === 'billed' && (
        <section style={{ background: '#fff', borderRadius: R.md, boxShadow: EL1, padding: 16 }}>
          <div style={{ fontSize: 12, color: M3.neutral, marginBottom: 8, textAlign: 'start' }}>
            {t('uren.staatOpFactuurUitleg')}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {billed.map((e) => (
              <li key={e.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline',
                padding: '8px 0', borderTop: `1px solid ${M3.surfaceVariant}`, flexWrap: 'wrap',
              }}>
                <div style={{ flex: '1 1 200px', textAlign: 'start' }}>
                  <div style={{ fontSize: 14 }}>{e.description}</div>
                  <div style={{ fontSize: 12, color: M3.neutral, fontFamily: FONT_NUM }}>
                    {e.worked_on} · {e.hours} {t('uren.urenKort')} · {nameOf(e.client_id)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: M3.neutral, textAlign: 'end' }}>{t('uren.staatOpFactuur')}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
