// src/app/dashboard/verkoop/page.tsx
// [NAMENS] Het scherm van de verkoopmedewerker.
//
// Eén scherm, en dat is het hele ontwerp. Hij maakt facturen voor het bedrijf van zijn baas en
// ziet wat hij zelf heeft gemaakt — verder niets: geen bank, geen kas, geen omzet, geen
// facturen van collega's.
//
// WAAR DE GRENS ECHT LIGT
// Niet hier. De query hieronder draait met de SESSIE van de medewerker, dus RLS beslist:
// invoices_member_read geeft alleen rijen met sender_id = acting_for_owner() EN
// created_by = auth.uid(). Zou dit bestand morgen een filter vergeten, dan krijgt hij nog steeds
// niets extra's terug. Dat is met opzet zo gebouwd: het scherm is de presentatie, niet het slot.
//
// Wat er WEL van dit bestand afhangt is de eerlijkheid van de tekst — dat hij weet dat hij
// namens iemand anders factureert, en onder wiens naam die facturen uitgaan.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { getActingFor } from '@/lib/acting-for-server'
import { isNamens } from '@/lib/acting-for'
import { FONT, M3, R } from '@/lib/design/tokens'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Verkoop — BoekBrug' }

const EURO = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export default async function VerkoopPage() {
  const acting = await getActingFor()
  if (!acting) redirect('/login')

  // Een eigenaar hoort hier niet: hij heeft /dashboard/facturen, waar álles staat. Dit scherm
  // zou hem een halve waarheid tonen.
  if (!isNamens(acting)) redirect('/dashboard/facturen')

  const supabase = await createServerSupabaseClient()

  // Sessie-client, dus RLS is de grens. De .eq() hieronder is de leesfilter uit acting-for.ts,
  // hier alleen om de query klein te houden — niet als beveiliging.
  //
  // [DEPLOY-SAFE] `as any` op de SESSIE-client, niet op service_role: invoices.created_by staat
  // nog niet in de gegenereerde types (die worden pas na de migratie bijgewerkt). De cast raakt
  // alleen het typen — de query draait nog steeds onder de sessie van de medewerker, dus RLS
  // beslist onverminderd wat hij terugkrijgt.
  const { data: facturen } = await (supabase as unknown as {
    from: (t: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (c: string) => any
    }
  })
    .from('invoices')
    .select('id, invoice_number, client_name, invoice_date, total_inc_btw, status, invoice_type')
    .eq('sender_id', acting.ownerId)
    .eq('created_by', acting.actorId)
    .order('created_at', { ascending: false })
    .limit(100) as {
      data: Array<{
        id: string; invoice_number: string | null; client_name: string | null
        invoice_date: string | null; total_inc_btw: number | null; status: string | null
        invoice_type: string | null
      }> | null
    }

  // De naam van het bedrijf waarvoor hij werkt. Het profiel van de eigenaar is voor zijn sessie
  // onleesbaar (RLS), dus via service_role — en pas nádat de koppeling is bewezen, wat hierboven
  // is gebeurd: getActingFor() geeft alleen een andere ownerId terug bij een geldige koppeling.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = createPipelineClient() as any
  const { data: baas } = await pipeline
    .from('profiles')
    .select('company_name, full_name')
    .eq('id', acting.ownerId)
    .single()
  const bedrijf = baas?.company_name || baas?.full_name || 'je werkgever'

  const rijen = facturen ?? []
  const verstuurd = rijen.filter((f) => f.status !== 'draft').length

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px 48px' }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>
          Facturen maken
        </h1>

        {/* [NAMENS] De belangrijkste zin op dit scherm. Iemand die facturen uitgeeft onder het
            BTW-nummer van een ander hoort dat te WETEN, en niet te moeten afleiden. */}
        <p style={{ fontSize: 14.5, color: M3.neutral, margin: '0 0 20px', lineHeight: 1.55 }}>
          Je maakt facturen namens <strong style={{ color: M3.onSurface }}>{bedrijf}</strong>. Ze gaan uit
          op hun naam en BTW-nummer, met hun doorlopende factuurnummers. Hieronder staat alleen wat
          jij zelf hebt gemaakt.
        </p>

        <Link
          href="/dashboard/invoice/new"
          style={{
            display: 'inline-block', background: M3.primary, color: M3.onPrimary,
            padding: '12px 22px', borderRadius: 999, textDecoration: 'none',
            fontWeight: 600, fontSize: 15,
          }}
        >
          Nieuwe factuur →
        </Link>

        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: 0 }}>Jouw facturen</h2>
            <span style={{ fontSize: 13, color: M3.mutedText }}>
              {rijen.length === 0 ? 'nog geen' : `${rijen.length} totaal · ${verstuurd} verstuurd`}
            </span>
          </div>

          {rijen.length === 0 ? (
            <div style={{
              background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg,
              padding: '28px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14.5,
            }}>
              Je hebt nog geen facturen gemaakt. Begin met de knop hierboven.
            </div>
          ) : (
            <div style={{ background: M3.surface, border: `1px solid ${M3.hairline}`, borderRadius: R.lg, overflow: 'hidden' }}>
              {rijen.map((f, i) => (
                <Link
                  key={f.id}
                  href={`/dashboard/invoice/${f.id}`}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 16px', textDecoration: 'none', color: 'inherit',
                    borderTop: i === 0 ? 'none' : `1px solid ${M3.outlineVariant}`,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.client_name || 'Zonder klant'}
                    </div>
                    <div style={{ fontSize: 12.5, color: M3.mutedText, marginTop: 2 }}>
                      {/* Een concept heeft nog GEEN nummer, en dat is geen ontbrekend gegeven maar
                          de waarheid: het nummer wordt pas bij versturen uitgegeven (Art. 35). */}
                      {f.invoice_number ?? 'concept — nog geen nummer'}
                      {f.invoice_date ? ` · ${f.invoice_date}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: M3.onSurface }}>
                      {EURO.format(Number(f.total_inc_btw ?? 0))}
                    </div>
                    <div style={{
                      fontSize: 11.5, fontWeight: 700, marginTop: 3,
                      color: f.status === 'draft' ? M3.warning : M3.success,
                    }}>
                      {f.status === 'draft' ? 'concept' : 'verstuurd'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Eerlijk over wat hij NIET ziet. Beter dan dat hij het zelf ontdekt en denkt dat er
            iets stuk is. */}
        <p style={{ fontSize: 12.5, color: M3.mutedText, marginTop: 22, lineHeight: 1.6 }}>
          Je ziet hier bewust niet de bankrekening, de omzet of de facturen van collega&apos;s van {bedrijf}.
          Klopt er iets niet aan een verstuurde factuur? Vraag het aan {bedrijf} — een verstuurde
          factuur heeft een wettelijk nummer en kan niet zomaar worden aangepast.
        </p>
      </div>
    </div>
  )
}
