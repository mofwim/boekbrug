// src/lib/funnel-events.ts
// [FUNNEL-METING] The six steps between "arrived from Google" and "has a BoekBrug account".
//
// ── WHY THIS EXISTS ──
// The app already ships Vercel Web Analytics (<Analytics/> in layout.tsx), so page views were
// counted — /factuur-maken got N, /register got M. What could never be answered is the only
// question that matters for the funnel: did the SAME visit go from one to the other, and where did
// it stop? A drop between "downloaded a PDF" and "clicked the CTA" is a copy problem; a drop
// between "clicked the CTA" and "finished registering" is a form problem. One number for each page
// cannot tell those apart, so every decision about the funnel was a guess.
//
// This does not add a second analytics system. `track()` is part of the @vercel/analytics package
// that is already installed and already mounted; this module only gives its events one spelling
// and one guard.
//
// ── THE PRIVACY GUARD IS THE TYPE, NOT A COMMENT ──
// This funnel runs over invoices: a client's name, address, BTW number, an IBAN, the amounts. None
// of that may reach an analytics vendor, and "remember not to send it" is not a mechanism — the
// next person adds one field in a hurry and it ships.
//
// So `trackFunnel` accepts exactly one shape, `FunnelProps`, with three optional keys and nothing
// else. TypeScript rejects an object with extra keys at the call site, which means passing
// `client_name` or `total` is a compile error rather than a leak. The keys that ARE allowed are
// route facts the URL already carries in plain sight.
//
// Vercel Web Analytics is cookieless and stores no personal identifiers, which is why the app
// chose it; that property only holds as long as what we hand it stays impersonal.
//
// Run: npx tsx --test src/lib/funnel-events.test.ts

import { track } from "@vercel/analytics";

/**
 * The funnel, in order. A visitor can leave at any step, and each name says what he DID rather
 * than what we hoped he would do — `invoice_cta_click` is a fact, `conversion_intent` is a story.
 */
export const FUNNEL_EVENTS = {
  /** The generator was opened. The top of the funnel; fires once per page view. */
  pageView: "invoice_page_view",
  /** The invoice first became downloadable: a party and at least one real line. Fires once. */
  created: "invoice_created",
  /** The PDF was actually downloaded. */
  pdfDownload: "invoice_pdf_download",
  /** The draft was stored for the account that does not exist yet. Fires once per visit. */
  handoffCreated: "invoice_handoff_created",
  /** The "Gratis account maken" button under the generator was clicked. */
  ctaClick: "invoice_cta_click",
  /** The registration form was submitted. */
  registerStarted: "register_started",
  /** Registration succeeded. */
  registerCompleted: "register_completed",
} as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

/**
 * Everything an event may carry. Deliberately tiny, and deliberately a closed type.
 *
 * `vak` answers the question this whole phase exists for — which trade page brings people who
 * actually become users, rather than people who merely visit. `source`/`medium`/`campaign` come
 * from the utm_* parameters of a marketing link.
 *
 * There is no key here for anything a person typed. That is the point.
 */
export interface FunnelProps {
  /** A slug from VAKKEN, or null on the generic page. Never free text — see trackFunnel. */
  vak?: string | null;
  /** utm_source of the visit, if it came from a tagged link. */
  source?: string | null;
  /** utm_medium. */
  medium?: string | null;
  /** utm_campaign. */
  campaign?: string | null;
}

/**
 * What actually leaves the browser for a given set of props.
 *
 * Exported because this is the half worth testing: the guard lives here, and `track()` itself is
 * one call into a vendor SDK that a unit test can only re-assert. Keeping the decision pure means
 * the privacy rule can be checked without mocking a module — see funnel-events.test.ts.
 *
 * Analytics values must be scalars; an empty or unknown value is simply left out.
 */
export function funnelProperties(props: FunnelProps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["vak", "source", "medium", "campaign"] as const) {
    const value = props[key];
    if (typeof value === "string" && value.trim() !== "") {
      // A campaign name arrives from a URL a stranger can write. Cap it so a pathological
      // querystring cannot turn into a pathological event property.
      out[key] = value.trim().slice(0, 64);
    }
  }
  return out;
}

/**
 * Make sure the SDK has somewhere to put an event.
 *
 * WHY THIS IS NOT PARANOIA. @vercel/analytics' `track()` ends in `window.va?.call(...)` — optional
 * chaining. When `window.va` does not exist yet the call is DROPPED, silently, with no error and
 * no queue. And `window.va` is installed by <Analytics/> in an effect, while React runs a child's
 * effects before its parent's: an event fired on mount from a page inside the layout races the
 * component that makes events possible, and loses.
 *
 * That was not hypothetical. `invoice_page_view` — the top of the funnel, the number every later
 * step is a percentage OF — never arrived, while the three events fired after the visitor started
 * typing all did. A funnel whose first step is undercounted does not read as broken; it reads as
 * an unusually good conversion rate, which is the most expensive kind of wrong number.
 *
 * This installs exactly the stub the SDK's own `initQueue` installs, and the same one Vercel's
 * script snippet writes: calls land in `window.vaq` and the real script drains that queue when it
 * loads. Idempotent, and it never replaces a queue that already exists.
 */
function ensureQueue(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { va?: (...args: unknown[]) => void; vaq?: unknown[][] };
  if (w.va) return;
  w.va = function queued(...params: unknown[]) {
    (w.vaq ||= []).push(params);
  };
}

/**
 * Record one funnel step.
 *
 * Never throws. An analytics call that fails — a blocker, an offline phone, a quota — must not
 * take a working invoice down with it, and a visitor who blocks trackers is exercising a choice
 * this product respects rather than a fault to report.
 */
export function trackFunnel(event: FunnelEvent, props: FunnelProps = {}): void {
  try {
    ensureQueue();
    track(event, funnelProperties(props));
  } catch {
    /* analytics is never load-bearing */
  }
}
