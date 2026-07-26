# BoekBrug — Google Play Store submission kit

Everything needed to publish the BoekBrug Android app (Trusted Web Activity)
to the Google Play Store. Copy-paste the texts, generate the graphics with
`node scripts/generate-store-assets.mjs` (output lands in `store-assets/`), and
follow the checklist.

> The app is a TWA wrapping `https://boekbrug.nl`. Digital Asset Links are already
> served from `/.well-known/assetlinks.json` (see `docs/ANDROID_TWA_GUIDE.md`).

---

## 1. Store listing — text

### Title (max 30 chars)
```
BoekBrug: Facturen & Bonnen
```

### Short description (max 80 chars)
**NL**
```
Fotografeer je bonnen en facturen — klaar voor je boekhouder, zonder gedoe.
```
**EN**
```
Snap your receipts and invoices — ready for your accountant, hassle-free.
```

### Full description (max 4000 chars)

**NL (nl-NL — primary)**
```
BoekBrug is de brug tussen jou en je boekhouder. Je hoeft geen boekhouding te
doen — je hoeft alleen niets kwijt te raken.

Fotografeer je bonnen en facturen, of laat ze automatisch binnenkomen via je
mail. BoekBrug leest ze uit, houdt je BTW bij en zet aan het eind van elk
kwartaal alles netjes klaar voor je boekhouder. Eén app, alles op één plek.

WAT JE MET BOEKBRUG DOET
• Facturen maken — professionele facturen in seconden, met je eigen huisstijl,
  en direct als PDF versturen.
• Bonnen en facturen scannen — maak een foto; BoekBrug herkent leverancier,
  bedrag, BTW en datum automatisch.
• Inkomende facturen via e-mail — koppel je mailbox en laat facturen vanzelf
  binnenstromen.
• BTW altijd bij de hand — je concept-BTW-aangifte groeit met je mee, per
  kwartaal.
• Bankafschrift koppelen — importeer je afschrift en laat betalingen automatisch
  matchen met je facturen.
• Samenwerken met je boekhouder — één ZIP met facturen, bonnen, bankafschrift én
  je concept-aangifte. Klaar om door te sturen.

VOOR WIE
Voor ZZP'ers, freelancers en kleine ondernemers die geen tijd (of zin) hebben
in boekhouden — en voor de boekhouders die met ze samenwerken.

VEILIG EN PRIVACYVRIENDELIJK
Je gegevens zijn versleuteld en AVG-proof. Je blijft eigenaar van je data en kunt
je account en gegevens op elk moment verwijderen.

Geen creditcard nodig om te beginnen. Nederlandse facturen, Nederlandse BTW.

Begin vandaag: fotografeer je eerste bon en zie hoe makkelijk het kan.
```

**EN (en-US — optional second locale)**
```
BoekBrug is the bridge between you and your accountant. You don't have to do
bookkeeping — you just have to not lose anything.

Snap your receipts and invoices, or let them arrive automatically by email.
BoekBrug reads them, keeps track of your VAT, and has everything ready for your
accountant at the end of every quarter. One app, everything in one place.

WHAT YOU CAN DO
• Create invoices — professional invoices in seconds, with your own branding,
  sent straight as PDF.
• Scan receipts and invoices — take a photo; BoekBrug recognises the supplier,
  amount, VAT and date automatically.
• Incoming invoices by email — connect your mailbox and let invoices flow in.
• VAT always at hand — your draft VAT return grows with you, per quarter.
• Bank statement matching — import your statement and auto-match payments to
  invoices.
• Work with your accountant — one ZIP with invoices, receipts, bank statement
  and your draft return. Ready to send.

FOR WHOM
For freelancers, self-employed people and small businesses who have no time (or
patience) for bookkeeping — and the accountants who work with them.

SECURE AND PRIVACY-FRIENDLY
Your data is encrypted and GDPR-compliant. You stay the owner of your data and
can delete your account and data at any time.

No credit card needed to start. Dutch invoices, Dutch VAT.
```

### Other listing fields
| Field | Value |
| --- | --- |
| App category | **Finance** (alt: Business) |
| Tags | facturen, boekhouding, ZZP, BTW, bonnen scannen |
| Contact email | *(your support email)* |
| Website | https://boekbrug.nl |
| Privacy policy | https://boekbrug.nl/privacy |

---

## 2. Graphics (in `store-assets/`)

| Asset | Spec | File |
| --- | --- | --- |
| App icon (hi-res) | 512×512 PNG, 32-bit | `play-icon-512.png` |
| Feature graphic | 1024×500 PNG | `play-feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, PNG/JPG, 9:16-ish, ≥1080px on the short side | `screenshot-N-framed.png` (see below) |

Generate icon + feature graphic: `node scripts/generate-store-assets.mjs`.
Frame phone screenshots too by passing their paths:
`node scripts/generate-store-assets.mjs shot1.jpg shot2.jpg ...`.

### Screenshots to capture (from the live app on your phone)
Take 3–5 clean screenshots (the URL bar is gone now) and I can frame them in the
same style. Best pages to show:
1. Dashboard / "Ben ik klaar?" (quarter progress) — the money shot.
2. Een factuur maken (create invoice).
3. Een bon scannen (camera capture / result).
4. Bank matching.
5. "Download voor de boekhouder" (the ZIP hand-off).

---

## 3. Play Console — required declarations

### Data safety form
BoekBrug collects and processes (all to run the service, none sold):
- **Personal info:** name, email address → account, communication.
- **Financial info:** invoices, receipts, bank transaction data the user imports
  → the core bookkeeping features.
- **App activity / uploads:** photos of receipts/invoices the user takes.

Answer the form as:
- Data **is** collected. Data **is** encrypted in transit (HTTPS).
- Data is **not** sold or shared with third parties for advertising.
- Users **can request deletion** — the app has account + data deletion
  (`/dashboard/settings` → account, and the `/api/account/delete` flow).
- Purposes: **App functionality**, **Account management** (not Advertising).

### Content rating questionnaire
Business/finance utility, no objectionable content → expect **Everyone / PEGI 3**.
Answer "No" to violence, sexual content, gambling, user-to-public content, etc.
(In-app messages are private between a user and their own accountant, not public.)

### Target audience & content
- Target age: **18+** (a financial tool for professionals) — this avoids the
  Families programme requirements.
- Ads: **No ads**.
- News app: No.

### App access (for review)
Most of the app is behind login, so Google's reviewers need a test account.
Provide **demo credentials** in Play Console → App content → *App access* → add a
login-required instruction with a working email + password (make a throwaway
demo account seeded with a few invoices).

---

## 4. Publishing flow (recommended: test track first)

1. **Create the app** in Play Console (Dutch as default language, add English).
2. **Closed testing** track → upload `BoekBrug.aab` → add yourself + a few testers.
3. **🔑 Play App Signing:** on upload, Google re-signs the app with its own key —
   a **different** SHA-256 than the upload key currently in `assetlinks.json`.
   Copy it from *Test and release → Setup → App integrity → App signing key
   certificate → SHA-256* and add it via the `ANDROID_APP_FINGERPRINTS` Vercel
   env var (comma-separated; it's merged with the built-in one). **Without this
   the URL bar reappears for users who install from Play.**
4. Fill **Store listing** (texts + graphics above), **Data safety**, **Content
   rating**, **Target audience**, **App access** (demo login).
5. Install from the test track on a device → confirm full-screen (no URL bar),
   login, scanning and downloads all work.
6. Promote to **Production** and submit for review (first review: hours–3 days).

---

## 5. Don't forget
- Keep `signing.keystore` + `signingkeyinfo.txt` backed up outside the repo — they
  are the only way to ship future updates.
- After adding the Play App Signing fingerprint, redeploy and verify:
  `https://boekbrug.nl/.well-known/assetlinks.json` should list **two**
  fingerprints (upload key + Play key).
