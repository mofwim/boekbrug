# Privacyverklaring — BoekBrug

**Laatst bijgewerkt:** 25 mei 2026
**Versie:** 1.0

---

## 1. Wie zijn wij?

BoekBrug is een financieel workflow platform dat het brug vormt tussen ZZP'ers (freelancers) en hun accountants in Nederland.

**Verwerkingsverantwoordelijke:**
- **Naam:** [JOUW NAAM HIER]
- **Handelsnaam:** BoekBrug
- **Adres:** [JOUW ADRES IN TILBURG]
- **E-mail:** privacy@boekbrug.nl
- **KVK-nummer:** [INVULLEN ZODRA INGESCHREVEN]
- **BTW-nummer:** [INVULLEN ZODRA TOEGEKEND]

**Functionaris Gegevensbescherming (FG):**
BoekBrug is niet wettelijk verplicht een FG aan te stellen. Voor privacy-gerelateerde vragen kun je contact opnemen via privacy@boekbrug.nl.

---

## 2. Welke gegevens verwerken wij?

### 2.1 Accountgegevens
Wanneer je een account aanmaakt, verwerken wij:
- Volledige naam
- E-mailadres
- Telefoonnummer (optioneel)
- Voorkeurstaal (Nederlands, Engels, Arabisch, Turks)
- Wachtwoord (versleuteld opgeslagen, voor ons niet leesbaar)
- Rol (ZZP'er of Accountant)

### 2.2 Bedrijfsgegevens
Voor het correct opstellen van facturen:
- Bedrijfsnaam
- KVK-nummer
- BTW-nummer
- IBAN-rekeningnummer
- Bedrijfsadres (straat, postcode, plaats)

### 2.3 Klantgegevens (door jou ingevoerd)
- Naam en e-mailadres van jouw klanten
- Adres- en factuurgegevens
- KVK- en BTW-nummers van jouw klanten
- Facturatiegeschiedenis

### 2.4 Financiële gegevens
- Facturen (verzonden en ontvangen)
- Factuurregels en omschrijvingen
- Bedragen en BTW-percentages
- Betalingsstatus
- Bankafschriften (CAMT, PDF) die je vrijwillig uploadt

### 2.5 Gekoppelde e-mailaccounts (optioneel)
Als je Gmail of Outlook koppelt voor automatische factuurverwerking:
- E-mailadres van het gekoppelde account
- OAuth-tokens (versleuteld opgeslagen in Supabase Vault)
- Alleen factuur-gerelateerde berichten worden gelezen
- Je e-mailinhoud wordt NIET opgeslagen — alleen geclassificeerde bijlagen

### 2.6 Geüploade documenten
- PDF-facturen
- Afbeeldingen van bonnetjes
- Bankafschriften
- Alle bestanden die je via "Mijn bestanden" uploadt

### 2.7 Gebruiksgegevens
- IP-adres (alleen bij login en kritieke acties voor beveiliging)
- Browser type en versie
- Tijdstempel van handelingen
- Audit logs van financiële acties (verplicht voor wettelijke compliance)

### 2.8 Cookies
Wij gebruiken alleen functionele cookies en analytische cookies van Sentry (foutmonitoring). Geen tracking of marketing cookies. Zie ons [Cookiebeleid](/cookies) voor details.

---

## 3. Waarvoor gebruiken wij jouw gegevens?

### 3.1 Uitvoering van de overeenkomst (Art. 6(1)(b) AVG)
- Het beschikbaar stellen van het BoekBrug platform
- Het maken en verzenden van facturen
- Het beheren van jouw klanten
- Het koppelen met jouw accountant (alleen na expliciete goedkeuring)
- Het uploaden, opslaan en organiseren van documenten

### 3.2 Wettelijke verplichting (Art. 6(1)(c) AVG)
- **Bewaarplicht (Belastingdienst):** Financiële administratie wordt minimaal 7 jaar bewaard, conform Nederlandse fiscale wetgeving
- **Audit trail:** Voor compliance worden kritieke wijzigingen in financiële data gelogd
- **BTW-aangifte:** Gegevens worden voorbereid voor jouw kwartaalaangifte

### 3.3 Gerechtvaardigd belang (Art. 6(1)(f) AVG)
- Beveiliging van het platform tegen misbruik
- Foutmonitoring via Sentry voor productverbetering
- Het verbeteren van AI-classificatie van documenten
- Het versturen van service-gerelateerde berichten

### 3.4 Toestemming (Art. 6(1)(a) AVG)
- Verbinding met Gmail/Outlook (jij geeft expliciete toestemming via OAuth)
- AI-verwerking van bijlagen uit gekoppelde e-mail
- Het koppelen met een accountant (jij keurt elke koppeling expliciet goed)

Je kunt je toestemming op elk moment intrekken via Instellingen.

---

## 4. Met wie delen wij gegevens?

### 4.1 Jouw accountant (alleen na expliciete koppeling)
Wanneer je een accountant koppelt aan jouw account, krijgt deze accountant toegang tot:
- ✅ **Betaalde facturen** (status = 'paid')
- ✅ **Gedeelde documentmap**
- ❌ Concept-facturen blijven privé
- ❌ Persoonlijke notities blijven privé
- ❌ Niet-bevestigde inkomende facturen blijven privé

Je kunt de koppeling op elk moment verbreken. Alle data die de accountant verwerkte blijft beschikbaar in een archiefmap (verplicht volgens wet), maar nieuwe data is niet meer zichtbaar.

### 4.2 Subverwerkers (data processors)
Wij maken gebruik van de volgende vertrouwde subverwerkers:

| Subverwerker | Doel | Vestigingsland | DPA |
|--------------|------|----------------|-----|
| **Supabase Inc.** | Databasehosting, opslag, authenticatie | Verenigde Staten (EU-gegevenslocatie beschikbaar) | Standard Contractual Clauses (SCCs) |
| **Vercel Inc.** | Hosting van de webapplicatie | Verenigde Staten (EU edge) | Standard Contractual Clauses (SCCs) |
| **Anthropic PBC** | AI-classificatie van documenten via Claude API | Verenigde Staten | Standard Contractual Clauses (SCCs) |
| **Resend Inc.** | Versturen van transactionele e-mails | Verenigde Staten | Standard Contractual Clauses (SCCs) |
| **Sentry (Functional Software Inc.)** | Foutmonitoring | Verenigde Staten | Standard Contractual Clauses (SCCs) |
| **Google LLC** (alleen bij Gmail-koppeling) | OAuth en API-toegang | Verenigde Staten | Google Cloud DPA |
| **Microsoft Corporation** (alleen bij Outlook-koppeling) | OAuth en API-toegang | Verenigde Staten | Microsoft DPA |

Alle subverwerkers zijn gebonden aan AVG-conforme verwerkersovereenkomsten en gebruiken Standard Contractual Clauses voor doorgifte buiten de EU.

### 4.3 Wettelijke verplichting
Wij delen gegevens met overheden (bijv. Belastingdienst, Politie) uitsluitend wanneer wij hiertoe wettelijk verplicht zijn.

### 4.4 Wat wij NIET doen
- ❌ Wij verkopen jouw gegevens **nooit**
- ❌ Wij delen geen gegevens met marketing- of advertentiepartijen
- ❌ Wij gebruiken jouw data niet voor AI-modeltraining (Anthropic API met opt-out)
- ❌ Wij delen geen gegevens met andere klanten

---

## 5. Hoe lang bewaren wij gegevens?

| Type gegevens | Bewaartermijn | Reden |
|---------------|---------------|-------|
| Accountgegevens (actief) | Zolang account actief is | Uitvoering overeenkomst |
| Accountgegevens (na verwijdering) | 30 dagen daarna verwijderd | Veiligheidsbuffer |
| **Financiële administratie** | **7 jaar minimaal** | **Wettelijke bewaarplicht (Art. 52 AWR)** |
| Facturen (verzonden) | 7 jaar minimaal | Belastingdienst |
| Bonnetjes en bankafschriften | 7 jaar minimaal | Belastingdienst |
| Audit logs | 7 jaar | Compliance |
| OAuth-tokens (Gmail/Outlook) | Tot je de koppeling verbreekt | Toestemming |
| Cookies (functioneel) | Maximaal 1 jaar | Functionaliteit |
| Cookies (Sentry analytics) | Maximaal 90 dagen | Foutmonitoring |
| Sessie-tokens | 7 dagen | Beveiliging |

**Na de bewaartermijn:**
- Financiële gegevens worden door AI gemarkeerd als "kan wettelijk verwijderd worden"
- Jij beslist of je ze daadwerkelijk verwijdert — wij verwijderen nooit automatisch

---

## 6. Jouw rechten

Onder de AVG heb je de volgende rechten:

### 6.1 Recht op inzage (Art. 15)
Je kunt op elk moment opvragen welke gegevens wij van jou hebben. Vraag dit aan via privacy@boekbrug.nl. Wij reageren binnen 30 dagen.

### 6.2 Recht op rectificatie (Art. 16)
Onjuiste gegevens kun je zelf wijzigen via Instellingen, of via privacy@boekbrug.nl.

### 6.3 Recht op verwijdering (Art. 17)
Je kunt verzoeken om verwijdering van je account. **Let op:**
- Financiële gegevens blijven 7 jaar bewaard (wettelijke verplichting)
- Je account wordt gedeactiveerd, jij ziet niets meer
- Volledige data-export gebeurt verplicht vóór deactivatie

### 6.4 Recht op beperking (Art. 18)
Je kunt verzoeken om beperking van verwerking als je een onjuistheid betwist.

### 6.5 Recht op dataportabiliteit (Art. 20)
Je kunt al jouw data exporteren in machine-leesbaar formaat (CSV, JSON, UBL/XML).

### 6.6 Recht van bezwaar (Art. 21)
Je kunt bezwaar maken tegen verwerking op basis van gerechtvaardigd belang.

### 6.7 Recht om toestemming in te trekken
Voor toestemming-gebaseerde verwerking (zoals Gmail-koppeling).

### Hoe een verzoek indienen?
- E-mail: privacy@boekbrug.nl
- Onderwerp: "AVG-verzoek: [type verzoek]"
- Wij reageren binnen 30 dagen (verlengbaar met 60 dagen bij complexiteit)
- Je verzoek is gratis (tenzij overmatig of ongegrond)

---

## 7. Account verwijderen

Verwijdering van je BoekBrug-account is een meerstapsproces:

1. **Stap 1:** Verzoek tot verwijdering via Instellingen of e-mail
2. **Stap 2:** Verplichte volledige export van al je data (facturen, bestanden, klantgegevens)
3. **Stap 3:** Bevestigingsmail met overzicht van geëxporteerde data
4. **Stap 4:** Inloggegevens invoeren ter bevestiging
5. **Stap 5:** Account wordt gedeactiveerd — je hebt geen toegang meer
6. **Stap 6:** Financiële data blijft 7 jaar bewaard (wettelijk verplicht)
7. **Stap 7:** Na 7 jaar markeert AI de data als verwijderbaar — wij verwijderen niet automatisch

---

## 8. Beveiliging

Wij nemen de bescherming van jouw gegevens uiterst serieus:

### 8.1 Technische maatregelen
- **End-to-end encryptie** voor data in transit (HTTPS/TLS 1.3)
- **Encryption at rest** voor data in opslag (AES-256)
- **Vault-encryptie** voor gevoelige tokens (Gmail/Outlook OAuth)
- **Row-Level Security (RLS)** in de database — jij ziet alleen jouw data
- **Real-time foutmonitoring** via Sentry
- **Audit logging** voor alle financiële handelingen

### 8.2 Organisatorische maatregelen
- Toegang tot productiedata beperkt tot kritieke onderhoudssituaties
- Sterke wachtwoordvereisten
- Reguliere security reviews

### 8.3 Datalek
Bij een datalek:
- Wij melden binnen 72 uur aan de Autoriteit Persoonsgegevens (AP)
- Bij hoog risico voor jou: directe melding aan jou
- Volledige transparantie over wat is gebeurd en welke maatregelen genomen zijn

---

## 9. Internationale doorgifte

Sommige van onze subverwerkers zijn gevestigd buiten de EU (voornamelijk de VS).
- Alle doorgiften gebeuren onder **Standard Contractual Clauses (SCCs)**, goedgekeurd door de Europese Commissie
- Voor Supabase en Vercel kies wij waar mogelijk EU-datacenters
- Anthropic (Claude API) heeft een DPA met SCCs en biedt geen training op API-data

---

## 10. Kinderen onder 16

BoekBrug is een professioneel platform voor ondernemers. Wij accepteren bewust geen accounts van personen onder 16 jaar. Als wij ontdekken dat een account is aangemaakt door iemand onder 16, wordt deze direct verwijderd.

---

## 11. Wijzigingen aan deze verklaring

Wij kunnen deze privacyverklaring updaten:
- Bij significante wijzigingen sturen wij een e-mailmelding 30 dagen vooraf
- De laatste versie is altijd beschikbaar op boekbrug.nl/privacy
- Je gaat akkoord met wijzigingen door verder gebruik van het platform

---

## 12. Klachten

### 12.1 Bij ons
Als je een klacht hebt over de verwerking van jouw gegevens, neem dan eerst contact met ons op via privacy@boekbrug.nl. Wij doen ons best om binnen 7 dagen een oplossing aan te bieden.

### 12.2 Bij de Autoriteit Persoonsgegevens
Je hebt altijd het recht om een klacht in te dienen bij de toezichthouder:

**Autoriteit Persoonsgegevens**
Postbus 93374
2509 AJ Den Haag
Telefoon: 088 - 1805 250
Website: https://autoriteitpersoonsgegevens.nl

---

## 13. Contact

**Voor privacy-gerelateerde vragen:**
- E-mail: privacy@boekbrug.nl
- Onderwerp: "AVG/Privacy: [jouw vraag]"
- Reactietijd: maximaal 7 dagen

**Voor algemene support:**
- E-mail: support@boekbrug.nl

---

*BoekBrug — Niet één document raakt verloren*

*Deze privacyverklaring is opgesteld in overeenstemming met de AVG (Algemene Verordening Gegevensbescherming) en de Uitvoeringswet AVG (UAVG).*
