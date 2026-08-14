// src/app/api/cash/settle/route.ts
// [CASH-SETTLE] Reconcile the kasboek against the owner's cash-paid invoices on demand. The
// client pay paths (IncomingManageClient / FacturenClient executePay) update the invoice
// directly via Supabase and never hit the confirm endpoint, so they call this afterwards to
// create/heal/remove the linked 'betaling' settlement immediately — instead of waiting for the
// next kasboek load. Idempotent + best-effort (the pure sync decides create/update/delete).

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { reconcileCashSettlements } from "@/lib/cash-settle";

export const dynamic = "force-dynamic";

// [KAS-STIL] It answers with the pass's OWN verdict instead of an unconditional ok:true.
//
// reconcileCashSettlements returns `ok: false` when it bailed — it read something it could not
// trust, so it created, healed and reversed NOTHING — and this route threw that away and reported
// success. A caller acting on that answer would tell the owner their kasboek is in step with their
// invoices at the exact moment nobody had checked.
//
// It has no caller today (IncomingManageClient's fetch was removed once /api/invoice/pay-toggle
// began reconciling on both the pay and the undo branch, with a deliberate retry — see
// [CASH-RETRY] there). That is precisely why the shape matters: the next caller inherits whatever
// this says, and a route that cannot fail is a route nobody thinks to handle.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ok, created, updated, deleted } = await reconcileCashSettlements(supabase, user.id);
  if (!ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "cash_reconcile_bailed",
        detail:
          "We konden je kasboek nu niet bijwerken met je contant betaalde facturen. Er is niets " +
          "veranderd aan je boekingen — probeer het zo meteen opnieuw.",
        created, updated, deleted,
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, created, updated, deleted });
}
