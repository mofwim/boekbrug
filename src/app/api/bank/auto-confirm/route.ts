// src/app/api/bank/auto-confirm/route.ts
// [BANK-AUTO-CONFIRM] "Quiet by default": the app books the NEAR-CERTAIN payments itself so
// the owner isn't chasing hundreds of one-tap confirms. It only ever touches matches that
// pass isSafeAutoConfirm (invoice number printed in the statement AND the amount matches to
// the cent, single invoice, not an instalment) — the same 0.97 match the UI would pre-select
// for a one-tap "betaald". Everything ambiguous stays for the human.
//
// Money discipline is identical to /api/bank/confirm, per match:
//   - invoice → 'paid' via the SESSION client (so the B.4 verwerkt trigger fires),
//   - the pay write .select()s so a CONCURRENT payment (0 rows) is skipped, never re-owned,
//   - bank_transactions → 'matched' + invoice_id via the pipeline (single invoice ⇒ covered),
//   - a link failure rolls the invoice back to its prior status (no orphaned paid invoice).
// Fully reversible (the owner can unlink), and every booking is audited for a review trail.
// BTW/omzet/kosten are on accrual (invoice date) so this changes ONLY the paid/linked status.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { runBankAutoConfirm, type KasRefusalTally } from "@/lib/bank-auto-confirm";
import { applyLearnedBankCategories } from "@/lib/bank-auto-categorize";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();

  // The safe-set pass now lives in a shared server helper so it runs identically from here,
  // from a bank import, and from the reconcile cron. The invoice→paid write uses the SESSION
  // client so the DB 'verwerkt' guard fires with a real auth.uid().
  // [KAS-ACHTER-BANK] Wat deze pas BEWUST niet heeft geboekt, en waarom. Onder het kasstelsel is
  // de betaaldatum btw-timing, dus een 'amount_only'-match in een kwartaal dat al is aangegeven
  // laat de app aan de eigenaar — een goede beslissing die tot nu toe alleen in een logregel stond.
  const kasRefusals: KasRefusalTally = {};
  const confirmed = await runBankAutoConfirm({ payClient: supabase, pipeline, userId: user.id, refusalsOut: kasRefusals });
  // [BANK-AUTO-CATEGORIZE] Also code fresh bank lines from the owner's learned memory (confident
  // only, reviewable) so the /bank load shrinks the uncategorized pile without a manual bulk tap.
  const categorized = await applyLearnedBankCategories({ pipeline, userId: user.id }).catch(() => []);

  return NextResponse.json({ ok: true, confirmed, count: confirmed.length, categorized: categorized.length, kasRefusals });
}
