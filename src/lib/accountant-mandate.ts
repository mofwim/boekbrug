// src/lib/accountant-mandate.ts
// [MANDAAT] May this accountant issue invoices in this client's name? Pure, no I/O.
// Run: npx tsx --test src/lib/accountant-mandate.test.ts
//
// WHY THIS EXISTS AS ITS OWN FILE
//
// Art. 35 lid 1 Wet OB allows an invoice to be issued "in zijn naam en voor zijn rekening ... door
// een derde" — in the entrepreneur's name and for their account, by a third party. So this is
// permitted. What art. 35a does NOT move is the responsibility: the entrepreneur stays liable for
// the invoice being correct. A permission with that consequence deserves to be decidable in one
// place, by a function with no database under it, so a test can state every case out loud.
//
// THREE FACTS, AND ALL THREE MUST HOLD
//   1. the caller IS an accountant (profiles.role);
//   2. an accountant_clients link with this client exists — the client invited them;
//   3. an invoice mandate from this client is active — the client said, separately, "you may also
//      invoice in my name".
//
// Two and three are deliberately not one thing. A client hands over their bookkeeping far more
// readily than their invoicing, and the app must be able to tell the difference. Almost every
// linked accountant will have (2) and not (3).
//
// AND THE DATABASE SAYS IT AGAIN
// next_invoice_seq() and prevent_accountant_amount_changes() both call
// has_active_invoice_mandate() (accountant_invoice_mandate.sql). This file is not the boundary —
// it is the half that can answer 403 with a sentence instead of letting the database answer 500
// with an exception. If the two ever disagree, the database wins and the user sees a crash; that
// is why the conditions here are written to be strictly the same, and why both are commented.

import type { ActingFor } from "./acting-for";

/**
 * [BEVESTIGEN] Which permission this row grants. Two, and they are two SEPARATE decisions by the
 * client — never one.
 *
 *   'facturen'   — issue invoices in the client's name, and remind their customers. Covered by
 *                  art. 35 lid 1 Wet OB: a third party may issue the invoice.
 *   'bevestigen' — confirm an incoming invoice so the quarter can close. NO article covers this,
 *                  and art. 52 AWR leaves the administration duty with the entrepreneur — which is
 *                  exactly why it needs its own explicit, revocable permission rather than a role.
 *
 * A client who wants their bookkeeping handled but their invoicing left alone is the common case,
 * not an edge one. Folding these into one switch would take that choice away silently.
 */
export type MandateKind = "facturen" | "bevestigen";

/** One row from accountant_invoice_mandates, as the database returns it. */
export interface MandateRow {
  zzper_id: string;
  accountant_id: string;
  /** Absent reads as 'facturen' — every row predates the kind column. */
  kind?: string | null;
  /** Set ⇒ the mandate grants nothing from that moment on. */
  revoked_at: string | null;
}

/**
 * Is this mandate live right now?
 *
 * `nowMs` is passed in — no clock inside a pure function, and it makes the test exact. An
 * unreadable revoked_at counts as REVOKED: better an accountant locked out a moment too early than
 * one who keeps invoicing under a VAT number they were told to stop using.
 */
export function isMandateActive(row: MandateRow | null | undefined, nowMs: number): boolean {
  if (!row) return false;
  if (!row.revoked_at) return true;
  const ms = Date.parse(row.revoked_at);
  if (!Number.isFinite(ms)) return false;
  return ms > nowMs;
}

/** What the server looked up, handed over as plain facts so this stays testable. */
export interface MandateFacts {
  /** profiles.role of the caller. Anything other than "accountant" ends it here. */
  callerRole: string | null | undefined;
  /** Does an accountant_clients row exist for this pair? */
  linked: boolean;
  /** The mandate row for this pair, or null. */
  mandate: MandateRow | null | undefined;
}

/** The kind a row grants. Absent reads as 'facturen' — the column arrived later. */
export function mandateKindOf(row: MandateRow): MandateKind {
  return row.kind === "bevestigen" ? "bevestigen" : "facturen";
}

/**
 * Who is this accountant, acting for this client — or nobody?
 *
 * Returns an ActingFor with the CLIENT as ownerId, so everything downstream (the invoice number,
 * sender_id, the PDF path, the fair-use counter) hangs off the client exactly as it does for a
 * sales member. The accountant lands in actorId and therefore in created_by: a trail, never
 * ownership. That is the whole point — one number series per company, art. 35.
 *
 * Returns null on ANY doubt. Every caller must treat null as 403 and stop; there is no partial
 * outcome here, and "acting for nobody" must never quietly become "acting for yourself" — an
 * accountant falling back to their own administration would mint a number in their OWN series for
 * a client's customer, which is the one mistake art. 35 cannot forgive.
 */
export function resolveAccountantActing(
  accountantId: string,
  clientId: string,
  facts: MandateFacts,
  nowMs: number,
): ActingFor | null {
  if (!accountantId || !clientId) return null;
  // An accountant invoicing "for themselves" through this door would get a boekhouder's read
  // filter over their own administration — they would lose sight of their own older invoices.
  // Their own invoices go through the ordinary owner path.
  if (accountantId === clientId) return null;
  if (facts.callerRole !== "accountant") return null;
  if (!facts.linked) return null;
  if (!isMandateActive(facts.mandate, nowMs)) return null;
  // The row must be about THIS pair. If a wrong row ever arrived here — a bug in the query, a
  // swapped parameter — that is exactly the case where continuing writes an invoice under the
  // wrong VAT number.
  if (facts.mandate!.accountant_id !== accountantId) return null;
  if (facts.mandate!.zzper_id !== clientId) return null;
  // [BEVESTIGEN] And it must be the RIGHT permission. A client who only allowed confirming has not
  // allowed invoicing, and a row that says so must never be read as the other one — that is the
  // silent widening this whole design exists to prevent. The database says the same thing in
  // has_active_invoice_mandate(), which filters on kind = 'facturen'.
  if (mandateKindOf(facts.mandate!) !== "facturen") return null;

  return { ownerId: clientId, actorId: accountantId, role: "boekhouder" };
}

/**
 * [BEVESTIGEN] May this accountant confirm this client's incoming invoices?
 *
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A PARAMETER
 *
 * It answers a different question and returns a different thing. resolveAccountantActing() hands
 * back an ActingFor, because issuing an invoice happens IN THE CLIENT'S NAME — the books, the
 * number series and the counter all move to the client. Confirming does not: the invoice is
 * already the client's, nothing is created, and the accountant stays themselves throughout. What
 * gets recorded is `confirmed_by`, which is a signature, not a change of owner.
 *
 * AND THE LAW IS DIFFERENT TOO
 *
 * Art. 35 lid 1 Wet OB explicitly permits a third party to ISSUE an invoice. Nothing comparable
 * exists for confirming an administration, and art. 52 AWR leaves that duty squarely with the
 * entrepreneur. So this permission cannot transfer responsibility — it can only make the act
 * visible. That is why the answer here is a boolean and not an identity.
 *
 * Same failure direction as everywhere else in this file: any doubt is false.
 */
export function canConfirmForClient(
  accountantId: string,
  clientId: string,
  facts: MandateFacts,
  nowMs: number,
): boolean {
  if (!accountantId || !clientId) return false;
  // Their own administration is not a mandate question; the ordinary owner path handles it.
  if (accountantId === clientId) return false;
  if (facts.callerRole !== "accountant") return false;
  if (!facts.linked) return false;
  if (!isMandateActive(facts.mandate, nowMs)) return false;
  if (facts.mandate!.accountant_id !== accountantId) return false;
  if (facts.mandate!.zzper_id !== clientId) return false;
  // The mirror of the check in resolveAccountantActing: an invoice mandate is NOT a confirm
  // mandate. A client who let their accountant invoice has not thereby let them sign off the
  // books, and the two are granted by two separate switches for exactly that reason.
  return mandateKindOf(facts.mandate!) === "bevestigen";
}
