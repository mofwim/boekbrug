# Cookiebeleid — BoekBrug

**Laatst bijgewerkt:** 30 augustus 2026
**Versie:** 2.0

---

## 1. Wat zijn cookies?

Cookies zijn kleine tekstbestanden die op jouw apparaat worden opgeslagen wanneer je een website bezoekt. Ze worden gebruikt om de website te laten functioneren, je voorkeuren te onthouden of analyses uit te voeren. Naast cookies kan een site ook `localStorage` gebruiken — hetzelfde idee, andere opslagplaats. Beide staan hieronder.

---

## 2. Welke cookies gebruikt BoekBrug?

BoekBrug plaatst **geen enkele cookie waarvoor jouw toestemming nodig is**. Daarom zie je bij ons ook geen cookiebanner: er valt niets te kiezen, omdat wij niets plaatsen dat verder gaat dan het Platform laten werken en jouw voorkeuren onthouden.

Wij gebruiken **geen marketing-, advertentie- of trackingcookies**, en wij nemen jouw scherm niet op.

### 2.1 Strikt noodzakelijke cookies (geen toestemming nodig)

Zonder deze cookies kun je niet inloggen.

| Naam | Doel | Bewaartermijn | Eigenaar |
|------|------|---------------|----------|
| `sb-<project>-auth-token` (soms gesplitst in `…-auth-token.0`, `.1`) | Jouw ingelogde sessie: toegangs- en verniewingstoken | Toegangstoken 1 uur, sessie tot 7 dagen | BoekBrug (via Supabase) |

De naam bevat de projectcode van onze database; hoe die precies heet, bepaalt de Supabase-bibliotheek die de sessie beheert.

### 2.2 Functionele cookies en opslag (geen toestemming nodig)

| Naam | Waar | Doel | Bewaartermijn |
|------|------|------|---------------|
| `boekbrug_taal` | Cookie | Onthouden in welke taal jij het scherm wilt (nl / en / ar / tr) | 1 jaar |
| `boekbrug.priceMode` | localStorage | Onthouden of jij factuurbedragen in- of exclusief btw invoert | Tot je je browsergegevens wist |

Beide onthouden alleen een keuze die jij zelf op het scherm hebt gemaakt. Ze volgen je niet en gaan nergens heen.

### 2.3 Analytische cookies

**Die hebben wij niet.**

- **Bezoekstatistiek** loopt via Vercel Web Analytics. Die telt paginabezoeken **zonder cookie en zonder herkenbare bezoeker** — er wordt niets op jouw apparaat gezet en er is dus niets om toestemming voor te vragen.
- **Foutmonitoring** loopt via Sentry. Als er in je browser een fout optreedt, sturen wij de foutmelding met stack trace, browsertype en de pagina waarop het misging. Sentry zet daarvoor **geen cookie**.
- **Session Replay staat uit.** Sentry kán een opname maken van wat er op het scherm gebeurde; die functie is uitgeschakeld. Dit is een boekhoudapp — op zo'n scherm staan jouw omzet, jouw klanten en jouw banksaldo, en dat filmen wij niet.
- Wat Sentry bij een fout **nooit** meekrijgt: wachtwoorden, tokens, en jouw KVK-, BTW- of IBAN-nummer. Die worden verwijderd voordat de melding je browser verlaat.

---

## 3. Wat gebruiken we NIET?

❌ Geen Google Analytics
❌ Geen Facebook Pixel
❌ Geen marketingcookies
❌ Geen advertentiecookies
❌ Geen tracking-cookies van derden
❌ Geen social media plugins met tracking
❌ Geen retargeting
❌ Geen opname van jouw scherm (session replay)

---

## 4. Cookies van derden

Bij bepaalde functies maken we gebruik van services van derden:

### 4.1 Google OAuth (alleen bij Gmail-koppeling)
Wanneer je Gmail koppelt voor automatische factuurverwerking, kan Google cookies plaatsen tijdens het OAuth-proces. Wij hebben hier geen controle over. Zie [Google's Privacy Policy](https://policies.google.com/privacy).

### 4.2 Microsoft OAuth (alleen bij Outlook-koppeling)
Vergelijkbaar met Google, voor Outlook. Zie [Microsoft Privacy Statement](https://privacy.microsoft.com).

### 4.3 Stripe (alleen bij een betaald abonnement)
Betalen loopt via **Stripe**. Je verlaat daarvoor boekbrug.nl en betaalt op Stripe's eigen beveiligde pagina; Stripe plaatst daar cookies die nodig zijn voor de betaling en voor fraudepreventie. Jouw kaartgegevens komen nooit op onze servers. Zie [Stripe's Privacy Policy](https://stripe.com/privacy).

### 4.4 Je bankkoppeling (alleen als je die maakt)
Koppel je je bankrekening, dan log je in bij je **eigen bank**; die pagina is van de bank en valt onder hun eigen cookiebeleid. De koppeling zelf loopt via Enable Banking (Finland) en zet niets op jouw apparaat.

---

## 5. Jouw rechten en keuzes

### 5.1 Cookies weigeren of beperken
Omdat wij niets plaatsen dat toestemming vereist, is er bij ons geen banner en geen keuzescherm. Wil je toch alles opruimen, dan kan dat altijd via je browser:

- **Chrome:** Instellingen → Privacy en beveiliging → Cookies
- **Firefox:** Voorkeuren → Privacy en beveiliging
- **Safari:** Voorkeuren → Privacy
- **Edge:** Instellingen → Privacy, zoeken en services

### 5.2 Gevolgen van weigering
- **Strikt noodzakelijke cookies** wissen: je wordt uitgelogd en moet opnieuw inloggen
- **Functionele opslag** wissen: het scherm valt terug op Nederlands en op bedragen exclusief btw
- Er is geen categorie die je kunt uitzetten zonder iets te verliezen, omdat er geen categorie is die alleen voor ons bestaat

### 5.3 Foutmonitoring uitzetten
Sentry werkt zonder cookie en stuurt alleen iets bij een echte fout. Wil je ook dat niet, dan blokkeert elke gangbare adblocker of tracking-blocker het verkeer naar `sentry.io`; het Platform blijft daarna gewoon werken.

---

## 6. Wijzigingen aan dit beleid

Wij kunnen dit cookiebeleid bijwerken bij nieuwe functionaliteit of wettelijke wijzigingen. De laatste versie staat altijd op boekbrug.nl/cookies.

Gaan wij ooit iets plaatsen waarvoor toestemming nodig is, dan vragen wij die **voordat** het wordt geplaatst — niet erna.

---

## 7. Contact

Vragen over dit cookiebeleid?
- E-mail: privacy@boekbrug.nl
- Onderwerp: "Cookies: [jouw vraag]"

Volledige privacy-informatie: [Privacyverklaring](/privacy)

---

*BoekBrug — Minimale cookies, maximale privacy*
