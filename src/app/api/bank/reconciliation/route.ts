// src/app/api/bank/reconciliation/route.ts
// [BANK-RECON-BADGE] Invoice-centric reconciliation status for the invoice lists.
// Returns, per invoice id: { linked, pendingMatch } — see computeInvoiceReconciliation.
//
// Read-only and idempotent (writes NOTHING). It is the inverse view of /api/bank/match:
// the bank page asks "which invoice does this payment match?"; the invoice lists ask
// "does this invoice have a payment in the bank statement (already linked, or a confident
// unconfirmed match to confirm)?". Confirmation still happens only via POST /api/bank/confirm.
//
// [MATCH-BUTTON] The queries + matcher call now live in buildInvoiceReconciliationMap so the
// on-demand matcher (POST /api/reconcile/run) returns the SAME map from the same code — the
// button's summary and these badges can never drift apart.
//
// service_role (pipeline) is safe here because EVERY query is pinned to the authenticated
// user's own rows, exactly like /api/bank/match.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { buildInvoiceReconciliationMap } from "@/lib/bank-recon-map";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();

  try {
    // [CIRKEL] The builder computes these counts anyway; sending them lets the invoice screens
    // show a STANDING "N betalingen wachten op de bankpagina" line instead of a post-run sheet
    // that vanishes on close.
    const { byInvoice, pendingTransactions, pendingMatchCount } = await buildInvoiceReconciliationMap({ pipeline, userId: user.id });
    return NextResponse.json({ ok: true, byInvoice, pendingTransactions, pendingMatchCount });
  } catch (e) {
    return NextResponse.json(
      { error: "reconciliation_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
