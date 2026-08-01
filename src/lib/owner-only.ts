// src/lib/owner-only.ts
// [ACTING-FOR] The latch on everything a sales member may NOT (yet) do.
//
// WHY THIS EXISTS, AND WHY IT IS NOT LAZINESS
//
// A sales member must be able to finish the job. That whole lifecycle was rebuilt to act ON
// BEHALF OF the owner — one number series, the owner's sender_id, created_by as a trail:
// create (draft), edit and discard ([id]), send (send), remind (reminder), duplicate
// (duplicate) and correct (creditnota).
//
// The rest of the invoice APIs are NOT rebuilt, and do not need to be. They all assume the
// logged-in human owns the administration, and they cover things outside invoicing:
// /numbering (changes the series for the whole company), /pay-toggle (touches money truth and
// bank reconciliation), /schedules (a standing obligation), /archive (taking an invoice out of
// the books), /betaalverzoek, /supersede, /multi-invoice, /payment/move. If a member got in
// there, they would book under THEIR OWN id — exactly the bug this whole build is about, only
// through a back door.
//
// Two ways to handle that:
//   1. rebuild all seven routes — more surface, more chance of a mistake in a path nobody needs
//      today;
//   2. close them for a member, with a sentence that says why.
//
// This is 2, deliberately. It is a CONSCIOUS boundary, not a forgotten case: a member who taps
// "change numbering" should read that their employer does that, rather than silently shifting
// the whole company's series. If such a function is opened up for them later, that happens one
// route at a time — with the same treatment as send: ownerId in, created_by as trail, and one
// extra line in the REBUILT list of acting-for-gates.test.ts.
//
// NOTE ON LANGUAGE: code and comments are English (see AGENTS.md). The message below is not
// code — it is read by a Dutch entrepreneur in the app, so it stays Dutch.

import { NextResponse } from "next/server";
import { getActingFor } from "@/lib/acting-for-server";
import { isActingForOther, type ActingFor } from "@/lib/acting-for";

/**
 * Returns the acting-for when the session belongs to an OWNER, otherwise a ready-made response.
 *
 * Usage:
 *   const w = await requireOwner('…')
 *   if (w.response) return w.response
 *   const acting = w.acting!
 *
 * `subject` is the Dutch phrase shown to the member ("De factuurnummering wijzigen"), because
 * it ends up in a user-facing sentence.
 */
export async function requireOwner(
  subject = "Dit",
): Promise<{ acting?: ActingFor; response?: NextResponse }> {
  const acting = await getActingFor();
  if (!acting) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (isActingForOther(acting)) {
    return {
      response: NextResponse.json(
        {
          error: `${subject} kan alleen de eigenaar van de administratie doen. Jij maakt en verstuurt facturen; vraag je werkgever om dit te doen.`,
        },
        { status: 403 },
      ),
    };
  }
  return { acting };
}
