// src/lib/acting-for.ts
// [ACTING-FOR] Who is acting, on whose behalf, and what may they do? Pure, no I/O.
// Run: npx tsx --test src/lib/acting-for.test.ts
//
// WHY THIS EXISTS
//
// Until now BoekBrug was one human per administration: every row hangs off `user_id`, and the
// question "may you touch this?" had one answer — is this row yours? Exactly one second role is
// added now: a sales member who creates and sends invoices FOR their employer's company.
//
// THE TRAP THIS FILE GUARDS
//
// The obvious move is to just give such a member an account. Then they write invoices with
// sender_id = THEIR id, and therefore THEIR number series. Two humans, two series, one company.
// invoice-numbering.ts says in its header why that is not allowed:
//
//   "per Dutch Belastingdienst (Article 35 — Wet OB 1968): numbers must be sequential
//    without gaps, and forward-only (no rollback once issued)."
//
// Two parallel series under one VAT number are not sloppiness during an audit but gaps in the
// numbering. And it cannot be undone: an issued number stays issued.
//
// THE RULE THAT SOLVES EVERYTHING
//
//   The member OWNS nothing. The member ACTS ON BEHALF OF the owner.
//
// Everything that touches the books — the invoice number, sender_id, the PDF path, the fair-use
// counter — hangs off `ownerId`. Whoever sat behind the keyboard goes into `actorId` and ends up
// in created_by: a trail, never ownership. One series per company, by construction.
//
// AND THE SECOND REASON IT IS BUILT THIS WAY
//
// RLS is the ONLY real boundary in this product (131 policies, 184 uses of auth.uid()). A role
// system that rebuilds those 131 policies into "may this actor do this" is not a feature but a
// new foundation — and a mistake there is not a screen that looks odd, but a member reading
// their employer's profit. By NEVER letting the member read the owner's rows directly, every
// existing policy stays exactly as it was.

/** The roles within one company. Deliberately two — see the header: this is not a role system. */
export type CompanyRole = "eigenaar" | "verkoop";

/** One row from company_members, as the database returns it. */
export interface MemberLink {
  owner_id: string;
  member_id: string;
  role: string;
  /** Set ⇒ the link is revoked and grants nothing from that moment on. */
  revoked_at: string | null;
}

export interface ActingFor {
  /**
   * Whose administration this is. EVERYTHING that touches the books is written under this:
   * the invoice number, sender_id, the PDF path, the fair-use counter.
   */
  ownerId: string;
  /**
   * Who sat behind the keyboard. Goes to created_by — a trail, not ownership.
   * For an owner this equals ownerId.
   */
  actorId: string;
  role: CompanyRole;
}

/** Is this person acting on someone else's behalf? */
export function isActingForOther(a: ActingFor): boolean {
  return a.ownerId !== a.actorId;
}

/**
 * Who is acting here, on whose behalf?
 *
 * ALWAYS FAILS TO "YOURSELF ONLY". Any doubt — no link, revoked, a role we do not know, a row
 * that is not about this user — yields an owner-of-self. That is the safe side: someone then
 * sees their own (empty) administration instead of someone else's. The opposite failure
 * direction is a stranger inside another person's numbers.
 *
 * `nowMs` is passed in — no clock inside a pure function, and it makes the test exact.
 */
export function resolveActingFor(
  sessionUserId: string,
  link: MemberLink | null | undefined,
  nowMs: number,
): ActingFor {
  const selfOnly: ActingFor = { ownerId: sessionUserId, actorId: sessionUserId, role: "eigenaar" };
  if (!sessionUserId) throw new Error("[ACTING-FOR] resolveActingFor without a user");
  if (!link) return selfOnly;

  // The row MUST be about this session. If a wrong row ever arrived here (a bug in the query, a
  // swapped parameter), that is precisely the case where continuing puts someone inside another
  // person's administration. So: ignore it.
  if (link.member_id !== sessionUserId) return selfOnly;

  // A self-link is nonsense and would let someone look at their own administration through a
  // member's READ FILTER — they would lose sight of their own older invoices.
  if (link.owner_id === link.member_id) return selfOnly;
  if (!link.owner_id) return selfOnly;

  // Revoked is immediate. No grace, no "until end of day".
  if (link.revoked_at) {
    const ms = Date.parse(link.revoked_at);
    // Unreadable date ⇒ treat as revoked. Better a member locked out too early than a revoked
    // member who stays inside.
    if (!Number.isFinite(ms) || ms <= nowMs) return selfOnly;
  }

  // A role we do not know grants NOTHING. That way a future role can never accidentally inherit
  // the rights of 'verkoop' because someone forgot to name it here.
  if (link.role !== "verkoop") return selfOnly;

  return { ownerId: link.owner_id, actorId: sessionUserId, role: "verkoop" };
}

// ── What may this actor do? ───────────────────────────────────────────────────────────────────

/**
 * The screens a sales member MAY see. A closed list, and that is the whole point.
 *
 * Anything not listed here is shut — including a screen added tomorrow. That is the right
 * failure direction: a new screen accidentally open to a member is a leak nobody notices, a new
 * screen accidentally shut is a complaint within a day. Opening up is a deliberate act, exactly
 * one line below.
 *
 * The paths themselves are Dutch because they are URLs in a Dutch app — user-facing text, not
 * identifiers.
 */
export const SALES_SCREENS: readonly string[] = [
  // Their own screen: the invoices they created.
  "/dashboard/verkoop",
  // Creating, viewing and editing a single invoice. This deliberately covers
  // /dashboard/invoice/<id> too: without that branch their own list dead-ends — every row links
  // to the detail screen. Safe because those screens read with the member's SESSION, and RLS
  // only gives them their own rows (invoices_member_read). So a guessed id yields nothing.
  "/dashboard/invoice",
  // Their clients. Same here: RLS (clients_member_read) limits it to what they entered.
  "/dashboard/klanten",
];

/**
 * May this actor reach this path?
 *
 * An owner: everywhere (their own administration). A member: only the list above, and only as an
 * exact match or as a subpath — so /dashboard/verkoop/x is included but /dashboard/verkoopcijfers
 * is NOT (a prefix comparison without a boundary is how guards like this silently grow too wide).
 */
export function canAccessScreen(a: ActingFor, path: string): boolean {
  if (a.role === "eigenaar") return true;
  return SALES_SCREENS.some((s) => path === s || path.startsWith(s + "/"));
}

/**
 * Under whose name is this invoice booked? ALWAYS the owner — see the header of this file.
 * This function exists so there is no choice left to make anywhere else in the codebase.
 */
export function invoiceOwnerId(a: ActingFor): string {
  return a.ownerId;
}

/** Who created it? The trail, never the ownership. */
export function invoiceCreatedBy(a: ActingFor): string {
  return a.actorId;
}

/**
 * The filter this actor may READ invoices with.
 *
 * The owner sees everything of their own. The member sees only what they created themselves —
 * not their employer's revenue, not a colleague's invoices. `created_by` is therefore not a
 * decorative field: it is the read boundary.
 */
export function invoiceReadFilter(a: ActingFor): { sender_id: string; created_by?: string } {
  return a.role === "eigenaar"
    ? { sender_id: a.ownerId }
    : { sender_id: a.ownerId, created_by: a.actorId };
}

/**
 * May this actor open/send THIS invoice?
 *
 * Deliberately a separate function next to the read filter: filtering a list and checking a
 * single row are two different moments, and the second is the moment a guessed id arrives.
 */
export function canAccessInvoice(
  a: ActingFor,
  invoice: { sender_id: string | null; created_by?: string | null },
): boolean {
  if (invoice.sender_id !== a.ownerId) return false;
  if (a.role === "eigenaar") return true;
  return invoice.created_by === a.actorId;
}

/**
 * May this actor send?
 *
 * Yes — that is the chosen design: the member finishes the invoice, including the number and the
 * mail. But the number comes from the OWNER's series (invoiceOwnerId), and that is what this
 * whole module guards. Sending is irreversible; the owner keeps control by revoking the link,
 * not through a per-invoice button.
 */
export function canSendInvoice(
  a: ActingFor,
  invoice: { sender_id: string | null; created_by?: string | null },
): boolean {
  return canAccessInvoice(a, invoice);
}
