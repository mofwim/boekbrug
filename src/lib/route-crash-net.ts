// src/lib/route-crash-net.ts
// [DEUR-VANGNET] What an owner is told when a document door throws instead of answering.
//
// ── THE OUTAGE THIS GENERALISES ──
//
// /api/intake crashed on a TypeError one line before it wrote anything (see
// thenable-not-promise.test.ts for the mistake itself). The crash was not the whole damage — the
// SILENCE was. The route had no try/catch around its body, so the throw never became an answer:
// it escaped to the platform, which replies with an HTML error page. The client cannot parse a
// reason out of HTML, so it fell through to describeUploadFailure's last resort and the owner read
// "de server gaf een onverwacht antwoord (HTTP 500)". Neither side ever learned what happened —
// not the owner, and not us, because nothing was logged either.
//
// Five doors take a document from an owner: /api/intake (camera and file), /api/email/upload,
// attaching a file to a bank line, "opnieuw inlezen", and the mail sync. They share the failure
// exactly, and a net that lives at one door is a net the other four do not have — the same lesson
// ai.ts already wrote down about the own-invoice guard.
//
// ── WHAT THIS DOES AND DOES NOT DO ──
//
// It does NOT make a crash harmless. Nothing was written, and the owner still has to hand the
// document over again. What it does is make the crash SAYABLE:
//
//   · the reason and its stack land in our log under a searchable tag, so the next one takes
//     minutes to find instead of a reproduction;
//   · the owner gets a sentence in their own language that says what happened to their document —
//     and every caller must pass that sentence, because "er ging iets mis" over a file that may or
//     may not have been stored is the answer that makes someone stop trusting the app.
//
// A redirect() or notFound() is CONTROL FLOW, not a failure: Next throws those on purpose. They
// are handed straight back through unstable_rethrow, so a net can never swallow one.

import { NextResponse } from "next/server"
import { unstable_rethrow } from "next/navigation"

/**
 * Run one route handler with a net under it.
 *
 * @param tag      Searchable log prefix, e.g. "INTAKE" → "[INTAKE-CRASH]".
 * @param sentence What the OWNER reads. It must say what happened to their document — whether it
 *                 was stored, and whether anything changed — because that is the question they
 *                 actually have, and a status code does not answer it.
 */
export async function withCrashNet(
  tag: string,
  sentence: string,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run()
  } catch (e) {
    // Next's own control-flow signals pass through untouched — catching one would break the
    // redirect it was asking for and turn a working page into this error.
    unstable_rethrow(e)
    console.error(`[${tag}-CRASH] the route threw before it could answer`, {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    })
    return NextResponse.json({ error: sentence }, { status: 500 })
  }
}
