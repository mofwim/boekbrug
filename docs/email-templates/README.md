# BoekBrug — E-mailtemplates (Supabase Auth)

Nederlandse, gebrande vervangers voor Supabase's standaard Engelse auth-mails.
Plakken in **Supabase → Authentication → Emails → Templates**.

| Bestand                | Supabase-template      | Wanneer verstuurd                          |
|------------------------|------------------------|--------------------------------------------|
| `confirm-signup.html`  | Confirm signup         | Na registratie met e-mail (activatie)      |
| `magic-link.html`      | Magic Link             | Inloggen zonder wachtwoord                 |
| `reset-password.html`  | Reset Password         | Wachtwoord vergeten                        |
| `change-email.html`    | Change Email Address   | E-mailadres wijzigen (bevestigt nieuw)     |
| `invite.html`          | Invite user            | Handmatige uitnodiging via Supabase-dashboard |

## Belangrijk
- **Variabelen niet aanpassen.** `{{ .ConfirmationURL }}`, `{{ .Email }}`,
  `{{ .NewEmail }}` worden door Supabase ingevuld. De `ConfirmationURL` loopt via de
  `emailRedirectTo` → onze PKCE-callback (`/api/auth/callback`), mits de Redirect URLs
  in Supabase kloppen (zie `../AUTH_SETUP_GUIDE.md`, Deel B.1).
- **Afzender:** stel in via Custom SMTP (`noreply@boekbrug.nl`) — zie Deel B.4 van de
  setup-gids. Zonder eigen SMTP + SPF/DKIM/DMARC belanden deze mails in spam,
  hoe mooi de template ook is.
- **Huisstijl:** BoekBrug-blauw `#1A73E8`, inline CSS (verplicht voor e-mailclients),
  table-layout voor maximale compatibiliteit, preheader-tekst en een zichtbare
  fallback-link onder elke knop.

## Testen
Stuur een testmail naar [mail-tester.com](https://www.mail-tester.com) → mik op 10/10.
Controleer in Gmail + Outlook (web en mobiel) dat de knop klikbaar is en niet in spam
belandt.
