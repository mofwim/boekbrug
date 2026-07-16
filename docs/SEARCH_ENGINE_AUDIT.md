# BoekBrug — Zoekmachine: Audit, Plan & Wijzigingen

> **Scope:** uitsluitend **zoeken** (search). Er is bewust niets buiten de zoekfunctie
> aangepast. Alle bevindingen komen uit code- en DB-onderzoek (`database.sql`,
> `supabase/migrations/*`, de betrokken componenten) — niet uit aannames.
> Onderzoek uitgevoerd door 3 parallelle audit-agents (backend/DB, per-pagina
> filters, resultaat-bedrading/UX/a11y) + handmatige dubbelcheck van elke kritieke claim.

Datum: 2026-07-15 · Branch: `claude/app-search-system-6i1zg2`

---

## 1. Hoe zoeken vandaag werkt

- **Globale zoekbalk** (`src/components/search/SearchBar.tsx`) → hook
  `src/hooks/useSearch.ts` → API `src/app/api/search/route.ts`.
- De API doet **`ILIKE '%term%'`** over meerdere kolommen (cartesisch product
  velden × termen) op `invoices`, `invoice_lines`, `documents`, en (alleen
  accountant) `profiles`. Draait op de **anon-key + user-cookies** client, dus
  **RLS geldt** op elke query (`src/lib/supabase-server.ts:18-19`).
- Daarnaast bestaan **losse** filter/zoekvakjes per pagina (facturen, bestanden,
  bank, klanten, artikelen, factuur-formulier).

---

## 2. Bevindingen (genummerd, met bestand:regel)

### A. Bedrading van resultaten — **de zoekfunctie is end-to-end kapot**
1. **Globale balk staat op één pagina.** `<SearchBar/>` wordt alleen gerenderd in
   `DashboardHeader` (`src/app/dashboard/_shared/index.tsx:586`), die enkel door
   `ZzpDashboard` (`/dashboard`) wordt gebruikt. Op facturen/bestanden/klanten en
   alle subpagina's is er geen zoekbalk. → *aanbeveling, niet in deze PR aangepast (layout-risico)*.
2. **Alle resultaat-links wezen naar dode parameters.** De API gaf
   `?highlight=` (facturen/klanten), `?file=` (bestanden) en Enter gaf
   `?search=` (facturen). **Geen enkele doelpagina las die parameters** — die
   lezen `?focus=` (+ `?folder=`). Elke klik landde dus op de kale sectiepagina
   zonder highlight. *(FacturenClient.tsx:120 leest `focus`; BestandenPage.tsx:277-278
   leest `folder`+`focus`; KlantenClient las niets.)*
3. **Klant-resultaten onbereikbaar.** De API gaf klant-resultaten alleen voor
   `role==='accountant'` (route.ts:132-141), maar de balk staat alleen in de
   zzper-shell → de rol die klanten kan opleveren heeft geen UI, en de rol met UI
   krijgt nooit klanten. Bovendien werd de eigen `clients`-tabel van een zzper
   **nooit** doorzocht.

### B. Backend correctheid & veiligheid
4. **`.or()`-injectie / breuk op leestekens.** Ruwe query werd in de PostgREST
   `.or(...)`-string geïnterpoleerd (`buildOr`, route.ts:23-27; ook
   `bestanden.ts:546`). Een komma, `(`, `)`, `%` of `_` breekt of verandert de
   filter-grammatica. **Kritiek.**
5. **Bedrag zoeken werkt niet op NL-invoer.** DB slaat `total_inc_btw` op als
   `1500.00`; een gebruiker typt `1.500,00` of `1.500`. `normalizeQuery` splitst
   op `.`/`,` → `%1.500%` matcht nooit `1500.00` (route.ts:15-20, 108).
6. **Losse cijfers vervuilen resultaten.** `\d+` liet termen als `"1"`/`"500"` toe
   (geen minimale lengte) → `%500%` matcht willekeurige nummers/bedragen
   (route.ts:17).
7. **Volledige multi-woord query als term** is bijna nooit een match — verspilde
   OR-predicaat op elke query (route.ts:19).
8. **Verwijderde (trashed) documenten** verschenen in resultaten — geen
   `trashed=false` filter (route.ts:120-129).
9. **Inkomende/ontvangen facturen onvindbaar.** `invoices` werd gefilterd op
   alleen `sender_id` (route.ts:104); RLS staat ook `receiver_id` toe. Facturen
   waar de gebruiker ontvanger is (leveranciersfacturen) waren nooit vindbaar.

### C. Prestaties
10. **Elke zoekopdracht is een sequential scan.** Alle `ILIKE '%term%'` zijn
    *leading-wildcard* → B-tree helpt niet. Er was **geen `pg_trgm`/GIN-trigram**
    index. `invoice_lines` had zelfs geen enkele index (ook niet op de FK
    `invoice_id`). De bestaande `search_vector` (tsvector) GIN-indexen op
    `invoices`/`documents` werden **niet** gebruikt door de API.

### D. Front-end / UX / toegankelijkheid
11. **Fout-status werd nooit getoond.** `useSearch` levert `error`, maar
    `SearchBar` las die niet uit → een backend/netwerk-fout toonde
    "Geen resultaten" (SearchBar.tsx:419).
12. **`Highlight` markeerde inconsistent.** Stateful `/g`-regex + `re.test()`
    binnen `.map()` → `lastIndex` schoof door, verkeerde delen ge-markeerd
    (SearchBar.tsx:57-61).
13. **"Recente zoekopdrachten" bewaarde de resultaat-titel** (factuurnummer /
    bestandsnaam) i.p.v. wat de gebruiker typte (SearchBar.tsx:507).
14. **A11y:** geen `aria-activedescendant`/optie-`id`s → toetsenbordselectie werd
    niet aangekondigd; combobox had geen `aria-controls`.
15. **Per-pagina zoekvakjes inconsistent:** geen accent-vouwing (café ≠ cafe), geen
    debounce (behalve bestanden 300ms), en client-side filters zien alleen de al
    geladen rijen. Facturen had **helemaal geen** tekstzoek. Bank-placeholder
    belooft "bedrag" maar zoekt daar niet op.

---

## 3. Plan & wat er in deze PR is gedaan

Doel: de zoekmachine **werkend, correct, veilig en snel** maken — alleen zoeken.

| # | Wijziging | Bestand |
|---|-----------|---------|
| 1 | **Trigram-indexen + `pg_trgm`** zodat elke `ILIKE '%..%'` index-gedekt is (perf). | `supabase/migrations/search_engine.sql` (+ `database.sql`, `apply-migrations.md`) |
| 2 | **API herschreven:** term-sanitatie voor `.or()`, min. cijferlengte, NL-bedrag-normalisatie, `trashed=false`, ontvangen facturen mee (`sender_id` **of** `receiver_id`), **zzper doorzoekt eigen `clients`-tabel**, en **correcte `?focus=`/`?folder=` links**. | `src/app/api/search/route.ts` |
| 3 | **SearchBar:** foutmelding tonen, `Highlight`-bug gefixt, recente = getypte query, Enter opent top-resultaat, `aria-activedescendant` + optie-`id`s. | `src/components/search/SearchBar.tsx` |
| 4 | **Klanten:** leest nu `?focus=` (scroll+highlight) en filtert op meer velden met accent-vouwing. | `src/app/dashboard/klanten/KlantenClient.tsx` |
| 5 | **Facturen:** leest nu `?search=` en heeft een tekstzoekveld (snelfilter op factuurnummer/klantnaam). | `src/app/dashboard/facturen/FacturenClient.tsx` |
| 6 | **Bestanden-zoek:** zelfde `.or()`-sanitatie als de API (komma/haakjes/wildcards braken de query). | `src/lib/bestanden.ts` |
| 7 | **Mappen doorzoekbaar:** zoeken toont nu ook mappen (op naam), klikbaar om te openen. | `src/lib/bestanden.ts`, `src/app/api/bestanden/route.ts`, `src/app/dashboard/bestanden/BestandenPage.tsx` |
| 8 | **Bankfilter eerlijk:** doorzoekt nu écht het **bedrag** (placeholder beloofde dat al) + accent-vouwing op naam/referentie. | `src/app/dashboard/bank/BankClient.tsx` |
| 9 | **Accent-vouwing** in artikelen, factuur-artikelpicker en factuur-klantpicker ("café" ↔ "cafe"); klantpicker doorzoekt ook KVK. | `src/lib/articles.ts`, `src/app/dashboard/artikelen/ArtikelenClient.tsx`, `src/app/dashboard/invoice/new/page.tsx` |
| 10 | **Slimme laag — relevantie-ranking** (exact > prefix > woordgrens > substring > fuzzy, dan recentheid) in de globale zoek-API. | `src/app/api/search/route.ts` |
| 11 | **Slimme laag — typo-tolerantie (fuzzy)** via `pg_trgm`-similariteit als exacte resultaten schaars zijn; veilige fallback (`safeRpc`) als de migratie nog niet is toegepast. | `supabase/migrations/search_smart.sql`, `src/app/api/search/route.ts` (+ `database.sql`) |

### Niet in deze PR (bewust — buiten "alleen zoeken" of te hoog risico)
- Globale balk op élke pagina mounten (raakt layouts van bestanden/accountant).
- Server-side volledige facturenzoek in `useInfiniteInvoices` (gedeelde, beschermde
  hook — `SHARED_FILES_PROTOCOL`).
- Accountant die documenten van klanten doorzoekt (RLS is owner-only).
- `unaccent`-extensie voor accent-ongevoelig **server-side** zoeken (client-side
  filters vouwen accenten nu al; server-side ILIKE blijft accent-gevoelig).
- Fuzzy-uitbreiding naar accountant-profielen (accountant-klantzoek is exact/substring;
  een `search_profiles_fuzzy` zou een id-scope-parameter nodig hebben).
- **Cross-group ranking** is er alleen voor de Enter-sneltoets (pickBest); de dropdown
  toont nog steeds vaste groepsvolgorde (facturen → bestanden → klanten).
- **Coverage:** de globale zoek dekt facturen/regels, documenten/mappen, klanten. Bank-
  transacties, kas, artikelen en berichten zitten er (bewust, nog) niet in.
- **Tests:** er zijn nog geen geautomatiseerde tests voor zoeken. Hoogste-waarde test:
  href-correctheid per resultaattype/rol (zou D1/D2 hieronder hebben gevangen), plus
  pure-functie-tests voor `sanitizeTerm`/`normalizeQuery`/`amountConditions`.

Deze staan hier gedocumenteerd als vervolgstappen.

### Agent-hunt fixes (twee rondes adversariële bug-hunt)
Vier + drie onafhankelijke bug-hunt-agents. Beveiliging bleek solide (geen injectie,
geen cross-tenant-lek). Verholpen defects o.a.: dubbele SearchBar op de accountant-hub;
overlay-z-index onder modals; bankfilter-vervuiling; `?search=` sync; `€`-prefix bedrag;
query-lengte-cap (DoS); **dode deep-links** — ontvangen facturen routeren nu naar
`/dashboard/incoming?focus=` (i.p.v. facturen, die alleen verzonden toont) en
accountant-klanten naar `/dashboard/clients/{id}` (i.p.v. de eigen `/klanten`);
useSearch abort-op-unmount + spinner-race; Bestanden out-of-order-race; Enter opent het
best passende resultaat over groepen.

### Fuzzy-ontwerp (definitief, live bevestigd) — 3 signalen
Eén maat vangt niet alle typefouten, dus `search_smart.sql` combineert er drie
(per veld, OR):
1. `similarity()` ≥ 0.2 — hele-string trigram-gelijkenis (vervang-typefouten).
2. `word_similarity()` ≥ 0.4 — beste-woord/deel trigram-gelijkenis.
3. **subsequence-LIKE** — query-tekens in volgorde met gaten (`"fmz"` → `%f%m%z%`,
   vanaf 3 tekens). Vangt WEGGELATEN letters/afkortingen waar trigrams falen: live
   bleek `word_similarity('fmz','FAMZFOOD BV') = 0.25`, gelijk aan onverwante namen —
   de subsequence matcht wél "FAMZFOOD" en NIET "Doyum Food"/"Vars Foods".

Randvoorwaarden: de functies gebruiken de trigram-FUNCTIES (niet de `%`/`<%`-operatoren)
met expliciete drempels, omdat Supabase `SET pg_trgm.*_threshold` in een functie-definitie
verbiedt ("permission denied to set parameter"). `q` wordt tot `[a-z0-9]` gestript vóór de
LIKE-tak → geen wildcard-/regex-injectie. SECURITY INVOKER → RLS blijft de grens.

### Verificatiestatus
- **Ranking** (JS): statisch getest (tsc/build), pure logica.
- **Fuzzy**: **live bevestigd** op de productie-DB — "fmz" vindt nu "FAMZFOOD" en niet de
  onverwante namen. De API/bestanden-zoek valt nog steeds veilig terug op exact/substring
  als de functies ontbreken. Fuzzy dekt nu: **facturen** (klantnaam/nummer) + **eigen
  klanten** (naam/e-mail) in de globale zoek; **documenten** (bestandsnaam/type) in de
  globale zoek én de Bestanden-pagina; **mappen** (naam) in de Bestanden-pagina.
  Accountant-profielen blijven een mogelijke uitbreiding.

---

## 4. Migratie toepassen
`supabase/migrations/search_engine.sql` is idempotent (`IF NOT EXISTS`). Draai 'm in
de Supabase SQL-editor. Zonder deze migratie werkt zoeken functioneel wél, maar
zonder de trigram-versnelling (sequential scans blijven).
