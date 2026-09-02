# Shipping BoekBrug to Android (Trusted Web Activity)

BoekBrug is a server-rendered Next.js app. The lowest-risk way to put it on the
Google Play Store is a **Trusted Web Activity (TWA)** — a thin Android shell that
runs the live site in full-screen Chrome, with no browser URL bar.

TWA was chosen over Capacitor on purpose: the app relies on **cookie-based
Supabase sessions + Google OAuth** and **blob file downloads** (invoice PDFs,
Excel, ZIP). Both work unchanged in Chrome/TWA but need real engineering to
survive Capacitor's custom URL scheme. The only thing TWA gives up is native push
notifications, which don't exist in the app yet and can be added later via
web-push + a service worker.

## What's already done in this repo

- **PWA icons** — `public/icons/` holds the `BB`-over-a-bridge launcher icons
  `icon-192.png`, `icon-512.png`, plus full-bleed `icon-maskable-{192,512}.png`
  and `apple-touch-icon.png`. Regenerate with
  `node scripts/generate-icons.mjs` (uses `sharp`) if the brand changes.
- **Web manifest** — `src/app/manifest.ts` references all icons with the correct
  `purpose: any | maskable`. `display: standalone`, `theme_color: #1a73e8`.
- **Digital Asset Links endpoint** — served at
  `/.well-known/assetlinks.json` via a rewrite in `next.config.ts` to the
  env-driven handler `src/app/api/well-known/assetlinks/route.ts`.
- **Middleware** — `src/middleware.ts` excludes `/icons/` and `/.well-known/`
  from the auth guard so Android / PWABuilder / Google's verifier can fetch them
  without a session.
- **Service worker** — `public/sw.js` is registered by `src/app/ServiceWorkerRegister.tsx`.
  It does two things and refuses to do a third: a branded `/offline.html` fallback when a
  navigation fails, and Web Push. It never caches or serves a live page while online and never
  touches `/api/*` — this is an auth-heavy money app, and a stale screen here is worse than a
  slow one.
- **Web Push** — built, not "later": `push`/`notificationclick` in the worker, `src/lib/push.ts`
  and `push-payload.ts` server-side, `use-push-notifications.ts` plus `/api/push/subscribe` and
  `/unsubscribe` client-side, `push_subscriptions.sql` for the store, and
  `api/cron/payment-due` as the first real sender.
- **Safe areas** — `viewportFit: "cover"` in `src/app/layout.tsx`, with `env(safe-area-inset-*)`
  carried through the headers and the bottom bar, so nothing sits under the gesture bar in a
  full-screen TWA.
- **The Android package itself** — generated and signed. `nl.boekbrug.twa`, upload-key SHA-256
  baked into the assetlinks handler as a public value.

## Remaining steps (need a signing key, so they can't be done in-repo)

### 1. Generate the Android app

Easiest — **PWABuilder**:

1. Go to <https://www.pwabuilder.com>, enter `https://boekbrug.nl`.
2. It reads the manifest above and reports the PWA is ready.
3. Package for **Android** → download the project. It produces a signed
   `app-release-signed.aab` (for Play) and `app-release-signed.apk` (for
   sideload testing), plus a `signing-key-info` with the key details.

Or, for more control — **Bubblewrap CLI** (needs JDK 17 + Android SDK):

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://boekbrug.nl/manifest.webmanifest
bubblewrap build      # prompts to create a keystore on first run
```

The `applicationId` is **`nl.boekbrug.twa`** — already chosen, already signed, and already the
value `src/app/api/well-known/assetlinks/route.ts` publishes. It is not a suggestion any more;
changing it means a new app on the Play Store, not a rename.

> ⚠️ **Keep the keystore + passwords safe forever.** The Play Store ties the app
> identity to this key; lose it and you can't publish updates under the same app.

### 2. Wire up Digital Asset Links

The URL bar only disappears once boekbrug.nl proves it owns the app. Get the
**SHA-256 fingerprint(s)** of the signing cert:

- From Bubblewrap: `keytool -list -v -keystore android.keystore` → copy `SHA256`.
- With Play App Signing (recommended): Play Console → *Test and release* →
  *Setup* → *App integrity* → *App signing key certificate* → SHA-256. When Play
  re-signs, list **both** your upload-key and the Play app-signing fingerprints.

Then set two env vars in **Vercel → Project → Settings → Environment Variables**
(Production) — no code change needed:

| Variable | Example |
| --- | --- |
| `ANDROID_APP_PACKAGE` | `nl.boekbrug.twa` (only to OVERRIDE the built-in) |
| `ANDROID_APP_FINGERPRINTS` | `AB:CD:...:99` (comma-separate multiple) |

Redeploy, then verify:

```bash
curl https://boekbrug.nl/.well-known/assetlinks.json
```

It should return your package + fingerprint(s).

⚠️ **This section used to say the endpoint returns `[]` until those vars are set. It does not, and
has not for a while.** `assetlinks/route.ts` carries the package name and the upload-key SHA-256
**in code**, as public values, so the file is complete the moment it deploys. The env vars only
ADD to it — in practice the one thing they add is the **Play App Signing** fingerprint, which is
also the one thing that still stands between the app and a hidden URL bar.

One line settles whether that is done:

```bash
curl -s https://boekbrug.nl/.well-known/assetlinks.json | jq '.[0].target.sha256_cert_fingerprints'
```

One fingerprint = the upload key only, and Play's re-signed build will not verify.
Two = done.

### 3. Publish

1. Google Play Console developer account (one-time ~$25).
2. Create the app, upload the `.aab`, add screenshots, description, and link the
   existing privacy policy at `https://boekbrug.nl/privacy`.
3. Submit for review (first review is typically a few hours to ~3 days).

Sideload the `.apk` on a device first to confirm login (incl. Google OAuth),
invoice scanning (camera), and PDF/Excel downloads all work in the shell.

## Native push notifications — built, not "later"

This section used to describe push as greenfield. It is not: the worker, the VAPID sender, the
subscribe/unsubscribe doors, the subscription table and a first cron sender all exist (listed
under *What's already done* above). What a TWA adds is only that Android renders them as system
notifications, which needs no further code.

## Why this document was wrong, and what that cost

Nothing, this time — the app shipped anyway. It is recorded because the same shape did cost
something elsewhere the same week: `docs/WELKE_MIGRATIES_STAAN_ER.sql` reported two security
migrations as applied while production was missing three protected columns, because its probe
asked whether a FUNCTION existed and nine migrations write the same one. See §13 of
`MONEY_PATH_AUDIT_2026-08.md`.

A document that describes a stage the code has passed is not neutral. It is read by whoever picks
the work up next, and it sends them to do something already done — or, worse, tells them a check
has been made that has not. When a step here is finished, edit the step; do not add a note under
it.
