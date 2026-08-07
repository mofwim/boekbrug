// src/app/api/bank/match/route.ts
// [BOEK-016] Run the matching engine over the user's pending transactions (phase 3).
//
// This endpoint ONLY computes suggestions. It is idempotent and writes NOTHING:
//   - bank_transactions stays 'pending'
//   - no invoice_id is set, no invoice status changes
// The UI holds the suggestion; the human confirms in phase 4, and only then does the
// existing payment path execute (invoice → 'paid' + bank_transactions → 'matched').
//
// There is no column to persist a suggestion (decision #4: no migration), so suggestions
// are computed on demand and returned to the client.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import {
  matchTransactions,
  isFullyCovered,
  bankLineFullyApplied,
  coveredNumbersRecovered,
  parseReferenceNumbers,
  normalizeRef,
  type InvoiceForMatching,
} from "@/lib/bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "@/lib/bank-import";
import { findSupplierSumMatch, type SupplierSumCandidate } from "@/lib/bank-batch-reconcile";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { counterpartHistory, type HistoryLine } from "@/lib/counterpart-history";
import { allocatedByTransaction } from "@/lib/bank-line-budget";
// [SUPPLIER-IBAN] The account a supplier is known to bill from — see supplier-known-iban.ts.
import { fetchSupplierIbans, withSupplierIbans } from "@/lib/supplier-known-iban";

export async function GET() {
  // 1. Auth — only ever read the authenticated user's own rows.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // service_role is safe here: every query below is pinned to this user's own data.
  const pipeline = createPipelineClient();

  // 2. Pending transactions for this user.
  //    [BANK-MULTI-LINK-PERSIST] Also select invoice_id so we can detect a
  //    partially-linked multi-invoice tx (status still 'pending', but already
  //    carries the last invoice paid against it). Without this the UI loses the
  //    "partially done" state on reload and the tx wrongly falls into "Geen factuur".
  //    [SEARCH-FULL-COVERAGE] Page past PostgREST's silent ~1000-row cap. A plain .select() dropped
  //    pending rows 1001+ — they vanished from BOTH the match engine AND the in-page zoekbalk (which
  //    filters this loaded set), so a real unmatched line could be unfindable. Stable id order; the
  //    matcher is order-independent and the UI re-sorts for display.
  let txRows: BankTransactionDbRow[];
  try {
    txRows = await fetchAllRows<BankTransactionDbRow>((from, to) =>
      pipeline
        .from("bank_transactions")
        // [BANK-COUNTERPART-HISTORY] `category` rides along so the card can say what the owner did
        // with this counterpart before. No extra query: these rows are already read in full.
        .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status, category")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "transactions_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const transactions = (txRows ?? []).map((r) =>
    rowToTransaction(r as BankTransactionDbRow)
  );

  if (transactions.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { pending: 0, auto: 0, choice: 0, none: 0 },
      suggestions: [],
    });
  }

  // 3. Candidate invoices: this user's own (sent or received), not already paid.
  //    isEligible() in the matcher still enforces direction/sign, draft/archived,
  //    and the B.4 'verwerkt' guard — this query is just a fast-path payload reducer.
  // [SEARCH-FULL-COVERAGE] Page past PostgREST's silent ~1000-row cap — the five other reads in
  // this file already do. A truncated CANDIDATE set is the worst kind of truncation: the correct
  // invoice is simply absent from the matcher's input, so a real payment renders as
  // "Geen factuur" with no error anywhere. An owner past 1000 open invoices would see matching
  // quietly stop working for their oldest ones.
  let invRows: unknown[] = [];
  let invErr: { message: string } | null = null;
  try {
    invRows = await fetchAllRows((from, to) =>
      pipeline
        .from("invoices")
        .select(
          // [PARTIAL-PAY] amount_paid lets the matcher target the REMAINING balance so the next
          // instalment matches on amount.
          "id, invoice_number, total_inc_btw, amount_paid, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, supplier_id"
        )
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .neq("status", "paid")
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    invErr = { message: e instanceof Error ? e.message : String(e) };
  }
  if (invErr) {
    return NextResponse.json(
      { error: "invoices_lookup_failed", detail: invErr.message },
      { status: 500 }
    );
  }

  // [SUPPLIER-IBAN] The account each supplier is known to bill from, for the invoices whose own
  // document never named one. Best-effort: an empty map leaves the matcher exactly as it was.
  const rawInvoices = (invRows ?? []) as (InvoiceForMatching & { supplier_id?: string | null })[];
  const invoices: InvoiceForMatching[] = withSupplierIbans(
    rawInvoices,
    await fetchSupplierIbans(pipeline, user.id, rawInvoices),
  );

  // 4. Run the pure matcher.
  // [BANK-BIG-BUNDLE] maxCandidates raised from the default 5: a wholesaler bundle routinely
  // lists 6-10 invoice numbers in one debit, and the UI resolves its slots FROM this candidate
  // list — a truncated list rendered existing invoices as "missing" slots with an upload
  // control, inviting a duplicate import of a bill that was already there. Fifteen covers any
  // realistic bundle; the choice-list UI still shows only the top few.
  const result = matchTransactions(transactions, invoices, { maxCandidates: 15 });

  // [BANK-MULTI-LINK-PERSIST] Partial-link coverage. A multi-invoice tx that has
  // already had ONE invoice paid against it keeps status='pending' + an invoice_id.
  // Its remaining candidates may now be zero (the only matching invoice is paid and
  // excluded above) → the matcher would label it 'none' and the UI would bury it in
  // "Geen factuur". To keep it in "Te bevestigen" until every reference number is
  // paid, we compute allCovered here (server-side, so it survives a reload) and tell
  // the UI which transactions are partially linked. Same shared rule as confirm.
  //
  // We only need paid invoice numbers when at least one pending tx is already linked.
  const linkedTxRows = (txRows ?? []).filter(
    (r) => (r as BankTransactionDbRow).invoice_id != null
  );
  const partialLink = new Map<string, boolean>(); // txId → allCovered
  // [BANK-SLOT-PERSIST] Per-tx list of reference numbers already paid — so the UI marks
  // those slots "Betaald" on reload instead of showing an already-paid invoice as open.
  const coveredByTx = new Map<string, string[]>();
  // [BANK-ONE-PAYMENT-MANY-INVOICES] How much of each still-pending bank line is already
  // booked on invoices. A line stays pending precisely because money of it is unassigned, and
  // the owner cannot act on "still here" without knowing how much is left. Read from the join
  // table's amount_applied — the same figure every booking path now writes.
  const appliedByTx = new Map<string, number>();
  // [BANK-COVERAGE-BY-MONEY] Can this line's applied total be MEASURED? Only when it has join
  // rows and every one of them carries an amount. A single amount-less (pre-[PARTIAL-PAY]) link
  // makes the sum a lower bound, not the truth — then we must not answer "covered" from it.
  const hasLinkRow = new Set<string>();
  const amountUnknown = new Set<string>();

  if (linkedTxRows.length > 0) {
    // [IN-CHUNK] Chunked + paged. A plain `.in()` over every partially-linked line hits both
    // silent ceilings: the ~1000-row response cap and the URL length of the id list. A truncated
    // read UNDERSTATES amount_applied, so bankLineFullyApplied answers "not covered" for a line
    // whose every euro is booked and it never leaves "Te bevestigen".
    // Wrapped, because fetchAllRowsForIds THROWS where the old `data`-only destructuring
    // swallowed — and this GET renders the whole bank page. A failed measurement is not a reason
    // to show the owner nothing: it has a documented fallback (measuredAllCovered returns null →
    // isFullyCovered's token rule), which is conservative and keeps every line visible. Leaving
    // hasLinkRow empty is exactly that fallback, so the page degrades instead of dying.
    let appliedRows: { transaction_id: string | null; invoice_id: string; amount_applied: number | null }[] = [];
    try {
      appliedRows = await fetchAllRowsForIds<{ transaction_id: string | null; invoice_id: string; amount_applied: number | null }, string>(
        linkedTxRows.map((r) => (r as BankTransactionDbRow).id),
        (chunk, from, to) =>
          pipeline
            .from("bank_tx_invoices")
            .select("transaction_id, invoice_id, amount_applied")
            .eq("user_id", user.id)
            .in("transaction_id", chunk)
            .order("id", { ascending: true }) // bank_tx_invoices.id is the PK — invoice_id is NOT unique (two payments can settle one invoice), so paging on it could repeat or skip a link row
            .range(from, to),
      );
    } catch (e) {
      console.error("[BANK-COVERAGE-BY-MONEY] applied-amount read failed — falling back to the reference-token rule", e);
    }
    for (const r of appliedRows) {
      const txId = r.transaction_id;
      if (!txId) continue;
      hasLinkRow.add(txId);
      if (r.amount_applied == null) amountUnknown.add(txId); // pre-[PARTIAL-PAY] link: amount unknown, don't guess
    }

    // [CREDITNOTA] The sum is SIGNED, and on this screen the magnitude version does not merely
    // report a wrong number — it makes money disappear from the owner's to-do list.
    //
    // An €850 debit made of a €150 supplier credit and a €700 invoice still has €300 to assign.
    // Counted as magnitudes that is 150 + 700 = 850, bankLineFullyApplied answers "every euro is
    // booked", and the line leaves "te bevestigen" with €300 nobody will look at again. Signed it
    // is 700 − 150 = 550 against 850, and the line stays where the owner can see it.
    //
    // The extra read is the invoice TYPES of the links we just found — one chunked query on a
    // screen that already runs several, and the alternative is a screen that hides money.
    const priced = appliedRows.filter((r) => r.transaction_id && r.amount_applied != null);
    if (priced.length > 0) {
      try {
        const linkedInvoices = await fetchAllRowsForIds<{ id: string; invoice_type: string | null; total_inc_btw: number | null }, string>(
          [...new Set(priced.map((r) => r.invoice_id))],
          (chunk, from, to) =>
            pipeline
              .from("invoices")
              .select("id, invoice_type, total_inc_btw")
              .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
              .in("id", chunk)
              .order("id", { ascending: true })
              .range(from, to),
        );
        const { byTransaction, unknownByTransaction } = allocatedByTransaction(priced, linkedInvoices);
        for (const [txId, total] of byTransaction) appliedByTx.set(txId, total);
        // A link to an invoice we could not read makes the total a guess, exactly like a missing
        // amount does — same set, same conservative outcome.
        for (const txId of unknownByTransaction.keys()) amountUnknown.add(txId);
      } catch (e) {
        // Same degradation as the read above: unmeasured, never mis-measured. Marking every line
        // unknown sends measuredAllCovered to null and the reference-token rule takes over, which
        // keeps lines VISIBLE — the safe direction for a screen whose job is to show what is left.
        console.error("[BANK-COVERAGE-BY-MONEY] invoice-type read failed — falling back to the reference-token rule", e);
        for (const r of priced) if (r.transaction_id) amountUnknown.add(r.transaction_id);
      }
    }
  }
  /** Is every euro of this bank line sitting on an invoice? Measured, not guessed —
   *  null when the line has no measurable applied total (caller falls back). */
  const measuredAllCovered = (row: BankTransactionDbRow): boolean | null =>
    !hasLinkRow.has(row.id) || amountUnknown.has(row.id)
      ? null
      : bankLineFullyApplied(row.amount, appliedByTx.get(row.id) ?? 0);

  if (linkedTxRows.length > 0) {
    // Paid invoice numbers for this user, both directions (cheap, single read).
    // isFullyCovered does equality on normalized numbers; direction already fixed
    // the candidate set when each link was confirmed, so a plain paid-number set is
    // sufficient here for the presence check.
    // [SEARCH-FULL-COVERAGE] Paged: a truncated paid-set makes isFullyCovered answer "no" for a
    // transaction whose invoices are all settled, so it never leaves "Te bevestigen".
    const paidRows = await fetchAllRows<{ invoice_number: string | null }>((from, to) =>
      pipeline
        .from("invoices")
        .select("invoice_number")
        .eq("status", "paid")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order("id", { ascending: true })
        .range(from, to)
    );

    const paidSet = new Set(
      (paidRows ?? [])
        .map((r) => normalizeRef(r.invoice_number ?? ""))
        .filter((n) => n.length > 0)
    );

    for (const r of linkedTxRows) {
      const row = r as BankTransactionDbRow;
      // [BANK-COVERAGE-BY-MONEY] Is this bank line finished? Answer it with the SAME arithmetic
      // /api/bank/confirm uses to decide it (`payAmount − Σ amount_applied ≤ 0.01`), because the
      // two must never disagree — and they did. confirm was moved to money by
      // [BANK-ONE-PAYMENT-MANY-INVOICES]; this route was left counting number-shaped tokens in the
      // reference, so a line whose every euro was booked still reported allCovered=false whenever a
      // reference token was not a paid invoice number (a customer/order number, a POS batch counter,
      // or free text the extractor fell back to). The UI keeps such a line in "Te bevestigen"
      // forever; confirming it again only earns a 409 (`payment_fully_applied` /
      // `invoice_already_paid`), which the client treats as done and then re-fetches — so the card
      // reappears on every single confirm, with no action able to clear it. The reference cannot
      // answer "is the money spent?"; only the money can. The token rule survives ONLY as the
      // fallback for links written before amount_applied existed, where nothing is measurable —
      // there it stays conservative (an unresolved number keeps the line visible, never hides on
      // doubt), exactly as confirm's own fallback does.
      partialLink.set(row.id, measuredAllCovered(row) ?? isFullyCovered(row.reference, paidSet));
      // [BANK-SLOT-RECOVERED] Answer in the PAID invoices' own full numbers, not in reference
      // tokens. For a recovered bundle the two vocabularies never met: the extractor stores
      // "2026-045" as the token "045", the slot key is the invoice's real number, and the paid
      // set holds "2026045" — token-equality matched nothing, so after a reload a genuinely
      // PAID slot reverted to an open "Koppelen" that invited booking the same bill twice.
      coveredByTx.set(row.id, coveredNumbersRecovered(row.reference, paidSet));
    }
  }

  // [BANK-PAID-EXPLAINED] A purchase debit that settles an invoice already marked paid by hand in
  // Crediteuren must NOT be flagged as a "missende inkoopfactuur — voorbelasting niet geclaimd": the
  // invoice exists, is paid, and its BTW is already in the aangifte (accrual). The matcher above
  // excludes paid invoices (.neq status paid), so such a debit falls to outcome 'none' and the UI
  // raises a FALSE missing-invoice alarm the owner can never clear. Re-run the scorer against PAID
  // invoices (as explain-only candidates: status forced 'received' so isEligible admits them, and
  // amount_paid zeroed so the remaining-aware amount targets the full total). A strong hit
  // (reference/iban + amount) means the debit is explained. Display-only — nothing is re-paid.
  const paidInvRows = await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      // [BON-AUTO] field_confidence carries _intake_kind — the one thing that tells a KASSABON from
      // an invoice here, and it decides which evidence is enough below.
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban, payment_reference, payment_prepared_at, supplier_id, field_confidence")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );
  // [BON-AUTO] Which of those paid invoices are kassabonnen. A bon has no invoice number and no
  // vendor IBAN — a till does not print either — so the rule below can never be satisfied for one,
  // and every pin-paid bon turned its own bank debit into a "missende inkoopfactuur" the owner
  // could not clear. The receipt IS the missing document; it is sitting right there, paid.
  const receiptIds = new Set(
    (paidInvRows ?? [])
      .filter((r) => {
        const fc = (r as { field_confidence?: unknown }).field_confidence;
        return !!fc && typeof fc === "object" && (fc as { _intake_kind?: unknown })._intake_kind === "receipt";
      })
      .map((r) => (r as { id: string }).id),
  );
  const paidExplained = new Set<string>();
  if ((paidInvRows ?? []).length > 0) {
    const paidAsCandidates = (paidInvRows as InvoiceForMatching[]).map((r) => ({ ...r, status: "received", amount_paid: 0 }));
    const explainResult = matchTransactions(transactions, paidAsCandidates);
    for (const m of explainResult.matches) {
      const id = m.transaction.transactionId;
      if (!id || !m.best) continue;
      const sig = m.best.signals;
      if ((sig.includes("reference") || sig.includes("iban")) && sig.includes("amount")) paidExplained.add(id);
      // [BON-AUTO] For a kassabon, the identity that exists is the SHOP NAME, the exact amount and
      // the day — the bank line for a card purchase carries the counterpart and nothing else. Three
      // independent axes agreeing is not weaker evidence than a reference; it is the only evidence
      // this document class can produce. Display-only, exactly like the rule above: this hides a
      // false alarm, it never books, re-pays or links anything.
      else if (
        receiptIds.has(m.best.invoiceId) &&
        sig.includes("counterpart") && sig.includes("amount") && sig.includes("date")
      ) {
        paidExplained.add(id);
      }
    }
  }

  // [BANK-COUNTERPART-HISTORY] What the owner already decided about each counterpart. Computed
  // from the rows we ALREADY hold — no extra round trip — and only over lines that carry a
  // category, so it reports answers rather than a pile of other open questions.
  const historyPool: HistoryLine[] = (txRows as unknown as HistoryLine[]).map((r) => ({
    counterpart_name: r.counterpart_name ?? null,
    counterpart_iban: r.counterpart_iban ?? null,
    category: r.category ?? null,
  }));

  // 5. Shape a lean DTO for the UI. transactionId === bank_transactions.id.
  const suggestions = result.matches.map((m) => {
    const txId = m.transaction.transactionId;
    const isLinked = txId != null && partialLink.has(txId);
    // [BANK-SUM-SUGGEST] A payment that is EXACTLY the sum of 2..4 open invoices from EXACTLY
    // this counterparty, with nothing quoted, used to render as "Geen factuur" — the one case
    // where the owner had to reconstruct the arithmetic by hand. Computed only for lines the
    // matcher found NOTHING for (a candidate list is a better answer), and it is a SUGGESTION:
    // the UI offers it, every booking still goes through the guarded per-invoice confirm.
    const sumMatch =
      m.outcome === "none" && !isLinked
        ? findSupplierSumMatch({
            amount: m.transaction.amount,
            counterpartName: m.transaction.counterpartName,
            counterpartIban: m.transaction.counterpartIban,
            invoices: invoices as SupplierSumCandidate[],
          })
        : null;
    return {
      transactionId: txId,
      date: m.transaction.date,
      amount: m.transaction.amount,
      description: m.transaction.description,
      counterpart: m.transaction.counterpartName,
      // [SEARCH] The tegenrekening IBAN — carried so the in-page zoekbalk can find a line by IBAN.
      iban: m.transaction.counterpartIban ?? null,
      // [BANK-COUNTERPART-HISTORY] "Wat deed ik hier de vorige keer mee?" — null when there is
      // nothing honest to say. Reported, never applied: counterpart_memory drives the actual
      // suggestion, and a second hint that could contradict it would be worse than none.
      history: counterpartHistory(
        { counterpart_name: m.transaction.counterpartName, counterpart_iban: m.transaction.counterpartIban ?? null },
        historyPool,
      ),
      // [BANK-REF-DISPLAY] The cleaned invoice number(s) the parser extracted from
      // REMI/Ustrd (e.g. "26702781, 26703066"). The UI shows this instead of the
      // raw description so the owner sees the real reference, not "USTD//...".
      reference: m.transaction.reference,
      outcome: m.outcome,
      best: m.best,
      candidates: m.candidates,
      // [BANK-MULTI-LINK-PERSIST] Persisted (reload-safe) link state. partiallyLinked
      // = this pending tx already has an invoice paid against it; allCovered = every
      // reference number is now paid. The UI keeps a partiallyLinked && !allCovered tx
      // in "Te bevestigen" regardless of `outcome` (it may have no candidates left).
      partiallyLinked: isLinked,
      allCovered: isLinked ? partialLink.get(txId!) === true : false,
      // [BANK-SLOT-PERSIST] Normalized reference numbers already paid against this tx, so
      // the multi-invoice UI marks those slots "Betaald" after a reload (session state gone).
      coveredNumbers: isLinked ? (coveredByTx.get(txId!) ?? []) : [],
      // [BANK-ONE-PAYMENT-MANY-INVOICES] Euros of this bank line already booked on invoices
      // (null when nothing is linked or the links predate amount_applied — then the UI says
      // nothing rather than something wrong).
      appliedAmount: isLinked ? (appliedByTx.get(txId!) ?? null) : null,
      // [BANK-PAID-EXPLAINED] This debit matches an already-PAID invoice → not a missing inkoopfactuur.
      explainedByPaid: txId != null && paidExplained.has(txId),
      // [BANK-SUM-SUGGEST] Unique same-supplier sum tie (or null). Suggestion only — see above.
      sumMatch,
    };
  });

  // [BANK-R1] Already-MATCHED transactions (incl. the app's own auto-bookings). This route used to
  // return pending txs only, so an auto-confirmed payment simply vanished from the UI on reload —
  // the owner saw "4 facturen automatisch" once and then nothing, with no way to see WHICH invoices
  // were booked or to undo one. We now return the matched lines too, shaped as "done" suggestions
  // (allCovered = true), so they populate the "Gekoppeld" tab with a working one-tap Ontkoppelen.
  // Paginated + newest-first: an account can hold >1000 matched lines over several quarters, and
  // the ~1000-row PostgREST cap would otherwise silently drop some — so a booked payment could
  // vanish from "Gekoppeld" and become unreachable to undo. fetchAllRows pages past the cap; the
  // date order means any residual cap drops OLDEST rows, never the current quarter's.
  const matchedRows = await fetchAllRows((from, to) =>
    pipeline
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status")
      .eq("user_id", user.id)
      .eq("status", "matched")
      .order("date", { ascending: false })
      .range(from, to),
  );
  const matchedTx = (matchedRows ?? []) as BankTransactionDbRow[];

  // Which invoice(s) each matched line paid — the AUTHORITATIVE id-based set (join table), so a
  // batch shows every invoice it settled, not just the representative. One grouped read of the
  // join table + a fallback to the single invoice_id (covers pre-migration lines with no join
  // rows). Best-effort, display only — wrapped so a missing table degrades to the invoice_id path.
  const idsByTx = new Map<string, Set<string>>();
  for (const r of matchedTx) idsByTx.set(r.id, new Set(r.invoice_id ? [r.invoice_id as string] : []));
  if (matchedTx.length > 0) {
    // [IN-CHUNK] matchedTx is fully paged above, so on a real account it holds thousands of ids —
    // and a plain `.in()` over them fails twice over: the response caps at ~1000 join rows, and
    // the id list itself outgrows the request URL long before that. Both come back as an ordinary
    // error (supabase-js does not throw), which this `data`-only destructuring reads as "no
    // links" — so the Gekoppeld tab quietly lost the invoice numbers of every batch. Chunked +
    // paged; the try/catch still covers a genuinely missing pre-migration table.
    try {
      const linkRows = await fetchAllRowsForIds<{ transaction_id: string | null; invoice_id: string }, string>(
        matchedTx.map((r) => r.id),
        (chunk, from, to) =>
          pipeline
            .from("bank_tx_invoices")
            .select("transaction_id, invoice_id")
            .eq("user_id", user.id)
            .in("transaction_id", chunk)
            .order("id", { ascending: true }) // bank_tx_invoices.id is the PK — invoice_id is NOT unique (two payments can settle one invoice), so paging on it could repeat or skip a link row
            .range(from, to),
      );
      for (const lr of linkRows) {
        const txId = lr.transaction_id;
        if (!txId) continue;
        (idsByTx.get(txId) ?? idsByTx.set(txId, new Set()).get(txId)!).add(lr.invoice_id);
      }
    } catch {
      /* pre-migration: keep the invoice_id fallback already seeded above */
    }
  }
  const allWantIds = new Set<string>();
  for (const s of idsByTx.values()) for (const id of s) allWantIds.add(id);
  const numById = new Map<string, string>();
  if (allWantIds.size > 0) {
    // [IN-CHUNK] Same two ceilings, same silence — a truncated read here left `numById` empty for
    // the dropped ids, so those cards fell back to the raw reference tokens instead of the
    // invoice numbers the payment actually settled.
    try {
      const linkedInvs = await fetchAllRowsForIds<{ id: string; invoice_number: string | null }, string>(
        [...allWantIds],
        (chunk, from, to) =>
          pipeline
            .from("invoices")
            .select("id, invoice_number")
            .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
      );
      for (const i of linkedInvs) numById.set(i.id, normalizeRef(i.invoice_number ?? ""));
    } catch {
      /* display only — the card falls back to the parsed reference numbers */
    }
  }
  const linkedNumbersByTx = new Map<string, string[]>();
  for (const [txId, ids] of idsByTx) {
    linkedNumbersByTx.set(txId, [...ids].map((id) => numById.get(id) ?? "").filter((n) => n.length > 0));
  }

  // [BANK-AMOUNT-ONLY] Which matched lines were auto-booked on amount+counterpart only (no printed
  // number / IBAN) — those the owner asked to see flagged "controleer". Best-effort + wrapped: a
  // not-yet-applied migration (no auto_match_reason column) just yields no flags, never an error.
  const reasonByTx = new Map<string, string>();
  if (matchedTx.length > 0) {
    // [IN-CHUNK] This one is not cosmetic: the flag it carries is the "controleer" warning on a
    // line the app booked on amount + supplier NAME alone, which [BANK-AMOUNT-ONLY] added
    // precisely because such a match can be the right supplier's WRONG month. Truncating this
    // read removed the warning while leaving the booking — the one combination that must never
    // happen. Chunked + paged; the catch still covers the not-yet-applied migration.
    try {
      const reasonRows = await fetchAllRowsForIds<{ id: string; auto_match_reason: string | null }, string>(
        matchedTx.map((r) => r.id),
        (chunk, from, to) =>
          pipeline
            .from("bank_transactions")
            // auto_match_reason is added by bank_auto_match_reason.sql — not in the generated types.
            .select("id, auto_match_reason")
            .eq("user_id", user.id)
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: { id: string; auto_match_reason: string | null }[] | null; error: { message: string } | null }>,
      );
      for (const rr of reasonRows) {
        if (rr.auto_match_reason) reasonByTx.set(rr.id, rr.auto_match_reason);
      }
    } catch {
      /* pre-migration: no column → no flags (correct — nothing was booked under this tier yet) */
    }
  }

  const linkedSuggestions = matchedTx.map((row) => {
    const t = rowToTransaction(row);
    // The AUTHORITATIVE paid numbers are the actually-linked invoices (join table / invoice_id).
    // Prefer them alone — a bank reference can contain unrelated numeric tokens (order/customer
    // numbers) that parseReferenceNumbers would otherwise show as false "Betaald" slots. Only when
    // NO invoice number is known (a legacy line with no link) do we fall back to the parsed
    // reference so the card still shows something.
    const linkedNums = linkedNumbersByTx.get(row.id) ?? [];
    const covered = linkedNums.length > 0 ? [...new Set(linkedNums)] : parseReferenceNumbers(row.reference);
    return {
      transactionId: row.id,
      date: t.date,
      amount: t.amount,
      description: t.description,
      counterpart: t.counterpartName,
      // [SEARCH] IBAN of the tegenrekening — so a matched line is findable by IBAN too.
      iban: t.counterpartIban ?? null,
      reference: t.reference,
      outcome: "auto" as const, // nominal — it is already done (allCovered), never shown as pending
      best: null,
      candidates: [],
      partiallyLinked: false,
      allCovered: true,
      coveredNumbers: covered,
      // [BANK-AMOUNT-ONLY] 'amount_only' → the Gekoppeld card shows a "controleer" flag.
      matchReason: reasonByTx.get(row.id) ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    summary: {
      pending: transactions.length,
      auto: result.autoCount,
      choice: result.choiceCount,
      none: result.noneCount,
    },
    suggestions: [...suggestions, ...linkedSuggestions],
  });
}