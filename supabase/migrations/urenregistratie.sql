-- =====================================================================
-- [UREN] Urenregistratie — de gewerkte uren, en het ene uur dat nooit twee keer op een
-- factuur mag staan. BoekBrug · augustus 2026
-- =====================================================================
-- WAAROM
--
-- Dit product kon een uur al FACTUREREN — invoice_lines draagt quantity × unit_price, en
-- units.ts kent 'uur' als eenheid ("nobody writes 3 uren on an invoice"). Wat er niet was, is
-- de plek waar dat uur VANDAAN komt. De zzp'er die per uur werkt — de consultant, de
-- ontwikkelaar, de ontwerper, de boekhouder zelf — hield zijn uren dus ergens anders bij: in
-- een schrift, in Excel, in de agenda. En tikte ze aan het eind van de maand over.
--
-- Overtikken is waar het geld weglekt, en het lekt maar één kant op: een vergeten uur wordt
-- nooit gefactureerd. Bij € 85 per uur is één vergeten uur per week € 4.400 per jaar.
--
-- WAT DIT WEL IS
--
-- Eén tabel, en één regel in die tabel die het hele punt is: `invoice_id`. Een uur dat op een
-- factuur staat WIJST naar die factuur. Daarmee is "wat is nog niet gefactureerd" geen
-- berekening en geen aanname maar een kolom — en kan hetzelfde uur niet twee keer meegaan,
-- want de tweede keer staat het er al in.
--
-- Dat is dezelfde keuze als bank_tx_invoices maakt voor een betaling: de koppeling is een RIJ,
-- geen afgeleide. Een afgeleide kan drift oplopen; een foreign key niet.
--
-- ON DELETE SET NULL op die factuur is niet luiheid maar de enige juiste kant. Wordt een
-- concept-factuur weggegooid, dan zijn die uren WEER factureerbaar — ze zijn immers gewerkt.
-- CASCADE zou het werk zelf wissen omdat de factuur eromheen verdween, en dat is precies de
-- fout die dit bestand bestaat om te voorkomen.
--
-- WAT DIT NADRUKKELIJK NIET IS
--
-- Geen projectadministratie, geen urenbudget, geen goedkeuringsstroom, geen timer die
-- meeloopt. Die horen bij een bureau met werknemers; dit product is van één ondernemer. Wat
-- hier staat is: wanneer, voor wie, wat, hoe lang, tegen welk tarief — en of het al op een
-- factuur staat.
--
-- SCHIPT DONKER. Een bestaande gebruiker heeft nul rijen in deze tabel. Er verschuift geen
-- cent, geen aangifte en geen bestaand scherm doordat deze migratie draait: niets leest hem
-- tot de ondernemer zijn eerste uur invoert.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- profiles(id), niet auth.users(id): dat is wat cash_entries, articles en bank_connections
  -- allemaal doen, en een tabel die als enige naar een ander anker wijst is een tabel die bij de
  -- eerste join afwijkt.
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Voor wie. Los van client_name op de factuur: die is een momentopname van de naam, deze is
  -- de relatie. NULL mag — uren voor een klant die nog niet in de kaartenbak staat zijn nog
  -- steeds gewerkte uren, en ze weigeren zou de ondernemer dwingen eerst administratie te doen
  -- voordat hij zijn werk mag opschrijven.
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- De dag waarop gewerkt is — niet de dag van invoeren. [TZ] De app rekent in de kalender van
  -- de ondernemer (Europe/Amsterdam), dus dit is een DATE en nooit een timestamp: "dinsdag" mag
  -- niet van tijdzone veranderen.
  worked_on   date NOT NULL,

  -- Wat er gedaan is. Dit wordt de omschrijving op de factuurregel, dus het is wat de KLANT
  -- straks leest. Verplicht: een factuurregel zonder omschrijving is een bedrag zonder reden.
  description text NOT NULL CHECK (btrim(description) <> ''),

  -- Hoe lang. numeric(6,2): tot 9999,99 uur per regel, twee decimalen omdat kwartieren (0,25)
  -- en tien minuten (0,17) allebei moeten passen. Strikt positief — een regel van nul uur is
  -- geen werk en een negatieve is een correctie die als eigen regel hoort.
  hours       numeric(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),

  -- Tegen welk tarief, excl. btw. NULL = "nog niet bepaald": de ondernemer mag uren opschrijven
  -- voordat hij het tarief heeft afgesproken, en de factuurstap vraagt er dan om. Nul is
  -- toegestaan (garantiewerk, ingehaald uur) en is iets anders dan onbekend — vandaar geen
  -- CHECK op > 0.
  hourly_rate numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),

  -- [UREN-EENMALIG] DE regel van dit bestand. Gevuld = dit uur staat op die factuur en is
  -- daarmee uit de factureerbare voorraad. Leeg = nog te factureren.
  --
  -- Niet afgeleid uit datums of statussen: een kolom die naar de factuur WIJST. Zo kan de vraag
  -- "heb ik dit al gefactureerd" maar één antwoord hebben, en dat antwoord staat naast het uur
  -- zelf in plaats van in een query die iemand later anders schrijft.
  invoice_id  uuid REFERENCES public.invoices(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Eigen rijen, en niets anders. Dezelfde vier policies als cash_entries en articles.
DROP POLICY IF EXISTS time_entries_select_own ON public.time_entries;
CREATE POLICY time_entries_select_own ON public.time_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS time_entries_insert_own ON public.time_entries;
CREATE POLICY time_entries_insert_own ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS time_entries_update_own ON public.time_entries;
CREATE POLICY time_entries_update_own ON public.time_entries
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS time_entries_delete_own ON public.time_entries;
CREATE POLICY time_entries_delete_own ON public.time_entries
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- De vraag die het scherm elke keer stelt: mijn nog niet gefactureerde uren, nieuwste eerst.
-- Partieel op invoice_id IS NULL, want dat is precies de rij-verzameling die groeit en gelezen
-- wordt; gefactureerde uren worden alleen nog per factuur opgevraagd.
CREATE INDEX IF NOT EXISTS idx_time_entries_unbilled
  ON public.time_entries (user_id, worked_on DESC)
  WHERE invoice_id IS NULL;

-- En de omgekeerde vraag: welke uren zitten in DEZE factuur. Die stelt de factuur zelf, en de
-- verwijder-stap die ze weer vrijgeeft.
CREATE INDEX IF NOT EXISTS idx_time_entries_invoice
  ON public.time_entries (invoice_id)
  WHERE invoice_id IS NOT NULL;
