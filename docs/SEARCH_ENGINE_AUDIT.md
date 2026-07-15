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

### Niet in deze PR (bewust — buiten "alleen zoeken" of te hoog risico)
- Globale balk op élke pagina mounten (raakt layouts van bestanden/accountant).
- Server-side volledige facturenzoek in `useInfiniteInvoices` (gedeelde, beschermde
  hook — `SHARED_FILES_PROTOCOL`).
- Accountant die documenten van klanten doorzoekt (RLS is owner-only).
- `unaccent`-extensie voor accent-ongevoelig server-side zoeken.

Deze staan hier gedocumenteerd als vervolgstappen.

---

## 4. Migratie toepassen
`supabase/migrations/search_engine.sql` is idempotent (`IF NOT EXISTS`). Draai 'm in
de Supabase SQL-editor. Zonder deze migratie werkt zoeken functioneel wél, maar
zonder de trigram-versnelling (sequential scans blijven).
