// src/app/dashboard/incoming/manage/page.tsx
// [BRIDGE-POLISH 3b] Server wrapper for the incoming-invoice MANAGEMENT surface.
// Mirrors facturen/page.tsx: auth -> profile -> pass to the client component.
//
// Scope (decided with M): this surface manages CONFIRMED incoming invoices
// (status 'received' = unpaid Crediteur, or 'paid'). The verification QUEUE
// (status 'processing' / 'archived') stays in incoming/IncomingInvoicesClient.
// So this page fetches only received + paid incoming rows for the current user
// as RECEIVER. No hook reuse (useInfiniteInvoices is sender_id-only); a plain
// server fetch is passed as initial data and the client manages it locally.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
// [PAGINATION] pages past PostgREST's silent ~1000-row cap — see supabase-paginate.ts
import { fetchAllRows } from '@/lib/supabase-paginate'
import IncomingManageClient from './IncomingManageClient'
// [SCAN-WHOLE-BOOK] The count must cover the whole book, not the window this page renders.
import { scanInvoices, type InvoiceScan, type ScanRow } from '@/lib/invoice-scan'
// [READING-MEMORY] The same supplier memory the verify queue shows — one shared read.
import { readingHintFor, vendorKey } from '@/lib/reading-memory'
import { getSessionUser } from '@/lib/session-user'
import { loadReadingMemory } from '@/lib/reading-memory-source'
// [LEVERANCIER-KIEZEN] The payload cap for the supplier picker — see supplier-suggest.ts.
import { SUPPLIER_PICK_LIMIT } from '@/lib/supplier-suggest'
import type { ComponentProps } from 'react'
// [OPENSTAAND-BEWIJS] Is anything on the pay list already settled in the bank? See the block below.
import { collectOpenInvoiceProof } from '@/lib/open-invoice-proof-collect'
// [BETAALBEWIJS] The bank line under every "Betaald" — see the block below.
import { collectPaymentEvidence } from '@/lib/payment-evidence-collect'

// Row shape the client expects — derived from its props (the type itself is not exported).
type IncomingRow = ComponentProps<typeof IncomingManageClient>['initialInvoices'][number]

// Exactly the columns the management UI needs — payment fields + accountant_status
// for the read-only 'Verwerkt' badge (3b-2). No amounts edited here, but shown.
// [CREDITNOTA-SIGNAL] invoice_type was missing here, so this screen could not even SEE the
// difference between an invoice and a credit note — no badge, no minus sign, and a credit counting
// as a debt in "still to pay". The column has existed from the start (database.sql:327) and is
// filled properly by intake/upload/reimport; only this screen never asked for it.
const COLS =
  'id, invoice_number, client_name, status, accountant_status, direction, invoice_type, total_inc_btw, amount_paid, total_ex_btw, btw_amount, untaxed_amount, invoice_date, due_date, payment_method, payment_date, created_at, document_id, pdf_url, vendor_iban, payment_reference, payment_prepared_at, field_confidence'

// [VRIJGESTELD] The cost-attribution column, asked for ONLY by an owner who declared exempt
// turnover. Two reasons it is not simply appended to COLS above:
//
//  · deploy safety — before vat_exemption.sql is applied the column does not exist, and naming a
//    missing column fails the WHOLE select. That would not be a missing field on this screen, it
//    would be an empty Crediteuren for everyone, including the owners this feature never touches.
//  · it is dead weight for them anyway: with no exempt turnover there is nothing to apportion.
const COLS_VRIJGESTELD = COLS + ', vat_deduction'

/**
 * [WATERVAL] Turn a settled promise back into a value or a throw.
 *
 * The reads on this page each handle their own failure, and that is the point of them: an empty
 * list here reads as "you owe nobody anything" ([NO-SILENT-EMPTY]). Running them together must not
 * take that away, so the wave uses allSettled and this hands each rejection back to the block that
 * was always meant to catch it — the code below is unchanged in what it does with a failure.
 */
function settled<T>(r: PromiseSettledResult<T>): T {
  if (r.status === 'rejected') throw r.reason
  return r.value
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // ── [WATERVAL] Zeven lezingen die niet op elkaar hoeven te wachten ─────────────────
  //
  // Ze stonden onder elkaar met een `await` ervoor: elf keer heen en weer naar de database voordat
  // dit scherm iets liet zien. En dit is het scherm waar de ondernemer VANAF BETAALT — het traagste
  // scherm van de app was uitgerekend het scherm waar hij het vaakst wacht.
  //
  // Geen van deze zeven wil iets van de ander weten; ze kennen allemaal alleen user.id. Wat er WEL
  // van afhangt blijft eronder staan: de kolomlijst hangt aan het profiel (`cols`), de facturenrijen
  // hangen aan die kolomlijst, en de deeplink-lezing hangt aan die rijen. Die volgorde is echt en
  // blijft dus echt.
  //
  // allSettled, niet all: elk blok hieronder handelt zijn EIGEN mislukking af, en dat is op dit
  // scherm het halve verhaal ([NO-SILENT-EMPTY]). Met Promise.all zou de eerste mislukte lezing de
  // andere zes meesleuren en de pagina omvertrekken — precies het tegenovergestelde van wat die
  // blokken doen. settled() geeft de worp terug aan het blok dat hem hoort te vangen.
  const [profileS, countS, scanS, memoryS, filedS, incassoS, supplierListS, paramsS] = await Promise.allSettled([
    supabase.from('profiles').select('*').eq('id', user.id).single(),

    // [INVOICE-COUNTER] Het WARE aantal bevestigde inkoopfacturen — zie de toelichting verderop,
    // bij het blok dat er iets mee doet.
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .in('status', ['received', 'paid']),

    // [SCAN-WHOLE-BOOK] De scan over het HELE boek — zie de toelichting verderop.
    fetchAllRows<ScanRow>((from, to) => supabase
      .from('invoices')
      .select('id, invoice_number, client_name, invoice_date, invoice_type, total_ex_btw, btw_amount, total_inc_btw')
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .in('status', ['received', 'paid'])
      // [PAGE-KEY] by id, for the same reason the open-rows query below uses it: created_at ties
      // have no defined order, so across .range() windows a row could be served twice or skipped.
      .order('id', { ascending: true })
      .range(from, to)
    ),

    loadReadingMemory(supabase, user.id),

    // btw_filings is not in the generated types yet — the same cast /api/btw/file uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('btw_filings').select('year, quarter').eq('user_id', user.id) as Promise<{ data: { year: number; quarter: number }[] | null; error: { message: string } | null }>,

    // auto_incasso is added by auto_incasso.sql and not yet in the generated types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('suppliers').select('name_key').eq('user_id', user.id).eq('auto_incasso', true) as Promise<{ data: { name_key: string | null }[] | null; error: { message: string } | null }>,

    // [LEVERANCIER-KIEZEN] De leveranciers die deze eigenaar al heeft — voor het naamveld in het
    // leveranciersformulier onderaan het documentblad. Een aparte lezing en niet de rij hierboven:
    // die is gefilterd op auto_incasso, en dat is een handjevol van de lijst.
    supabase
      .from('suppliers')
      .select('id, name, iban')
      .eq('user_id', user.id)
      .order('name')
      .limit(SUPPLIER_PICK_LIMIT),

    searchParams,
  ])

  const { data: profile } = settled(profileS)

  if (!profile) redirect('/login')

  // [VRIJGESTELD] Which column list this render uses — see COLS_VRIJGESTELD. Read off the profile
  // that was just fetched with select('*'), so a deployment where the migration has not run yet
  // simply has no such property and lands on the plain COLS.
  const exemptOwner = !!(profile as { vat_exempt_activity?: boolean | null }).vat_exempt_activity
  const cols = exemptOwner ? COLS_VRIJGESTELD : COLS

  // Confirmed incoming invoices where the current user is the RECEIVER.
  // RLS already scopes to the user; the explicit receiver_id + direction keep
  // the query precise. 'received' (unpaid Crediteur) and 'paid' only.
  //
  // [INBOX-CROWD-OUT] Fetched as TWO queries, not one. The old single query
  // (received+paid mixed, newest 200 by created_at) let a stream of newly
  // imported/paid rows push an older UNPAID invoice off the list entirely —
  // it stayed on Vandaag's "Te betalen" (which reads ALL received rows) but
  // was invisible and thus unpayable here. Unpaid rows are the actionable
  // ones: they get their own query, and it is PAGED — see [PAGINATION] below,
  // where the old "a limit no real backlog reaches" turned out to be exactly
  // the limit PostgREST silently truncates at.
  //
  // [NO-SILENT-EMPTY] Both reads dropped their error, and on THIS screen that is the worst
  // possible answer to give. `const { data }` without `error` is not a smaller answer: supabase-js
  // does not throw, it returns `{ data: null, error }`, so a failed read became `[]` and the page
  // rendered its empty state — "Geen inkoopfacturen". This is the list the owner PAYS from, so
  // that sentence reads as "je hoeft niemand te betalen". Nothing else on the screen contradicted
  // it: the search box and the counter line are both hidden when the list is empty. Same rule as
  // the Kas page and the Brug: the page still renders, but it SAYS that it could not look.
  const readFailed: string[] = []
  const readOrFlag = async <T,>(label: string, run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run()
    } catch (e) {
      console.error('[NO-SILENT-EMPTY] inkoopfacturen source read failed', { userId: user.id, source: label, error: e instanceof Error ? e.message : String(e) })
      readFailed.push(label)
      return []
    }
  }

  const [receivedRows, paidRows] = await Promise.all([
    // [PAGINATION] The open rows are PAGED, not capped. `.limit(1000)` sat exactly on PostgREST's
    // own ~1000-row ceiling (supabase-paginate.ts:1-6) — which truncates SILENTLY — so a backlog
    // of 1200 was indistinguishable from a complete list of 1000. And because the order was
    // created_at DESC, what fell off was the OLDEST unpaid invoices: the most overdue ones, the
    // exact rows [INBOX-CROWD-OUT] above exists to keep reachable. A row that is not here cannot
    // be paid from here.
    // [PAGE-KEY] Ordered by id (unique), never created_at: two invoices imported in the same
    // batch share a created_at to the microsecond, and Postgres defines no order among ties, so
    // across .range() windows a row could be served twice or skipped. The client sorts the list
    // itself on every render (sortRows, default 'added_desc'), so the read order costs nothing.
    readOrFlag('openstaande facturen', () => fetchAllRows((from, to) => supabase
      .from('invoices')
      .select(cols)
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .eq('status', 'received')
      .order('id', { ascending: true })
      .range(from, to)
    )),
    // The paid side stays a deliberate WINDOW (the 200 most recent), disclosed to the owner by
    // the counter below — an archive of paid invoices does not have to be complete to pay from.
    readOrFlag('betaalde facturen', async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(cols)
        .eq('receiver_id', user.id)
        .eq('direction', 'incoming')
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw new Error(error.message)
      return data ?? []
    }),
  ])

  const rows = [...receivedRows, ...paidRows] as unknown as IncomingRow[]

  // [INVOICE-COUNTER] The TRUE number of confirmed inkoopfacturen — not the number the two
  // queries above happened to return. The paid query stops at 200, so a real backlog is larger
  // than the list; the counter in the client derives its breakdown from the loaded rows (so it
  // stays live while the owner pays and matches), and uses this number to SAY that the list is
  // capped instead of quietly presenting 200 as "all you have". head+exact = a count, no rows.
  // Null on failure → the client simply omits the disclosure, never guesses a total. That one was
  // honest already; its error is read only so a failing count is visible in the logs instead of
  // looking like an owner who happens to have none.
  const { count: totalCount, error: countErr } = settled(countS)
  if (countErr) console.error('[INVOICE-COUNTER] count read failed — disclosure omitted', { userId: user.id, error: countErr.message })

  // [SCAN-WHOLE-BOOK] The scan runs over EVERY confirmed inkoopfactuur, not over the list.
  //
  // The client also scans, and has to: that is what puts a badge on a row. But the two answer
  // different questions, and only one of them is "how many are wrong". `rows` above is every OPEN
  // invoice plus the 200 most recent PAID ones — a deliberate window that is right for a screen you
  // pay from, and wrong for a count. A purchase invoice booked with a broken breakdown and since
  // paid went into the aangifte just as wrong as an unpaid one, and beyond the 200th it would have
  // been invisible to a banner that nonetheless announced a total.
  //
  // That is the failure this whole line keeps coming back to: a bounded read presented as a
  // complete answer. So the count comes from a read that is bounded by nothing but the owner's
  // actual history — eight small columns, paged past PostgREST's silent ~1000 ceiling.
  //
  // [NO-SILENT-EMPTY] null on failure, never an empty scan. "0 facturen kloppen niet" is the single
  // most dangerous sentence this screen could produce out of a failed query.
  let bookScan: InvoiceScan | null = null
  try {
    const scanRows = settled(scanS)
    bookScan = scanInvoices(scanRows)
  } catch (e) {
    console.error('[SCAN-WHOLE-BOOK] scan read failed — the banner says it could not look', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    bookScan = null
  }

  // [READING-MEMORY] The same supplier memory the verify queue shows. It belongs here too: this is
  // the OTHER door through which the owner corrects a misread invoice, and the correction modal is
  // the same checking moment — "you have fixed the btw at this supplier three times" is worth
  // knowing while you are typing the fourth. Recorded from here already; now also shown here.
  const readingMemory = settled(memoryS)
  const readingHints: Record<string, string> = {}
  for (const r of rows) {
    const hint = readingHintFor(r.client_name, readingMemory)
    if (hint) readingHints[vendorKey(r.client_name)] = hint
  }

  // [INVOICE-SCAN] Which quarters has the owner already FILED? That single fact changes what a
  // wrong invoice means: in an open quarter a correction is just a correction, in a filed one it is
  // a correction to the return itself. The scan on the client counts and groups; this read supplies
  // the one piece it cannot know.
  //
  // [NO-SILENT-EMPTY] A failed read must not come back as "nothing is filed" — that would tell the
  // owner they can freely correct a quarter that is already closed. null means "we could not look",
  // and the banner says so instead of guessing.
  let filedQuarters: string[] | null = []
  try {
    const { data, error } = settled(filedS)
    if (error) throw new Error(error.message)
    filedQuarters = (data ?? []).map((f: { year: number; quarter: number }) => `${f.year}-Q${f.quarter}`)
  } catch (e) {
    // A missing table (the migration is applied by hand) is not the same as a failed read, but for
    // this banner both mean the same thing: we cannot say which quarters are closed, so we do not.
    console.error('[INVOICE-SCAN] filed-quarter read failed — banner omits the filed warning', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    filedQuarters = null
  }

  // [AUTO-INCASSO] Which suppliers collect their own invoices. The screen needs it to do the one
  // thing that matters most here: NOT offer "Betalen" on an invoice the bank already took. Sent as
  // normalized name keys, the same key the registry stores, so a row imported before the supplier
  // registry existed (with only a client_name) is recognised too.
  //
  // [NO-SILENT-EMPTY] `null` on a failed read, never an empty set. An empty set means "no supplier
  // is on incasso", and this screen acts on that by showing the Betalen button again — on invoices
  // that were already collected. A read that could not run must not be able to say that, so the
  // client keeps every incasso row in its incasso state and only the switch goes quiet.
  let incassoKeys: string[] | null = []
  try {
    const { data, error } = settled(incassoS)
    if (error) throw new Error(error.message)
    incassoKeys = (data ?? []).map((s: { name_key: string | null }) => s.name_key).filter(Boolean) as string[]
  } catch (e) {
    // A missing column (the migration has not been applied yet) is the ordinary case on a fresh
    // deploy and means exactly "nobody is on incasso" — but so does a failed read, and those two
    // must not arrive as the same answer on the screen the owner pays from.
    console.error('[AUTO-INCASSO] supplier read failed — the screen keeps its incasso rows guarded', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    incassoKeys = null
  }

  // [LEVERANCIER-KIEZEN] [NO-SILENT-EMPTY] Een mislukte lezing is niet "je hebt geen leveranciers":
  // bij een lege lijst zegt het naamveld dat opslaan een nieuwe leverancier maakt, bij een mislukte
  // lezing dat de lijst niet geladen kon worden. Alleen deze twee zinnen hangen eraan — de facturen
  // op dit scherm staan er los van, dus dit gaat bewust niet in readFailed.
  let supplierList: { id: string; name: string; iban: string | null }[] = []
  let supplierListFailed = false
  try {
    const { data, error } = settled(supplierListS)
    if (error) throw new Error(error.message)
    supplierList = ((data ?? []) as { id: string; name: string; iban: string | null }[])
      .filter((s) => typeof s.name === 'string' && s.name.trim() !== '')
  } catch (e) {
    console.error('[LEVERANCIER-KIEZEN] supplier list read failed', { userId: user.id, error: e instanceof Error ? e.message : String(e) })
    supplierListFailed = true
  }

  // [INBOX-CROWD-OUT] Deep-link guarantee: Vandaag routes here with ?focus={id}
  // (and ?action=pay). If that row still fell outside the fetched window (e.g. a
  // paid row beyond the 200 cap), fetch it by id so the focus/pay flow always
  // lands. Same receiver/direction/status guards — never someone else's row.
  const { focus } = settled(paramsS)
  if (focus && !rows.some((r) => r.id === focus)) {
    const { data: focused, error: focusErr } = await supabase
      .from('invoices')
      .select(cols)
      .eq('id', focus)
      .eq('receiver_id', user.id)
      .eq('direction', 'incoming')
      .in('status', ['received', 'paid'])
      .maybeSingle()
    // A failed lookup is not "that invoice does not exist" — the deep link simply does not land.
    // Logged rather than flagged: the list itself is fine, and one unopened notification is not
    // worth putting a warning over a working screen.
    if (focusErr) console.error('[INBOX-CROWD-OUT] focus lookup failed — deep link did not land', { userId: user.id, focus, error: focusErr.message })
    if (focused) rows.unshift(focused as unknown as IncomingRow)
  }

  // [BETAALBEWIJS] Under every "Betaald" on this screen, the bank line that says so.
  //
  // The list has always shown the word and never read bank_tx_invoices, so it carried no evidence:
  // to check it the owner had to open their bank in another tab — the work this app exists to
  // remove, handed back at the moment trust is being asked for. And a payment PROVEN by a bank line
  // and one the owner ticked by hand rendered identically, which lends a third party's authority to
  // a memory.
  //
  // Two reads for the whole screen, not two per row. Never blocking: a failure leaves every row
  // 'unknown', which the screen states rather than dressing up as "no evidence".
  const paymentEvidence = await collectPaymentEvidence({
    pipeline: supabase,
    ownerId: user.id,
    invoiceIds: rows.map((r) => r.id).filter((id): id is string => typeof id === 'string'),
    // The totals come along so a link from before amount_applied existed can be valued: it settled
    // its invoice in full, and reading its NULL as 0 made this line report "geen betaling
    // gekoppeld" about an invoice with a bank line on it.
    totals: Object.fromEntries(
      rows.filter((r) => typeof r.id === 'string').map((r) => [r.id as string, r.total_inc_btw ?? null]),
    ),
  }).catch((e) => {
    console.error('[BETAALBEWIJS] evidence failed — the list still renders', {
      userId: user.id, error: e instanceof Error ? e.message : String(e),
    })
    return {}
  })

  // [OPENSTAAND-BEWIJS] The other direction, and the one nobody ever asked: is anything on this
  // list — the list the owner PAYS from — already settled in their bank?
  //
  // Everything else on this screen is a conclusion. "Openstaand: € 8.914" is an assertion the owner
  // can only check by redoing the work the app exists to do, and that is where the doubt lives. So
  // the screen now reports the SEARCH: how many bills were held against how many bank lines, and up
  // to which day the bank data reaches. Empty is the normal answer and the reassuring one — but only
  // because the two counts are beside it.
  //
  // Never blocking, and never a reason to withhold the list: a proof that could not run leaves the
  // page exactly as it was, and says so.
  const openProof = await collectOpenInvoiceProof({ pipeline: supabase, ownerId: user.id })
    .catch((e) => {
      console.error('[OPENSTAAND-BEWIJS] proof failed — the list still renders', {
        userId: user.id, error: e instanceof Error ? e.message : String(e),
      })
      return null
    })

  return (
    <IncomingManageClient
      profile={profile}
      openProof={openProof}
      paymentEvidence={paymentEvidence}
      initialInvoices={rows}
      totalCount={totalCount ?? null}
      readFailed={readFailed}
      filedQuarters={filedQuarters}
      bookScan={bookScan}
      readingHints={readingHints}
      incassoKeys={incassoKeys}
      suppliers={supplierList}
      suppliersUnavailable={supplierListFailed}
    />
  )
}
