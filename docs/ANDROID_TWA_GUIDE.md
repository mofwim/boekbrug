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

Suggested `applicationId`: `nl.boekbrug.app` (this is the `package_name`).

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
| `ANDROID_APP_PACKAGE` | `nl.boekbrug.app` |
| `ANDROID_APP_FINGERPRINTS` | `AB:CD:...:99` (comma-separate multiple) |

Redeploy, then verify:

```bash
curl https://boekbrug.nl/.well-known/assetlinks.json
```

It should return your package + fingerprint(s). Until the vars are set it returns
`[]` (valid JSON, verification just stays pending).

### 3. Publish

1. Google Play Console developer account (one-time ~$25).
2. Create the app, upload the `.aab`, add screenshots, description, and link the
   existing privacy policy at `https://boekbrug.nl/privacy`.
3. Submit for review (first review is typically a few hours to ~3 days).

Sideload the `.apk` on a device first to confirm login (incl. Google OAuth),
invoice scanning (camera), and PDF/Excel downloads all work in the shell.

## Later: native push notifications

The reconcile cron and messaging flows already write in-app `notifications`
rows — natural push candidates. To deliver them as Android notifications from a
TWA, add a service worker + Web Push (VAPID) and a subscription store; the TWA
forwards them as system notifications. This is greenfield and independent of the
steps above.
