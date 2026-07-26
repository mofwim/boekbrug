import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // [PERF] Strip console.* from PRODUCTION bundles only (dev keeps all logs).
  // console.error / console.warn are preserved for real diagnostics + Sentry.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
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