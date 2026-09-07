// src/lib/correction-proposal.ts
// [VOORSTEL] The accountant proposes a correction; the client decides. Pure, no I/O.
// Run: npx tsx --test src/lib/correction-proposal.test.ts
//
// The amount guard (accountant_amount_guard) keeps a boekhouder from changing the money on a
// client's invoice, and that is right: art. 52 AWR leaves the administration the owner's. But the
// boekhouder is the one who SEES the wrong btw split, the wrong date, the total that does not
// match the paper — and until now the only tool was a free-text question that ended in WhatsApp.
//
// A proposal is a question with the answer already typed in. It carries the fields it wants to
// change, a snapshot of what they were when it was written, and a reason. The client sees old →
// new and taps Akkoord or Niet akkoord. Akkoord goes through the client's OWN correction door
// (/api/invoice/[id]/amounts, in the client's session) — the same validation, the same guards,
// the same audit trail as if they had typed it themselves. The app applies nothing on the
// accountant's word alone.
//
// Two refusals live here because they are arithmetic, not policy:
//   · a proposal that changes nothing is not a proposal;
//   · a proposal is STALE when the invoice no longer matches its snapshot — someone corrected it in
//     between — and a stale proposal is refused, never applied on top of the newer truth.

import { SUM_TOLERANCE } from "./btw-reconcile";

/** The fields a proposal may name. All of them sit behind the amount guard. */
export const PROPOSABLE_FIELDS = ["total_ex_btw", "btw_amount", "total_inc_btw", "invoice_date", "due_date"] as const;
export type ProposableField = (typeof PROPOSABLE_FIELDS)[number];

export interface ProposableValues {
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  invoice_date: string | null;
  due_date: string | null;
}

export interface ProposedChange {
  field: ProposableField;
  from: number | string | null;
  to: number | string | null;
}

export type ProposalVerdict =
  | { ok: true; changes: ProposedChange[]; proposed: ProposableValues }
  | { ok: false; reason: string; code: "nothing_changed" | "incomplete_amounts" | "sum_mismatch" | "no_base" | "impossible_rate" | "bad_date" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function sameMoney(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.005;
}

/**
 * Read a proposal against the invoice as it is now. The amount rules are the ones the client's
 * own editor enforces (amounts route): all three or none, ex + btw = inc, no btw over nothing,
 * no rate above 21%. A proposal the client's door would refuse is refused here, before it is
 * ever shown to the client.
 */
export function buildProposal(current: ProposableValues, input: Partial<Record<ProposableField, unknown>>): ProposalVerdict {
  const ex = finite(input.total_ex_btw) ? input.total_ex_btw : null;
  const btw = finite(input.btw_amount) ? input.btw_amount : null;
  const inc = finite(input.total_inc_btw) ? input.total_inc_btw : null;
  const anyAmount = ex !== null || btw !== null || inc !== null;
  if (anyAmount && (ex === null || btw === null || inc === null)) {
    return { ok: false, code: "incomplete_amounts", reason: "Vul alle drie de bedragen in — excl. btw, btw en totaal — of laat ze alle drie leeg." };
  }
  if (anyAmount && Math.abs((ex as number) + (btw as number) - (inc as number)) > SUM_TOLERANCE) {
    return { ok: false, code: "sum_mismatch", reason: "Bedrag excl. btw plus btw moet gelijk zijn aan het totaal." };
  }
  if (anyAmount && Math.abs(btw as number) > 0.005) {
    if (Math.abs(ex as number) < 0.005) return { ok: false, code: "no_base", reason: "Btw zonder grondslag kan niet." };
    if (Math.abs((btw as number) / (ex as number)) * 100 > 21.5) return { ok: false, code: "impossible_rate", reason: "Deze bedragen impliceren een btw-tarief boven 21%." };
  }
  const invoiceDate = typeof input.invoice_date === "string" ? input.invoice_date.trim() : null;
  const dueDate = typeof input.due_date === "string" ? input.due_date.trim() : null;
  if ((invoiceDate !== null && !ISO_DATE.test(invoiceDate)) || (dueDate !== null && dueDate !== "" && !ISO_DATE.test(dueDate))) {
    return { ok: false, code: "bad_date", reason: "Vul een geldige datum in (jjjj-mm-dd)." };
  }

  const proposed: ProposableValues = {
    total_ex_btw: anyAmount ? (ex as number) : current.total_ex_btw,
    btw_amount: anyAmount ? (btw as number) : current.btw_amount,
    total_inc_btw: anyAmount ? (inc as number) : current.total_inc_btw,
    invoice_date: invoiceDate ?? current.invoice_date,
    due_date: dueDate === null ? current.due_date : (dueDate === "" ? null : dueDate),
  };
  const changes: ProposedChange[] = [];
  for (const f of ["total_ex_btw", "btw_amount", "total_inc_btw"] as const) {
    if (!sameMoney(current[f], proposed[f])) changes.push({ field: f, from: current[f], to: proposed[f] });
  }
  for (const f of ["invoice_date", "due_date"] as const) {
    if ((current[f] ?? null) !== (proposed[f] ?? null)) changes.push({ field: f, from: current[f], to: proposed[f] });
  }
  if (changes.length === 0) return { ok: false, code: "nothing_changed", reason: "Er is niets gewijzigd." };
  return { ok: true, changes, proposed };
}

/** Has the invoice moved since the snapshot? Only the fields the proposal names matter. */
export function isStale(before: ProposableValues, current: ProposableValues, changes: readonly ProposedChange[]): boolean {
  for (const c of changes) {
    const f = c.field;
    if (f === "invoice_date" || f === "due_date") {
      if ((before[f] ?? null) !== (current[f] ?? null)) return true;
    } else if (!sameMoney(before[f], current[f])) return true;
  }
  return false;
}

/**
 * The body the client's correction door takes. Amounts travel as a trio whenever one of them
 * changed — the door refuses a partial trio — and a due date cleared travels as "" (the door's
 * spelling for "no due date").
 */
export function proposalPatchBody(proposed: ProposableValues, changes: readonly ProposedChange[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (changes.some((c) => c.field === "total_ex_btw" || c.field === "btw_amount" || c.field === "total_inc_btw")) {
    body.total_ex_btw = proposed.total_ex_btw;
    body.btw_amount = proposed.btw_amount;
    body.total_inc_btw = proposed.total_inc_btw;
  }
  if (changes.some((c) => c.field === "invoice_date")) body.invoice_date = proposed.invoice_date;
  if (changes.some((c) => c.field === "due_date")) body.due_date = proposed.due_date ?? "";
  return body;
}

export type ProposalStatus = "open" | "accepted" | "declined" | "stale";

export function isProposalStatus(v: unknown): v is ProposalStatus {
  return v === "open" || v === "accepted" || v === "declined" || v === "stale";
}
