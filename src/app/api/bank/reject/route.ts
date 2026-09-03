// src/app/api/bank/reject/route.ts
// [NIET-DEZE-FACTUUR] "This is not the invoice for this payment." One pair, written down.
//
// The bank page's card offered an invoice and one button: Bevestig betaling. There was no way to
// say the suggestion was wrong — so a wrong pair was either confirmed or left sitting, and leaving
// it means the same pair is offered again on every visit.
//
// POST   { transactionId, invoiceId }  → refuse this pair
// DELETE { transactionId, invoiceId }  → take it back
//
// Both are idempotent and both are cheap to undo, which is the point: a refusal must never be a
// decision an owner is afraid to make. Nothing here touches money — no link is written, no invoice
// changes status. It only removes a SUGGESTION.
//
// [DEPLOY-SAFE] bank_match_rejections.sql is applied by hand. Until it is, the table does not
// exist, this answers `stored: false`, and the screen keeps the refusal for the session only — the
// same behaviour it has today, with nothing claimed that is not true.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { columnExists } from "@/lib/column-probe";

export const dynamic = "force-dynamic";

async function pair(req: NextRequest): Promise<{ transactionId: string; invoiceId: string } | null> {
  try {
    const body = (await req.json()) as { transactionId?: string; invoiceId?: string };
    const transactionId = (body.transactionId ?? "").trim();
    const invoiceId = (body.invoiceId ?? "").trim();
    return transactionId && invoiceId ? { transactionId, invoiceId } : null;
  } catch {
    return null;
  }
}

/** Is the table there yet? [KAS-PROBE] One definition, in column-probe.ts. */
function supported(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  return columnExists(
    supabase, "bank_match_rejections", "id",
    "a refused suggestion would come back on the next page load",
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = await pair(req);
  if (!p) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  if (!(await supported(supabase))) return NextResponse.json({ ok: true, stored: false });

  // Both ids are checked against the OWNER's own rows before anything is written. The pair itself
  // is harmless, but a table that accepts ids nobody owns is a table that can be filled by anyone.
  const [{ data: tx }, { data: inv }] = await Promise.all([
    supabase.from("bank_transactions").select("id").eq("id", p.transactionId).eq("user_id", user.id).maybeSingle(),
    supabase.from("invoices").select("id").eq("id", p.invoiceId)
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).maybeSingle(),
  ]);
  if (!tx || !inv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The table is applied by hand, so it is not in the generated types yet — the same cast every
  // other not-yet-migrated table in this codebase uses. The probe above is what makes it safe:
  // nothing reaches this line until the table demonstrably exists.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("bank_match_rejections")
    // Idempotent: a second tap must not write a second row, or the undo below would remove one of
    // two and the suggestion would come back looking like the app forgot.
    .upsert(
      { user_id: user.id, transaction_id: p.transactionId, invoice_id: p.invoiceId },
      { onConflict: "user_id,transaction_id,invoice_id" },
    );
  if (error) {
    // [NO-SILENT-EMPTY] Say it did not stick. The screen keeps the refusal for this session either
    // way; what it may not do is promise the app will remember.
    return NextResponse.json({ error: "not_stored", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stored: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = await pair(req);
  if (!p) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await supported(supabase))) return NextResponse.json({ ok: true, stored: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("bank_match_rejections")
    .delete()
    .eq("user_id", user.id)
    .eq("transaction_id", p.transactionId)
    .eq("invoice_id", p.invoiceId);
  if (error) return NextResponse.json({ error: "not_removed", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stored: true });
}
