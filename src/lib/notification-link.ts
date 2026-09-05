// src/lib/notification-link.ts
// [MELDING-TIK] The one place that decides whether a stored notification link may be opened.
//
// ── WHY THIS IS ONE FUNCTION AND NOT THREE CHECKS ──
// A notification's `link` is the only field in the row that the app ACTS on: the bell calls
// router.push() with it and the service worker opens it. It was checked in exactly one of the
// three places it travels through:
//
//   · buildPushPayload  — checked, with `link.startsWith("/")`;
//   · the bell          — not checked at all, `router.push(n.link)` on whatever the row held;
//   · POST /api/notifications/create and /notify-client — not checked, and both accept `link`
//     straight from the request body, so the value is not app-authored to begin with.
//
// And the one check that existed is incomplete: `"//evil.example/x".startsWith("/")` is true.
// A protocol-relative URL is a complete URL — the browser resolves it against the current scheme
// and navigates off-site. So the guard that was written to stop an off-app redirect passes the
// one string an attacker would actually use.
//
// Nothing has ever exploited this (measured on production at the time of writing: 0 of 1031 rows
// hold a non-relative link, 0 hold a protocol-relative one). That is the reason to close it now
// and not the reason to leave it: the door costs nothing while it is unused.

/** Control characters are never meaningful in a URL and are how a value slips past a prefix test. */
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/**
 * The stored link, if it is safe to navigate to — otherwise null.
 *
 * Safe means: a path INSIDE this app. Not a URL with a scheme, not a protocol-relative host, not
 * a backslash the browser normalises into one, and nothing carrying a control character.
 *
 * Returns null rather than a fallback path on purpose. The caller decides what "no link" means:
 * the push payload sends the device to /dashboard because a notification that opens nothing is a
 * dead tap on a phone, while the bell leaves the row in place and simply marks it read. A shared
 * fallback here would have forced the bell to navigate somewhere it has no reason to go.
 */
export function safeNotificationLink(raw: string | null | undefined): string | null {
  const link = (raw ?? "").trim();
  if (!link) return null;

  // Must be an absolute path within the app.
  if (!link.startsWith("/")) return null;

  // "//host" and "/\host" are protocol-relative URLs, not paths. The second form exists because
  // browsers normalise a backslash to a forward slash in the authority position, so "/\evil.example"
  // reaches the same place "//evil.example" does while passing a naive "does it start with //" test.
  if (link.startsWith("//") || link.startsWith("/\\")) return null;

  if (CONTROL_CHARACTER.test(link)) return null;

  return link;
}
