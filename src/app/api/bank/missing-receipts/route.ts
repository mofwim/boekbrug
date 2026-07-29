// src/app/api/bank/missing-receipts/route.ts
// [ONTBREKENDE-BONNEN] The "missing receipts" list for a quarter: every bank payment
// (debit) that still needs a purchase document (bon) — a pending, unlinked, uncovered
// business cost. Read-only projection over bank_transactions; no matching logic here,
// just the ONE shared predicate (bank-identity.isMissingReceipt), the same one that
// feeds the readiness score, so this list and that count never disagree.
//
// Dual-path (mirrors /api/readiness, /api/closing-package): own quarter by default, OR
// a linked client's quarter for an accountant. resolveQuarterOwner does the auth; every
// query below is service_role and scoped to the resolved ownerId — never widened.
// Read-only: resolving an item (attach a bon / "geen bon nodig") stays owner-only via
// the existing /api/bank/attach-invoice and /api/bank/ignore routes.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
import { isMissingReceipt } from "@/lib/bank-identity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function pad(n: number): string { return String(n).padStart(2, "0"); }

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const { year, quarter } = quarterFromParams((k) => sp.get(k));

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;

  // Auth: own quarter, or a linked client's quarter for an accountant. 403 otherwise.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const ownerId = owner.ownerId;

  const pipeline = createPipelineClient();
  const rows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("id, date, amount, category, invoice_id, status, description, counterpart_name, reference")
    .eq("user_id", ownerId).gte("date", start).lte("date", end)
    .order("date", { ascending: false }).range(from, to));

  const items = rows
    .filter((t) => isMissingReceipt({
      status: t.status,
      invoice_id: t.invoice_id,
      amount: t.amount ?? 0,
      category: t.category,
      counterpart_name: t.counterpart_name,
      description: t.description,
    }))
    .map((t) => ({
      id: t.id as string,
      date: t.date as string,
      amount: (t.amount ?? 0) as number,
      counterpart_name: (t.counterpart_name ?? null) as string | null,
      description: (t.description ?? null) as string | null,
      reference: (t.reference ?? null) as string | null,
    }));

  return NextResponse.json({ year, quarter, count: items.length, items });
}
