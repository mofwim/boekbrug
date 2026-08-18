// src/lib/double-pay-check.ts
// [PAY-SAFE-NUMBER] Which already-paid invoice, if any, should stop the owner before they pay
// this one — decided in one pure function so the route stays I/O and the rule stays testable.
//
// The no-double-pay check exists for ONE case, and /api/incoming/check-paid says so in its own
// header: "the vendor re-sent the same invoice and I paid the first one". A re-sent invoice
// carries the SAME number. But the query behind it never looked at a number — vendor + amount +
// paid within 120 days was the whole test — so it fired just as loudly on the ordinary opposite:
// a supplier who bills the same amount on a rhythm. A boekhouder on a monthly fee, a
// huurcontract, an abonnement: every period the owner was told they might already have paid this,
// about a document that plainly carries a different number. A warning that cries wolf every month
// is worse than no warning — it teaches the owner to tap past the one that matters.
//
// So the invoice number decides — but going silent is the dangerous direction, so it only gets to
// silence the warning where it actually proves the two are different documents. Two fences:
//
//  1. The number must be REAL on both sides. A placeholder ("UPLOAD-17", "EMAIL-9") means we never
//     read a number off the document, and two of those are not "two different numbers" but two
//     failed reads. There the old vendor+amount signal is the only thing between the owner and a
//     second payment, so it stands untouched.
//  2. The invoice DATES must differ. Same supplier, same amount, same invoice date, two different
//     numbers is the shape of ONE document read twice — an OCR digit misread on one copy — and
//     that is exactly a double payment waiting to happen. A running account does not bill the same
//     amount twice on the same day; a misread does. So the number only clears a pair that also
//     sits on different days. A missing date on either side cannot clear anything, and doesn't.

import { isPlaceholderInvoiceNumber, normalizeInvoiceNumber } from "./safecore";
// [DUBBEL-BEWIJS] The words come from the catalogue; this module still decides WHICH words.
import { translator } from "./i18n/t";
import { localeDir } from "./i18n/locale";

/** The fields of an already-paid candidate this decision needs. */
export interface PaidTwinCandidate {
  id: string;
  invoice_number: string | null;
  invoice_date?: string | null;
  client_name?: string | null;
  total_inc_btw?: number | null;
  payment_date?: string | null;
  marked_paid_at?: string | null;
}

/** The invoice the owner is about to pay — only the two fields that decide this. */
export interface PayTarget {
  invoice_number: string | null | undefined;
  invoice_date?: string | null;
}

/** Does this string name a real invoice number, or is it a stand-in for one we never read? */
function hasRealNumber(n: string | null | undefined): boolean {
  return normalizeInvoiceNumber(n) !== "" && !isPlaceholderInvoiceNumber(n);
}

/** The calendar day, or null when nothing usable was stored. */
function day(raw: string | null | undefined): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/**
 * Pick the paid invoice worth warning about, out of the candidates already narrowed to
 * "same vendor, same amount, paid recently". Returns null when none of them can be the same
 * document — i.e. when every candidate states its own real number AND sits on its own date.
 *
 * Order of preference is deliberate: a same-number twin is THE signal and must be the one shown,
 * whatever order the database returned; only when there is none does a weaker candidate stand in.
 */
export function pickPaidTwin<T extends PaidTwinCandidate>(
  target: PayTarget,
  candidates: readonly T[],
): T | null {
  const targetNum = normalizeInvoiceNumber(target.invoice_number);
  const targetNumIsReal = hasRealNumber(target.invoice_number);
  const targetDay = day(target.invoice_date);

  const sameNumber = (c: PaidTwinCandidate) => {
    const n = normalizeInvoiceNumber(c.invoice_number);
    return n !== "" && n === targetNum;
  };

  const surviving = candidates.filter((c) => {
    if (sameNumber(c)) return true; // the re-send this check is FOR
    // Fence 1 — at least one side has no readable number: the number cannot separate them.
    if (!targetNumIsReal || !hasRealNumber(c.invoice_number)) return true;
    // Fence 2 — the dates must PROVE the pair apart before the number is allowed to clear it.
    // A missing date on either side proves nothing: absence of evidence is not evidence, and
    // reading it as "different documents" would silence the warning on exactly the invoices we
    // understand least. Only two readable dates that differ let a pair through.
    const cDay = day(c.invoice_date);
    if (!targetDay || !cDay) return true;
    if (targetDay === cDay) return true; // one document, read twice (an OCR digit misread)
    // Two documents that state their own number AND their own date → a running account.
    return false;
  });

  return surviving.find(sameNumber) ?? surviving[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// [DUBBEL-BEWIJS] The check's third answer, and the search behind the other two.
//
// pickPaidTwin above decides WHICH already-paid invoice is worth stopping the owner for. It is
// correct and it is fenced carefully — but it can only ever be as good as the set it is handed,
// and until now nothing on the screen said anything about that set.
//
// /api/incoming/check-paid answered `{ duplicate: false }` in FOUR situations that are not the
// same situation at all:
//
//   1. the invoice being paid could not be read      → a database error
//   2. the already-paid invoices could not be read   → a database error
//   3. the invoice carries no usable amount          → nothing to compare on
//   4. the invoice names neither a vendor nor an iban → nothing to anchor on
//
// and in the one situation the answer was built for: we searched, and found no twin. All five
// produced the same pixels — the ordinary pay dialog, opening as if the coast were clear. So did
// a network failure, which the screen caught and swallowed with a comment saying it must never
// BLOCK paying. Not blocking is right; not telling is the defect.
//
// Cases 3 and 4 are the sharpest of the five, because they are not random. An invoice with no
// readable amount and no readable vendor is a document the reader could not make sense of — which
// is exactly the document most likely to have been uploaded twice. The check switched itself off
// on the invoices it understood least, and said nothing.
//
// So the result carries three things instead of one boolean: WHAT the check concluded, WHAT it
// searched, and — when it could not conclude — WHY. The owner is never blocked (SAFECORE ⑤: warn,
// don't block). They are told.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the sentences come from the
// catalogue because they are what the entrepreneur reads.

/** What the check managed to conclude. */
export type DoublePayOutcome =
  /** An already-paid invoice that may be this same document. */
  | "twin"
  /** The search ran to completion and found nothing that could be this document. */
  | "clear"
  /** The search did not run, or did not finish. Never render this as "clear". */
  | "unchecked";

/** Why an `unchecked` result could not answer. Each maps to one sentence the owner reads. */
export type DoublePayUnchecked =
  /** The invoice the owner is about to pay could not be read. */
  | "invoice_unreadable"
  /** The set of already-paid invoices could not be read. */
  | "candidates_unreadable"
  /** No usable amount on the document, so there is nothing to compare on. */
  | "no_amount"
  /** Neither an iban nor a vendor name, so there is nothing to anchor the vendor on. */
  | "no_vendor"
  /** The screen never reached the route. */
  | "network";

/**
 * The SEARCH, as the owner can check it: how wide it was, and what identified the vendor.
 *
 * `anchor` is not decoration. An iban is an account number and matches exactly; a name is a
 * spelling, matched with an escaped ilike, so "Kiwi Food Market" and "Kiwi Food Market B.V." are
 * two different suppliers as far as this query is concerned. On a name anchor the check can miss a
 * genuine re-send, and the owner is the only one who can catch that — which they can only do if
 * they are told which of the two anchors was used.
 */
export interface DoublePaySearch {
  /** Already-paid invoices held against this one: same vendor, same amount, inside the window. */
  candidates: number;
  anchor: "iban" | "name";
  /** The recency window in days, as the route applied it. */
  days: number;
  /**
   * True when the candidate query hit its own ceiling, so the oldest of the set were dropped.
   * Reported rather than absorbed: a bounded search presented as a complete one is the shape of
   * false reassurance this whole line of work exists to remove.
   */
  capped: boolean;
  /** The ceiling that was applied, so the sentence can name it. */
  limit: number;
}

/** What /api/incoming/check-paid answers. */
export interface DoublePayResult {
  outcome: DoublePayOutcome;
  /** The already-paid invoice worth stopping for. Non-null only on `twin`. */
  match: DoublePayMatch | null;
  /** What was searched. Null only when the search never ran (`unchecked`). */
  search: DoublePaySearch | null;
  /** Why nothing could be concluded. Non-null only on `unchecked`. */
  reason: DoublePayUnchecked | null;
}

/** The already-paid invoice the warning names, as the screen shows it. */
export interface DoublePayMatch {
  id?: string;
  invoice_number: string | null;
  client_name: string | null;
  total_inc_btw: number | null;
  payment_date: string | null;
}

/**
 * The lines under the check's conclusion. `tone` says which of the three answers this is; the
 * component maps it to a colour and holds no words of its own.
 */
export interface DoublePayNotice {
  tone: "alarm" | "clear" | "unknown";
  /** One sentence: the search that ran, or the reason none did. */
  lead: string;
  /** What qualifies it — the anchor's caveat, the ceiling, or what the owner should do instead. */
  detail: string[];
  /** Travels with the words so a component cannot render text and direction out of step. */
  dir: "ltr" | "rtl";
}

/** The sentence for the reason, one per case — never a shared "something went wrong". */
const UNCHECKED_KEY = {
  invoice_unreadable: "dubbel.onbekend.factuur",
  candidates_unreadable: "dubbel.onbekend.eerder",
  no_amount: "dubbel.onbekend.bedrag",
  no_vendor: "dubbel.onbekend.leverancier",
  network: "dubbel.onbekend.netwerk",
} as const;

/**
 * What the pay dialog says about the double-payment check.
 *
 * Returns null only when there is no result yet — before the check has run there is nothing to
 * report, and inventing "we are checking…" would be a claim of its own.
 *
 * An `unchecked` result reports the reason and what to do instead; it never reports a search,
 * because on four of its five paths there was none. A `clear` or `twin` result reports the search
 * even though the conclusion is the interesting part: the conclusion is only worth as much as the
 * set it came from, and the owner is the one who knows whether that set was the right one.
 */
export function buildDoublePayNotice(
  result: DoublePayResult | null | undefined,
  locale: unknown,
): DoublePayNotice | null {
  if (!result) return null;
  const t = translator(locale);
  const dir = localeDir(locale);

  if (result.outcome === "unchecked") {
    // An unchecked result with no reason is a bug upstream, not a reason to go quiet: the owner
    // still needs to know the check did not answer. `network` is the honest default — it is the
    // only path that can reach the screen without the route naming a reason.
    const key = UNCHECKED_KEY[result.reason ?? "network"];
    return { tone: "unknown", lead: t(key), detail: [t("dubbel.onbekend.watNu")], dir };
  }

  const search = result.search;
  // A concluded check with no search description cannot state one. It still has a conclusion, and
  // the dialog around it carries that; this line simply has nothing to add.
  if (!search) return null;

  const lead =
    search.candidates === 0 ? t("dubbel.zoek.geen", { dagen: search.days })
    : search.candidates === 1 ? t("dubbel.zoek.een", { dagen: search.days })
    : t("dubbel.zoek.meer", { count: search.candidates, dagen: search.days });

  const detail = [t(search.anchor === "iban" ? "dubbel.anker.iban" : "dubbel.anker.naam")];
  if (search.capped) detail.push(t("dubbel.zoek.grens", { count: search.limit }));

  return { tone: result.outcome === "twin" ? "alarm" : "clear", lead, detail, dir };
}
