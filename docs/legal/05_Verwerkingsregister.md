# Register van Verwerkingsactiviteiten
## BoekBrug — Article 30 AVG Compliance

**Verwerkingsverantwoordelijke:** [JOUW NAAM] — BoekBrug
**KVK:** [INVULLEN]
**Versie:** 1.0
**Laatst bijgewerkt:** 25 mei 2026

---

> **Doel van dit register:**
> Voldoen aan Artikel 30 AVG — verplichte documentatie van alle verwerkingsactiviteiten van persoonsgegevens binnen BoekBrug.
> Dit document moet beschikbaar zijn voor de Autoriteit Persoonsgegevens (AP) op verzoek.

---

## Activiteit 1: Accountregistratie en -beheer

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Het beheren van gebruikersaccounts en het verlenen van toegang tot het Platform |
| **Rechtsgrondslag** | Uitvoering overeenkomst (Art. 6(1)(b) AVG) |
| **Categorieën betrokkenen** | ZZP'ers, Accountants |
| **Categorieën gegevens** | Naam, e-mail, telefoonnummer, wachtwoord (gehashed), rol, voorkeurstaal |
| **Categorieën ontvangers** | Supabase (auth provider), Vercel (hosting) |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | Actief tijdens accountleven + 30 dagen na deactivatie |
| **Beveiligingsmaatregelen** | TLS, bcrypt wachtwoordhashing, RLS, MFA optie |

---

## Activiteit 2: Bedrijfsgegevens en facturatie

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Het opstellen en verzenden van facturen, BTW-administratie |
| **Rechtsgrondslag** | Uitvoering overeenkomst + Wettelijke verplichting (bewaarplicht) |
| **Categorieën betrokkenen** | ZZP'ers en hun zakelijke klanten |
| **Categorieën gegevens** | Bedrijfsnaam, KVK, BTW-nummer, IBAN, adres, factuurregels, bedragen |
| **Categorieën ontvangers** | Supabase, e-mailontvangers (klanten), accountant (indien gekoppeld) |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | **Minimaal 7 jaar** (wettelijke bewaarplicht — Art. 52 AWR) |
| **Beveiligingsmaatregelen** | TLS, AES-256 at rest, RLS, audit logging |

---

## Activiteit 3: Klantgegevensbeheer

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Het beheren van klantencontacten van de ZZP'er |
| **Rechtsgrondslag** | Uitvoering overeenkomst (ZZP'er is verwerkingsverantwoordelijke voor eigen klanten) |
| **Categorieën betrokkenen** | Klanten van ZZP'ers |
| **Categorieën gegevens** | Naam, e-mail, adres, KVK, BTW-nummer, factuurgeschiedenis |
| **Categorieën ontvangers** | Supabase, accountant (alleen bij betaalde facturen) |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | Gekoppeld aan facturatieperiode (7 jaar bewaarplicht) |
| **Beveiligingsmaatregelen** | TLS, AES-256, RLS per ZZP'er |

---

## Activiteit 4: E-mailintegratie (Gmail/Outlook)

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Automatisch ophalen en classificeren van inkomende facturen |
| **Rechtsgrondslag** | Toestemming (Art. 6(1)(a) AVG) — via OAuth flow |
| **Categorieën betrokkenen** | ZZP'ers |
| **Categorieën gegevens** | E-mailadres, OAuth-tokens (versleuteld), bijlagen die als factuur classificeren |
| **Categorieën ontvangers** | Anthropic (AI-classificatie), Supabase Vault (tokens), Sentry (foutmonitoring) |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | Tokens: tot intrekking toestemming; bijlagen: 7 jaar bewaarplicht |
| **Beveiligingsmaatregelen** | OAuth 2.0, Vault encryption, scoped permissions (alleen factuur-mail) |

---

## Activiteit 5: AI-classificatie van documenten

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Automatisch herkennen en categoriseren van geüploade documenten |
| **Rechtsgrondslag** | Uitvoering overeenkomst (Platform-functionaliteit) |
| **Categorieën betrokkenen** | ZZP'ers (uploader) en personen genoemd in documenten |
| **Categorieën gegevens** | PDF/afbeelding-inhoud, geëxtraheerde tekst, classificatie |
| **Categorieën ontvangers** | Anthropic (Claude API) |
| **Doorgifte buiten EU** | Ja — naar Anthropic in VS via SCCs |
| **Bewaartermijn** | Inhoud niet bewaard door Anthropic (no-training agreement); resultaat 7 jaar |
| **Beveiligingsmaatregelen** | TLS, Anthropic enterprise DPA, opt-out van AI-training |

---

## Activiteit 6: Bestandsopslag (Mijn bestanden)

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Opslag van facturen, bonnetjes en bankafschriften |
| **Rechtsgrondslag** | Uitvoering overeenkomst + Wettelijke bewaarplicht |
| **Categorieën betrokkenen** | ZZP'ers en personen in geüploade documenten |
| **Categorieën gegevens** | Bestandsinhoud (PDF, JPG, PNG, etc.), metadata, bestandstypes |
| **Categorieën ontvangers** | Supabase Storage, accountant (alleen gedeelde map) |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | 7 jaar bewaarplicht |
| **Beveiligingsmaatregelen** | TLS, AES-256, RLS-policies per gebruiker, signed URLs voor toegang |

---

## Activiteit 7: Accountant-koppeling

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Het delen van financiële administratie tussen ZZP'er en accountant |
| **Rechtsgrondslag** | Toestemming van ZZP'er (Art. 6(1)(a) AVG) |
| **Categorieën betrokkenen** | ZZP'ers, hun klanten, accountants |
| **Categorieën gegevens** | Betaalde facturen, gedeelde documentmap, factuurregels |
| **Categorieën ontvangers** | Gekoppelde accountant |
| **Doorgifte buiten EU** | Nee (alleen tussen Nederlandse partijen op Platform) |
| **Bewaartermijn** | Tot intrekking koppeling; daarna archief voor accountant 7 jaar |
| **Beveiligingsmaatregelen** | RLS-policies, expliciete uitnodigingsflow, archief-isolatie bij ontkoppeling |

---

## Activiteit 8: Audit logging (compliance)

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Naleving wettelijke verplichtingen en frauddetectie |
| **Rechtsgrondslag** | Wettelijke verplichting + Gerechtvaardigd belang |
| **Categorieën betrokkenen** | Alle gebruikers |
| **Categorieën gegevens** | User ID, actie (invoice.created, etc.), tijdstempel, IP, oude/nieuwe waardes |
| **Categorieën ontvangers** | Alleen interne toegang voor compliance |
| **Doorgifte buiten EU** | Ja — naar VS (Supabase) via SCCs |
| **Bewaartermijn** | 7 jaar |
| **Beveiligingsmaatregelen** | Append-only via service_role, geen gebruikersbewerking mogelijk |

---

## Activiteit 9: Foutmonitoring (Sentry)

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Detectie en oplossing van technische fouten |
| **Rechtsgrondslag** | Gerechtvaardigd belang (Art. 6(1)(f) AVG) |
| **Categorieën betrokkenen** | Alle gebruikers |
| **Categorieën gegevens** | User ID (alleen), browsergegevens, foutdetails, stack traces |
| **Categorieën ontvangers** | Sentry (Functional Software Inc.) |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | 90 dagen |
| **Beveiligingsmaatregelen** | Geen PII in error context, scrubbing van gevoelige data |

---

## Activiteit 10: Transactionele e-mails

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Verzenden van facturen aan klanten, account-notificaties |
| **Rechtsgrondslag** | Uitvoering overeenkomst |
| **Categorieën betrokkenen** | ZZP'ers, klanten van ZZP'ers, accountants |
| **Categorieën gegevens** | E-mailadres, naam, bedrag, factuurnummer, IBAN |
| **Categorieën ontvangers** | Resend (e-mailservice), e-mailontvangers |
| **Doorgifte buiten EU** | Ja — naar VS via SCCs |
| **Bewaartermijn** | Logs 30 dagen bij Resend; inhoud bij BoekBrug volgens bewaarplicht |
| **Beveiligingsmaatregelen** | TLS voor verzending, SPF/DKIM/DMARC, geen gevoelige data in body |

---

## Activiteit 11: Betalingsverwerking

| Aspect | Beschrijving |
|--------|--------------|
| **Doel verwerking** | Afhandeling van abonnementsbetalingen |
| **Rechtsgrondslag** | Uitvoering overeenkomst |
| **Categorieën betrokkenen** | Betalende gebruikers |
| **Categorieën gegevens** | Naam, e-mail, bankgegevens (verwerkt door Stripe — niet door BoekBrug opgeslagen) |
| **Categorieën ontvangers** | Stripe (betalingsverwerker) |
| **Doorgifte buiten EU** | Ja — naar VS via Stripe DPA |
| **Bewaartermijn** | Conform Stripe bewaartermijn (typisch 7 jaar) |
| **Beveiligingsmaatregelen** | PCI-DSS compliant via Stripe, geen kaartgegevens bij BoekBrug |

---

## Beveiliging — Overzicht TOM's (Technische en Organisatorische Maatregelen)

### Technisch
1. ✅ HTTPS/TLS 1.3 voor alle verbindingen
2. ✅ AES-256 encryption at rest
3. ✅ Bcrypt voor wachtwoordhashing
4. ✅ Supabase Vault voor gevoelige tokens (Gmail/Outlook)
5. ✅ Row-Level Security (RLS) op database-niveau
6. ✅ Service_role isolatie voor systeemoperaties
7. ✅ Rate limiting op kritieke endpoints
8. ✅ Audit logging van financiële handelingen
9. ✅ Real-time foutmonitoring (Sentry)
10. ✅ Automatische sessie-timeout
11. ✅ Search input sanitization (escapeSearchTerm)
12. ✅ CSRF-bescherming via Next.js

### Organisatorisch
1. ✅ Privacy-by-design en privacy-by-default
2. ✅ Beperkte toegang tot productiedata
3. ✅ Documentatie van verwerkingsactiviteiten (dit document)
4. ✅ Privacybeleid en transparante communicatie
5. ✅ DPA met alle subverwerkers
6. ✅ Datalek-responseprocedure (zie sectie hieronder)
7. ✅ Reguliere security reviews

---

## Datalek-procedure

### Detectie
- Automatische detectie via Sentry en Supabase logs
- Meldingen van gebruikers via support@boekbrug.nl
- Reguliere reviews van audit logs

### Beoordeling (binnen 1 uur)
- Type lek vaststellen (toegang, wijziging, verlies)
- Omvang inschatten (aantal records, type data)
- Risico voor betrokkenen bepalen

### Containment (binnen 4 uur)
- Toegang blokkeren waar mogelijk
- Compromised credentials roteren
- Vault-secrets vervangen indien nodig

### Notificatie

**Aan AP (Autoriteit Persoonsgegevens):**
- Binnen 72 uur na ontdekking
- Via meldpunt: https://datalekken.autoriteitpersoonsgegevens.nl
- Documenteren in interne logs

**Aan betrokkenen:**
- Bij hoog risico: direct
- Heldere communicatie: wat is gebeurd, wat doen we, wat kunnen zij doen

**Aan Accountants (indien hun klanten betrokken):**
- Binnen 24 uur na ontdekking
- Via persoonlijke e-mail naar contactpersoon

### Documentatie
Alle incidenten worden gelogd met:
- Tijdstip ontdekking
- Aard van het incident
- Genomen maatregelen
- Tijdlijn van resolutie
- Geleerde lessen voor toekomst

---

## Contact

**Voor AP of compliance-vragen:**
- E-mail: privacy@boekbrug.nl
- Reactietijd: binnen 7 dagen (kritieke vragen: 24 uur)

**Verantwoordelijke voor dit register:**
- Naam: [JOUW NAAM]
- Functie: Verwerkingsverantwoordelijke / Eigenaar BoekBrug
- E-mail: privacy@boekbrug.nl

---

*Dit register wordt jaarlijks gereviewed en aangepast bij wijzigingen in verwerkingsactiviteiten.*
