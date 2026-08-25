// src/lib/ochtend-digest.ts
// [OCHTEND] The owner's morning line: what the administration did while they slept — and the
// decision, made here and nowhere else, to usually say NOTHING.
//
// ── WHY THIS EXISTS ──
// The app now works overnight: bank-sync pulls the statement, auto-confirm books the certain
// matches, e-mail-sync stages incoming invoices, Mollie rings when a customer pays. All of that
// lands in bell notifications — which are read only by someone already in the app. The one channel
// that reaches an owner who did NOT open the app is e-mail, and until this module the app never
// used it to say the only thing a freelancer never tires of hearing: money came in.
//
// ── WHAT KEEPS IT FROM BECOMING SPAM (the design constraint, not an afterthought) ──
//   · At most ONE mail per day, in the morning, about YESTERDAY — never a stream of pings.
//   · A quiet day produces NO mail at all. Not "no news today" — nothing. An empty digest
//     teaches the reader to delete unread, which then costs the one mail that mattered.
//   · Only two facts qualify, both of them events, not standing state: payments that were
//     RECORDED against outgoing invoices, and incoming invoices that ARRIVED. No nagging about
//     open work, no running totals, no streaks. Standing state belongs on the dashboard.
//   · One click target. The mail is a doorway, not a report.
//
// Pure module: the cron fetches and this file decides + composes, so the quiet-by-default rule
// is testable without a database. UI text is Dutch — this mail addresses the owner the way every
// other owner-facing mail in this app does.

import { escapeHtml } from "./escape-html";
import { formatDateNL, formatEuroNL } from "./format-nl";

/** One payment recorded yesterday against an OUTGOING invoice. */
export interface OchtendPayment {
  invoiceNumber: string | null;
  clientName: string | null;
  amount: number;
}

export interface OchtendInput {
  /** Yesterday, as the Amsterdam calendar day the mail is about ('YYYY-MM-DD'). */
  gisteren: string;
  payments: OchtendPayment[];
  /** Incoming invoices that arrived/were staged yesterday (e-mail sync, upload, intake). */
  newIncomingCount: number;
  /** Absolute base URL for the one click target, e.g. https://boekbrug.nl */
  baseUrl: string;
}

export interface OchtendMail {
  subject: string;
  html: string;
}

/** Sum of yesterday's recorded payments, in cents-safe form for display. */
function paymentsTotal(payments: OchtendPayment[]): number {
  return Math.round(payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0) * 100) / 100;
}

/**
 * Decide whether yesterday earned a mail, and compose it if so. `null` means: stay quiet.
 *
 * The subject leads with the money when there is money — that is the line that gets a mail
 * opened at 07:30 — and with the arrivals when there is only staging work to report.
 */
export function planOchtendMail(input: OchtendInput): OchtendMail | null {
  const betalingen = input.payments.filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  const inkomend = Number.isInteger(input.newIncomingCount) && input.newIncomingCount > 0
    ? input.newIncomingCount
    : 0;

  // The quiet-by-default rule. A day with nothing to say says nothing.
  if (betalingen.length === 0 && inkomend === 0) return null;

  const totaal = paymentsTotal(betalingen);
  const subject = betalingen.length > 0
    ? `${formatEuroNL(totaal)} binnengekomen ${formatDateNL(input.gisteren)}`
    : inkomend === 1
      ? "1 nieuwe inkomende factuur klaargezet"
      : `${inkomend} nieuwe inkomende facturen klaargezet`;

  const betaalRegels = betalingen
    .map((p) => {
      const wie = p.clientName?.trim() ? escapeHtml(p.clientName.trim()) : "Onbekende betaler";
      const nr = p.invoiceNumber?.trim() ? ` · factuur ${escapeHtml(p.invoiceNumber.trim())}` : "";
      return `<li style="margin: 2px 0;">${wie}${nr} — <strong>${formatEuroNL(p.amount)}</strong></li>`;
    })
    .join("\n");

  const betaalBlok = betalingen.length > 0
    ? `
        <p style="color: #202124; font-size: 16px; margin: 0 0 4px;">
          <strong>${formatEuroNL(totaal)}</strong> binnengekomen op ${betalingen.length === 1 ? "1 factuur" : `${betalingen.length} facturen`}:
        </p>
        <ul style="color: #555; padding-inline-start: 18px; margin: 4px 0 0;">
          ${betaalRegels}
        </ul>`
    : "";

  const inkomendBlok = inkomend > 0
    ? `<p style="color: #555; margin: ${betalingen.length > 0 ? "14px" : "0"} 0 0;">
         ${inkomend === 1 ? "1 nieuwe inkomende factuur staat" : `${inkomend} nieuwe inkomende facturen staan`} voor je klaar.
       </p>`
    : "";

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #202124; font-size: 18px; margin: 0 0 12px;">Je administratie, ${formatDateNL(input.gisteren)}</h2>
      ${betaalBlok}
      ${inkomendBlok}
      <p style="margin: 18px 0 0;">
        <a href="${escapeHtml(input.baseUrl)}/dashboard"
           style="display: inline-block; background: #1A73E8; color: #FFFFFF; text-decoration: none; border-radius: 8px; padding: 10px 20px; font-size: 14px;">
          Open BoekBrug
        </a>
      </p>
      <p style="color: #a0a0a5; font-size: 12px; margin-top: 24px;">
        Je krijgt dit bericht alleen op dagen dat er iets gebeurde. Uitzetten kan onder Instellingen.
      </p>
    </div>`;

  return { subject, html };
}
