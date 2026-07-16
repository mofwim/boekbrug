# Mijn bestanden — het in-app bestandssysteem van BoekBrug

> **Doel:** een echte "OneDrive/Google Drive voor de ZZP'er" ín de app — geen
> domme bestandenlijst, maar een slim, fiscaal-bewust archief. Dit document is
> de canonieke beschrijving van hoe het systeem werkt (gebaseerd op de code en
> de database, niet op aannames).

Laatste update: 2026-07 — bij de toevoeging van de slimme weergaven, sortering
en opslagmeter (`[BESTANDEN-SMART]` / `[BESTANDEN-SORT]`).

---

## 1. Waar het leeft (bestandsindex)

| Laag | Pad |
|---|---|
| UI (client) | `src/app/dashboard/bestanden/BestandenPage.tsx` + `components/**` |
| UI (server wrapper) | `src/app/dashboard/bestanden/page.tsx` (auth + `ensureYearStructure`) |
| Businesslogica | `src/lib/bestanden.ts` (mappenboom, structuur, zoeken, verplaatsen) |
| Upload/opslag helpers | `src/lib/documents.ts` (upload, dedup, signed URL, verwijderen) |
| API — inhoud/zoeken/PATCH | `src/app/api/bestanden/route.ts` |
| API — mappen CRUD | `src/app/api/bestanden/folders/route.ts` |
| API — platte mappenlijst | `src/app/api/bestanden/folders-tree/route.ts` |
| API — AI-classificatie | `src/app/api/bestanden/classify/route.ts` |
| API — prullenbak | `src/app/api/bestanden/trash/route.ts` |
| API — upload + lijst | `src/app/api/files/route.ts` |
| API — metadata / signed URL | `src/app/api/files/[id]/route.ts`, `src/app/api/files/[id]/url/route.ts` |
| API — jaarexport (ZIP) | `src/app/api/kluis/export/route.ts` |

---

## 2. Datamodel (Supabase / Postgres)

### `documents`
Eén rij per bestand. Belangrijkste kolommen (zie `src/types/database.types.ts`,
dat autoritatief is boven `database.sql`):

- `id`, `user_id` (eigenaar, FK → `profiles`)
- `file_name`, `file_url` (= **opslagpad**, niet de publieke URL), `file_size`, `file_type`
- `folder_id` (FK → `folders`, `ON DELETE SET NULL`) — `null` = hoofdmap
- `doc_type`, `period` (`"YYYY-Qn"`), `year` — fiscale ordening
- `invoice_id` (FK → `invoices`), `notes`
- `starred`, `trashed`, `trashed_at` — favoriet & zachte verwijdering
- `shared` (**boolean, NOT NULL**) — zichtbaar voor de gekoppelde boekhouder
- `content_hash` — byte-hash voor dedup over mappen heen
- `source` — `email | upload | whatsapp | camera`
- `ai_processed`, `ai_doc_type`, `ai_suggested_folder` — AI-classificatie
- `search_vector` (tsvector) — automatisch gevuld door trigger
  `documents_search_vector_trigger` op `file_name + doc_type + notes`

**Indexen** (relevant voor de weergaven): `documents_user_created (user_id,
created_at DESC)`, `documents_starred_idx (user_id, starred)`,
`documents_trashed_idx (user_id, trashed)`, `documents_user_year`,
`documents_search_idx` (GIN). De slimme weergaven leunen exact op deze indexen.

### `folders`
- `id`, `user_id`, `name`, `parent_id` (FK → `folders`, `ON DELETE CASCADE`)
- `color`, `starred`, `created_at`
- `is_system` (boolean) — systeemmappen, beschermd
- `folder_type` — `year | quarter | month | bank | facturen | kosten | shared | custom | imported`

**Systeemmapbescherming** = twee partiële UNIQUE-indexen
(`folders_system_child_uniq`, `folders_system_root_uniq`) + RLS. Idempotent
seeden kan daardoor nooit duplicaten maken.

### RLS (row-level security)
- `documents`: eigenaar-only voor SELECT/INSERT/UPDATE/DELETE (`user_id = auth.uid()`).
- `folders`: eigenaar-only, **plus** `is_system = false` op INSERT/UPDATE/DELETE.
  Systeemmappen zijn dus alleen-lezen voor de gebruiker; aanmaken/wijzigen ervan
  vereist `service_role` (background/`ensureYearStructure`).
- Boekhouder ziet gedeelde bestanden via `accountant_clients` + het
  `shared/`-pad-prefix (zie §5).

### Opslag (Supabase Storage)
- Eén private bucket: **`documents`**, limiet 50 MB per bestand.
- Objectpad begint met `auth.uid()` (afgedwongen door storage-policies).
  Privé: `{userId}/{year}/Q{q}/{YYYYMMDD}_{naam}` · Gedeeld:
  `{userId}/shared/{year}/Q{q}/{YYYYMMDD}_{naam}`.
- Lezen gaat altijd via **signed URLs** (1 uur), nooit publieke links.

---

## 3. De slimme mappenstructuur

`ensureYearStructure(userId, year)` (in `src/lib/bestanden.ts`, `service_role`)
bouwt idempotent per jaar:

```
{jaar}/
  Q1 (jan–mrt)/  Bank/  januari/  Facturen/ Kosten/  februari/…  maart/…
  Q2 (apr–jun)/  …
  Q3 (jul–sep)/  …
  Q4 (okt–dec)/  …
Gedeeld met boekhouder/     (folder_type = shared, altijd in root)
Geïmporteerde bestanden/    (folder_type = imported, fallback voor imports)
```

- **Snelpad:** één query. Bestaat de structuur al (4 kwartalen + shared +
  imported), dan return direct — geen INSERTs.
- **Bouwpad:** maakt alleen ontbrekende mappen; INSERT + vang `23505`
  (unique_violation) → concurrency-veilig.
- `resolveImportTarget(userId, invoiceDate, type)` is dé functie voor importers
  (e-mailsync): zorgt voor de jaarstructuur en geeft de juiste `folder_id` terug,
  met `Geïmporteerde bestanden` als fallback bij ontbrekende/ongeldige datum.

---

## 4. Wat de gebruiker kan (UI-mogelijkheden)

De `BestandenPage` is een volwaardige Drive-ervaring:

- **Weergave:** raster (grid) / lijst; mappen + bestanden per map.
- **Navigatie:** zijbalk-mappenboom (drag-drop), breadcrumbs, interne
  terug-geschiedenis, deep-links `?folder=&focus=` (opent map + markeert bestand).
- **Selectie:** klik, Shift-bereik, Ctrl/⌘-klik, sleep-selectiekader, Ctrl+A.
- **Sleep & neerzetten:** bestanden/mappen naar mappen, naar prullenbak, groep-drag.
- **Klembord:** Ctrl+C / Ctrl+X / Ctrl+V (knippen → plakken), Delete → prullenbak.
- **Acties:** hernoemen, verplaatsen (modal), ster/favoriet, delen met boekhouder,
  downloaden, voorbeeld (PDF-iframe + afbeelding), bulkbalk (ster/delen/verplaatsen/verwijderen).
- **Upload:** sleepzone + FAB, meerdere bestanden, per-bestand voortgang,
  duplicaatdetectie (byte-hash) met link naar het reeds bestaande bestand.
- **AI:** bij upload in de hoofdmap classificeert de AI het document en **stelt**
  een map voor (de eigenaar bevestigt — nooit stil verplaatsen).
- **Prullenbak:** zachte verwijdering (`trashed`) + herstellen. **Geen** permanente
  verwijdering vanuit de UI: financiële stukken vallen onder de 7-jaars
  bewaarplicht, dus de prullenbak is "verborgen maar bewaard". (De oude
  "permanent verwijderen"/"prullenbak legen"-knoppen riepen een uitgeschakelde
  410-route aan en deden in werkelijkheid niets — verwijderd zodat de UI niet liegt.)
- **Zoeken:** debounced, full-text over naam/notities/doc_type, met
  "open locatie"-chip naar de map van het resultaat.

### 4.1 Slimme weergaven — `[BESTANDEN-SMART]` (nieuw)
De zijbalk heeft nu de kenmerkende Drive/OneDrive-navigatie: platte,
map-overstijgende lijsten van de **eigen** bestanden.

| Weergave | Filter (server) | Bron |
|---|---|---|
| **Recent** | laatste 50, `created_at DESC` | `?view=recent` |
| **Favorieten** | `starred = true` | `?view=starred` (alias van `?starred=true`) |
| **Gedeeld** | `shared = true` | `?view=shared` |

- Puur lezend over dezelfde RLS-tabel (`documents`, `trashed = false`). Geen
  nieuwe tabellen, geen schrijfacties.
- Mutaties (ster/delen/verplaatsen/verwijderen) binnen een weergave werken de
  lijst optimistisch bij én triggeren een re-fetch (`bumpSmart`), zodat er nooit
  een verouderde rij blijft staan.
- In lijstweergave heeft elk resultaat een "open locatie"-knop naar de echte map.

### 4.2 Sorteren — `[BESTANDEN-SORT]` (nieuw)
Sorteerknop in de werkbalk: **Naam / Datum / Grootte**, op- of aflopend.
Zuivere client-side sortering (`sortDocs`, muteert niets). Geldt voor de
mapweergave én de slimme weergaven; Shift-bereikselectie volgt exact de
zichtbare volgorde.

### 4.3 Opslagmeter — `[BESTANDEN-SMART]` (nieuw)
Voettekst in de zijbalk toont het totaal gebruikte volume + aantal bestanden
(`?stats=true` → som van `file_size` over niet-verwijderde eigen bestanden).
Eerlijke weergave: geen verzonnen quota. Ververst na upload/verwijderen/herstellen.

### 4.4 Bug-hunt hardening (integriteit)
Uit een gerichte bug-jacht op deze unit:
- **`[I#1]` Upload respecteert de map.** `uploadDocument` + `POST /api/files`
  bewaren nu `folder_id` (met eigenaars-validatie). Voorheen viel elk in-een-map
  geüpload bestand na een refresh terug naar de hoofdmap.
- **`[Fo#1]` Geen mapcycli.** `moveFolder` weigert een map naar haar eigen submap
  te verplaatsen (voorkwam een onzichtbare, losgekoppelde subtree + een
  breadcrumb-crash door oneindige recursie). `MoveModal` toont de subtree niet meer.
- **`[Fo#2]` Systeemmapnamen gereserveerd.** Een custom map kan niet meer
  "Gedeeld met boekhouder"/"Geïmporteerde bestanden" heten — dat toonde een
  "gedeeld"-badge zonder echt te delen.
- **`[Fo#3]` `deleteFolder`** controleert nu elke stap (reparent vóór delete), zodat
  de `ON DELETE CASCADE` nooit per ongeluk een subtree wist.
- **`[T#3]` Globale zoekbalk** filtert nu `trashed=false` (verwijderde bestanden
  lekten in de topbar-zoek).
- **`[I#2]` `deleteDocument`** verwijdert eerst de rij, dan het object, met
  foutcontrole — geen dangling rows / weesobjecten meer.
- **`[F#2]` Upload-inputveld** reset, zodat hetzelfde bestand opnieuw kiesbaar is.

Tweede ronde:
- **`[T#4]`** `/api/bank/statements` filtert nu `trashed=false` (verwijderde
  afschriften lekten in de statements-lijst).
- **`[I#4]`** AI-bankdetectie op woordgrenzen + niet meer over een zeker
  `invoice`/`receipt`-oordeel heen — "Rabobank_factuur" wordt niet als afschrift
  gefiled.
- **`[Fo#5]`** `moveFolder` weigert systeemmappen (geen stille `{ ok:true }` no-op).
- **`[F#1/F#3]`** Signed-URL-fetching gedeeld/gecachet/concurrency-gelimiteerd
  (`signedUrl.ts`) — geen request-storm bij een map vol foto's, en remounts
  hergebruiken de URL (TTL onder de 1h-expiry).
- **`[F#4]`** PreviewModal fetch is cancel-guarded; **`[F#5]`** "Openen" alleen voor
  image/pdf; **`[F#6]`** contextmenu-hoogte telt dividers; **`[F#7]`** batch-balk
  haalt 100%; **`[F#8]`** upload zet geen state na unmount.

**Bewust NIET gedaan (`[I#3]`):** een unique index op `(user_id, content_hash)` om
de TOCTOU-race in de dedup-gate te sluiten — dat zou de `allowDuplicate`-functie
("nogmaals uploaden", die opzettelijk een tweede rij met dezelfde hash maakt)
breken. De race is een goedaardige dubbel-submit-edge; de index is hier de
verkeerde fix.

---

## 5. Delen met de boekhouder

Delen is losgekoppeld van de mapindeling — een bestand kan gedeeld zijn en toch
in zijn eigen map blijven staan.

- **Vlag:** `documents.shared = true` is wat de boekhouder-RLS leest.
- **Twee manieren om te delen** (beide zetten `shared=true` + stempelen kwartaal):
  1. Expliciete knop "Delen met boekhouder" (deelt **in-place**, geen verplaatsing).
  2. Verplaatsen/uploaden **in** de map "Gedeeld met boekhouder"
     (`folder_type=shared`) — de PATCH-route detecteert dit en deelt automatisch.
- Un-sharen is altijd expliciet; een gewone reorganisatie-verplaatsing haalt de
  toegang van de boekhouder nooit stilletjes weg.
- De boekhouder leest gedeelde bestanden via `GET /api/files?clientId=…`
  (na verificatie in `accountant_clients`) met een `shared/`-pad-prefix-filter.

---

## 5b. Eén kopie, geen dubbele bestanden (client ↔ boekhouder)

De boekhouder ziet dezelfde bestanden, maar er bestaat **nooit een tweede
fysieke kopie**. Dit is de kern van het ontwerp:

- **Opslag:** één object in bucket `documents` op pad `{userId}/…`. Delen
  **verplaatst noch kopieert** het object. Her-upload van hetzelfde bestand
  wordt geblokkeerd door de byte-hash (`content_hash`).
- **Database:** één `documents`-rij. Delen = `PATCH shared=true` op diezelfde rij
  — geen aparte rij "voor de boekhouder".
- **Boekhouder leest dezelfde rij + hetzelfde object:**
  - **`/brug`** (`src/app/dashboard/brug/page.tsx`): selecteert `documents` onder
    RLS `documents_accountant_read` (= `shared=true` van gekoppelde klanten) en
    ondertekent hetzelfde opslagobject met `service_role` (tabellen-RLS geeft
    leesrecht op de rij, storage-RLS wordt alleen voor die reeds-geautoriseerde
    paden omzeild).
  - **Kwartaalpakket** (`src/lib/closing-package.ts`, **accountant-lane / `main`**):
    de selectie van gedeelde documenten is daar gecentraliseerd in
    `sharedDocsForQuarter(supabase, ownerId, year, quarter)` — filter
    `shared=true, trashed=false, invoice_id IS NULL, doc_type != 'bankafschrift'`,
    gebucket op `period='{jaar}-Q{n}'`. Het pakket **downloadt** de bytes van
    hetzelfde object in een tijdelijke ZIP — schrijft nooit terug naar opslag.
    **Contract:** deze functie is het raakvlak tussen deze unit (die `shared` /
    `period` / `trashed` zet) en het pakket; wijzig ik die semantiek, dan is dat
    het punt om af te stemmen.

**Drie meldingsvormen, één definitie van "gedeeld":** zowel `/brug` als het
kwartaalpakket lezen de **`shared`-vlag**. De oude, op opslagpad gebaseerde
mechaniek (`shared/`-pad + `listDocuments(sharedOnly)` + `/api/files?clientId=`)
is **teruggetrokken** (`[FIN-UNIFY]`), zodat er precies één bron van waarheid is.

### Beveiliging — de koppeling die "gedeeld" mogelijk maakt (`[SEC-LINK]`)
Wie een client's gedeelde bestanden mag zien wordt bepaald door de
`accountant_clients`-koppeling. Een security-jacht vond dat de INSERT-RLS
(`WITH CHECK (accountant_id = auth.uid())`) **geen toestemming/uitnodiging
eiste** — elke ingelogde gebruiker kon zichzelf via één directe PostgREST-insert
als boekhouder van een willekeurige client koppelen en zo diens gedeelde stukken
lezen. De legitieme accept-route koppelt via `service_role`, dus de policy was
overbodig én open. **Fix:** `supabase/migrations/accountant_clients_insert_consent.sql`
laat de open policy vallen (koppelen kan alleen nog via de geverifieerde accept-route).
Bijkomend: `unlink-by-client` werkt nu ook als een client meerdere boekhouders
heeft (was een `maybeSingle()`-404), en `subject-status` negeert getrashte docs.

> **Audit-herstel (prod-drift):** `documents_accountant_read` is nu vastgelegd in
> `supabase/migrations/documents_accountant_read_policy.sql` (idempotent, gespiegeld
> aan `invoices_accountant_read` + `trashed`-hardening) en in de `database.sql`-snapshot.
> Vóór deploy: diff tegen de LIVE policy (`pg_policy` op `public.documents`) om te
> bevestigen dat de productie-`USING` het linked-client-predicaat bevat — als die
> breder is, tightent deze migratie hem. **Nog wél prod-only:** het bestaan van de
> `documents.shared`-kolom en de Storage-bucketpolicies (SECTION 8, alleen comments) —
> die horen ook in een migratie zodat een fresh rebuild de volledige gate opzet.

### Consistentie-fixes (bij deze analyse toegevoegd)

1. **`[FIN-QUARTER]` — delen overschrijft `period` niet meer met "vandaag".**
   Voorheen stempelde de share-actie `period` op het *huidige* kwartaal, wat een
   in Q1 geüpload document bij delen in Q2 naar het Q2-pakket verplaatste. Nu
   geldt de prioriteit: expliciet gekozen kwartaal → het eigen `period` van het
   document (behouden) → pas als laatste het huidige kwartaal.
   **Belangrijke nuance:** `documents.period` wordt op UPLOAD-tijd gezet
   (upload-kwartaal), niet uit de eigen datum van de bon — er is geen stap die
   `period` uit de documentdatum afleidt. Deze fix voorkomt dus vooral het
   *bederven* van een correct upload-kwartaal; volledig correcte kwartaal­toewijzing
   vereist nog een expliciete kwartaalkeuze bij delen (de `body.period`/FIN-9-haak
   bestaat, maar de UI stuurt hem nog niet). Bankafschriften worden bij delen
   **niet** opnieuw gestempeld (hun `period` hoort bij de bankinname).
   (`src/app/api/bestanden/route.ts`)
   > **Afstem-nota:** deze fix verandert de `period`-waarde die een gedeeld
   > bestand draagt (upload-kwartaal behouden i.p.v. huidig kwartaal). Het pakket
   > buckt daarop via `sharedDocsForQuarter` — dus dit beïnvloedt in welk
   > kwartaalpakket een laat-gedeeld bestand valt. Bewust binnen het contract.
2. **Kwartaalpakket-ZIP (dedup + `shared_outside_quarter`-waarschuwing)** valt in
   de **accountant-lane (`main`)**, niet in deze unit. Bevindingen uit de review
   zijn daar afgehandeld (`sharedDocsForQuarter` + `sharedOutsideWarning`); deze
   unit raakt `closing-package.ts` niet aan, om botsing te voorkomen.
3. **`[FIN-UNIFY]` — dode deelmechaniek opgeruimd.** Het ongebruikte
   `?clientId=`-pad in `/api/files`, `listDocuments(sharedOnly)` en de
   `shared/`-opslagtak in `buildStoragePath` zijn verwijderd; delen loopt nu
   uitsluitend via de `shared`-vlag.

## 6. Jaarexport / bewaarplicht (`kluis`)

`GET /api/kluis/export?year=YYYY` bouwt een ZIP `administratie-{jaar}/` met alle
documenten van dat jaar + `documenten-index.csv` + `facturen-index.csv`
(beide richtingen) + `LEESMIJ.txt` met de 7-jaars Belastingdienst-bewaarplicht.
Limieten: 500 bestanden / 150 MB. CSV-injectie wordt geneutraliseerd
(export is boekhouder-facing). Ontbrekende opslag wordt eerlijk in het manifest
gemeld — niets verdwijnt stil.

---

## 7. API-samenvatting

| Route | Methode | Doel |
|---|---|---|
| `/api/bestanden` | GET | mapinhoud · `?search=` · `?view=recent\|starred\|shared` (of `?starred=true`) · `?stats=true` |
| `/api/bestanden` | PATCH | `?id=` — verplaatsen / hernoemen / ster / prullenbak / delen (+kwartaal) |
| `/api/bestanden/folders` | POST/PATCH/DELETE | map-CRUD (systeemmappen beschermd → 403) |
| `/api/bestanden/folders-tree` | GET | platte mappenlijst voor de zijbalkboom |
| `/api/bestanden/classify` | POST | AI-classificatie (rate-limited) → voorgestelde map |
| `/api/bestanden/trash` | GET/PATCH | prullenbak tonen / herstellen |
| `/api/files` | POST/GET | upload (dedup, 50 MB) / eigen-lijst (owner-scoped) |
| `/api/files/[id]` | GET | metadata (DELETE is uitgeschakeld → 410) |
| `/api/files/[id]/url` | GET | signed URL (1 uur) |
| `/api/kluis/export` | GET | `?year=` — jaararchief-ZIP |

**Vaste vorm:** `{ error }` bij fouten (401 niet-ingelogd, 400 ontbrekende param,
403 systeemmap, 404 niet gevonden). Slimme weergaven en de starred/zoek-lijst
delen allemaal de `{ documents }`-vorm die de client al rendert.

---

## 8. Ontwerpprincipes (waarom het zo is)

1. **Fiscaal eerst.** De mappenstructuur is jaar → kwartaal → maand → Facturen/Kosten/Bank,
   zodat een kwartaalaangifte en de jaarexport triviaal worden.
2. **Nooit stil muteren.** AI stelt voor, de eigenaar bevestigt. Un-sharen en
   verwijderen zijn altijd expliciet.
3. **Eigenaarschap streng.** Elke query is dubbel afgeschermd: RLS + `.eq("user_id", …)`.
   Privé is privé; delen is een bewuste, omkeerbare daad.
4. **Additief & patroonvast.** Nieuwe functies (slimme weergaven, sortering,
   meter) zijn puur lezend en volgen de bestaande route- en UI-patronen — geen
   nieuwe tabellen, geen schrijf-migraties, geen risico voor bestaande data.
