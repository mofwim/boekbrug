// src/lib/invoice-sent-notice.ts
// [VERSTUURD] What the owner is told the moment an invoice actually goes out. Pure, no I/O.
// Run: npx tsx --test src/lib/invoice-sent-notice.test.ts
//
// Until now the most consequential button in the app said nothing. "✉ Opslaan en versturen"
// minted a permanent invoice number, rendered the PDF, mailed it to a customer — and the screen
// silently replaced itself with the invoice detail page. No confirmation, no number, nothing
// naming what had just become irreversible. The owner's own question, in their words: "I have
// just sent my first invoice, how do I know it arrived correctly?" They could not know, because
// nothing had told them.
//
// This module builds that answer, and the failure paths are why it can be trusted: a send that
// does not fully succeed never reaches here. A rejected send returns 400 and the page shows the
// error; a PDF or e-mail failure returns a `warning` and the page routes to the recovery banner.
// Reaching this notice means the route minted the number AND the mail provider accepted the
// message. So it may say "verstuurd" — and it must not say more than that, which is why nothing
// here claims the customer has READ it, or that a bounce would be caught.
//
// The copy lives apart from the modal for the same reason fair-use-notice.ts does: what the app
// promises about a legal document is worth testing on its own, without rendering anything.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md); the strings are Dutch
// because they are what the entrepreneur reads.

import { formatEuroNL } from "./format-nl";
// [TAAL] The words come from the catalogue; this module still decides WHICH words. Dutch is the
// source and the fallback, so an owner who has not chosen a language sees exactly what they saw
// before — the tests below assert that literally.
import { translator } from "./i18n/t";
import { localeDir, type Locale } from "./i18n/locale";

/** Exactly what /api/invoice/send returns on the success path, plus what the screen knows. */
export interface InvoiceSentFacts {
  /** The definitive number the route minted. Absent ⇒ no notice: there is nothing to confirm. */
  invoiceNumber?: string | null;
  invoiceType?: string | null;
  /** True when this came from an offerte — the wording then names that, not "nieuwe factuur". */
  converted?: boolean;
  clientName?: string | null;
  clientEmail?: string | null;
  totalInc?: number | null;
  /**
   * The address a customer's reply lands on, as the route reports it. Absent ⇒ the notice says
   * nothing about replies. The route only sets a Reply-To when the owner's profile carries an
   * e-mail; without one a reply goes to the noreply sender, so promising otherwise would send
   * the owner looking in an inbox that will never receive anything.
   */
  replyTo?: string | null;
}

export interface InvoiceSentNotice {
  title: string;
  /** One line: what happened, to whom. */
  lead: string;
  /** The irreversible part, stated plainly — this is the reason the modal must be dismissed. */
  definitief: string;
  /** Label/value rows: the facts the owner would otherwise have to go looking for. */
  rows: Array<[label: string, value: string]>;
  /** How to check it themselves, which is the question this whole notice exists to answer. */
  controle: string[];
  /** Heading above that list. */
  controleKop: string;
  /** The two exits. Labels live here, not in the component — see the note below. */
  acties: { bekijk: string; nieuw: string };
  /**
   * Text direction for the panel. Carried on the notice rather than looked up in the component so
   * that ONE object fully describes what is on the screen: an owner reading Arabic gets the words
   * and the direction from the same call, and a component cannot render the two out of step.
   */
  dir: "ltr" | "rtl";
}

/** "factuur" / "creditnota" as a sentence-leading word. Anything unknown reads as "factuur". */
function documentWord(invoiceType: string | null | undefined): "factuur" | "creditnota" {
  return invoiceType === "creditnota" ? "creditnota" : "factuur";
}

/**
 * The confirmation, or null when there is nothing confirmed.
 *
 * Null on a missing number is deliberate and not defensive noise: the number IS the event. A
 * modal that says "verstuurd" without one would be claiming something the response did not.
 */
export function invoiceSentNotice(
  facts: InvoiceSentFacts,
  locale?: Locale | string | null,
): InvoiceSentNotice | null {
  const number = (facts.invoiceNumber ?? "").trim();
  if (!number) return null;

  const t = translator(locale);
  const woord = documentWord(facts.invoiceType);
  const naam = (facts.clientName ?? "").trim();
  const email = (facts.clientEmail ?? "").trim();
  const replyTo = (facts.replyTo ?? "").trim();

  const rows: Array<[string, string]> = [];
  rows.push([t(`sent.${woord}.numberLabel`), number]);
  if (naam) rows.push([t("sent.row.to"), naam]);
  // No placeholder dash for a missing e-mail: this row is a claim about where the document went,
  // and "—" next to "Verstuurd naar" reads as if it went nowhere. Better absent than ambiguous.
  if (email) rows.push([t("sent.row.sentTo"), email]);
  if (typeof facts.totalInc === "number" && Number.isFinite(facts.totalInc)) {
    rows.push([t("sent.row.amount"), formatEuroNL(facts.totalInc)]);
  }

  return {
    title: t(`sent.${woord}.title`),
    lead: naam
      ? t(`sent.${woord}.lead`, { number, name: naam })
      : t(`sent.${woord}.leadNoName`, { number }),
    // Art. 35 Wet OB: a numbered invoice belongs to an unbroken series and may not be altered
    // afterwards. This is the one thing the owner cannot undo, so it is the one thing that is
    // stated before anything else — including before the reassurance.
    //
    // Converting is something an OFFERTE does, and what it becomes is a factuur — so there is no
    // creditnota variant of this sentence and the key is not built from `woord`.
    definitief: facts.converted
      ? t("sent.factuur.fixedConverted", { number })
      : t(`sent.${woord}.fixed`, { number }),
    rows,
    controle: [
      // Each of these is something the owner can verify with their own eyes, today. Nothing here
      // is a promise about the future or about the customer's mailbox.
      // The tab and the status are filled from the SAME keys the navigation bar and the status
      // chip render, so this sentence always names the words that are actually on the screen —
      // in whatever language the owner has chosen.
      t(`sent.${woord}.checkList`, { tab: t("nav.invoices"), status: t("status.sent") }),
      t("sent.check.pdf"),
      // Only when the route actually set a Reply-To, and then WITH the address — an owner who
      // knows which mailbox to watch can check it; one who is told "it comes to you" cannot.
      ...(replyTo ? [t("sent.check.reply", { email: replyTo })] : []),
      // The honest limit, and the reason the lines above can be relied on.
      t("sent.check.failed"),
    ],
    controleKop: t("sent.check.heading"),
    // [TAAL] The button labels live here and not in InvoiceSentModal so that the component holds
    // no language at all. A component with one Dutch string left in it is the shape that keeps a
    // translation permanently half-finished — and it is invisible, because the screen still looks
    // right in Dutch.
    acties: { bekijk: t("sent.action.view"), nieuw: t("sent.action.new") },
    dir: localeDir(locale),
  };
}
