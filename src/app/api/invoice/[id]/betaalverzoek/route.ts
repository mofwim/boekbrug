// src/app/api/invoice/[id]/betaalverzoek/route.ts
// [BETAALVERZOEK] Owner-only: mint (or return) the public payment-request link for
// one outgoing invoice, plus the payment details to preview (owner IBAN, amount,
// invoice number as reference, and the EPC/SEPA QR payload). Session client → RLS,
// scoped by sender_id. No money movement — this only creates a shareable link to a
// public /pay page the customer opens to pay from THEIR OWN bank.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { buildBetaalverzoek, type BetaalverzoekInvoice } from '@/lib/betaalverzoek'
import { SITE_URL } from '@/lib/site'
// [NAMENS] Omgebouwd in plaats van dichtgezet. Een betaalverzoek is een LINK naar een factuur
// die al is uitgegeven — geen geldbeweging, geen nieuw document, en het IBAN erop is dat van de
// eigenaar. Het hoort dus bij het werk van wie de factuur maakte: hij factureert om betaald te
// worden. Stond dit dicht, dan zag een medewerker op zijn eigen factuur een knop die 403 gaf.
import { getActingFor } from '@/lib/acting-for-server'
import { factuurEigenaar, isNamens, magFactuur } from '@/lib/acting-for'
import { createPipelineClient } from '@/lib/supabase-pipeline'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // [NAMENS] Wie handelt hier, namens wie? Voor een eigenaar verandert er niets.
  const acting = await getActingFor()
  if (!acting) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const ownerId = factuurEigenaar(acting)

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  // Owner-scoped fetch (RLS + explicit sender_id). Only the fields the logic needs.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, direction, invoice_type, status, invoice_number, payment_reference, total_inc_btw, amount_paid, client_name, pay_token, due_date, sender_id')
    .eq('id', id)
    .eq('sender_id', ownerId)
    .single()
  if (!invoice) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })

  // [NAMENS] Tweede slot naast RLS. Een medewerker maakt alleen een betaallink voor een factuur
  // die HIJ heeft gemaakt — niet voor die van zijn baas of een collega. Dit is het moment waarop
  // een geraden id binnenkomt, en het gevolg is een deelbare link naar andermans bedrag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!magFactuur(acting, invoice as any)) {
    return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
  }

  // The owner's OWN payout details — the beneficiary of the QR.
  const { data: owner } = await (isNamens(acting) ? createPipelineClient() : supabase)
    .from('profiles')
    // [NAMENS] Het IBAN op de betaallink is dat van de EIGENAAR — het is zijn factuur. Voor een
    // medewerker is die profielrij via RLS onleesbaar, dus dan langs service_role; anders zou de
    // link stranden op "geen IBAN bekend" terwijl het gewoon is ingevuld.
    .select('iban, company_name, full_name')
    .eq('id', ownerId)
    .single()

  // [CREDITNOTA-NO-CHASE] Refuse to mint a link for an invoice the owner already withdrew. The
  // public page 404s a credited invoice, so without this the owner copies a link that is
  // guaranteed to be dead — while this modal still shows them an IBAN, a QR and the full amount
  // to quote by hand. Refusing here keeps the route and the pay page saying the same thing.
  const { data: creditRows, error: creditErr } = await supabase
    .from('invoices')
    .select('id')
    .eq('original_invoice_id', id)
    .eq('invoice_type', 'creditnota')
    .limit(1)
  if (creditErr || (creditRows ?? []).length > 0) {
    return NextResponse.json(
      { error: 'Voor deze factuur is een creditnota gemaakt — er kan geen betaalverzoek meer voor worden gedeeld.' },
      { status: 400 }
    )
  }

  const built = buildBetaalverzoek(invoice as BetaalverzoekInvoice, owner ?? { iban: null, company_name: null, full_name: null })
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })

  // Mint a random, unguessable token on first use; reuse it afterwards so the link
  // is stable (the customer may keep it). Scoped update — RLS enforces ownership.
  let token = invoice.pay_token as string | null
  if (!token) {
    token = crypto.randomUUID()
    const { error: upErr } = await supabase
      .from('invoices')
      .update({ pay_token: token })
      .eq('id', id)
      .eq('sender_id', ownerId)
    if (upErr) return NextResponse.json({ error: 'Betaallink aanmaken mislukt' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    url: `${SITE_URL}/pay/${token}`,
    token,
    beneficiaryName: built.beneficiaryName,
    iban: built.iban,
    amount: built.amount,
    reference: built.reference,
    epcPayload: built.epcPayload,
  })
}
