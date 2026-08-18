// src/lib/security-overview.ts
// [BEVEILIGING] Who can reach this administration right now — the rule, with nothing that talks to
// a network. Run: npx tsx --test src/lib/security-overview.test.ts
//
// ── WHY THIS IS A SCREEN AT ALL ──
//
// A zzp'er handing his books to an app he has never heard of is asked to take one thing on faith:
// that nobody else can read them. Every competitor answers that with a paragraph on a marketing
// page. This answers it with his own data — the actual list of people who can open this
// administration today, where each one came from, since when, and a button to end it.
//
// ── THE ONE RULE THAT CARRIES THE WHOLE SCREEN ──
//
// A NUMBER OF PEOPLE IS ONLY EVER SAID WHEN EVERY SOURCE ANSWERED.
//
// The list comes from three places — the session, the bookkeeper link, the team table — and any of
// them can fail on its own. Fold a failure into an empty list and the screen says "2 mensen hebben
// toegang" when the true answer is three, or "alleen jij" when a bookkeeper is reading along. On a
// security screen that is not a degraded answer, it is the opposite of the true one, delivered in
// the exact tone of voice the owner came here to trust. So a partial read produces `null` — "we
// could not establish this" — and the screen says so instead of counting what it happens to hold.
//
// It is the same refusal as [NO-SILENT-EMPTY] elsewhere in this app, and it bites harder here:
// everywhere else a missing row is a missing row, and here it is a person.

/** Where someone's access comes from. The three doors into an administration, and there are three. */
export type AccessKind =
  /** The account itself. Always present, never revocable — this is the person reading the screen. */
  | "owner"
  /** A boekhouder with a link to this administration (accountant_clients). */
  | "bookkeeper"
  /** An invited medewerker (company_members), who issues invoices in the owner's number series. */
  | "member";

/** One person who can open this administration. */
export type AccessHolder = {
  kind: AccessKind;
  /**
   * The id needed to end this access, or null when there is nothing to end. The owner has none by
   * definition; a link whose row id we could not read has none either, and a revoke button without
   * an id is a button that cannot work — so the screen renders none.
   */
  revokeId: string | null;
  /**
   * The person's name, or null when we know someone is there and not who.
   *
   * Deliberately null rather than a fallback word. "Onbekend" is a sentence, and a sentence belongs
   * in the catalogue in the owner's language — see AGENTS.md. More importantly the two cases are
   * genuinely different: a name we could not read is not the same as a person called Onbekend, and
   * only the screen knows how to say that.
   */
  name: string | null;
  email: string | null;
  /** ISO day or timestamp the access started, or null when the row did not carry one. */
  since: string | null;
};

/** A read that either answered or did not. Never "answered with nothing" when it in fact failed. */
export type ReadState<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable" };

/** One row of accountant_clients, as much of it as this screen needs. */
export type BookkeeperLinkRow = {
  id?: string | null;
  accountant_id?: string | null;
  created_at?: string | null;
};

/** One row of company_members, joined to the profile, as /api/company/members already returns it. */
export type MemberRow = {
  id?: string | null;
  member_id?: string | null;
  naam?: string | null;
  email?: string | null;
  sinds?: string | null;
  ingetrokken?: string | null;
};

/** A profile, for putting a name to an id. */
export type ProfileRow = {
  id?: string | null;
  full_name?: string | null;
  company_name?: string | null;
  email?: string | null;
};

/** What the screen renders. */
export type SecurityOverview = {
  /**
   * Everyone with access, owner first. Empty is impossible when `complete` is true — the owner is
   * always on it — so an empty list is itself a sign that something did not answer.
   */
  holders: AccessHolder[];
  /**
   * Did every source answer?
   *
   * false means the list above is a FLOOR and not a total: there may be people on it we could not
   * see. The screen must say that in words rather than print a count. See the header.
   */
  complete: boolean;
  /**
   * How many people can open this administration, or null when we could not establish it.
   *
   * Null exactly when `complete` is false. Kept as its own field because a screen that computes
   * `holders.length` itself would silently drop the distinction — and that computation is the
   * mistake this whole module exists to prevent.
   */
  count: number | null;
};

/** The display name for a profile row: the business first, then the person. */
export function profileName(profile: ProfileRow | null | undefined): string | null {
  if (!profile) return null;
  const name = (profile.company_name || profile.full_name || "").trim();
  return name.length > 0 ? name : null;
}

/**
 * Build the picture of who can reach this administration.
 *
 * Every argument is a ReadState rather than a value, and that is the point: the caller cannot hand
 * this function a failed read dressed as an empty one without saying so, because there is no shape
 * for it. See the rule in the header.
 */
export function buildSecurityOverview(args: {
  /** The signed-in owner. Their own e-mail is a session fact, so it does not have a failure mode. */
  ownerEmail: string | null;
  ownerName: string | null;
  /** The bookkeeper links on this administration, with the accountants' profiles to name them. */
  bookkeepers: ReadState<Array<{ link: BookkeeperLinkRow; profile: ProfileRow | null }>>;
  /** The team members, as /api/company/members returns them (revoked rows included; filtered here). */
  members: ReadState<MemberRow[]>;
}): SecurityOverview {
  const { ownerEmail, ownerName, bookkeepers, members } = args;

  // The owner is always first and always there. Not read from anywhere: this is the person holding
  // the screen, and a list of who can see your books that does not start with you is a list that
  // has already lost the plot.
  const holders: AccessHolder[] = [
    { kind: "owner", revokeId: null, name: ownerName, email: ownerEmail, since: null },
  ];

  if (bookkeepers.state === "ok") {
    for (const { link, profile } of bookkeepers.value) {
      holders.push({
        kind: "bookkeeper",
        // The LINK's id, not the accountant's: ending this access removes one row from
        // accountant_clients, and handing a revoke button a person's id would be a button aimed at
        // the wrong record.
        revokeId: link.id ?? null,
        name: profileName(profile),
        email: profile?.email ?? null,
        since: link.created_at ?? null,
      });
    }
  }

  if (members.state === "ok") {
    for (const row of members.value) {
      // A revoked member no longer has access, and listing him under "wie kan hierbij" would be the
      // screen's single worst sentence: an ex-employee shown as still holding a key.
      if (row.ingetrokken) continue;
      holders.push({
        kind: "member",
        revokeId: row.id ?? null,
        name: (row.naam ?? "").trim() || null,
        email: row.email ?? null,
        since: row.sinds ?? null,
      });
    }
  }

  const complete = bookkeepers.state === "ok" && members.state === "ok";
  return { holders, complete, count: complete ? holders.length : null };
}

/**
 * Is this administration reachable by anyone besides its owner?
 *
 * Three answers, and the third is why this is a function. `null` is "we do not know" — returned
 * whenever a source failed AND the people we did read are only the owner, because the ones we could
 * not read are exactly the ones that would change the answer. Once someone else is already on the
 * list, a failed read cannot make that untrue, so the answer is a solid `true`.
 */
export function sharedWithOthers(overview: SecurityOverview): boolean | null {
  const others = overview.holders.filter((h) => h.kind !== "owner").length;
  if (others > 0) return true;
  return overview.complete ? false : null;
}
