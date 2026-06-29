// src/app/dashboard/vandaag/page.tsx
// [TODAY-LISTS-V1] "Vandaag" — server component.
//
// Surfaces TASKS, not numbers. Two lists only (v1):
//   1. Te betalen        — incoming invoices you must pay      (direction='incoming', status='received')
//   2. Herinner je klant — outgoing invoices a client must pay (direction='outgoing', status IN ('sent','overdue'))
//
// GOVERNING PRINCIPLE (locked): we show actions + dates, NEVER computed
// amounts/totals. A wrong task the owner ignores; a wrong NUMBER breaks trust in
// the whole app. So "Vandaag" deliberately shows no money in v1.
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

// Only the columns the cards need. No amounts are selected — by design, "Vandaag"
// shows tasks + dates, never money. client_name covers both the supplier (incoming)
// and the client (outgoing) party name.
const SELECT = "id, client_name, due_date, status, direction";

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