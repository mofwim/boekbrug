// src/instrumentation-client.ts
// [SENTRY-EEN-CONFIG] The browser Sentry setup. THE one that runs — see the note below.
//
// ── WHAT WAS WRONG, AND WHY IT WAS INVISIBLE ──
//
// There were TWO client Sentry.init calls in this repo: this file, scaffolded by the Sentry
// wizard, and sentry.client.config.ts, which somebody had thought about carefully — a 5% replay
// rate, 10% tracing in production, and a beforeSend that deletes password, access_token,
// refresh_token, kvk_number, btw_number and iban before anything leaves the browser.
//
// @sentry/nextjs 10 loads instrumentation-client.ts and IGNORES sentry.client.config.ts. Checked
// against the built bundle rather than the docs: `replaysSessionSampleRate: 0.1` from this file
// ships, `0.05` from the other one does not, and neither does its `vercel.live` frame filter.
//
// So every deliberate privacy decision in this app was written down and never executed, while the
// scaffold defaults ran in production. Two files answering one question, and the wrong one live —
// the same shape that produced the leverdatum, the reverse charge and the exemption notice.
//
// An external review read the dead file and reported "Session Replay records unmasked text
// (maskAllText: false)". Reasonable from the source, and wrong about what shipped: that line never
// reached a bundle, and replayIntegration() with no arguments masks text BY DEFAULT. The real
// exposure was the opposite one — sendDefaultPii: true, and no beforeSend at all.
//
// sentry.client.config.ts is deleted rather than fixed. Keeping a second file that looks
// authoritative and runs nowhere is how this happened.

import * as Sentry from "@sentry/nextjs";

const isProduction = process.env.NODE_ENV === "production";

Sentry.init({
  // The env var wins, with the project's own DSN as the fallback. A DSN is public by design — it
  // ships in the browser bundle either way — so the fallback costs nothing, and it means a
  // deployment that forgot the variable still reports instead of going quietly dark.
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://63a90da6a47502f7baa7c8837d07e368@o4511444931248128.ingest.de.sentry.io/4511444937670736",

  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.2.0",

  // [SENTRY-EEN-CONFIG] The scaffold sent 100% of traces from production. Ten percent is the rate
  // this project chose; full sampling stays in development where it costs nothing.
  tracesSampleRate: isProduction ? 0.1 : 1.0,

  // [SENTRY-EEN-CONFIG] Off, and this is the line that mattered most. The scaffold turns it ON,
  // which attaches IP addresses and user identifiers to every event and every replay. This is a
  // Dutch bookkeeping app: the screens Sentry records show a person's turnover, their customers
  // and their bank balance. Nobody chose to send that; a wizard did.
  sendDefaultPii: false,

  // [SENTRY-GEEN-REPLAY] Session Replay is GONE — not tuned down, removed.
  //
  // It ran at 5% of sessions plus every session that hit an error, masked as carefully as the SDK
  // allows. Masking was never the problem. The problem is that a replay is a RECORDING of a
  // browsing session, it needs browser storage to stitch its segments together, and under
  // art. 11.7a Telecommunicatiewet that puts it outside "strikt noodzakelijk" — it needs the
  // visitor's consent BEFORE the first segment is written.
  //
  // There is no consent mechanism in this app. The cookiebeleid described a banner and a
  // settings button that were never built, so for as long as replay ran, the recording happened
  // and the page that was supposed to offer the choice described a choice nobody was ever given.
  //
  // Two ways to close that. Build the banner, or stop recording. This app is a Dutch bookkeeping
  // product whose own cookie page ends with "Minimale cookies, maximale privacy": the screens a
  // replay would capture show one person's turnover, their customers and their bank balance, and
  // the debugging value of watching that is small next to what it costs to ask every owner for
  // permission to film their books. So: stop recording, and the consent question does not arise.
  //
  // What stays is the part that was always defensible without asking: an exception with its stack
  // trace, and 10% tracing. No cookie, no storage, no recording — and beforeSend below still
  // strips anything sensitive that rode along by accident.
  //
  // The rates are stated as zero rather than deleted. Removing the keys would leave the SDK
  // defaults in charge, which is the exact failure this file's header is about.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // [SENTRY-EEN-CONFIG] Carried over from sentry.client.config.ts, where it was written and never
  // ran. Everything below this line is that file's work.
  beforeSend(event) {
    const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
    const errorMessage = event.exception?.values?.[0]?.value ?? "";

    // ResizeObserver — a browser quirk, not a real error.
    if (errorMessage.includes("ResizeObserver loop")) return null;
    // Ad blocker / network noise — not actionable.
    if (errorMessage.includes("NetworkError")) return null;
    if (errorMessage.includes("Failed to fetch")) return null;
    if (errorMessage.includes("Load failed")) return null;
    // Known Next.js hydration noise.
    if (errorMessage.includes("Hydration failed")) return null;
    // Vercel's own preview toolbar, not our code.
    if (frames.some((f) => f.filename?.includes("vercel.live"))) return null;

    // Strip anything sensitive that was captured by accident. The header of the old file put it
    // plainly: never send tokens, passwords, or KvK/BTW numbers.
    if (event.request?.data) {
      const data = event.request.data as Record<string, unknown>;
      delete data.password;
      delete data.access_token;
      delete data.refresh_token;
      delete data.kvk_number;
      delete data.btw_number;
      delete data.iban;
    }

    return event;
  },

  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Non-Error promise rejection captured",
    /^No error$/,
    /Loading chunk \d+ failed/,
    /Loading CSS chunk \d+ failed/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
