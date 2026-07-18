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

export const dynamic = "force-dynamic";

// [TODAY-UX-FIELDS] Per owner decision, the card now shows the invoice number,
// invoice date, due date, and the STORED total (total_inc_btw). The amount is
// READ DIRECTLY from the DB column — never computed/derived in "Vandaag" — so it
// is the same trusted number shown on the invoices page, not an arithmetic claim.
const SELECT =
  // [PARTIAL-PAY] amount_paid so a deelbetaling shows the REMAINING openstaand, not the full total.
  "id, client_name, invoice_number, invoice_date, due_date, total_inc_btw, amount_paid, status, direction";

export default async function VandaagPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // [TODAY-LISTS-V1] List 1 — Te betalen: incoming invoices verified but unpaid.
  // status='received' = verified Crediteur awaiting payment (NOT 'processing',
  // which is still in the verification queue; NOT 'paid'). Payment state = status.
  const { data: payableRaw } = await supabase
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
  const { data: remindRaw } = await supabase
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("status", ["sent", "overdue"])
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(100);

  const payable = (payableRaw ?? []) as unknown as VandaagInvoice[];
  const remind = (remindRaw ?? []) as unknown as VandaagInvoice[];

  return <VandaagClient payable={payable} remind={remind} />;
}