// src/app/api/invoice/[id]/amounts/route.ts
// [AMOUNT-CORRECTION] Correct a CONFIRMED incoming invoice: its amounts, its KIND, and — since
// [FULL-CORRECTION] — its invoice number, supplier name and invoice date.
//
// The path still reads /amounts, which now under-describes it. Renaming a live money route while
// other sessions are working in the same repo is churn with a real conflict risk and no functional
// gain, so the name stays and this line says what it actually covers. Everything below applies to
// every field it accepts.
//
// ── WHY THIS ROUTE EXISTS ──
// The verify queue has always let the reviewer fix a misread invoice before confirming it. After
// confirming there was nothing: /dashboard/incoming/manage had no edit path at all. So an invoice
// that made it into the books wrong stayed wrong, and the only ways out were archiving it (which
// hides a real purchase) or asking the accountant.
//
// That gap became visible with four real invoices: a credit note booked as a debt, and three
// wholesale invoices whose ex-btw amount lost a 0%-rated deposit or a second rate. The screen can
// now SEE those (creditnota-signal.ts, btw-reconcile.ts) — this route is what lets the owner
// actually fix them.
//
// ── SIX GUARDS, ALL FAIL-CLOSED ──
// Correcting an amount on a CONFIRMED invoice moves money in the books, so every one of these
// refuses rather than guesses:
//
//   1. Ownership — receiver of an INCOMING invoice, and nothing else.
//   2. Status must be 'received'. A 'paid' invoice has money settled against a bank line, and
//      changing its total would break the invariant amount_paid = Σ bank_tx_invoices.amount_applied.
//      A 'processing' row belongs to the queue's own confirm route.
//   3. No settled money — the same predicate the archive and ignore routes use, so the three doors
//      to "this invoice holds money" cannot disagree.
//   4. The identity has to hold: ex + btw = incl. The screen guarantees it (amount-triplet.ts), but
//      a server that trusts the client's arithmetic is not a guard.
//   5. The write re-asserts status and ownership in its WHERE, so a stale tab loses the race
//      honestly instead of overwriting a newer state.
//   6. A corrected invoice NUMBER may not collide with another purchase invoice. The number is the
//      key the duplicate gate, the bank matcher and the accountant all work from, so two invoices
//      sharing one is how a cost gets counted twice — arriving through the edit box this time.
//
// Every field is OPTIONAL and each is written only where it really differs, so a screen that posts
// the whole form cannot manufacture a correction out of a field nobody touched — which matters
// twice over, because [READING-MEMORY] learns from exactly this trail.
//
// The 'verwerkt' freeze is enforced by the database trigger prevent_verwerkt_invoice_changes; we
// recognise its message and translate it, rather than duplicating the rule here.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [NAMENS] Correcting a booked purchase amount is bookkeeping, not sales. A sales member has no
// business here — and saying so explicitly beats relying on the receiver_id check happening to
// exclude them. Same choice as the archive and ignore routes.
// [SUPPLIER-ALIAS] Learn what a corrected leverancier name means — see src/lib/supplier-alias.ts.
import { learnSupplierAlias } from "@/lib/supplier-alias-write";
import { requireOwner } from "@/lib/owner-only";
// [AMOUNT-CORRECTION] One predicate for "this invoice already holds money" — shared with the
// archive and ignore routes.
import { hasSettledMoney } from "@/lib/invoice-removal";
// [AMOUNT-TRIPLET] The same tolerance the arithmetic gate uses, so screen and server agree.
import { SUM_TOLERANCE } from "@/lib/btw-reconcile";
// [READING-MEMORY] Which fields the human changed about the reader's answer, and — for the GET —
// the sentence that says what this owner keeps fixing at THIS supplier.
import { correctedFields, readingHintFor } from "@/lib/reading-memory";
import { loadReadingMemory } from "@/lib/reading-memory-source";
// [CREDIT-SIGN] A credit note has to be STORED negative — nothing that counts money reads the type.
import { asCreditAmounts } from "@/lib/creditnota-signal";
// [SPLIT-CORRECTIE] The owner's per-rate split, validated against the final totals.
import { validateBtwRows } from "@/lib/btw-rows-correction";
// [SUPPLETIE] The one door to "did this touch a quarter that is already at the Belastingdienst?"
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { filedQuarterImpacts, describeFiledQuarterImpact, stampDivergence } from "@/lib/filed-quarter";
import { createNotification } from "@/lib/notifications";
import type { Database } from "@/types/database.types";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];

/** A finite number, whatever the sign — a credit note's amounts are legitimately negative. */
function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * [FULL-CORRECTION] The correctable fields of one booked purchase invoice.
 *
 * /dashboard/bank opens the same editor as the pay screen, but a bank card only carries what a
 * match needs — the invoice number, the gross total, the date. It has no ex/btw breakdown, and
 * putting one on every candidate in a long list would be waste for a modal that opens rarely.
 *
 * GET /api/invoice/[id] cannot serve this: it is scoped to sender_id, so it answers for SALES
 * invoices only. Rather than widen a route that guards outgoing invoices, the route that WRITES
 * these fields also reads them, under exactly the same ownership rule.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  { const w = await requireOwner('De gegevens van een geboekte inkoopfactuur bekijken om ze te corrigeren'); if (w.response) return w.response }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // [NO-SILENT-EMPTY] A failed read is not "no such invoice". Telling the owner their invoice does
  // not exist, while it sits on the screen behind the dialog, is the wrong answer to a hiccup.
  const { data: invoice, error } = await supabase
    .from("invoices")
    // [LEES-CORRECTIE] due_date/vendor_iban/payment_reference ride along so the editor can
    // prefill the three fields that used to be write-only for the pipeline.
    .select("id, invoice_number, client_name, invoice_date, due_date, vendor_iban, payment_reference, invoice_type, total_ex_btw, btw_amount, total_inc_btw, status, amount_paid, field_confidence")
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .maybeSingle();

  if (error) {
    console.error("[FULL-CORRECTION] read failed", { invoiceId: id, userId: user.id, error: error.message });
    return NextResponse.json(
      { error: "We konden deze factuur nu niet ophalen — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  if (!invoice) return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });

  // Whether the editor can save at all, decided by the SAME predicates PATCH uses, so the dialog
  // never opens on an invoice it will refuse — an owner who types a correction into a form that
  // then rejects it has been misled by the screen, not by the server.
  const editable =
    invoice.status === "received" &&
    !hasSettledMoney({ status: invoice.status, amount_paid: invoice.amount_paid });

  // [SPLIT-CORRECTIE] Only the split leaves this route — the rest of field_confidence is the
  // machine's testimony (grounding, safecore, e-invoice witness) and stays server-side.
  const fc = (invoice as {
    field_confidence?: { _btw_rows?: unknown; _statiegeld?: unknown } | null
  }).field_confidence;
  const { field_confidence: _weg, ...invoiceZonderFc } = invoice as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    invoice: invoiceZonderFc,
    btwRows: Array.isArray(fc?._btw_rows) ? fc._btw_rows : null,
    // [STATIEGELD-GAT] The deposit line the import found back on the paper, when the breakdown
    // comes up short. Same rule as the split above: not the whole testimony, only the one fact the
    // editor can act on — and it must reach BOTH editors, or the same invoice gets help on the
    // verify screen and none on the screen where the owner is about to pay it.
    depositGap: fc?._statiegeld ?? null,
    // [READING-MEMORY] Same rule as the deposit above, on a second kind of help. The pay screen
    // renders this hint server-side and hands it to the editor; /bank opens the SAME editor and
    // handed it nothing, so "bij deze leverancier corrigeer je meestal het bedrag" appeared on one
    // screen and not on the other, over one invoice. loadReadingMemory swallows its own failures
    // and answers an empty map, so a hiccup in the audit read costs the hint and never the dialog.
    readingHint: readingHintFor(invoice.client_name, await loadReadingMemory(supabase, user.id)),
    editable,
    reason: editable
      ? null
      : invoice.status === "paid"
        ? "Deze factuur staat op betaald. Draai eerst de betaling terug; daarna kun je hem corrigeren."
        : invoice.status !== "received"
          ? "Deze factuur staat nog in de controlewachtrij — corrigeer hem daar."
          : "Er is al een bedrag afgeboekt op deze factuur — ontkoppel die betaling eerst op de Bank-pagina.",
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  { const w = await requireOwner('De bedragen van een geboekte inkoopfactuur corrigeren'); if (w.response) return w.response }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const exBtw = body.total_ex_btw;
  const btw = body.btw_amount;
  const incBtw = body.total_inc_btw;
  const declaredCredit = body.is_credit_note === true;

  // [FULL-CORRECTION] The amounts are now OPTIONAL, and the identity is only asserted when they
  // are present. An owner fixing a misread invoice NUMBER should not have to retype three amounts
  // that were already right — being made to retype a correct figure is how a correct figure
  // becomes a typo. A request that changes nothing at all is still refused, below.
  const hasAmounts = finite(exBtw) || finite(btw) || finite(incBtw);
  if (hasAmounts && !(finite(exBtw) && finite(btw) && finite(incBtw))) {
    return NextResponse.json(
      { error: "Vul alle drie de bedragen in — bedrag excl. BTW, BTW en totaal — of laat ze alle drie leeg." },
      { status: 400 },
    );
  }

  // GUARD 4 — the identity. The screen cannot break it, but a hand-made request can, and a stored
  // set of amounts that contradicts itself is exactly what this whole round is about removing.
  if (hasAmounts && Math.abs(exBtw + btw - incBtw) > SUM_TOLERANCE) {
    return NextResponse.json(
      { error: "Bedrag excl. BTW plus BTW moet gelijk zijn aan het totaal.", code: "sum_mismatch" },
      { status: 400 },
    );
  }

  // GUARD 4b — [SAFECORE-SPIEGEL] the two SAFECORE rules the identity alone cannot see. This
  // route edits a BOOKED invoice, and the identity is satisfiable by amounts SAFECORE would have
  // refused at import:
  //   · ex 0 · btw 21 · incl 21 holds exactly (0 + 21 = 21) and is the [NO-BASE] case — a € 21
  //     voorbelasting claim on a purchase with no taxable base at all;
  //   · ex 100 · btw 79 · incl 179 holds exactly and implies a 79% rate no Dutch invoice can
  //     carry, singly or blended (the ceiling is 21%).
  // The import door refuses both; an edit door that accepts them is the same defect one screen
  // later. Magnitudes, so a creditnota (all negative) is judged by the same ceiling.
  if (hasAmounts && Math.abs(btw) > 0.005) {
    if (Math.abs(exBtw) < 0.005) {
      return NextResponse.json(
        { error: "BTW zonder grondslag kan niet: een bedrag excl. BTW van € 0 met BTW erop bestaat op geen enkele factuur.", code: "no_base" },
        { status: 400 },
      );
    }
    const impliedRate = Math.abs(btw / exBtw) * 100;
    if (impliedRate > 21.5) {
      return NextResponse.json(
        {
          error: `Deze bedragen impliceren een BTW-tarief van ${Math.round(impliedRate)}% — het hoogste Nederlandse tarief is 21%. Controleer welk bedrag verkeerd is ingevuld.`,
          code: "impossible_rate",
        },
        { status: 400 },
      );
    }
  }

  // [FULL-CORRECTION] The fields the ACCOUNTANT reads. A misread supplier name or invoice number
  // moves no money and still makes the books wrong where it counts: the number is what the
  // duplicate gate, the bank matcher and the accountant's own cross-check all key on, and the date
  // decides which BTW quarter the invoice lands in.
  const nextNumber = typeof body.invoice_number === "string" ? body.invoice_number.trim() : null;
  const nextVendor = typeof body.client_name === "string" ? body.client_name.trim() : null;
  const nextDate = typeof body.invoice_date === "string" ? body.invoice_date.trim() : null;

  if (nextNumber !== null && nextNumber.length === 0) {
    return NextResponse.json({ error: "Een factuurnummer mag niet leeg zijn." }, { status: 400 });
  }
  if (nextVendor !== null && nextVendor.length === 0) {
    return NextResponse.json({ error: "Een leveranciersnaam mag niet leeg zijn." }, { status: 400 });
  }
  // The shape <input type="date"> produces, and the one the queue's confirm route already accepts.
  if (nextDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
    return NextResponse.json({ error: "Vul een geldige factuurdatum in (jjjj-mm-dd)." }, { status: 400 });
  }

  // [LEES-CORRECTIE] The three fields the pipeline extracted but NO screen could ever fix — the
  // day-mapping audit's list. Each moves something real: due_date schedules the "Vandaag" screen
  // and the reminders, vendor_iban feeds the IBAN-change fraud check and the amount+IBAN match
  // tier, payment_reference is what the owner types into their bank. An owner correcting them is
  // the AUTHORITY here; empty string means "wis dit veld".
  const rawDue = typeof body.due_date === "string" ? body.due_date.trim() : null;
  if (rawDue !== null && rawDue !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) {
    return NextResponse.json({ error: "Vul een geldige vervaldatum in (jjjj-mm-dd)." }, { status: 400 });
  }
  const nextDue = rawDue === null ? null : (rawDue === "" ? "" : rawDue);
  const rawIban = typeof body.vendor_iban === "string" ? body.vendor_iban : null;
  let nextIban: string | null = null;
  if (rawIban !== null) {
    const genormaliseerd = rawIban.replace(/[\s.\-]/g, "").toUpperCase();
    if (genormaliseerd !== "" && !/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(genormaliseerd)) {
      return NextResponse.json({ error: "Dit is geen geldige IBAN-vorm. Controleer het rekeningnummer." }, { status: 400 });
    }
    nextIban = genormaliseerd;
  }
  const rawRef = typeof body.payment_reference === "string" ? body.payment_reference.trim() : null;
  if (rawRef !== null && rawRef.length > 140) {
    return NextResponse.json({ error: "Een betaalkenmerk is nooit langer dan 140 tekens." }, { status: 400 });
  }
  const nextRef = rawRef;

  // [SPLIT-CORRECTIE] The per-rate BTW split — the last AI-read field without a door. Parsed
  // here, VALIDATED further down against the FINAL totals (they may be edited in this same
  // request), because a split that contradicts the invoice it specifies is worse than none.
  const rawBtwRows = "btw_rows" in body ? body.btw_rows : null;

  if (!hasAmounts && nextNumber === null && nextVendor === null && nextDate === null && !declaredCredit
      && nextDue === null && nextIban === null && nextRef === null && rawBtwRows === null) {
    return NextResponse.json({ error: "Er is niets gewijzigd." }, { status: 400 });
  }

  // [NO-SILENT-EMPTY] Read the row BEFORE deciding anything, and treat a failed read as a refusal.
  // supabase-js answers a failed read with { data: null, error }, so without checking `error` a
  // database problem would read as "invoice not found" and the owner would be told their invoice
  // does not exist while it sits right there on the screen.
  const { data: invoice, error: readErr } = await supabase
    .from("invoices")
    // client_name is read for the audit trail only — [READING-MEMORY] keys a correction to the
    // supplier it happened at, and without the name the correction cannot be remembered anywhere.
    // [SUPPLIER-ALIAS] supplier_id + vendor_iban ride along: they are what says WHICH company a
    // corrected name belongs to, and without one of them a rename is one name pointing at another.
    .select("id, receiver_id, direction, status, invoice_type, invoice_number, client_name, invoice_date, due_date, payment_reference, total_ex_btw, btw_amount, total_inc_btw, amount_paid, supplier_id, vendor_iban, field_confidence")
    .eq("id", id)
    .maybeSingle();

  if (readErr) {
    console.error("[AMOUNT-CORRECTION] read failed — refusing to write", { invoiceId: id, userId: user.id, error: readErr.message });
    return NextResponse.json(
      { error: "We konden deze factuur nu niet ophalen. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }

  // GUARD 1 — ownership. Same answer for "not yours" and "does not exist": a probe learns nothing.
  if (!invoice || invoice.receiver_id !== user.id || invoice.direction !== "incoming") {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  // GUARD 2 — only a confirmed, unpaid invoice.
  if (invoice.status !== "received") {
    return NextResponse.json(
      {
        error:
          invoice.status === "paid"
            ? "Deze factuur staat op betaald. Draai eerst de betaling terug; daarna kun je de bedragen corrigeren."
            : "Deze factuur staat nog in de controlewachtrij — corrigeer hem daar.",
        code: "wrong_status",
      },
      { status: 409 },
    );
  }

  // GUARD 3 — no money booked against it. A partly paid invoice sits in 'received' too, so the
  // status check above does not cover this.
  if (hasSettledMoney({ status: invoice.status, amount_paid: invoice.amount_paid })) {
    return NextResponse.json(
      { error: "Er is al een bedrag afgeboekt op deze factuur — ontkoppel die betaling eerst op de Bank-pagina.", code: "money_settled" },
      { status: 409 },
    );
  }

  // The number we would actually write — null when it is unchanged, so an owner re-saving the same
  // invoice is never told it collides with itself.
  const patchNumberCandidate =
    nextNumber !== null && nextNumber !== (invoice.invoice_number ?? "").trim() ? nextNumber : null;

  // [FULL-CORRECTION] GUARD 6 — a corrected invoice number may not collide with another invoice.
  //
  // The number is the key the duplicate gate, the bank matcher and the accountant's cross-check all
  // work from, so two purchase invoices carrying one number is precisely how a cost gets counted
  // twice — the failure this whole line has been closing all week, arriving through the edit box
  // instead of through an import.
  //
  // [NO-SILENT-EMPTY] A failed check refuses. "We could not look" must not read as "no collision",
  // because that is the one answer that lets the collision through.
  if (patchNumberCandidate !== null) {
    const { data: clash, error: clashErr } = await supabase
      .from("invoices")
      .select("id, invoice_number")
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .ilike("invoice_number", patchNumberCandidate)
      .neq("id", id)
      .limit(1);
    if (clashErr) {
      console.error("[FULL-CORRECTION] duplicate-number check failed — refusing to write", { invoiceId: id, userId: user.id, error: clashErr.message });
      return NextResponse.json(
        { error: "We konden niet nakijken of dit factuurnummer al bestaat. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
        { status: 503 },
      );
    }
    if (clash && clash.length > 0) {
      return NextResponse.json(
        {
          error: `Je hebt al een inkoopfactuur met nummer ${patchNumberCandidate}. Twee facturen met hetzelfde nummer tellen de kosten dubbel — controleer welk nummer klopt.`,
          code: "duplicate_number",
        },
        { status: 409 },
      );
    }
  }

  // [CREDIT-SIGN] A credit note is stored NEGATIVE, or it is not a credit note in any way that
  // counts. openAmountSigned reads `total_inc_btw < 0`, and /api/aangifte sums btw_amount without
  // ever selecting invoice_type — so a row typed +51,80 and marked 'creditnota' keeps standing as a
  // debt and keeps ADDING input tax that belongs subtracted. Same rule, same helper as the queue's
  // confirm route, so the two doors cannot store the same document two different ways.
  //
  // [FULL-CORRECTION] Now that a correction can carry no amounts at all, this starts from what is
  // STORED when none were sent. Reading the posted values unconditionally put `undefined` into the
  // audit trail and the response for a metadata-only fix — the patch itself was safe (it is gated
  // on hasAmounts), but the trail an accountant reads a year later would have shown a booked
  // invoice with no amounts on the day someone corrected its supplier name.
  //
  // It also means ticking "dit is een creditnota" WITHOUT retyping anything still flips the stored
  // amounts, which is exactly the case the credit-sign fix exists for.
  const baseEx = hasAmounts ? exBtw : (invoice.total_ex_btw ?? 0);
  const baseBtw = hasAmounts ? btw : (invoice.btw_amount ?? 0);
  const baseIncl = hasAmounts ? incBtw : (invoice.total_inc_btw ?? 0);
  const signed = (declaredCredit || invoice.invoice_type === "creditnota")
    ? asCreditAmounts({ totalExBtw: baseEx, btwAmount: baseBtw, totalIncBtw: baseIncl })
    : { totalExBtw: baseEx, btwAmount: baseBtw, totalIncBtw: baseIncl, flipped: false };

  // [SPLIT-CORRECTIE] Validated against the SIGNED final totals — the ones being written when
  // amounts ride in the same request, the stored ones otherwise. [CREDIT-SIGN] rides along for
  // free: a creditnota's totals are negative here, so only a negative split passes.
  let nextBtwRows: import("@/lib/btw-rows-correction").BtwRow[] | null = null;
  let clearBtwRows = false;
  if (rawBtwRows !== null) {
    const verdict = validateBtwRows(rawBtwRows, { totalExBtw: signed.totalExBtw, btwAmount: signed.btwAmount });
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason, code: "btw_rows_invalid" }, { status: 400 });
    if (verdict.rows.length === 0) clearBtwRows = true;
    else nextBtwRows = verdict.rows;
  }

  const patch: InvoiceUpdate = { updated_at: new Date().toISOString() };
  // Only when amounts were actually sent — see [FULL-CORRECTION] above. Writing them back
  // unchanged would be harmless for the money and dishonest in the audit trail.
  // Written when the owner sent amounts, AND when the credit-sign rule turned the stored ones
  // negative — a tick with no retyping is still a change to the money, and the whole point of
  // [CREDIT-SIGN] is that the tick must move it.
  if (hasAmounts || signed.flipped) {
    patch.total_ex_btw = signed.totalExBtw;
    patch.btw_amount = signed.btwAmount;
    patch.total_inc_btw = signed.totalIncBtw;
    // [SAFECORE-SPIEGEL] The stored _safecore verdict describes the amounts that are being
    // REPLACED. Leaving it standing means every later reader of field_confidence (health, the
    // queue, the checklist) grades the new figures with the old read's verdict — stale either
    // way, as a false alarm or a false all-clear. The human just asserted these amounts, which
    // outranks any machine verdict about their predecessors; the other per-field scores stay,
    // because vendor/nummer/datum were not what changed here.
    {
      const fc = (invoice as { field_confidence?: Record<string, unknown> | null }).field_confidence;
      if (fc && typeof fc === "object" && "_safecore" in fc) {
        const cleaned = { ...fc };
        delete cleaned._safecore;
        (patch as Record<string, unknown>).field_confidence = cleaned;
      }
    }
  }
  // [SPLIT-CORRECTIE] The owner's split replaces the read's — or clears it. Merged over whatever
  // field_confidence the patch already carries (the _safecore cleanup above), never over a stale
  // copy, so the two edits compose in one request.
  if (nextBtwRows !== null || clearBtwRows) {
    const basisFc = ((patch as Record<string, unknown>).field_confidence as Record<string, unknown> | undefined)
      ?? { ...(((invoice as { field_confidence?: Record<string, unknown> | null }).field_confidence) ?? {}) };
    if (clearBtwRows) delete basisFc._btw_rows;
    else basisFc._btw_rows = nextBtwRows;
    // The owner ASSERTED this split — a remembered machine mismatch about the old one is stale.
    (patch as Record<string, unknown>).field_confidence = basisFc;
  }
  // [FULL-CORRECTION] Applied only where the value really differs, so a form that posts every
  // field cannot manufacture a change out of one the owner never touched. Trimmed comparison, the
  // same rule correctedFields uses, so the patch and the memory agree about what "changed" means.
  if (nextNumber !== null && nextNumber !== (invoice.invoice_number ?? "").trim()) patch.invoice_number = nextNumber;
  if (nextVendor !== null && nextVendor !== (invoice.client_name ?? "").trim()) patch.client_name = nextVendor;
  if (nextDate !== null && nextDate !== (invoice.invoice_date ?? "")) patch.invoice_date = nextDate;
  // [LEES-CORRECTIE] Same differs-only rule; empty string clears to NULL.
  const inv2 = invoice as unknown as { due_date?: string | null; payment_reference?: string | null; vendor_iban?: string | null };
  if (nextDue !== null && nextDue !== (inv2.due_date ?? "")) (patch as Record<string, unknown>).due_date = nextDue === "" ? null : nextDue;
  if (nextIban !== null && nextIban !== (inv2.vendor_iban ?? "")) (patch as Record<string, unknown>).vendor_iban = nextIban === "" ? null : nextIban;
  if (nextRef !== null && nextRef !== (inv2.payment_reference ?? "")) (patch as Record<string, unknown>).payment_reference = nextRef === "" ? null : nextRef;
  // [KIND-CORRECTION] Same one-way rule as the queue's confirm route: 'factuur' → 'creditnota'
  // only. That is the direction the reader structurally under-sees (a positively printed credit
  // note is never recognised, see HUNT-F2 in ai.ts) and the direction that takes money OFF the
  // outstanding balance. The reverse would quietly turn a credit into a debt.
  if (declaredCredit && invoice.invoice_type !== "creditnota") patch.invoice_type = "creditnota";

  // GUARD 5 — the WHERE re-asserts every precondition, so a stale tab cannot overwrite a newer
  // state. .select() so zero rows is distinguishable from success — without it a WHERE that matched
  // nothing would return ok and the screen would show a correction that never happened.
  const { data: written, error: writeErr } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .select("id");

  if (writeErr) {
    // The B.4 trigger freezes an invoice the accountant marked 'verwerkt'. Its message deliberately
    // contains that word — the pay-toggle and confirm routes detect it the same way.
    if (/verwerkt/i.test(writeErr.message)) {
      return NextResponse.json(
        { error: "Je boekhouder heeft deze factuur al verwerkt — vraag hem eerst de verwerking ongedaan te maken.", code: "verwerkt" },
        { status: 409 },
      );
    }
    console.error("[AMOUNT-CORRECTION] write failed", { invoiceId: id, userId: user.id, error: writeErr.message });
    return NextResponse.json({ error: "Opslaan mislukt — er is niets gewijzigd." }, { status: 500 });
  }

  if (!written || written.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur is intussen veranderd — ververs de pagina en probeer het opnieuw.", code: "stale" },
      { status: 409 },
    );
  }

  // [READING-MEMORY] Which of the reader's fields the owner actually moved. Computed against the
  // row as it was read, not against what the form posted — the modal sends all three amounts every
  // time, and recording those would teach the memory that everything is always wrong.
  // [FULL-CORRECTION] The metadata fields are in here too. reading-memory.ts already listed
  // client_name, invoice_number and invoice_date among CORRECTABLE_FIELDS — the memory was built
  // for them from the start; this route simply never had them to give.
  const correctedNow = correctedFields(
    {
      total_ex_btw: invoice.total_ex_btw,
      btw_amount: invoice.btw_amount,
      total_inc_btw: invoice.total_inc_btw,
      invoice_type: invoice.invoice_type,
      invoice_number: invoice.invoice_number,
      client_name: invoice.client_name,
      invoice_date: invoice.invoice_date,
    },
    {
      // Only what was actually sent — an absent field is unchanged, never "corrected to itself".
      total_ex_btw: hasAmounts ? signed.totalExBtw : undefined,
      btw_amount: hasAmounts ? signed.btwAmount : undefined,
      total_inc_btw: hasAmounts ? signed.totalIncBtw : undefined,
      // A server-applied sign flip is not a human correction — the same rule the confirm route's
      // [ORDER] test locks. What the human did was tick the box, and invoice_type records that.
      invoice_type: patch.invoice_type,
      invoice_number: patch.invoice_number,
      client_name: patch.client_name,
      invoice_date: patch.invoice_date,
    },
  );

  // The trail carries BOTH sides. Correcting a booked amount is exactly the kind of change an
  // accountant must be able to reconstruct a year later: what it was, what it became, and when.
  await logAuditAction({
    userId: user.id,
    action: "invoice.updated",
    entityType: "invoice",
    entityId: id,
    oldValue: {
      total_ex_btw: invoice.total_ex_btw,
      btw_amount: invoice.btw_amount,
      total_inc_btw: invoice.total_inc_btw,
      invoice_type: invoice.invoice_type,
      invoice_number: invoice.invoice_number,
    },
    newValue: {
      total_ex_btw: signed.totalExBtw,
      btw_amount: signed.btwAmount,
      total_inc_btw: signed.totalIncBtw,
      invoice_type: patch.invoice_type ?? invoice.invoice_type,
      via: "manage_amount_correction",
      // [CREDIT-SIGN] Recorded when the server turned the posted amounts negative, so a year later
      // the trail explains a minus the owner never typed.
      ...(signed.flipped ? { credit_sign_applied: true } : {}),
      // [READING-MEMORY] Same block, same shape as the queue's confirm route. There are two doors
      // through which a human disagrees with the reader — correcting before booking, and correcting
      // after — and a memory fed by only one of them would tell the owner a supplier is read fine
      // while they fix its invoices on the other screen every month.
      ...(correctedNow.length
        ? { reading_correction: { vendor: invoice.client_name, fields: correctedNow } }
        : {}),
    },
    ipAddress: getClientIP(req),
  });

  // [SUPPLIER-ALIAS] The lesson. A corrected leverancier name is not a label on one invoice: it is
  // the owner saying who this company is, and invoices.client_name is the identity key the IBAN
  // check, the incasso mandate, the creditnota signal and the reading memory all resolve through.
  // Left unlearned, the same misread comes back next month AND this invoice quietly leaves its
  // supplier's history — which is how the fraud check ends up answering "no IBAN on record".
  //
  // After the write and never before it: a lesson drawn from a correction that did not save would
  // teach the app something that is not in the books.
  const aliasLearned = patch.client_name
    ? await learnSupplierAlias(supabase, user.id, {
        printedName: invoice.client_name,
        correctedName: patch.client_name,
        supplierId: (invoice as { supplier_id?: string | null }).supplier_id ?? null,
        vendorIban: (invoice as { vendor_iban?: string | null }).vendor_iban ?? null,
      })
    : null;

  // ── [SUPPLETIE] Did this correction move a quarter that is already at the Belastingdienst? ──
  //
  // GUARD 7, and it does not refuse. The six above protect the books; this one protects a duty the
  // owner acquires the moment the books move: art. 10a AWR obliges them to report a filed aangifte
  // that has turned out wrong, and the obligation is time-bound. Blocking would be the wrong
  // answer here — the owner cannot issue a creditnota against their own supplier, and the number
  // being corrected is a reading of someone else's paper, so refusing leaves the books permanently
  // wrong AND the Belastingdienst uninformed. Allow, compute, and say the number.
  //
  // BOTH dates, because a corrected invoice_date moves the invoice out of one quarter and into
  // another: the first loses the amount and the second gains it, and naming one describes half of
  // what just happened.
  //
  // After the write, never before: an obligation announced for a correction that did not save is a
  // suppletie the owner would file over nothing.
  const filedImpact = await filedQuarterImpacts({
    pipeline: createPipelineClient(),
    ownerId: user.id,
    dates: [invoice.invoice_date, patch.invoice_date ?? invoice.invoice_date],
  });
  const suppletie: string[] = filedImpact.impacts.map(describeFiledQuarterImpact);
  if (filedImpact.unknown) {
    // [NO-SILENT-EMPTY] "We could not check" is not "nothing happened". The correction stands
    // either way, and the owner is told which half of the answer is missing rather than being left
    // to read silence as an all-clear.
    suppletie.push(
      "We konden niet nakijken of dit kwartaal al is ingediend. Je correctie is opgeslagen — " +
      "controleer op de Waarheid-pagina of er een suppletie nodig is.",
    );
  }
  for (const impact of filedImpact.impacts) {
    // [SUPPLETIE] The moment of awareness, recorded now because it cannot be reconstructed later.
    // Deploy-safe and never blocking — see stampDivergence.
    await stampDivergence({
      db: createPipelineClient(), ownerId: user.id,
      year: impact.year, quarter: impact.quarter, nowIso: new Date().toISOString(),
    });
    // In the bell as well as on the screen. The modal closes; a duty with a legal clock on it may
    // not close with it, and the notification is what the owner still has tomorrow morning.
    const melding = await createNotification({
      userId: user.id,
      title: `Ingediend kwartaal ${impact.label} is gewijzigd`,
      body: describeFiledQuarterImpact(impact),
      type: "status",
      link: "/dashboard/waarheid",
    });
    if (!melding.ok) {
      console.error("[SUPPLETIE] melding over een gewijzigd ingediend kwartaal mislukt", {
        invoiceId: id, quarter: impact.label, error: melding.error,
      });
    }
  }

  // The screen replaces its row with THIS, so it must be what was stored — otherwise a flipped
  // credit note would show positive until the next reload and the owner would correct it again.
  return NextResponse.json({
    ok: true,
    // [SUPPLETIE] One sentence per already-filed quarter this correction moved. Empty on the
    // ordinary correction, which is nearly all of them.
    suppletie,
    // Null when nothing was learned — the client says nothing rather than claiming a memory that
    // does not exist.
    supplier_memory: aliasLearned?.message ?? null,
    total_ex_btw: signed.totalExBtw,
    btw_amount: signed.btwAmount,
    total_inc_btw: signed.totalIncBtw,
    invoice_type: patch.invoice_type ?? invoice.invoice_type,
    // [SPLIT-CORRECTIE] The split as it now stands, so the caller's row (whose checklist reads
    // it) updates without a reload. null = untouched in this request; [] = cleared.
    btw_rows: clearBtwRows ? [] : nextBtwRows,
  });
}
