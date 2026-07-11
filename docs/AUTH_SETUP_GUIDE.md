# BoekBrug — Front-Door Auth Setup Guide
*Alles wat NIET in code zit maar wél nodig is voor een vertrouwde eerste indruk.*
*Laatst bijgewerkt: juli 2026*

De code is inmiddels correct (zie commit `AUTH-FRONTDOOR`): sign-in vraagt alleen
`openid email profile`, registratie faalt niet meer onder e-mailbevestiging, en de
bevestigingslink loopt via de PKCE-callback. Wat overblijft zijn **configuratie- en
DNS-instellingen** in Google Cloud, Supabase en je DNS-provider. Dit document is de
checklist.

> **Waarom dit ertoe doet:** deze twee dingen — Google's "app niet geverifieerd"
> waarschuwing en een bevestigingsmail van een onbekende Supabase-afzender die in
> spam belandt — raken *elke* gebruiker, ongeacht features. Ze zijn onzichtbaar als
> je de app zélf test (jij klikt door de waarschuwing; jij hebt je eigen mail al
> whitelisted). Een vreemde haakt hier af.

---

## Deel A — Google OAuth (Google Cloud Console)

Doel: de "Google heeft deze app niet geverifieerd" waarschuwing weg krijgen bij het
inloggen. Sinds de code-fix vraagt login **alleen basis-scopes** (`openid email
profile`) — dat is de makkelijke categorie (alleen *brand verification*, géén CASA).

### A.1 — OAuth consent screen invullen
`APIs & Services → OAuth consent screen`
- **User type:** External
- **App name:** BoekBrug
- **User support email:** (jouw support-adres)
- **App logo:** upload het BoekBrug-logo (verplicht voor verificatie)
- **App domain →** Application home page: `https://boekbrug.nl`
- **Privacybeleid:** `https://boekbrug.nl/privacy` *(inhoud staat in `docs/legal/01_Privacyverklaring.md`)*
- **Servicevoorwaarden:** `https://boekbrug.nl/voorwaarden` *(zie `docs/legal/02_Algemene_Voorwaarden.md`)*
- **Authorized domains:** `boekbrug.nl` + `supabase.co`
- **Developer contact:** je e-mailadres

### A.2 — Scopes
`Scopes` tab → voeg **alleen** toe:
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`
- `openid`

⚠️ **Voeg hier GEEN `gmail.readonly` toe.** Dat is een *restricted scope* die het hele
project in een jaarlijkse CASA-securityaudit trekt. Gmail-import gebruikt een eigen,
losse toestemmingsstroom (`/api/email/connect`) — zie Deel D.

### A.3 — NU (pre-launch beta): Testing-modus + testgebruikers
Zolang je nog geen verificatie hebt, zet de app op **Testing** en voeg je beta-testers
toe onder `Test users`. **Testgebruikers zien de waarschuwing NIET** — ook niet bij
Gmail-import. Dit is dé manier om je eerste ~100 gebruikers zonder wrijving te laten
starten terwijl verificatie loopt. (Limiet: 100 test users.)

### A.4 — LATER (publieke launch): Publiceren + brand verification
`Publishing status → Publish app` → dien in voor verificatie. Met alleen basis-scopes
is dit doorgaans een korte *brand verification* (logo + domein + beleid). Daarna is de
waarschuwing weg voor iedereen.

### A.5 — Credentials (redirect URI's) — LET OP, veelgemaakte fout
`APIs & Services → Credentials → OAuth 2.0 Client ID`
- **Authorized JavaScript origins:** `https://boekbrug.nl`, `http://localhost:3000`
- **Authorized redirect URIs:** **de Supabase-callback, NIET je app-URL:**
  ```
  https://<PROJECT_REF>.supabase.co/auth/v1/callback
  ```
  (`<PROJECT_REF>` staat in je Supabase project-URL.)
  De app-route `/api/auth/callback` hoort hier **niet** — die is de `redirectTo` in
  Supabase (Deel B.1), niet Google's redirect.
- Kopieer **Client ID** + **Client Secret** → plak in Supabase (Deel B.2).

---

## Deel B — Supabase Auth

### B.1 — URL Configuration
`Authentication → URL Configuration`
- **Site URL:** `https://boekbrug.nl`
- **Redirect URLs** (allowlist — voeg alle toe):
  ```
  https://boekbrug.nl/api/auth/callback
  http://localhost:3000/api/auth/callback
  https://*.vercel.app/api/auth/callback      ← preview-deploys (optioneel)
  ```
  Zonder deze staan wordt de bevestigings-/OAuth-redirect geweigerd en landt de code
  ongebruikt op de homepage.

### B.2 — Google provider aanzetten
`Authentication → Providers → Google` → **Enabled**, plak Client ID + Secret uit A.5.
Laat het scopes-veld hier leeg/standaard (de code stuurt de juiste scopes mee).

### B.3 — E-mailbevestiging
`Authentication → Providers → Email` → **Confirm email = ON** (aanbevolen).
De code-fix zorgt dat registratie hier niet meer op stukloopt.
*(Wil je voor de beta minder wrijving? Je kúnt Confirm email tijdelijk uitzetten —
dan is er direct een sessie en logt de gebruiker meteen in. Maar met custom SMTP
(B.4) is bevestiging aan de nettere keuze.)*

### B.4 — Custom SMTP (cruciaal voor deliverability)
De standaard Supabase-mailer is **niet voor productie**: ~2–4 mails/uur, onbekende
afzender, belandt in spam. Zet een eigen SMTP-provider op.

**Aanbevolen: [Resend](https://resend.com)** (ruime gratis tier, beste deliverability, simpel).
1. Maak een Resend-account, voeg domein `boekbrug.nl` toe.
2. Resend toont DNS-records (SPF/DKIM) → zet die in DNS (Deel C).
3. Maak een API-key.
4. Supabase `Authentication → Emails → SMTP Settings → Enable Custom SMTP`:
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL) of `587` (STARTTLS)
   - **Username:** `resend`
   - **Password:** je Resend API-key
   - **Sender email:** `noreply@boekbrug.nl`
   - **Sender name:** `BoekBrug`
   - **Minimum interval / rate limit:** verhoog naar wat je plan toelaat.

*(Alternatieven: Postmark, Amazon SES, SendGrid — zelfde principe.)*

### B.5 — E-mailtemplates
`Authentication → Emails → Templates`. Vervang de standaard Engelse templates door de
Nederlandse, gebrande versies in **`docs/email-templates/`**:

| Supabase template          | Bestand                                   |
|----------------------------|-------------------------------------------|
| Confirm signup             | `confirm-signup.html`                     |
| Magic Link                 | `magic-link.html`                         |
| Reset Password             | `reset-password.html`                     |
| Change Email Address       | `change-email.html`                       |
| Invite user                | `invite.html` *(zie noot)*                |

> **Noot bij Invite:** BoekBrug heeft een **eigen** uitnodigingssysteem (boekhouder ↔
> klant, via `/invite`). Supabase's "Invite user" wordt alleen gebruikt als je iemand
> handmatig via het Supabase-dashboard uitnodigt. Meegeleverd voor de volledigheid.

Elke template gebruikt de Supabase-variabelen (`{{ .ConfirmationURL }}` enz.) — niet
aanpassen, die vult Supabase in.

---

## Deel C — DNS (deliverability: SPF, DKIM, DMARC)

Zonder deze records belandt élke mail in spam, hoe mooi de template ook is. Zet ze bij
je DNS-provider (waar `boekbrug.nl` beheerd wordt).

### C.1 — SPF (TXT)
Autoriseert je mailprovider om namens jou te sturen.
```
Type: TXT   Naam: @   Waarde: v=spf1 include:_spf.resend.com ~all
```
⚠️ Heb je al een SPF-record? **Voeg samen** — er mag maar één SPF-record zijn:
`v=spf1 include:_spf.resend.com include:<bestaande> ~all`.
*(Gebruik je Postmark/SES → gebruik hún include-waarde i.p.v. `_spf.resend.com`.)*

### C.2 — DKIM (CNAME/TXT — door provider gegenereerd)
DKIM-sleutels kan ik niet vooraf invullen; je provider genereert ze per domein.
Resend/Postmark/SES tonen 1–3 records zoals:
```
Type: CNAME   Naam: resend._domainkey   Waarde: <door Resend gegeven>
```
Kopieer exact wat de provider toont. Deze ondertekenen je mail cryptografisch.

### C.3 — DMARC (TXT)
Vertelt ontvangers wat te doen als SPF/DKIM falen. Begin met **monitoren** (`p=none`),
verscherp later naar `quarantine`/`reject`.
```
Type: TXT   Naam: _dmarc   Waarde: v=DMARC1; p=none; rua=mailto:dmarc@boekbrug.nl; fo=1
```

### C.4 — Verifiëren
- Resend-dashboard → domein moet **Verified** tonen.
- Test met [mail-tester.com](https://www.mail-tester.com): stuur een bevestigingsmail
  naar het opgegeven adres → mik op **10/10**.

---

## Deel D — Gmail-import (later, apart)

Gmail-import (auto-inlezen van facturen) gebruikt de restricted scope `gmail.readonly`
via de **losse** flow `/api/email/connect`. Dit staat los van inloggen:
- Zolang de app in **Testing** staat (A.3), zien testgebruikers geen waarschuwing bij
  Gmail koppelen.
- Voor een **publieke** Gmail-import zonder waarschuwing is aparte verificatie + een
  jaarlijkse **CASA-securityaudit** nodig. Plan dit pas als de feature echt getrokken
  wordt; houd het tot dan achter Testing-gebruikers.

---

## Volledige checklist

**Nu (pre-launch beta):**
- [ ] A.1 Consent screen ingevuld (logo, privacy, voorwaarden, domeinen)
- [ ] A.2 Alleen basis-scopes — géén gmail.readonly
- [ ] A.3 App op **Testing** + beta-testers als Test users toegevoegd
- [ ] A.5 Redirect URI = `https://<ref>.supabase.co/auth/v1/callback`
- [ ] B.1 Site URL + Redirect URLs (incl. `/api/auth/callback`)
- [ ] B.2 Google provider aan met Client ID/Secret
- [ ] B.4 Custom SMTP (Resend) actief
- [ ] B.5 Nederlandse templates geplakt
- [ ] C.1–C.3 SPF + DKIM + DMARC gezet
- [ ] C.4 mail-tester ≥ 9/10, Resend-domein Verified

**Later (publieke launch):**
- [ ] A.4 App gepubliceerd + brand verification goedgekeurd
- [ ] C.3 DMARC verscherpt naar `quarantine`
- [ ] D Gmail-verificatie/CASA — alleen als Gmail-import geschaald wordt
