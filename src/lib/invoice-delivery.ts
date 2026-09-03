// src/lib/invoice-delivery.ts
// [VERSTUURD-EERLIJK] Did the invoice actually go out? One place answers, for every screen.
// Run: npx tsx --test src/lib/invoice-delivery.test.ts
//
// ── WHY THIS IS NOT A SCREEN'S DECISION ──
//
// /api/invoice/send does something irreversible before it does something fallible. It mints a
// number out of the legal sequence — which cannot be un-minted, because Dutch invoice numbering
// must be gap-free — and only then renders the PDF and hands it to the mail provider. When that
// last step fails there is nothing to roll back, so the route returns HTTP 200 with a `warning`
// and the screen is expected to say so.
//
// `res.ok` is therefore TRUE on a failed delivery. Every screen that checked only `res.ok` told
// the owner their invoice was sent while nothing had left the building — and an owner who believes
// an invoice was sent does not chase it. The invoice is legally issued, the customer never saw it,
// and the money never arrives.
//
// Four of the app's seven send call sites got this wrong, and the two that were fixed were fixed
// one at a time: the comment on FacturenClient still says "/dashboard/invoice/new already handled
// both warnings together; this page did not." A third screen was going to be found the same way.
// invoice-sent-notice.ts even states the invariant in its header — "a send that does not fully
// succeed never reaches here" — which was simply not true of half its callers.
//
// So the question moves out of the screens. A screen decides how to SAY it; this decides IF.

// [WAARSCHUWING-GEHOORD] The classification lives in ONE registry, next to the other fact each
// warning carries (who has to hear it). Two lists of the same six names would drift, which is the
// failure this whole area keeps producing.
import { API_WARNINGS, type DeliveryFailure } from "./api-warnings";

export type { DeliveryFailure };

/** What /api/invoice/send returns on a 2xx. Everything optional: old shapes reach here too. */
export interface SendResponse {
  warning?: unknown;
  /**
   * An older, narrower signal than `warning`, still returned on some paths. It is read too because
   * dropping it would silently un-fix the screens that only ever checked it — and because a
   * response carrying `delivered: false` is stating the failure outright.
   */
  delivered?: unknown;
}

/**
 * The failure to tell the owner about, or null when the invoice really did go out.
 *
 * Null is the ONLY value that permits a "verstuurd" message. Anything else means the number was
 * issued and the customer has nothing.
 */
export function deliveryFailure(response: SendResponse | null | undefined): DeliveryFailure | null {
  if (!response) return null; // no body to judge; the caller's res.ok check already spoke
  if (typeof response.warning === "string" && response.warning !== "") {
    const known = API_WARNINGS[response.warning];
    if (known !== undefined) return known.delivery;
    // An unknown warning is still the route flagging something, and the two errors here are not
    // equal: saying "verstuurd" over a failed send loses the money, while an unnecessary recovery
    // banner costs the owner a moment and at worst one duplicate e-mail. So an unrecognised
    // warning is treated as undelivered. The gate above means this branch should never be reached
    // in this repo — it is the behaviour for a route that got ahead of the map.
    return "email_failed";
  }
  // `delivered: false` without a named warning: the route says it did not arrive but not why.
  // Reported as the e-mail leg, which is the one the owner acts on — they resend either way.
  if (response.delivered === false) return "email_failed";
  return null;
}
