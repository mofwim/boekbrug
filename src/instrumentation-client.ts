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

  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Stated, not inherited. These three ARE the library defaults today, and a default is a
      // decision someone else can change in a minor release — on a screen showing invoice amounts
      // and customer names that is not a risk worth carrying implicitly.
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

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
