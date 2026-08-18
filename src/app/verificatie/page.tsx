// src/app/verificatie/page.tsx
// [2FA] The screen at MFA_CHALLENGE_PATH. A server component that renders the client and does
// nothing else — and the "nothing else" is the whole design.
//
// ── WHY THIS PAGE READS NO SESSION ──
//
// Every other authenticated page in this app opens with `getSessionUser()` and a
// `redirect('/login')`. This one must not, because this is the page the middleware sends people
// TO. A session read here would run a second, independent judgement about the same session the
// middleware just judged, milliseconds later and against a different client — and the two only
// have to disagree once for the browser to bounce between /verificatie and its redirect target
// forever. A redirect loop here is not a bug report; it is an entrepreneur who can reach no page
// at all, including the sign-out that would let them start over.
//
// So the rule is: this page never sends anyone anywhere. The only navigation that leaves it is a
// verified code (onwards to where they were going) or the sign-out button (to /login), both of
// which the client does after something the owner actually did.
//
// A visitor with no session at all lands on a form whose verify attempt fails and says so, and
// whose sign-out button still takes them to /login. That is a worse screen than a redirect would
// be, for a case the middleware does not produce — and it is the direction worth failing in.

import { Suspense } from "react";
import type { Metadata } from "next";

import VerificatieClient from "./VerificatieClient";

// The client below reads ?redirect= from the querystring; nothing on this page can be prerendered
// into a static file.
export const dynamic = "force-dynamic";

// [AUTH-NOINDEX] Same reasoning as login/layout.tsx: a step inside an authentication flow has no
// search value — nobody can use it without an account — and indexing it only dilutes the set of
// pages this domain is judged on. Crawlable on purpose, so the noindex can be read at all.
export const metadata: Metadata = {
  title: "Verificatie in twee stappen — BoekBrug",
  robots: { index: false, follow: false },
};

export default function VerificatiePage() {
  // fallback={null} rather than a word: useSearchParams suspends for a single tick on the client,
  // and a loading line that flashes for one frame reads as a stutter. Nothing here waits on a
  // network, so there is nothing to reassure anyone about yet.
  return (
    <Suspense fallback={null}>
      <VerificatieClient />
    </Suspense>
  );
}
