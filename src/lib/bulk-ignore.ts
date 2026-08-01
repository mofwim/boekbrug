// src/lib/bulk-ignore.ts
// [BULK-IGNORE] What the queue REPORTS after a batch of invoices is ignored in one tap. Pure, no
// I/O — the loop itself lives in IncomingInvoicesClient.
//
// ── WHY THIS IS ITS OWN FILE ──
// Ignoring one invoice has one outcome at a time: it worked, or the server said why not, and that
// sentence is shown literally (confirmFailureMessage). With a batch that is impossible: twenty
// invoices can produce three different answers, and those do not fit in one snackbar.
//
// The temptation is then to simplify to "18 ignored, 2 failed". That is exactly the dishonesty
// this app fights everywhere, because "failed" hides the one distinction the owner needs: DO I
// HAVE TO DO SOMETHING, OR DO I HAVE TO WAIT.
//
// ── THE SPLIT, AND WHY 409 IS THE LINE ──
// /api/email/confirm/[id] DELETE has exactly two kinds of no:
//
//   · 409 — the STATE of this invoice forbids it. Three cases, all three permanent:
//       money_settled  "already paid — reverse the payment first"
//       bank_linked    "a bank transaction is attached — unlink it first"
//       (unnamed)      the row was no longer 'processing'/'received' by then
//     Retrying CANNOT work here; something else has to happen first.
//
//   · everything else — 503 (the money check could not be performed → the route refuses
//     fail-closed and says so itself), 500, 401, or a network error. Nothing is wrong with the
//     invoice here; retrying is precisely the answer.
//
// So we classify on STATUS rather than on the error code: there are three codes and there may be
// more, but "is this permanent?" is already answered by the status code. A new 409 reason lands on
// the right side by itself.
//
// ── WHAT THE MESSAGE DELIBERATELY DOES NOT DO ──
// It names no per-invoice REASON. That is no loss: a refused invoice simply stays in the queue,
// and one tap on that card gives the server's full sentence through the existing single path. The
// batch counts; the card explains. That way the snackbar never has to choose which of twenty
// reasons to show.

/** Permanently refused (something else has to happen first) or temporarily unavailable. */
export type IgnoreFailureKind = "refused" | "unavailable";

/**
 * One HTTP status → permanent or temporary.
 *
 * A network error (a fetch that throws) has no status; pass 0 there — it lands on "unavailable",
 * which is right: nothing was changed and it may well work in a moment.
 */
export function classifyIgnoreFailure(status: number): IgnoreFailureKind {
  return status === 409 ? "refused" : "unavailable";
}

export type BulkIgnoreTally = {
  /** How many invoices the server actually archived. */
  ok: number;
  /** Permanently refused — 409. */
  refused: number;
  /** Temporarily failed — everything else. */
  unavailable: number;
};

/** "1 factuur" / "3 facturen" — the singular is right at 0 too ("0 facturen"). */
function facturen(n: number): string {
  return n === 1 ? "1 factuur" : `${n} facturen`;
}

/**
 * The sentence under a finished batch.
 *
 * Three rules covering every outcome:
 *   1. All done → just the count. No noise.
 *   2. Something went wrong → name the two kinds SEPARATELY, and say those invoices are still in
 *      the queue. That last half is the important one: the screen does not remove them, so the
 *      owner needs to know that what they still see is not a display error.
 *   3. "Try again" appears ONLY when there is something for which that can work.
 *
 * Dutch strings: UI text shown to the owner, per the language rule in AGENTS.md.
 */
export function bulkIgnoreSummary(t: BulkIgnoreTally): string {
  const { ok, refused, unavailable } = t;
  const failed = refused + unavailable;

  if (failed === 0) {
    // The (theoretical) ok === 0 & failed === 0 case lands here too: nothing happened, and there
    // is nothing to report beyond what it says.
    return `✓ ${facturen(ok)} genegeerd`;
  }

  const parts: string[] = [];
  parts.push(ok > 0 ? `${ok} genegeerd` : "Niets genegeerd");
  if (refused > 0) parts.push(`${refused} geweigerd`);
  if (unavailable > 0) parts.push(`${unavailable} niet gelukt`);

  // The tail picks the action that actually helps.
  const tail =
    refused > 0 && unavailable > 0
      ? "ze staan nog in de wachtrij — open ze los"
      : refused > 0
        ? `open ${refused === 1 ? "hem" : "ze"} los om te zien waarom`
        : "probeer het zo meteen opnieuw";

  return `${parts.join(" · ")} — ${tail}`;
}

/**
 * May the message offer an "undo"?
 *
 * Only if something was actually removed. An undo button next to "Niets genegeerd" would offer an
 * action with nothing to undo.
 */
export function bulkIgnoreOffersUndo(t: BulkIgnoreTally): boolean {
  return t.ok > 0;
}

/**
 * The same shape for the way back (undo → PATCH per invoice).
 *
 * No split is needed here: PATCH only refuses with 409 "no longer in Genegeerd", and for the owner
 * that reads the same as any other error — take a look, something is off.
 *
 * Dutch strings: UI text shown to the owner, per the language rule in AGENTS.md.
 */
export function bulkRestoreSummary(ok: number, failed: number): string {
  if (failed === 0) return `${facturen(ok)} teruggezet`;
  if (ok === 0) return "Terugzetten mislukt — ververs de pagina";
  return `${ok} teruggezet · ${failed} niet — ververs de pagina`;
}
