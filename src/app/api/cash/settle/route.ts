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

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await reconcileCashSettlements(supabase, user.id);
  return NextResponse.json({ ok: true });
}
