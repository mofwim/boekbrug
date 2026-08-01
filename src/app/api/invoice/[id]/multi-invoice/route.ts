// src/app/api/invoice/[id]/multi-invoice/route.ts
// [MULTI-INVOICE] "Nee, dit is één factuur" — the owner's answer to a suspicion.
//
// detectMultipleInvoices flags an uploaded PDF that looks like it holds SEVERAL different
// invoices, because the reader books exactly one of them and the rest exist nowhere. It is a
// deliberately soft signal: the invoice imports, it is held out of auto-booking, and the queue
// says what it thinks it saw.
//
// A suspicion the owner cannot answer stops being a warning and becomes noise — and noise on this
// screen is expensive, because the same badge carries a real arithmetic error and a changed IBAN.
// So: one DELETE clears THIS flag and nothing else, and the invoice returns to being judged on its
// own merits. Nothing financial moves; the row keeps its status, its amounts and its place in the
// queue. Fully reversible in the only sense that matters — re-uploading the file flags it again.
//
// Session client → RLS, and scoped by receiver_id: only the owner of an incoming invoice may
// answer for it.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { clearSingleInvoiceDoubt } from "@/lib/multi-invoice-pdf";
import { logAuditAction, getClientIP } from "@/lib/audit";
import type { Database } from "@/types/database.types";
import { requireOwner } from '@/lib/owner-only'

type Json = Database["public"]["Tables"]["invoices"]["Update"]["field_confidence"];

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('Een factuur in delen splitsen'); if (w.response) return w.response }

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_number, field_confidence")
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  // Clears BOTH grounds — "we saw several invoices" and "we could not check" — because the owner
  // answers one question and import-health already maps the two onto one flag. Clearing only one
  // would leave the badge standing after the answer that was meant to take it down.
  const next = clearSingleInvoiceDoubt((invoice as { field_confidence?: unknown }).field_confidence);
  if (!next) {
    // Nothing was flagged. Say so instead of reporting a change that never happened — the queue
    // may simply be a version behind, and a fake success would leave the badge on screen.
    return NextResponse.json({ ok: true, alreadyClear: true });
  }

  // [PIPELINE] Same reason the supersede route uses it: field_confidence is written by the import
  // pipeline, and this is a correction to that pipeline's own guess, not a money field.
  const pipeline = createPipelineClient();
  const { data: updated, error } = await pipeline
    .from("invoices")
    .update({ field_confidence: next as Json })
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .select("id");
  if (error) {
    return NextResponse.json({ error: "dismiss_failed", detail: error.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "invoice_not_found", detail: "Deze factuur is niet meer beschikbaar — ververs de pagina." },
      { status: 409 },
    );
  }

  // The owner overruled a machine judgement about the completeness of their own bookkeeping.
  // That belongs in the trail: it is the record of who decided the other invoices do not exist.
  await logAuditAction({
    userId: user.id,
    action: "invoice.multi_invoice_dismissed",
    entityType: "invoice",
    entityId: id,
    oldValue: {
      multiple_invoices: true,
      numbers:
        ((invoice as { field_confidence?: { _safecore?: { multiple_invoices_numbers?: unknown } } })
          .field_confidence?._safecore?.multiple_invoices_numbers) ?? null,
    },
    newValue: { multiple_invoices: false, reason: "owner_says_single_invoice" },
    ipAddress: getClientIP(req),
  }).catch(() => { /* the correction already landed; the trail is best-effort */ });

  return NextResponse.json({ ok: true });
}
