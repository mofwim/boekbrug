// src/lib/notification-link.test.ts — run: npx tsx src/lib/notification-link.test.ts
// [MELDING-TIK] What may and may not come out of the `link` column and into router.push().
import { safeNotificationLink } from "./notification-link";

let failed = 0;
function check(name: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL ${name}`);
    failed++;
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── What the app itself writes must keep working ──────────────────────────────
// These are real values, taken from the createNotification call sites.
check("a plain in-app path is kept", safeNotificationLink("/dashboard/bank") === "/dashboard/bank");
check(
  "a path with a query is kept",
  safeNotificationLink("/dashboard/aangifte?year=2026&quarter=2") === "/dashboard/aangifte?year=2026&quarter=2",
);
check(
  "a path with a fragment is kept",
  safeNotificationLink("/dashboard/settings#boekhouder") === "/dashboard/settings#boekhouder",
);
check("surrounding whitespace is trimmed, not rejected", safeNotificationLink("  /dashboard/vandaag  ") === "/dashboard/vandaag");

// ── Absent is absent, in every shape a database column produces ───────────────
check("null is no link", safeNotificationLink(null) === null);
check("undefined is no link", safeNotificationLink(undefined) === null);
check("empty is no link", safeNotificationLink("") === null);
check("whitespace only is no link", safeNotificationLink("   ") === null);

// ── Off-app navigation ────────────────────────────────────────────────────────
check("an absolute https URL is refused", safeNotificationLink("https://evil.example/steal") === null);
check("an http URL is refused", safeNotificationLink("http://evil.example/steal") === null);
check("a javascript: URL is refused", safeNotificationLink("javascript:alert(1)") === null);
check("a bare relative path without a leading slash is refused", safeNotificationLink("dashboard/bank") === null);

// The hole this file was written for. The push guard was `link.startsWith("/")`, and both of
// these satisfy it while navigating the browser to another host.
check("a protocol-relative URL is refused (the old guard passed this)", safeNotificationLink("//evil.example/steal") === null);
check("a backslash protocol-relative URL is refused", safeNotificationLink("/\\evil.example/steal") === null);

// ── Control characters ────────────────────────────────────────────────────────
check("a newline inside the link is refused", safeNotificationLink("/dashboard\n/bank") === null);
check("a NUL byte inside the link is refused", safeNotificationLink("/dashboard\u0000/bank") === null);
check("a tab inside the link is refused", safeNotificationLink("/dash\tboard") === null);

// ── [NEGATIEVE CONTROLE] The refusals above must be SPECIFIC ──────────────────
// Every "refused" assertion in this file also passes if the function simply returns null for
// everything. These three are the ones that catch that: each is one character away from a case
// above and must come back INTACT.
check(
  "one slash instead of two is a path, and is kept",
  safeNotificationLink("/evil.example/steal") === "/evil.example/steal",
);
check(
  "a backslash that is not in the authority position is kept",
  safeNotificationLink("/dashboard/a\\b") === "/dashboard/a\\b",
);
check(
  "the word 'https' inside a path is not a scheme",
  safeNotificationLink("/dashboard/https-uitleg") === "/dashboard/https-uitleg",
);

console.log(failed === 0 ? "\nnotification-link: all green" : `\nnotification-link: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
