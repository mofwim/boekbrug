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

/**
 * The roles that can act inside one administration.
 *
 * Still not a role system — three named cases, each with its own source of proof:
 *   · eigenaar    — it is their own administration. No proof needed.
 *   · verkoop     — an active row in company_members. Ambient: one per session.
 *   · boekhouder  — an accountant_clients link PLUS an active invoice mandate from the client
 *                   (accountant-mandate.ts). NOT ambient: an accountant acts for the ONE client
 *                   named in the request, never for "their" client in general.
 *
 * That last difference is the reason resolveActingFor() below does not handle 'boekhouder'. It
 * takes an ambient link and answers "who are you?"; for an accountant the question is always "who
 * are you FOR THIS CLIENT?", which needs the client id and therefore a different door.
 *
 * What the two non-owner roles have in common is everything that matters here: the books belong to
 * ownerId, the human goes in actorId, and they may only touch what they created themselves.
 */
export type CompanyRole = "eigenaar" | "verkoop" | "boekhouder";

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
  // [BEVEILIGING] Their OWN account's security, and this is not a widening of what they may see.
  //
  // A medewerker issues invoices in the owner's doorlopende nummerreeks, so his password is worth
  // exactly as much to an attacker as the owner's — and until this line he could not switch
  // two-step on for it, because the panel lives behind a screen he may not open. A lock the person
  // most worth attacking cannot reach is not a lock.
  //
  // What he sees there is his own account: /api/beveiliging reads the bookkeeper links and the team
  // of the SESSION user, and a medewerker owns neither, so the list is himself. Nothing about the
  // owner's administration appears on it.
  "/dashboard/beveiliging",
];

/**
 * The screens a mandated accountant may reach WHILE ACTING FOR A CLIENT.
 *
 * Short on purpose. An accountant already has their own portal, reached as themselves; this list
 * is only about the screens where they stand in their client's shoes. Everything else they do —
 * reading the quarter, marking documents verwerkt — happens under their OWN id and does not pass
 * through here at all.
 */
export const ACCOUNTANT_SCREENS: readonly string[] = [
  // Where they pick a client and write the invoice.
  "/dashboard/accountant/factuur",
  // The invoice they just made. Same reasoning as the sales member: without it every row in their
  // own list dead-ends.
  "/dashboard/invoice",
];

/**
 * May this actor reach this path?
 *
 * An owner: everywhere (their own administration). Anyone else: only their own closed list, and
 * only as an exact match or as a subpath — so /dashboard/verkoop/x is included but
 * /dashboard/verkoopcijfers is NOT (a prefix comparison without a boundary is how guards like this
 * silently grow too wide).
 *
 * An unknown role reaches NOTHING. Same failure direction as resolveActingFor: a role nobody named
 * here cannot inherit another role's screens by accident.
 */
export function canAccessScreen(a: ActingFor, path: string): boolean {
  if (a.role === "eigenaar") return true;
  const allowed =
    a.role === "verkoop" ? SALES_SCREENS : a.role === "boekhouder" ? ACCOUNTANT_SCREENS : [];
  return allowed.some((s) => path === s || path.startsWith(s + "/"));
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
 *
 * [MANDAAT] A mandated accountant lands in the same branch, and that is right: this filter feeds
 * the screen where they WRITE invoices, and there they should see the invoices they wrote. Their
 * broader view of the client's books is a different screen with a different query (the accountant
 * portal, accountant.repository.ts) — it does not come through here.
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
 *
 * [MANDAAT] The same answer for an accountant, and for the same reason — with the mandate itself
 * as the revocable link. Note what canAccessInvoice above already refuses them: an invoice the
 * CLIENT made. A mandate is permission to write invoices in someone's name, never permission to
 * finish or re-price the ones they wrote themselves. The database says the same thing in
 * prevent_accountant_amount_changes(); this is the half that answers with a 403 instead of a 500.
 */
export function canSendInvoice(
  a: ActingFor,
  invoice: { sender_id: string | null; created_by?: string | null },
): boolean {
  return canAccessInvoice(a, invoice);
}

/**
 * [DEBITEUREN] May this actor send a payment REMINDER for this invoice?
 *
 * WHY THIS IS NOT canAccessInvoice, AND WHY THE ACCOUNTANT IS WIDER HERE
 *
 * Issuing and reminding are two different acts, and conflating them gets one of them wrong:
 *
 *   · ISSUING creates a document under someone else's name and VAT number and consumes a number
 *     from their series, irreversibly (art. 35). An accountant may only finish what they started
 *     themselves — hence created_by in canAccessInvoice.
 *   · REMINDING changes nothing at all. No number, no status, no amount — the reminder route says
 *     so in its own header, and all it writes is a row in invoice_reminders. It is asking for money
 *     that is already owed on an invoice that already exists.
 *
 * Debiteurenbeheer is meaningless scoped to the invoices the accountant happened to type. The
 * client's overdue invoices are overwhelmingly ones the CLIENT made; a screen that hides those is
 * not a chase-list, it is a list of the accountant's own typing. So a mandated accountant reaches
 * every invoice of that client — and only that client.
 *
 * The sales member stays narrow, deliberately: they are inside one company with colleagues, and
 * chasing the boss's other customers is not their job.
 *
 * AND THE ONE THING THAT OVERRULES ALL OF IT
 * `reminders_paused` is how the owner says "not this one" — a disputed invoice, a customer they
 * are handling by phone, a relationship they are repairing. The cron already obeys it. A third
 * party pressing a button must obey it too, because the owner set that flag knowing exactly what
 * it was for and cannot be in the room when someone else decides otherwise. The OWNER themselves
 * is not blocked: pausing the automatic mails and then sending one by hand is a coherent thing to
 * want, and it is their relationship.
 */
export function canRemindInvoice(
  a: ActingFor,
  invoice: { sender_id: string | null; created_by?: string | null; reminders_paused?: boolean | null },
): { allowed: true } | { allowed: false; reason: string } {
  if (invoice.sender_id !== a.ownerId) {
    return { allowed: false, reason: "Deze factuur hoort niet bij deze administratie." };
  }
  if (a.role === "eigenaar") return { allowed: true };

  if (invoice.reminders_paused) {
    return {
      allowed: false,
      reason: "De ondernemer heeft herinneringen voor deze factuur stilgezet. Overleg met hem.",
    };
  }
  if (a.role === "boekhouder") return { allowed: true };
  if (a.role === "verkoop") {
    return invoice.created_by === a.actorId
      ? { allowed: true }
      : { allowed: false, reason: "Je kunt alleen herinneren aan facturen die je zelf hebt gemaakt." };
  }
  // An unknown role gets nothing — same failure direction as everywhere else in this file.
  return { allowed: false, reason: "Je hebt geen toestemming om hieraan te herinneren." };
}
