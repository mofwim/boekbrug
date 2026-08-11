// src/lib/fair-use-hold.ts
// [GRENS-ZICHTBAAR] The owner's invoices arrived and were not read. Say so. Pure, no I/O.
// Run: npx tsx --test src/lib/fair-use-hold.test.ts
//
// WHAT WAS IN THE LOG
//
//   [EERLIJK-GEBRUIK] maandgrens bereikt — rest van de batch wordt bewaard, niet gelezen
//     { userId: …, wanted: 10, granted: 0, plan: 'free' }
//   [EERLIJK-GEBRUIK] maandgrens bereikt — rest van de batch wordt bewaard, niet gelezen
//     { userId: …, wanted: 10, granted: 0, plan: 'free' }
//   [CRON-EMAIL-SYNC] drain made no progress — likely a stuck attachment; deferring
//     { uid: …, remaining: 10, prevSaved: 0 }
//
// Three separate problems, in one five-second window.
//
// 1. THE OWNER WAS NOT TOLD, AND THAT IS THE ONE THAT MATTERS.
//    Ten supplier invoices reached their mailbox, the app fetched them, and it read none of them.
//    Nothing appeared on any screen. The manual upload path DOES say this — UploadClient shows a
//    fair-use message when a file is refused — but that is the path where the owner is standing
//    there watching. On the e-mail path, which runs while they are not looking, there was no
//    message, no notification and no row: their invoices simply were not there. An owner in that
//    position concludes their supplier never sent them, or that the app is broken.
//
// 2. THE DIAGNOSIS IN THE LOG IS WRONG. "likely a stuck attachment" describes a poison pill: one
//    file that fails every round and holds up the queue. There is no such file here. The batch was
//    never attempted, because the month's allowance was spent. Whoever reads that log goes looking
//    for a broken PDF that does not exist, while the actual cause — a plan limit — is one line
//    above it and unconnected.
//
// 3. THE RETRY CANNOT WORK. A MONTHLY allowance does not refill between two calls six seconds
//    apart. The drain loop re-fetched the mailbox and asked again anyway, and would have kept
//    doing so up to its round cap, every hour, until the month turned over.
//
// This module is the shared vocabulary for the three fixes: what a hold IS, what the owner is
// told about it, and — the part that decides whether the telling is worth anything — how often.

/** Which plan the owner is on. Mirrors fair-use.ts, kept narrow on purpose. */
export type FairUsePlan = "free" | "plus";

export interface FairUseHold {
  /** How many documents arrived and were NOT read because the month's allowance was spent. */
  held: number;
  plan: FairUsePlan;
}

/**
 * Was this batch held back by the monthly allowance?
 *
 * Null when nothing was held — including the ordinary partial case where SOME were granted, which
 * is still a hold for the remainder. `granted >= wanted` is the only clean answer.
 */
export function fairUseHold(
  wanted: number,
  granted: number,
  plan: FairUsePlan = "free",
): FairUseHold | null {
  const w = Math.max(0, Math.trunc(safeInt(wanted)));
  const g = Math.max(0, Math.trunc(safeInt(granted)));
  // Granted more than wanted is not a hold — and it is not a negative one either. Clamping here
  // keeps every caller from having to think about it.
  const held = w - Math.min(g, w);
  return held > 0 ? { held, plan } : null;
}

/**
 * The month a hold belongs to, as "2026-08".
 *
 * The allowance is monthly, so the notification is monthly: one per owner per month. The cron runs
 * every hour and would otherwise post the same sentence twenty-four times a day for the rest of
 * the month, and a notification that arrives every hour is one the owner turns off — after which
 * they are back to not being told, which is where this started.
 *
 * Derived from the date STRING, not from a Date object, so it cannot drift with the server's zone.
 */
export function fairUseHoldMonth(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(isoDate ?? ""));
  return m ? `${m[1]}-${m[2]}` : "";
}

/**
 * What the owner reads. Dutch — it lands in their notification list (AGENTS.md).
 *
 * Three things, and all three are needed. WHAT happened (invoices arrived and were not read), that
 * NOTHING IS LOST (they are kept and will be read), and WHAT THEY CAN DO. Leaving the second out
 * turns a limit into an accusation that their bookkeeping has holes in it; leaving the third out
 * makes it an announcement they can do nothing with.
 *
 * It never says "upgrade" as an instruction. It states the limit and links to the page that
 * explains it, because the honest position is that waiting for the new month is also a valid
 * answer, and a bookkeeping app that turns a service message into a sales pitch has stopped being
 * one you can trust about your own numbers.
 */
export function fairUseHoldNotice(
  hold: FairUseHold,
  month: string,
): { title: string; body: string; link: string } {
  const n = hold.held;
  const stuks = n === 1 ? "1 factuur" : `${n} facturen`;
  const zij = n === 1 ? "Hij staat" : "Ze staan";
  return {
    // THE TITLE CARRIES NO COUNT, and that is not a style choice — it is what makes the
    // once-a-month promise hold. The title is the deduplication key: the caller posts this only
    // when no notification with it exists yet. A count in it changes between two cron runs (ten
    // held this hour, three the next), so every change would read as a new title and the owner
    // would get the same message again and again — which is the notification they switch off.
    //
    // The month IS in it, so next month's hold is a different key and does get told.
    title: `Niet alles is ingelezen (${month})`,
    body:
      `Er ${n === 1 ? "kwam" : "kwamen"} ${stuks} binnen via je e-mail, maar de maandgrens van je ` +
      `${hold.plan === "free" ? "gratis" : "Plus"}-pakket voor automatisch inlezen is bereikt. ` +
      `${zij} klaar en ${n === 1 ? "wordt" : "worden"} vanzelf ingelezen zodra de nieuwe maand ` +
      "begint — er gaat niets verloren. Wil je ze eerder in je boeken hebben, kijk dan bij Prijzen " +
      "wat je pakket per maand kan lezen.",
    link: "/prijzen",
  };
}

/**
 * Why the drain stopped, in the words that fit the actual cause.
 *
 * The cron's own message said "likely a stuck attachment" for a batch that no attachment was ever
 * tried on. This is the sentence that replaces it, and it exists as a function so the cron and its
 * gate cannot drift apart about which cause is which.
 */
export function drainStopReason(heldByFairUse: number): string {
  return heldByFairUse > 0
    ? "monthly allowance spent — the rest of the mailbox waits for the new month, not for a retry"
    : "no progress — likely a stuck attachment; deferring";
}

function safeInt(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
