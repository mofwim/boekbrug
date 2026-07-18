// src/app/api/well-known/assetlinks/route.ts
// [ANDROID/TWA] Digital Asset Links — the proof that boekbrug.nl and the Android
// app are published by the same owner. This is what lets a Trusted Web Activity
// (TWA) hide the browser URL bar and run BoekBrug as a real full-screen app.
//
// Served at the canonical /.well-known/assetlinks.json path via a rewrite in
// next.config.ts (Next ignores app-router folders that start with ".", so the
// file lives here and is mapped over).
//
// This is env-driven ON PURPOSE: the signing fingerprint doesn't exist until the
// Android app is built + signed, so you finish the link by setting two Vercel
// env vars — NO code change or redeploy of source needed:
//   ANDROID_APP_PACKAGE       the app's applicationId, e.g. nl.boekbrug.app
//   ANDROID_APP_FINGERPRINTS  the SHA-256 signing-cert fingerprint(s), each as
//                             colon-separated hex. When you publish through Play
//                             App Signing you'll have TWO (your upload key + the
//                             Google-managed key) — list both, comma-separated.
//   Find the Play fingerprint in Play Console → Test and release → Setup →
//   App integrity → App signing key certificate (SHA-256).
//
// Until both are set this returns an empty [] (valid JSON, verification simply
// stays pending) so the endpoint never 500s.

import { NextResponse } from "next/server";

// Read env at request time so setting the vars in Vercel takes effect without a
// source redeploy.
export const dynamic = "force-dynamic";

export function GET() {
  const packageName = process.env.ANDROID_APP_PACKAGE?.trim();
  const fingerprints = (process.env.ANDROID_APP_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  const statements =
    packageName && fingerprints.length > 0
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return NextResponse.json(statements, {
    headers: {
      // Asset Links verifiers re-fetch this; an hour of caching is plenty and
      // keeps it snappy without pinning a stale/empty response for too long.
      "cache-control": "public, max-age=3600",
    },
  });
}
