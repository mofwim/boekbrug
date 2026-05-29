# BoekBrug Legal Package — README
## Volledige juridische infrastructuur voor v1.0 launch

**Status:** ✅ Complete — klaar voor implementatie
**Versie:** 1.0
**Datum:** 25 mei 2026

---

## 📦 Wat zit er in dit package?

```
legal/
├── 00_README.md                          ← Dit document
├── 01_Privacyverklaring.md               ← Voor /privacy pagina
├── 02_Algemene_Voorwaarden.md            ← Voor /voorwaarden pagina
├── 03_Cookiebeleid.md                    ← Voor /cookies pagina
├── 04_Verwerkersovereenkomst_DPA.md      ← Voor accountants (template)
├── 05_Verwerkingsregister.md             ← Intern document (AP-vereiste)
└── 06_Implementation_Guide.md            ← Hoe in code implementeren
```

---

## ⚠️ BELANGRIJK: Lees dit eerst

### Wat dit package WEL is:
- ✅ Complete legal foundation voor MVP launch
- ✅ AVG/GDPR-conform voor Nederlands SaaS
- ✅ Gebaseerd op huidige BoekBrug architectuur
- ✅ Klaar voor implementatie

### Wat dit package NIET is:
- ❌ Vervanging van professioneel juridisch advies
- ❌ Garantie tegen alle juridische risico's
- ❌ Maatwerk voor jouw specifieke situatie

### Wanneer wel professioneel advies?
- 🔴 Bij eerste echte klant (€200-300 review bij ICTRecht)
- 🔴 Bij 50+ paying users (€1,000-1,500 volledige audit)
- 🔴 Bij specifieke vragen of disputen
- 🔴 Bij internationale expansie

---

## 📋 Snelle Start — 5 stappen

### Stap 1: Vul je bedrijfsgegevens in
Open elk document en vul in op de gemarkeerde plaatsen `[INVULLEN]`:
- Je volledige naam
- KVK-nummer (zodra ingeschreven)
- BTW-nummer (zodra toegekend)
- Bedrijfsadres in Tilburg

### Stap 2: Maak e-mail adressen aan
Bij je e-mailprovider (Hostnet, TransIP, etc.):
- privacy@boekbrug.nl
- support@boekbrug.nl
- legal@boekbrug.nl

### Stap 3: Teken DPAs met providers
- Supabase: https://supabase.com/dashboard → Settings → Legal
- Vercel: https://vercel.com/dashboard → Settings → Legal
- Anthropic: bevestig no-training in API settings

### Stap 4: Implementeer in code
Volg `06_Implementation_Guide.md` stap voor stap:
- Maak `/privacy`, `/voorwaarden`, `/cookies` pagina's
- Voeg footer toe
- Voeg cookie banner toe
- Update registratieflow

### Stap 5: Test alles
- Test cookie banner op verschillende browsers
- Test data export functionaliteit
- Test account deletion flow
- Test alle consent flows

---

## 🎯 Wat dekt dit package?

### AVG/GDPR-compliance
✅ Artikel 13/14 — Informatieverplichting (Privacyverklaring)
✅ Artikel 6 — Rechtsgrondslagen (gedocumenteerd)
✅ Artikel 28 — Verwerkers (DPA met subverwerkers)
✅ Artikel 30 — Verwerkingsregister
✅ Artikel 32 — Beveiliging (technisch en organisatorisch)
✅ Artikel 33/34 — Datalekprocedure
✅ Artikelen 15-22 — Rechten van betrokkenen

### Nederlandse wetgeving
✅ Uitvoeringswet AVG (UAVG)
✅ Bewaarplicht 7 jaar (Art. 52 AWR)
✅ Factuurnummering (Art. 35 Wet OB 1968)
✅ Burgerlijk Wetboek (overeenkomstenrecht)

### Specifiek voor BoekBrug
✅ Gmail/Outlook OAuth flow
✅ AI-verwerking (Anthropic Claude)
✅ Accountant-koppeling consent
✅ Vault-encryption (tokens)
✅ Row-Level Security

---

## 💰 Kostenoverzicht

### Wat dit package kost je (eenmalig):
- **€0** — Alle documenten zijn opgesteld

### Wat je nodig hebt voor compliance:
- **€20-30/jaar** — Cookie banner service (CookieYes optioneel, zelf bouwen is ook OK)
- **€0** — Supabase + Vercel DPAs (inbegrepen)
- **€0** — Anthropic DPA (inbegrepen)

### Aanbevolen toekomstige investering:
- **€200-300** — ICTRecht review bij 20+ users (eenmalig)
- **€1,000-1,500** — Volledige juridische audit bij 200+ users
- **€50/maand** — Cyber insurance (vanaf 100+ users)

**Totale kosten voor launch: €0-30**

---

## 📊 Compliance Matrix

| Vereiste | Wettelijke basis | Status in BoekBrug | Document |
|----------|------------------|---------------------|----------|
| Privacyverklaring publiceren | Art. 13 AVG | ✅ Klaar | 01 |
| Algemene voorwaarden | Burgerlijk Wetboek | ✅ Klaar | 02 |
| Cookiebeleid | ePrivacy Directive | ✅ Klaar | 03 |
| DPA met klanten (accountants) | Art. 28 AVG | ✅ Template klaar | 04 |
| Verwerkingsregister | Art. 30 AVG | ✅ Klaar | 05 |
| Toestemming bij registratie | Art. 7 AVG | ✅ Implementatie in guide | 06 |
| Cookie consent | ePrivacy + AVG | ✅ Implementatie in guide | 06 |
| Datalek procedure | Art. 33/34 AVG | ✅ In verwerkingsregister | 05 |
| Recht op inzage/verwijdering | Art. 15-17 AVG | ✅ Implementatie in guide | 06 |
| Recht op dataportabiliteit | Art. 20 AVG | ✅ Export functie in guide | 06 |
| Bewaarplicht 7 jaar | Art. 52 AWR | ✅ Gedocumenteerd | 01, 02 |

---

## 🚦 Implementatie Status Tracker

Print of kopieer dit naar je projectboard:

### 🔴 Critical (vóór eerste echte klant)
- [ ] Privacyverklaring online (/privacy)
- [ ] Algemene Voorwaarden online (/voorwaarden)
- [ ] Cookiebeleid online (/cookies)
- [ ] Footer met legal links op alle pagina's
- [ ] Cookie banner geïmplementeerd
- [ ] Consent checkboxes op /register
- [ ] Bedrijfsgegevens ingevuld in alle docs
- [ ] E-mail addressen aangemaakt
- [ ] Supabase + Vercel DPAs getekend

### 🟡 Important (vóór 10 paying users)
- [ ] Data export functionaliteit (`/api/account/export`)
- [ ] Account deletion flow (multi-stap)
- [ ] Verwerkersovereenkomst beschikbaar voor accountants
- [ ] Settings pagina met privacy controls
- [ ] Consent flow voor accountant-koppeling
- [ ] Audit logs voor consent events

### 🟢 Nice to have (vóór 50 paying users)
- [ ] ICTRecht review (€200-300)
- [ ] AP-registratie (optioneel maar aanbevolen)
- [ ] Cookie banner met granulaire controls
- [ ] Multi-language legal pages
- [ ] Backup van legal documenten

---

## 🆘 Veelgestelde vragen

### V: Is dit genoeg om te launchen?
**A:** Ja, voor MVP launch met Nederlandse gebruikers. Voor enterprise klanten of internationale expansie heb je meer nodig.

### V: Heb ik een juridisch advies nodig?
**A:** Niet voor launch, maar wel aanbevolen zodra je echte (paying) klanten hebt. Een review van €200-300 bij ICTRecht geeft peace of mind.

### V: Wat als ik gevraagd word om een DPA met een accountant?
**A:** Stuur ze `04_Verwerkersovereenkomst_DPA.md`. Het is een professionele template die zou moeten voldoen.

### V: Moet ik registreren bij de Autoriteit Persoonsgegevens?
**A:** Niet verplicht voor jouw situatie, maar wel aanbevolen vanaf 50+ users. Het is gratis en geeft serieusheid.

### V: Wat als er een datalek is?
**A:** Volg de procedure in `05_Verwerkingsregister.md` sectie "Datalek-procedure". Belangrijkste: meld binnen 72 uur aan AP.

### V: Kan ik deze documenten aanpassen?
**A:** Ja, ze zijn voor jou. Update versie-nummers bij significante wijzigingen. Bij grote wijzigingen: informeer gebruikers 30 dagen vooraf.

### V: Wat als ik buiten Nederland uitbreid?
**A:** Bel ICTRecht of een internationale privacy specialist. Elk land heeft eigen eisen.

---

## 📞 Contact en Support

**Bij vragen over dit package:**
- Lees eerst het Implementation Guide (`06_Implementation_Guide.md`)
- Voor specifieke vragen: privacy@boekbrug.nl (zodra opgezet)

**Voor professioneel advies:**
- **ICTRecht** — https://www.ictrecht.nl
- **Considerati** — https://considerati.com
- **DLA Piper** — https://www.dlapiper.com (voor grote zaken)

**Voor AP-vragen:**
- **Autoriteit Persoonsgegevens** — https://autoriteitpersoonsgegevens.nl

---

## ✨ Tot slot

Dit package is gemaakt om BoekBrug op een **professionele, AVG-conforme** manier te lanceren — zonder grote investering in juridische diensten.

De grootste fout die SaaS-startups maken: **maandenlang wachten met legal** omdat het "ingewikkeld lijkt".

Met dit package kun je **vandaag** beginnen.

**Volgende stap:** Open `06_Implementation_Guide.md` en begin met Dag 1.

---

*BoekBrug — Niet één document raakt verloren*
*Begin klein. Bouw veilig. Groei verantwoord.*

🛡️ Veel succes!
