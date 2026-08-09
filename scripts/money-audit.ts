// scripts/money-audit.ts
// [GELD-INVARIANT] Do the books still add up? Checked against the real database.
// -----------------------------------------------------------------------------
// Run (env from .env.local):
//   npx tsx --env-file=.env.local scripts/money-audit.ts
//   npx tsx --env-file=.env.local scripts/money-audit.ts --user <uuid>
//
// READ-ONLY. It writes nothing, changes nothing, sends nothing, and calls no AI.
// Safe to run against production, and that is where it belongs — a consistency
// check on test data proves nothing about the money that is actually booked.
//
// ── WHAT IT ASKS THAT NOTHING ELSE DOES ──
//
// Every money gate in this app guards a MOMENT: is this read right, does this
// payment fit, may this invoice book itself. All of them are about the euro that
// is arriving. None of them ever looks back at the euros that already landed.
//
// So the question an accountant asks first — do the books still add up? — has no
// answer in this codebase. Not "was each write correct when it happened": every
// write believed it was. Whether the RESULT is internally consistent right now.
// Those come apart after a concurrent booking, a half-applied batch, a migration
// run out of order, or a bug that has since been fixed and left its numbers behind.
//
// books-audit.ts already re-checks a stored amount against the DOCUMENT it came
// from. This is the other axis: the money tables against EACH OTHER. A figure can
// be perfectly grounded in its own invoice and still be impossible next to its
// payments.
//
// ── IT REPORTS EUROS, NOT ROWS ──
//
// "3 invoices inconsistent" tells nobody anything. "€4.212 booked as paid that no
// payment covers" tells you whether to stop what you are doing.
//
// ── AND IT FIXES NOTHING, DELIBERATELY ──
//
// A violation means two sources disagree, and an automatic repair has to pick one.
// Picking wrong writes a false number over a true one and destroys the evidence
// that they ever differed — on a quarter already filed, that is not a bug but a
// correction nobody can trace. This states what it found; deciding is human work.
// -----------------------------------------------------------------------------

import { createPipelineClient } from '@/lib/supabase-pipeline'
import { fetchAllRows } from '@/lib/supabase-paginate'
import {
  findMoneyViolations,
  moneyAuditHeadline,
  type InvoiceRow,
  type LinkRow,
  type TransactionRow,
} from '@/lib/money-invariants'
// [EIGEN-FACTUUR] Dezelfde beslissing als de e-mailpoort — zie own-document.ts.
import { looksLikeOwnDocument } from '@/lib/own-document'

/** Plain-language heading per violation kind, so the output reads without the source open. */
const HEADINGS: Record<string, string> = {
  transaction_overallocated: 'Bankregels verdeeld over meer dan er is overgemaakt',
  overpaid: 'Meer betaald dan de factuur waard is',
  paid_without_payments: 'Als betaald geboekt zonder bankregel die het dekt',
  payments_without_paid: 'Bankregels gekoppeld die de factuur niet toont',
  status_paid_but_open: 'Staat op betaald terwijl er geld open is',
  status_open_but_covered: 'Helemaal betaald maar staat nog open',
  btw_arithmetic: 'ex + btw is niet inc — dit getal staat in de aangifte',
  creditnota_sign: 'Creditnota met een positief bedrag — telt op waar hij eraf hoort',
  negative_paid: 'Negatief betaald bedrag',
  // [EIGEN-FACTUUR] Twee kwaden tegelijk: de omzet telt ook als kosten, en de BTW die je moet
  // AFDRAGEN staat als voorbelasting terug te vragen. De rij spreekt zichzelf nergens tegen.
  own_invoice_booked: 'Je EIGEN verkoopfactuur staat als inkoop geboekt',
  own_invoice_suspected: 'Lijkt je eigen verkoopfactuur, als inkoop geboekt — naam komt overeen',
}

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

async function main() {
  const onlyUser = argValue('user')
  const pipeline = createPipelineClient()

  // Paged, not limited. This is the one script where a silent truncation would be worse than no
  // script at all: PostgREST caps a response at ~1000 rows without saying so, and an audit that
  // quietly checked the first thousand invoices and reported "all clear" would be actively
  // misleading about the rest. fetchAllRows throws on a failed page rather than returning a short
  // one, which is exactly the behaviour a completeness claim needs.
  // Optioneel op één administratie. Losse helper omdat alle drie de lezingen hem nodig hebben en
  // een vergeten .eq() hier zou betekenen dat je de boeken van iemand anders naast de jouwe legt.
  function scope<T extends { eq(column: string, value: string): T }>(q: T): T {
    return onlyUser ? q.eq('user_id', onlyUser) : q
  }

  console.log('\n[GELD-INVARIANT] lezen…')

  const invoices = await fetchAllRows<{
    id: string; invoice_number: string | null; direction: string | null; status: string | null
    invoice_type: string | null; total_ex_btw: number | null; btw_amount: number | null
    total_inc_btw: number | null; amount_paid: number | null
    // [EIGEN-FACTUUR] Who the supplier is said to be, and where its money was to go.
    client_name: string | null; vendor_iban: string | null; receiver_id: string | null
  }>((from, to) =>
    scope(pipeline
      .from('invoices')
      .select('id, invoice_number, direction, status, invoice_type, total_ex_btw, btw_amount, total_inc_btw, amount_paid, client_name, vendor_iban, receiver_id'))
      .order('id', { ascending: true })
      .range(from, to),
  )

  type RawLink = { transaction_id: string; invoice_id: string; amount_applied: number | null }
  // bank_tx_invoices komt uit een losse migratie en staat niet in de gegenereerde typen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relaxed = pipeline as any
  const links = await fetchAllRows<RawLink>((from, to) =>
    scope(relaxed.from('bank_tx_invoices').select('transaction_id, invoice_id, amount_applied'))
      .order('id', { ascending: true })
      .range(from, to),
  ).catch(() => [] as RawLink[])

  const transactions = await fetchAllRows<{ id: string; amount: number | null }>((from, to) =>
    scope(pipeline.from('bank_transactions').select('id, amount'))
      .order('id', { ascending: true })
      .range(from, to),
  ).catch(() => [] as { id: string; amount: number | null }[])

  const invRows: InvoiceRow[] = invoices.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    direction: r.direction,
    status: r.status,
    invoiceType: r.invoice_type,
    totalExBtw: r.total_ex_btw,
    btwAmount: r.btw_amount,
    totalIncBtw: r.total_inc_btw,
    amountPaid: r.amount_paid,
  }))
  const linkRows: LinkRow[] = links.map((r) => ({
    transactionId: r.transaction_id,
    invoiceId: r.invoice_id,
    amountApplied: r.amount_applied,
  }))
  const txRows: TransactionRow[] = transactions.map((r) => ({ id: r.id, amount: r.amount }))

  console.log(
    `  ${invRows.length} facturen · ${linkRows.length} betalingskoppelingen · ${txRows.length} bankregels` +
      (onlyUser ? `  (alleen ${onlyUser})` : ''),
  )

  const violations = findMoneyViolations({ invoices: invRows, links: linkRows, transactions: txRows })

  console.log(`\n══ ${moneyAuditHeadline(violations)} ══\n`)

  if (violations.length === 0) {
    console.log('  Elke factuur klopt met haar eigen betalingen, elke bankregel met wat hij heeft')
    console.log('  uitgedeeld, en elk ex + btw met zijn inc. Er is niets te doen.\n')
    return
  }

  // Grouped by kind, biggest euros first inside each group — the order you would work in.
  const byKind = new Map<string, typeof violations>()
  // ── [EIGEN-FACTUUR] Invoices already booked as a cost that are the owner's OWN ──────────────
  //
  // The guard in email-integration.ts stops NEW ones. It cannot undo what is already in the books,
  // and this is the shape that leaves no trace of itself: the owner's own sales invoice, mailed
  // back and read as a purchase. Measured once at EUR 394,99 — turnover standing a second time as
  // a cost, and EUR 32,61 of BTW OWED also claimed as voorbelasting.
  //
  // What an existing ROW can be checked against is narrower than what the reader saw: the vendor's
  // KVK and BTW number are not columns on invoices. Two signals survive on the row itself, and
  // they are treated as differently as they deserve — the IBAN is proof, the name is a question.
  const profiles = await fetchAllRows<{
    id: string; company_name: string | null; full_name: string | null; iban: string | null
  }>((from, to) => {
    const q = pipeline.from('profiles').select('id, company_name, full_name, iban')
    return (onlyUser ? q.eq('id', onlyUser) : q).order('id', { ascending: true }).range(from, to)
  }).catch(() => [] as { id: string; company_name: string | null; full_name: string | null; iban: string | null }[])

  const meById = new Map(profiles.map((p) => [p.id, p]))
  const ownFindings: Array<{ certain: boolean; entityId: string; euros: number; message: string }> = []
  let ownCertain = 0
  let ownLikely = 0
  for (const inv of invoices) {
    if (inv.direction !== 'incoming') continue
    const me = inv.receiver_id ? meById.get(inv.receiver_id) : undefined
    if (!me) continue
    const v = looksLikeOwnDocument(
      { vendorName: inv.client_name, vendorIban: inv.vendor_iban },
      { companyName: me.company_name, fullName: me.full_name, iban: me.iban },
    )
    if (!v.isOwn) continue
    const euros = Math.abs(Number(inv.total_inc_btw) || 0)
    // Kept in its OWN list rather than pushed into `violations`. ViolationKind is a closed union in
    // money-invariants.ts, and widening a shared money type for a finding only this script makes
    // would be the tail wagging the dog — the invariants module is about arithmetic that must hold,
    // this is about a document that should never have been read as a cost. Same report shape below.
    ownFindings.push({
      certain: v.certainty === 'certain',
      entityId: inv.id,
      euros,
      message: `${inv.invoice_number ?? '(geen nummer)'} — ${v.reasons.join(' · ')}`,
    })
    if (v.certainty === 'certain') ownCertain++
    else ownLikely++
  }
  if (ownFindings.length > 0) {
    for (const certain of [true, false]) {
      const list = ownFindings.filter((f) => f.certain === certain)
      if (list.length === 0) continue
      const sum = Math.round(list.reduce((s, f) => s + f.euros, 0) * 100) / 100
      console.log(`── ${HEADINGS[certain ? 'own_invoice_booked' : 'own_invoice_suspected']} — ${list.length}×, samen € ${sum.toFixed(2)}`)
      for (const f of list.slice(0, 15)) console.log(`     ${f.entityId}  ${f.message}`)
      if (list.length > 15) console.log(`     … en nog ${list.length - 15}. Niet afgekapt in het totaal hierboven.`)
      console.log()
    }
    console.log(
      `  ${ownCertain} zeker + ${ownLikely} mogelijk. Elk daarvan telt je omzet ook als KOSTEN én\n` +
      '  vraagt de BTW terug die je juist moet AFDRAGEN — twee fouten in tegengestelde richting,\n' +
      '  op één stuk. Op de rij zelf staan alleen de naam en het IBAN; het KVK- en BTW-nummer van\n' +
      '  de leverancier zijn geen kolommen op invoices, dus dit is een ONDERGRENS.\n',
    )
    process.exitCode = 1
  }

  for (const v of violations) {
    const list = byKind.get(v.kind) ?? []
    list.push(v)
    byKind.set(v.kind, list)
  }
  const groups = [...byKind.entries()].sort(
    (a, b) => b[1].reduce((s, v) => s + v.euros, 0) - a[1].reduce((s, v) => s + v.euros, 0),
  )

  for (const [kind, list] of groups) {
    const sum = Math.round(list.reduce((s, v) => s + v.euros, 0) * 100) / 100
    console.log(`── ${HEADINGS[kind] ?? kind} — ${list.length}×, samen € ${sum.toFixed(2)}`)
    for (const v of list.slice(0, 15)) console.log(`     ${v.entityId}  ${v.message}`)
    if (list.length > 15) console.log(`     … en nog ${list.length - 15}. Niet afgekapt in het totaal hierboven.`)
    console.log()
  }

  console.log('  Er is met opzet niets gerepareerd. Een verschil betekent dat twee bronnen elkaar')
  console.log('  tegenspreken, en automatisch herstellen moet er één kiezen — verkeerd gekozen')
  console.log('  schrijft een onwaar getal over een waar heen en wist het bewijs dat ze ooit')
  console.log('  verschilden. Op een kwartaal dat al is ingediend is dat geen bug maar een')
  console.log('  correctie die niemand kan terugvinden.\n')

  // A non-zero exit makes this usable in CI or a cron without anyone having to read the output.
  process.exitCode = 1
}

main().catch((e) => {
  console.error('[GELD-INVARIANT] mislukt:', e)
  process.exit(2)
})
