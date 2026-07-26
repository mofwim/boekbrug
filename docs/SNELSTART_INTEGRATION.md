# SnelStart-koppeling (B2B-API v2)

_Juli 2026 — status: geïmplementeerd, wacht op een subscription key om live te gaan._

SnelStart is het boekhoudpakket dat onze doelgroep — kleine handelaren en de boekhouders
die hen bedienen — het meest gebruikt. Deze koppeling brengt BoekBrug van "exportbestand
dat iemand handmatig importeert" naar **online**: een gecontroleerde factuur wordt met één
klik een inkoop- of verkoopboeking in de administratie van de gebruiker.

---

## 1. Wat je nodig hebt

| Geheim | Van wie | Waar het staat | Levensduur |
| --- | --- | --- | --- |
| **Subscription key** | van ons, per applicatie | `SNELSTART_SUBSCRIPTION_KEY` (env, server-only) | permanent |
| **Maatwerksleutel** (clientkey) | van de gebruiker, per administratie | Supabase Vault (`snelstart_connections.client_key_secret_id`) | tot de gebruiker hem intrekt |
| **Access token** | afgeleid | alleen in het geheugen van het proces | ± 1 uur |

De subscription key vraag je aan op <https://b2bapi-developer.snelstart.nl>. **Zonder die
key is de koppeling onzichtbaar**: `/api/snelstart/status` meldt `configured: false` en de
kaart op Instellingen verbergt zichzelf. Er is dus nooit een knop die per definitie niet
kan werken.

De gebruiker maakt zijn eigen maatwerksleutel in SnelStart onder **Onderhoud → Maatwerk**.
Die sleutel hoort bij één administratie; een gebruiker met meerdere administraties koppelt
er dus één (dat is bewust: één administratie per BoekBrug-account houdt de boekingen
eenduidig).

## 2. Authenticatie

```
POST https://auth.snelstart.nl/b2b/token
Content-Type: application/x-www-form-urlencoded

grant_type=clientkey&clientkey={maatwerksleutel}
```

→ `{ "access_token": "...", "token_type": "bearer", "expires_in": 3600 }`

Elk volgend verzoek naar `https://b2bapi.snelstart.nl/v2/...` draagt **beide** geheimen:

```
Authorization: Bearer {access_token}
Ocp-Apim-Subscription-Key: {subscription key}
```

Het token wordt per proces gecachet (`snelstart-client.ts`), met een minuut marge voor het
verloopt. Een batch van vijftig facturen doet dus één token-ronde, niet vijftig. Bij een
401 wordt het gecachete token direct weggegooid — anders loopt elke volgende factuur in
dezelfde instantie op hetzelfde dode token stuk.

## 3. De onderdelen

| Bestand | Rol |
| --- | --- |
| `src/lib/snelstart-client.ts` | alles wat het netwerk raakt: token, headers, foutvertaling, endpoints |
| `src/lib/snelstart-mapping.ts` | pure vertaling factuur → boeking (geen netwerk, volledig getest) |
| `src/lib/snelstart-connection.ts` | opslag van de koppeling + de sleutel in Vault |
| `src/lib/snelstart-queue.ts` | wat staat er klaar om door te sturen (één waarheid voor teller én push) |
| `src/app/api/snelstart/*` | `status`, `connect` (POST/PATCH), `grootboeken`, `push`, `disconnect` |
| `src/components/settings/SnelStartCard.tsx` | de kaart op Instellingen |
| `supabase/migrations/snelstart_connection.sql` | `snelstart_connections` + `snelstart_exports` |

## 4. De boekhoudkundige regels

Deze vier staan vast in `snelstart-mapping.ts` en zijn getest in
`snelstart-mapping.test.ts`. Elk ervan zet bij een fout een onwaarheid in een échte
administratie:

1. **Alleen feiten gaan mee.** Uitgaand: `sent`, `paid`, `overdue`. Inkomend: `received`,
   `processed`, `paid`. Alleen `factuur` en `creditnota` — een offerte, pro forma of
   concept is geen boeking.
2. **Het BTW-soort wordt nooit geraden.** SnelStart heeft per administratie eigen
   BTW-tarieven met eigen namen. Wij halen `/v2/btwtarieven` op en zoeken op percentage.
   Geen match → de factuur blijft staan met een duidelijke melding, in plaats van geboekt
   te worden met een verkeerd tarief. Bij twee tarieven op hetzelfde percentage wint de
   gewone variant: verleggen is een keuze van de ondernemer, geen afleiding van een automaat.
3. **De optelling moet kloppen.** Σ boekingsregels + Σ BTW = factuurbedrag. Een cent
   afrondingsruis wordt op de grootste regel gecorrigeerd; meer dan twee cent is een fout
   (`AMOUNT_MISMATCH`) en blokkeert de boeking.
4. **Een creditnota is het spiegelbeeld.** Zelfde boeking, alle bedragen negatief.

Verklaren de factuurregels het kopbedrag niet (verschil > 2 cent), dan wint de kop en gaat
er één regel mee. De kop is namelijk gecontroleerd bij het boeken; losse regels uit een
OCR-lezing niet altijd.

## 5. Vorm van een boeking

`POST /v2/inkoopboekingen` (of `/v2/verkoopboekingen`):

```jsonc
{
  "leverancier": { "id": "<relatie-uuid>" },   // bij verkoop: "klant"
  "factuurnummer": "2026-001",
  "factuurDatum": "2026-04-12T00:00:00",
  "vervalDatum": "2026-05-12T00:00:00",
  "omschrijving": "Factuur 2026-001 — Bakkerij Jansen",
  "factuurBedrag": 121.00,                      // INCL. BTW, negatief bij creditnota
  "boekingsregels": [
    { "omschrijving": "Advies", "bedrag": 100.00, "btwSoort": "Hoog", "grootboek": { "id": "<uuid>" } }
  ],
  "btw": [{ "btwSoort": "Hoog", "btwBedrag": 21.00 }]
}
```

De relatie wordt eerst opgezocht (`GET /v2/relaties?$filter=naam eq '…' and
relatiesoort/any(s: s eq 'Leverancier')`) en alleen aangemaakt als ze nog niet bestaat —
anders staat dezelfde leverancier straks dubbel in het relatiebestand. Namen met een
apostrof worden ge-escaped (`''`), zodat een naam de OData-filter niet kan openbreken.

De grootboekrekening komt uit de keuze van de gebruiker (`inkoop_grootboek_id` /
`verkoop_grootboek_id`); zonder die keuze weigert de push-route met `NO_GROOTBOEK`.

## 6. Idempotentie

Elke poging krijgt een rij in `snelstart_exports`. Een **partiële unique index**
(`WHERE status = 'pushed'`) maakt een tweede geslaagde boeking van dezelfde factuur
onmogelijk — het slot ligt in de database, niet in de applicatiecode, en houdt dus ook
stand bij twee gelijktijdige verzoeken. Mislukte pogingen mogen opnieuw en overschrijven
de vorige mislukking van die factuur.

Ontkoppelen wist de sleutel en de koppelrij, maar **niet** het duw-logboek: anders zou
opnieuw koppelen alles nog een keer boeken.

## 7. Foutafhandeling

| Code | Betekenis | Wat er gebeurt |
| --- | --- | --- |
| `INVALID_KEY` / `FORBIDDEN` | sleutel afgewezen | koppeling → `needs_reauth`, batch stopt, UI vraagt om een nieuwe sleutel |
| `RATE_LIMITED` | 429 (met `Retry-After`) | batch stopt, de rest blijft klaarstaan |
| `SERVER` / `NETWORK` | SnelStart plat / geen verbinding | batch stopt, niets gaat verloren |
| `VALIDATION` | SnelStart wijst de boeking inhoudelijk af | die factuur faalt, de rest gaat door |
| mapping-codes | onze eigen controles | die factuur faalt met een Nederlandse uitleg |

De token-endpoint antwoordt op een ingetrokken sleutel met **400** (OAuth `invalid_grant`),
niet met 401. Die 400 wordt daarom als `INVALID_KEY` behandeld: de gebruiker moet een
nieuwe sleutel maken, niet zijn factuurgegevens controleren.

## 8. Grenzen (bewust, nu nog niet gebouwd)

- **Eén richting.** Wij duwen boekingen naar SnelStart; we halen er niets uit terug
  (geen betaalstatus, geen mutaties).
- **Geen bijlagen.** De PDF blijft in BoekBrug; `documents` op de boeking is niet gevuld.
- **Eén administratie per gebruiker**, en één vaste grootboekrekening voor inkoop en één
  voor verkoop — nog geen kostensoort per leverancier of categorie.
- **Geen automatische push.** De gebruiker drukt zelf op de knop. Een cron die ongemerkt
  boekt is te veel macht voor een eerste versie.

## 9. Aanzetten in productie

1. Vraag de subscription key aan in het SnelStart developer-portal.
2. Zet `SNELSTART_SUBSCRIPTION_KEY` in Vercel (alle omgevingen waar de koppeling mag werken).
3. Draai `supabase/migrations/snelstart_connection.sql` (zie `docs/apply-migrations.md`).
4. Controleer met één testadministratie: koppelen → rekeningen kiezen → één factuur
   doorsturen → in SnelStart terugvinden onder Inkoop-/Verkoopboekingen.

## 10. Tests

```bash
npx tsx --test src/lib/snelstart-mapping.test.ts src/lib/snelstart-client.test.ts
```

De client-tests draaien met een geïnjecteerde `fetch`: geen netwerk, geen sleutels.
