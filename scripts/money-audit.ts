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
  findDrawerViolations,
  moneyAuditHeadline,
  type InvoiceRow,
  type LinkRow,
  type TransactionRow,
  type DrawerViolation,
} from '@/lib/money-invariants'
// [GELD-INVARIANT-KAS] The drawer is checked by ASKING the app's own reconciler what it still wants
// to change, never by re-deriving what the kasboek should hold — see findDrawerViolations.
import { loadCashSettlementState } from '@/lib/cash-settle'
// [KAS-ZACHT] One definition of "the movements that still count" — see cash-live.ts.
import { liveCashEntries } from '@/lib/cash-live'
import { computeCashSettlementSync } from '@/lib/cash'
import { loadDrawerWitness } from '@/lib/drawer-witness'
// The quarter whose BTW is actually due — the same default every surface in the app uses, and the
// one the filing gate refuses a negative drawer on.
import { lastCompletedQuarter } from '@/lib/quarter'
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
  // [GELD-INVARIANT-KAS] De la, achterstevoren gelezen.
  drawer_settlement_missing: 'Contant betaald, maar de kas beweegt niet — kassaldo staat te hoog',
  drawer_settlement_orphan: 'Kasregel zonder contante betaling — kassaldo staat te laag',
  drawer_settlement_stale: 'De factuur is gecorrigeerd, de kasregel volgde niet',
  drawer_negative: 'Kassaldo onder nul — dit blokkeert de aangifte',
}

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}

const eurStr = (n: number) =>
  `€ ${Math.abs(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * [GELD-INVARIANT-KAS] Is every owner's cash book still in step with the invoices it settles?
 *
 * Per OWNER, not in one sweep, because both halves are owner-scoped by definition: which invoices
 * are settled in cash, and what the drawer's running balance does. It reads the same two sides the
 * app reconciles with (loadCashSettlementState) and asks the app's own pure reconciler what it still
 * wants to change — anything it wants is a state that survived the reconcile on every kasboek read
 * and the hourly cron.
 *
 * An owner whose read FAILS is named and skipped, never counted as clean. That is the whole
 * discipline of this script: a check that did not run may not look like one that passed.
 */
async function auditDrawers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  onlyUser: string | null,
): Promise<{ findings: Array<DrawerViolation & { ownerId: string }>; checked: number; unreadable: string[] }> {
  const findings: Array<DrawerViolation & { ownerId: string }> = []
  const unreadable: string[] = []

  // Only owners who actually keep a drawer. A ZZP with no cash is not "clean", it has nothing to
  // check, and printing it as checked would inflate the coverage this script claims.
  let ownerIds: string[]
  if (onlyUser) {
    ownerIds = [onlyUser]
  } else {
    // [KAS-ZACHT] Owners with a LIVE drawer. A user whose only cash rows are removed has no cash
    // book to check, and counting them would inflate the coverage this script claims.
    const live = await liveCashEntries(pipeline)
    const rows = await fetchAllRows<{ user_id: string }>((from, to) =>
      live.only(pipeline.from('cash_entries').select('user_id')).order('user_id', { ascending: true }).range(from, to),
    ).catch(() => [] as { user_id: string }[])
    ownerIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  }
  if (ownerIds.length === 0) return { findings, checked: 0, unreadable }

  const { year, quarter } = lastCompletedQuarter()
  console.log(`\n[GELD-INVARIANT-KAS] ${ownerIds.length} kasadministratie(s) · negatief saldo getoetst op Q${quarter} ${year}`)

  for (const ownerId of ownerIds) {
    try {
      const state = await loadCashSettlementState(pipeline, ownerId)
      if (!state.ok) { unreadable.push(ownerId); continue }
      const sync = computeCashSettlementSync(state.paid, state.existing)

      // The drawer's worst day, from the SAME witness readiness and /api/btw/file block on. It
      // throws rather than guessing a €0 float, so a failure here means "not checked" as well.
      let lowestPoint: { date: string; balance: number } | null = null
      try {
        lowestPoint = (await loadDrawerWitness({ client: pipeline, ownerId, year, quarter })).lowestPoint
      } catch {
        unreadable.push(ownerId)
      }

      for (const v of findDrawerViolations({ settlementEntries: state.existing, sync, lowestPoint })) {
        findings.push({ ...v, ownerId })
      }
    } catch {
      unreadable.push(ownerId)
    }
  }
  return { findings, checked: ownerIds.length - new Set(unreadable).size, unreadable }
}

/**
 * [KAS-SPOOR] What has been taken OUT of a cash book, and what its starting float was set to.
 *
 * Not an invariant — nothing here is wrong by itself. It is the one question a cash administration
 * cannot answer from its own rows, because a cash_entries delete is a HARD delete: the audit trail
 * is the only place the removed movement still exists. And kas_opening_balance shifts every
 * eindsaldo in the owner's whole history, filed quarters included, so a change to it belongs next to
 * the drawer figures rather than buried in a log.
 *
 * The trail starts when the [KAS-SPOOR] actions were added, so an empty section means "nothing
 * recorded since then" — never "nothing ever happened". It says so.
 */
async function auditDrawerTrail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any,
  onlyUser: string | null,
): Promise<{ removed: Array<{ ownerId: string; when: string; amount: number; text: string }>; floatChanges: Array<{ ownerId: string; when: string; text: string }> }> {
  const removed: Array<{ ownerId: string; when: string; amount: number; text: string }> = []
  const floatChanges: Array<{ ownerId: string; when: string; text: string }> = []
  const rows = await fetchAllRows<{
    user_id: string; action: string; created_at: string | null
    old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null
  }>((from, to) => {
    const q = pipeline
      .from('audit_logs')
      .select('user_id, action, created_at, old_value, new_value')
      .in('action', ['cash.entry_removed', 'cash.opening_balance_set'])
    return (onlyUser ? q.eq('user_id', onlyUser) : q).order('id', { ascending: true }).range(from, to)
  }).catch(() => [])

  for (const r of rows) {
    const when = (r.created_at ?? '').slice(0, 10)
    if (r.action === 'cash.entry_removed') {
      const o = r.old_value ?? {}
      const amount = Math.abs(Number(o.amount) || 0)
      removed.push({
        ownerId: r.user_id, when, amount,
        text:
          `${String(o.entry_date ?? '?')} · ${String(o.direction ?? '?')} ${eurStr(amount)} · ` +
          `${String(o.category ?? '?')}${o.description ? ` · ${String(o.description)}` : ''}`,
      })
    } else {
      const was = (r.old_value ?? {}) as { kas_opening_balance?: number | null; previous_value_unknown?: boolean }
      const now = (r.new_value ?? {}) as { kas_opening_balance?: number | null }
      floatChanges.push({
        ownerId: r.user_id, when,
        text: was.previous_value_unknown
          ? `beginsaldo gezet op ${eurStr(Number(now.kas_opening_balance) || 0)} (vorige waarde niet gelezen)`
          : `beginsaldo ${eurStr(Number(was.kas_opening_balance) || 0)} → ${eurStr(Number(now.kas_opening_balance) || 0)}`,
      })
    }
  }
  return { removed, floatChanges }
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

  // ── [GELD-INVARIANT-KAS] The cash drawer ────────────────────────────────────────────────────
  //
  // Placed BEFORE the "nothing to do" return below, and that is not a detail: the drawer is the one
  // ledger whose failures cash-settle.ts names out loud and nothing ever re-checks, so a clean set of
  // invoices must never be allowed to end this run before the kasboek has been looked at.
  const drawer = await auditDrawers(pipeline, onlyUser)
  const trail = await auditDrawerTrail(pipeline, onlyUser)

  if (drawer.unreadable.length > 0) {
    console.log(`── ${drawer.unreadable.length} kasadministratie(s) NIET te controleren — niet hetzelfde als "in orde":`)
    for (const id of [...new Set(drawer.unreadable)].slice(0, 10)) console.log(`     ${id}`)
    console.log()
    process.exitCode = 1
  }
  if (drawer.findings.length > 0) {
    const total = Math.round(drawer.findings.reduce((s, f) => s + f.euros, 0) * 100) / 100
    console.log(`══ Kas: ${drawer.findings.length} verschil(len), samen ${eurStr(total)} ══\n`)
    const byKind = new Map<string, typeof drawer.findings>()
    for (const f of drawer.findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f])
    const ordered = [...byKind.entries()].sort(
      (a, b) => b[1].reduce((s, f) => s + f.euros, 0) - a[1].reduce((s, f) => s + f.euros, 0),
    )
    for (const [kind, list] of ordered) {
      const sum = Math.round(list.reduce((s, f) => s + f.euros, 0) * 100) / 100
      console.log(`── ${HEADINGS[kind] ?? kind} — ${list.length}×, samen ${eurStr(sum)}`)
      for (const f of list.slice(0, 15)) console.log(`     ${f.ownerId}  ${f.entityId}  ${f.message}`)
      if (list.length > 15) console.log(`     … en nog ${list.length - 15}. Niet afgekapt in het totaal hierboven.`)
      console.log()
    }
    console.log('  Deze kunnen zichzelf herstellen: de reconcile draait bij elke kasboek-lezing en')
    console.log('  ieder uur. Wat na een tweede run TERUGKOMT, is precies wat dat zelfherstel niet')
    console.log('  bereikt — en dat is de enige soort die hier echt om aandacht vraagt.\n')
    process.exitCode = 1
  } else if (drawer.checked > 0) {
    console.log(`  Kas: ${drawer.checked} administratie(s) gecontroleerd — elke contante betaling staat`)
    console.log('  in de la, elke kasregel hoort bij een betaling, en geen enkele dag staat onder nul.\n')
  }

  // [KAS-SPOOR] Not violations — disclosure. A cash_entries delete is a hard delete, so this trail
  // is the only place the removed movement still exists.
  if (trail.removed.length > 0 || trail.floatChanges.length > 0) {
    console.log('── Uit de kas gehaald / beginsaldo gewijzigd (uit het auditspoor, niets fout per se)')
    const sum = Math.round(trail.removed.reduce((s, r) => s + r.amount, 0) * 100) / 100
    if (trail.removed.length > 0) {
      console.log(`     ${trail.removed.length} verwijderde kasboeking(en), samen ${eurStr(sum)}:`)
      for (const r of trail.removed.slice(0, 15)) console.log(`       ${r.when}  ${r.ownerId}  ${r.text}`)
      if (trail.removed.length > 15) console.log(`       … en nog ${trail.removed.length - 15}.`)
    }
    for (const f of trail.floatChanges.slice(0, 15)) console.log(`       ${f.when}  ${f.ownerId}  ${f.text}`)
    if (trail.floatChanges.length > 15) console.log(`       … en nog ${trail.floatChanges.length - 15}.`)
    console.log('     Het spoor begint bij [KAS-SPOOR]; hierboven staat niets van vóór die datum.\n')
  }

  if (violations.length === 0) {
    console.log('  Elke factuur klopt met haar eigen betalingen, elke bankregel met wat hij heeft')
    console.log('  uitgedeeld, en elk ex + btw met zijn inc.')
    if (drawer.findings.length === 0 && drawer.unreadable.length === 0) console.log('  Er is niets te doen.')
    console.log()
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
