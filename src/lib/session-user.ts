// src/lib/session-user.ts
// [WATERVAL] Who is logged in — asked ONCE per request instead of once per file that wonders.
//
// `supabase.auth.getUser()` is not a cookie read. It hands the token to the auth server and waits
// for the answer, which is exactly why this codebase uses it instead of getSession() — the Next
// documentation is explicit that a token you have not had verified is good enough to hide a menu
// and never good enough to draw a boundary. That verification is the point and it stays.
//
// What was NOT the point: paying for it three times to render one screen. A /dashboard/* page runs
// its layout and its page in the SAME React pass, and both ask; getActingFor() asks a third time
// from underneath. Three trips, one after another, before the first byte leaves — and all three
// send the same cookie and get back the same user.
//
// React's cache() collapses them into one. Its scope is a single render pass / request, not a
// window of time: the moment the request is over the memo is gone, so a member whose access was
// revoked is locked out on their very next click — not a minute later. That distinction is the
// whole reason this is cache() and not a TTL cache, and it is the same mechanism the Next
// authentication guide recommends for a Data Access Layer (02-guides/authentication.md), and the
// same one getActingFor() has been built on since it was written.
//
// It stays a DAL function, not a convenience: every server route and every server component that
// touches money keeps calling it ITSELF. Memoising the answer removes the round-trip, never the
// question — nothing here lets a caller skip asking and trust what some earlier link in the chain
// concluded.
//
// No "server-only" marker here: the package is not a dependency of this repo and adding one for a
// single import is not worth it. The guard is the import below — createServerSupabaseClient reads
// next/headers cookies(), which a client bundle cannot do, so a component that tried to pull this
// in would fail at build, loudly, at the moment the mistake was made.

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * The verified user of this request, or `null` when nobody is logged in.
 *
 * Returns null on a failed lookup as well, and that is the safe side: a caller that cannot
 * establish who is asking must treat it as nobody, never as "probably the last one".
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
});
