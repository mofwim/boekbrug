// src/app/api/invoice/payment/move/route.ts
// [MOVE-PAYMENT] Move one booked payment from the invoice that has it to the invoice that should.
//
//   GET  ?invoiceId=<id>  → the invoice's payments + the invoices each could move to
//   POST { linkId, targetInvoiceId } → move it
//
// Why this exists: money lands on the wrong invoice — a supplier's corrected re-issue, a matcher
// choosing the wrong one of two equal amounts, a tap on the wrong row. The answer used to be
// "undo the payment, find the bank line again, book it on the other invoice": three actions, and
// between the first and the last the money exists nowhere. An owner interrupted halfway leaves the
// books in that half state.
//
// The WRITE is one transaction and lives entirely in the move_invoice_payment RPC — this route
// never moves money in steps. It authenticates, hands over two ids, and translates the refusal.
// The pre-checks here (payment-move.ts) exist to keep the picker honest, never as the guard: the
// RPC re-reads and re-decides everything under a row lock, because a client answer is not a
// permission and the read below can be seconds stale.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import {
  rankMoveTargets,
  moveFailureText,
  type MoveTargetCandidate,
  type MovablePayment,
} from "@/lib/payment-move";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { reconcileCashSettlements } from "@/lib/cash-settle";

export const dynamic = "force-dynamic";

const INVOICE_FIELDS =
  "id, status, direction, invoice_number, client_name, invoice_date, total_inc_btw, amount_paid, accountant_status";

// ── GET — what can move, and where to ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  if (!invoiceId) return NextResponse.json({ error: "missing_invoice" }, { status: 400 });

  const pipeline = createPipelineClient();

  const { data: source } = await pipeline
    .from("invoices")
    .select(INVOICE_FIELDS)
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  // The payments actually booked on this invoice. A pre-[PARTIAL-PAY] row carries no amount and
  // cannot be moved (we would not know what we are moving) — it is returned WITH that fact rather
  // than hidden, so the screen can explain instead of silently offering less than the owner sees.
  const { data: linkRows } = await pipeline
    .from("bank_tx_invoices")
    .select("id, invoice_id, amount_applied, transaction_id, paid_on, method")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId);
  const payments = ((linkRows ?? []) as MovablePayment[]).map((l) => ({
    ...l,
    amount_applied: Math.max(0, Number(l.amount_applied ?? 0)),
  }));

  if (payments.length === 0) {
    return NextResponse.json({ ok: true, source, payments: [], targets: [] });
  }

  // Candidates: the owner's own invoices in the SAME direction that can still receive money.
  // "Enough left over" cannot be asked of the database (it is total − amount_paid), so the set is
  // narrowed by direction and status here and decided in code (payment-move).
  //
  // TWO reads, not one uncapped one. An owner with thousands of open invoices would otherwise page
  // through all of them every time this sheet opens, and capping a single read would silently drop
  // the one candidate that matters. So: every invoice of the SAME SUPPLIER — the case this feature
  // exists for, and the one that must never be truncated — plus a bounded window of the most
  // recent others for the ordinary "wrong row" mistake. Anything older than that window is not
  // offered; the owner can still undo and re-book by hand.
  const dir = (source as MoveTargetCandidate).direction ?? "incoming";
  const base = () =>
    pipeline
      .from("invoices")
      .select(INVOICE_FIELDS)
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq("direction", dir)
      .in("status", ["received", "sent", "overdue"])
      .neq("id", invoiceId);

  const vendor = ((source as MoveTargetCandidate).client_name ?? "").trim();
  const [sameVendor, recent] = await Promise.all([
    vendor
      ? base().eq("client_name", vendor).order("invoice_date", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as MoveTargetCandidate[] }),
    base().order("invoice_date", { ascending: false }).limit(300),
  ]);

  const byId = new Map<string, MoveTargetCandidate>();
  for (const row of [
    ...(((sameVendor as { data?: MoveTargetCandidate[] }).data ?? [])),
    ...(((recent as { data?: MoveTargetCandidate[] }).data ?? [])),
  ]) {
    byId.set(row.id, row);
  }
  const candidates = [...byId.values()];

  // Which invoices each payment's bank line already pays — a second link to the same pair would
  // collide with bank_tx_invoices_unique_pair, so those targets must not be offered.
  const txIds = [...new Set(payments.map((p) => p.transaction_id).filter(Boolean))] as string[];
  const linkedByTx = new Map<string, Set<string>>();
  if (txIds.length > 0) {
    const { data: siblings } = await pipeline
      .from("bank_tx_invoices")
      .select("transaction_id, invoice_id")
      .eq("user_id", user.id)
      .in("transaction_id", txIds);
    for (const s of (siblings ?? []) as { transaction_id: string; invoice_id: string }[]) {
      const set = linkedByTx.get(s.transaction_id) ?? new Set<string>();
      set.add(s.invoice_id);
      linkedByTx.set(s.transaction_id, set);
    }
  }

  return NextResponse.json({
    ok: true,
    source,
    payments: payments.map((p) => ({
      ...p,
      movable: p.amount_applied > 0,
      targets: rankMoveTargets(
        p,
        source as MoveTargetCandidate,
        candidates,
        p.transaction_id ? (linkedByTx.get(p.transaction_id) ?? new Set()) : new Set(),
      ).slice(0, 50),
    })),
  });
}

// ── POST — move it ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { linkId?: string; targetInvoiceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { linkId, targetInvoiceId } = body;
  if (!linkId || !targetInvoiceId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Session client so the RPC's caller guard sees a real auth.uid() — the same contract
  // apply_manual_payment is called under. The function is SECURITY DEFINER because
  // bank_tx_invoices has no UPDATE policy at all: moving a link is precisely the operation RLS
  // does not grant, and it must only ever happen through these guards.
  // move_invoice_payment arrives with invoice_move_payment.sql, applied by hand — it is not in the
  // generated types until they are regenerated. Same cast the /api/btw/file route uses for
  // btw_filings; the arguments below are still checked by the function itself.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("move_invoice_payment", {
    p_user_id: user.id,
    p_link_id: linkId,
    p_target_invoice_id: targetInvoiceId,
  });

  if (error) {
    // The move is atomic: a failure always means NOTHING changed. Say which reason it was, in
    // words the owner can act on — never a bare code, never a shrug.
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText(error.message) },
      { status: 409 },
    );
  }

  const row = Array.isArray(data)
    ? (data[0] as
        | {
            applied: number;
            source_invoice_id: string;
            source_amount_paid: number;
            source_status: string;
            target_amount_paid: number;
            target_status: string;
            target_is_paid: boolean;
          }
        | undefined)
    : undefined;
  if (!row) {
    return NextResponse.json(
      { error: "move_failed", detail: moveFailureText(null) },
      { status: 409 },
    );
  }

  await logAuditAction({
    userId: user.id,
    action: "invoice.payment_moved",
    entityType: "invoice",
    entityId: targetInvoiceId,
    oldValue: { invoice_id: row.source_invoice_id },
    newValue: {
      link_id: linkId,
      applied: row.applied,
      from_invoice_id: row.source_invoice_id,
      to_invoice_id: targetInvoiceId,
      source_amount_paid: row.source_amount_paid,
      source_status: row.source_status,
      target_amount_paid: row.target_amount_paid,
      target_status: row.target_status,
    },
    ipAddress: getClientIP(req),
  });

  // The kasboek holds one entry per cash settlement; a moved 'kas' instalment now belongs to a
  // different invoice, so the drawer has to be re-derived. Called directly, as every sibling route
  // does — an internal HTTP hop back into our own API would depend on forwarding the cookie and
  // resolving the origin correctly, two ways to fail at a step that must not be able to fail
  // loudly. Best-effort: the money write already committed, and the kasboek reconciles on load.
  try {
    await reconcileCashSettlements(supabase, user.id);
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ ok: true, ...row });
}
