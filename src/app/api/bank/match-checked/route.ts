// src/app/api/bank/match-checked/route.ts
// [KAS-AUTO-BOOK] "Ik heb het gecontroleerd" — the missing half of the amount-only flag.
//
// The app books a bank line onto an invoice on amount + supplier name alone (no invoice number in
// the description), stamps auto_match_reason='amount_only', and the Gekoppeld tab shows an amber
// "even controleren of dit de juiste factuur is". That was the whole loop: a warning with two
// outcomes, one of which — "it is correct" — had no button.
//
// The cost of that gap is not cosmetic. The readiness board now counts these before a quarter is
// filed (they are why an amount-only match is allowed to book itself under the kasstelsel at all:
// reversible until the aangifte goes out). A warning nobody can dismiss becomes a permanent risk on
// every quarter for the rest of the administration's life, and a permanent warning is one nobody
// reads — which would leave the genuinely wrong one sitting in plain sight.
//
// So this route says one thing: a human looked at this link and it is right. It clears the flag and
// nothing else — the link, the payment, the invoice status are all untouched. Getting it wrong
// costs nothing that "Ontkoppelen" does not still fix.
//
// service_role is safe here: every statement is pinned to the authenticated user's own rows.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { logAuditAction } from "@/lib/audit";
import { isMissingColumn } from "@/lib/pg-missing";

export const dynamic = "force-dynamic";

/** No more than this many per call — the tab pages at 200, so a "check all" never exceeds it. */
const MAX_IDS = 500;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transactionIds?: unknown };
  try {
    body = (await req.json()) as { transactionIds?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ids = Array.isArray(body.transactionIds)
    ? body.transactionIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "no_transactions" }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: "too_many" }, { status: 400 });

  const pipeline = createPipelineClient();

  // status='matched' is part of the WHERE on purpose: this may only ever clear a flag on a line
  // that is still linked. A line the owner unlinked in another tab has no flag to confirm, and
  // confirming one would be a claim about a link that no longer exists.
  //
  // auto_match_reason arrives with bank_auto_match_reason.sql and is not in the generated types —
  // the same relaxed cast /api/bank/match uses for its read.
  const { data, error } = await (pipeline as unknown as {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => {
          in: (c: string, v: string[]) => {
            eq: (c: string, v: string) => {
              select: (c: string) => PromiseLike<{ data: { id: string }[] | null; error: { message: string; code?: string } | null }>;
            };
          };
        };
      };
    };
  })
    .from("bank_transactions")
    .update({ auto_match_reason: null })
    .eq("user_id", user.id)
    .in("id", ids)
    .eq("status", "matched")
    .select("id");

  if (error) {
    // [DEPLOY-SAFE] The column not existing yet means no line can carry the flag, so there was
    // nothing to clear and the owner's tap did exactly what they wanted. Every other error is a
    // write that failed, and reporting that as success would leave the amber banner up with no
    // explanation — the owner would tap it again and again.
    if (isMissingColumn(error.message, error.code)) {
      return NextResponse.json({ ok: true, cleared: 0 });
    }
    console.error("[KAS-AUTO-BOOK] clearing the amount-only flag failed", { userId: user.id, error: error.message });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const cleared = (data ?? []).map((r) => r.id);
  // Audited like every other state change on a booking: the flag is evidence about how the link
  // came to exist, and who dismissed it is part of that story.
  if (cleared.length > 0) {
    await logAuditAction({
      userId: user.id,
      action: "bank.match_checked",
      entityType: "bank_transaction",
      entityId: cleared[0],
      newValue: { transaction_ids: cleared, count: cleared.length },
    }).catch((e) => {
      console.error("[KAS-AUTO-BOOK] audit write failed after clearing flags", {
        userId: user.id, error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return NextResponse.json({ ok: true, cleared: cleared.length });
}
