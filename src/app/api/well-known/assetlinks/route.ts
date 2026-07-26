// src/app/api/well-known/assetlinks/route.ts
// [ANDROID/TWA] Digital Asset Links — the proof that boekbrug.nl and the Android
// app are published by the same owner. This is what lets a Trusted Web Activity
// (TWA) hide the browser URL bar and run BoekBrug as a real full-screen app.
//
// Served at the canonical /.well-known/assetlinks.json path via a rewrite in
// next.config.ts (Next ignores app-router folders that start with ".", so the
// file lives here and is mapped over).
//
// The package name + signing fingerprint below are the ones baked into the
// BoekBrug Android package generated with PWABuilder. They are NOT secrets —
// assetlinks.json is a public file by design — so they live in code and the link
// works the moment this deploys, no manual Vercel step required.
//
// [PLAY APP SIGNING] When you upload the .aab to Google Play, Google re-signs it
// with its own managed key, which has a DIFFERENT SHA-256 than the upload key
// below. Add that second fingerprint (Play Console → Test and release → Setup →
// App integrity → App signing key certificate → SHA-256) via the env var — it's
// merged with the built-ins, no code change needed:
//   ANDROID_APP_FINGERPRINTS  extra SHA-256 fingerprint(s), comma-separated.
//   ANDROID_APP_PACKAGE       override the package name if it ever changes.

import { NextResponse } from "next/server";

// The upload-key identity from the generated package (public values).
const DEFAULT_PACKAGE = "nl.boekbrug.twa";
const DEFAULT_FINGERPRINTS = [
  "DA:25:9A:66:E5:A3:67:08:BF:42:CF:15:42:20:9B:EB:9A:AF:9F:65:0C:89:6C:23:AB:B1:F9:4E:78:5E:97:E7",
];

// Read env at request time so adding the Play App Signing fingerprint in Vercel
// takes effect without a source redeploy.
export const dynamic = "force-dynamic";

export function GET() {
  const packageName = process.env.ANDROID_APP_PACKAGE?.trim() || DEFAULT_PACKAGE;

  const envFingerprints = (process.env.ANDROID_APP_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  // Built-in upload key + any env-added (e.g. Play App Signing) key, de-duped
  // case-insensitively.
  const seen = new Set<string>();
  const fingerprints = [...DEFAULT_FINGERPRINTS, ...envFingerprints].filter((f) => {
    const key = f.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const statements = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return NextResponse.json(statements, {
    headers: {
      // Asset Links verifiers re-fetch this; an hour of caching is plenty.
      "cache-control": "public, max-age=3600",
    },
  });
}
