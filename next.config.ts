import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { SITE_URL, siteUrlIssue } from "./src/lib/site";

// [CANONIEK-BUILD] Say it out loud during the build when NEXT_PUBLIC_BASE_URL is the wrong host.
//
// WHY HERE AND NOWHERE ELSE. siteUrlIssue() already knew how to spot this, and /api/health already
// called it — but that endpoint needs CRON_SECRET and somebody who thinks to ask. Nothing asked.
// The variable sat on the www host for months while the deployment served the apex, and the only
// evidence was outside the app: all 283 URLs in sitemap.xml answered 301, every canonical pointed
// at a redirect, and Google indexed none of it. The screens were fine the whole time.
//
// A local build cannot catch that, because a developer's shell does not have the production
// variable. The Vercel build does. This is the one place in the repo that runs with the real value
// and can still print something a human sees, so the check belongs here and not in a unit test.
//
// IT WARNS, IT DOES NOT THROW. A wrong canonical costs indexing; a build that refuses to run costs
// the deploy in front of it, including the deploy that would have fixed the variable. The person
// who can act on this is the one reading the build log.
//
// The message is Dutch because its reader is the owner in the Vercel dashboard — the same audience
// and the same sentence as /api/health, whose `gevolg` text is reused here rather than restated.
const canonicalIssue = siteUrlIssue();
if (canonicalIssue) {
  console.warn(
    [
      "",
      "════════════════════════════════════════════════════════════════════════",
      "  ⚠  NEXT_PUBLIC_BASE_URL klopt niet — de site wordt niet geïndexeerd",
      "",
      `  Nu ingesteld : ${SITE_URL || "(leeg)"}`,
      `  Probleem     : ${canonicalIssue.code}`,
      `  Gevolg       : ${canonicalIssue.gevolg}`,
      "",
      "  Dit breekt geen enkel scherm. Het breekt alleen sitemap.xml, robots.txt",
      "  en elke canonical — en dat zie je pas weken later in Search Console.",
      "  Zet de variabele goed in Vercel → Settings → Environment Variables en",
      "  deploy opnieuw.",
      "════════════════════════════════════════════════════════════════════════",
      "",
    ].join("\n"),
  );
}

const nextConfig: NextConfig = {
  // [PERF] Strip console.* from PRODUCTION bundles only (dev keeps all logs).
  // console.error / console.warn are preserved for real diagnostics + Sentry.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  // [INSTANT] View transitions were enabled here and have been REMOVED. Do not
  // switch them back on without reading the post-mortem in
  // docs/UX_REVIEW_2026.md first: the two top bars both carried
  // view-transition-name: 'page-header', and during a navigation from a home to
  // a sub-page BOTH bars exist in the DOM for a moment. A duplicate
  // view-transition-name aborts the transition, and the aborted snapshot stayed
  // painted — a blank white rectangle over the header, at z-index 100 in the
  // view-transition layer, with the first list row clipped behind it. Seen on
  // the Vercel preview at /dashboard/incoming/manage?from=home.

  // [BOEK-COST] sharp is a native, server-only image library used in src/lib/ai.ts
  // to downscale invoice photos before sending them to Claude. ai.ts is also
  // pulled into some client components, so without this Next.js tries to bundle
  // sharp for the browser and the build fails with "module not found". Marking it
  // here keeps sharp server-only (Node runtime), out of the client bundle.
  serverExternalPackages: ["sharp", "unpdf"],

  // [ANDROID/TWA] Serve the Digital Asset Links file at its canonical well-known
  // path. Next ignores app-router folders beginning with ".", so the handler
  // lives at /api/well-known/assetlinks and is mapped here. This is what the
  // Android TWA verifier fetches to drop the browser URL bar.
  async rewrites() {
    return [
      {
        source: "/.well-known/assetlinks.json",
        destination: "/api/well-known/assetlinks",
      },
    ];
  },

  // [SEC-HEADERS] Baseline security response headers on every route. These are
  // the safe, non-breaking set — deliberately NOT a strict Content-Security-Policy,
  // which would need per-source allow-listing for Supabase / Sentry / Vercel and
  // could silently break the app. What we DO set:
  //   · Strict-Transport-Security — force HTTPS for 2 years incl. subdomains.
  //     `preload` is only a hint; the header alone never submits us to the
  //     browser preload list (that requires a manual submission), so it is safe.
  //   · X-Frame-Options: SAMEORIGIN — clickjacking guard. SAMEORIGIN (not DENY)
  //     so we retain the option to embed our own pages (e.g. a /pay widget).
  //   · X-Content-Type-Options: nosniff — no MIME-sniffing of our responses.
  //   · Referrer-Policy — send only the origin to third parties, full path
  //     same-origin. Keeps client/invoice paths out of external Referer logs.
  //   · Permissions-Policy — deny camera/microphone/geolocation/topics. NB: the
  //     invoice-photo flow uses <input capture>, a native file-input attribute
  //     that is NOT gated by the Permissions-Policy `camera` directive (that
  //     governs getUserMedia only), so denying camera here does not break it.
  //   · X-DNS-Prefetch-Control: on — small latency win on outbound links.
  async headers() {
    const securityHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
      },
      { key: "X-DNS-Prefetch-Control", value: "on" },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "mofwim",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});