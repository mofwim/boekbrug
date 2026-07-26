// src/app/dashboard/vandaag/page.tsx
// [TODAY-LISTS-V1] "Vandaag" — server component.
//
// Surfaces TASKS, not numbers. Two lists only (v1):
//   1. Te betalen        — incoming invoices you must pay      (direction='incoming', status='received')
//   2. Herinner je klant — outgoing invoices a client must pay (direction='outgoing', status IN ('sent','overdue'))
//
// GOVERNING PRINCIPLE (updated by owner decision — TODAY-UX-FIELDS): the card
// now shows the stored total alongside dates + invoice number, to act as a real
// daily control center. The amount is READ DIRECTLY from total_inc_btw — never
// computed, summed, or derived in "Vandaag". This is the same trusted number the
// invoices page shows; displaying a stored value is an honest read, not the kind
// of arithmetic claim the no-amount rule originally guarded against.
//
// Payment state is defined by `status` ONLY — never payment_date/marked_paid_at
// (the live data proved they disagree: paid invoices exist with no payment_date).
//
// This page READS only. The single in-screen action is "Negeren" (session-only,
// visual, no DB) handled in the client. Any real action (pay, mark-as-paid, QR)
// jumps to the invoice page where that logic already lives — one source, no copy.

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import VandaagClient, { type VandaagInvoice } from "./VandaagClient";
// [CREDITNOTA-NO-CHASE] shared "is this still owed to me" rule — both sides of a credited pair
// must leave the list together (see src/lib/credited-invoices.ts)
import { creditedIdsFrom, filterOpenReceivables } from "@/lib/credited-invoices";

export const dynamic = "force-dynamic";

// [TODAY-UX-FIELDS] Per owner decision, the card now shows the invoice number,
// invoice date, due date, and the STORED total (total_inc_btw). The amount is
// READ DIRECTLY from the DB column — never computed/derived in "Vandaag" — so it
// is the same trusted number shown on the invoices page, not an arithmetic claim.
const SELECT =
  // [PARTIAL-PAY] amount_paid so a deelbetaling shows the REMAINING openstaand, not the full total.
  // [CREDITNOTA-NO-CHASE] invoice_type so a creditnota can be recognised: it is ALSO outgoing +
  // 'sent' and would otherwise sit in "Herinner je klant" as a negative amount to chase.
  "id, client_name, invoice_number, invoice_date, due_date, total_inc_btw, amount_paid, status, direction, invoice_type";

export default async function VandaagPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // [TODAY-LISTS-V1] List 1 — Te betalen: incoming invoices verified but unpaid.
  // status='received' = verified Crediteur awaiting payment (NOT 'processing',
  // which is still in the verification queue; NOT 'paid'). Payment state = status.
  const { data: payableRaw, error: payableErr } = await supabase
    .from("invoices")
    .select(SELECT)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(100);

  // [TODAY-LISTS-V1] List 2 — Herinner je klant: outgoing invoices sent but unpaid.
  // status IN ('sent','overdue') — 'overdue' included defensively; if the app never
  // promotes sent→overdue automatically it simply matches nothing extra (safe).
  const { data: remindRaw, error: remindErr } = await supabase
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("status", ["sent", "overdue"])
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(100);

  // [P1-STUCK-PROCESSING] Incoming invoices sitting in the verify queue (status='processing')
  // — imported/photographed but not yet verified. A clean high-confidence one is auto-advanced
  // to 'received'; the AMBIGUOUS / low-confidence ones stay here, and with no reminder they rot
  // silently — their voorbelasting (BTW-aftrek) and cost never reach the books. Surface the count
  // on the daily control center so the owner is nudged to clear them. Head-count only (no rows).
  const { count: toVerifyCount, error: toVerifyErr } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "processing");

  // [DATELESS-TASK] A confirmed incoming bill with NO due date is excluded from the "Te betalen"
  // list above (it filters `due_date IS NOT NULL` to date-sort). So a real cost the owner still
  // owes appears on NO task list and can be silently forgotten. Surface a count nudge here so it is
  // never invisible — the owner opens it to add a date / pay. Head-count only (no rows).
  const { count: datelessPayableCount, error: datelessErr } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .is("due_date", null)
    // Exclude incoming credit notes (NEGATIVE total): they REDUCE what's owed, so "controleer of
    // betaal" would mislabel them. Mirrors the InvoiceCard isCredit rule. A NULL total is NOT a
    // creditnota — it's a real dateless bill whose amount wasn't read — so keep it counted; a
    // plain `.gte(total,0)` dropped it (SQL: NULL >= 0 → NULL) and hid a genuine payable.
    .or("total_inc_btw.gte.0,total_inc_btw.is.null");

  const payable = (payableRaw ?? []) as unknown as VandaagInvoice[];
  // [CREDITNOTA-NO-CHASE] "Herinner je klant" must not list an invoice the owner WITHDREW with a
  // creditnota — nor the creditnota itself, which is also outgoing + 'sent' and so comes back from
  // the query above with a negative total. The home tile (/api/daily-truth) already filters both,
  // and its own comment says this page shows the same to-do; without this they contradict each
  // other, with the home saying "niets te doen" while this page shows a red "55 dagen te laat".
  // Same shared rule and the same honest degradation: an errored lookup keeps the old list.
  const remindAll = (remindRaw ?? []) as unknown as VandaagInvoice[];
  const creditRows = remindAll.length > 0
    ? await supabase
        .from("invoices")
        .select("original_invoice_id")
        .eq("sender_id", user.id)
        .eq("invoice_type", "creditnota")
        .not("original_invoice_id", "is", null)
        .then(({ data, error }) => (error ? null : (data ?? [])))
    : [];
  const remind = creditRows == null
    ? remindAll
    : filterOpenReceivables(remindAll, creditedIdsFrom(creditRows));

  // [COHERENCE-ERRSTATE] A failed load must NEVER masquerade as a calm "all clear".
  // Supabase returns { data: null, error } without throwing, so `?? []` silently
  // coerces a DB/RLS/network failure into two empty lists → the owner is falsely
  // reassured that nothing is due or overdue, hiding real payment obligations. Pass
  // the failure through so the client can show an honest "we could not load" state
  // instead of the reassuring checkmark. (Locked constraint #3: no false reassurance.)
  // Fold the count-query errors in too: a lone count failure must not silently coerce to 0 and show
  // a false "all clear" (a dateless payable / a verify-queue item could be hidden). No false calm.
  const loadFailed = !!payableErr || !!remindErr || !!toVerifyErr || !!datelessErr;

  return <VandaagClient payable={payable} remind={remind} loadFailed={loadFailed} toVerifyCount={toVerifyCount ?? 0} datelessPayableCount={datelessPayableCount ?? 0} />;
}