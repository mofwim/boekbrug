-- =====================================================================
-- [PAY-DATE-SANE] Een boekingsdatum die niet kan bestaan, komt de database niet meer in.
-- BoekBrug · July 2026
-- =====================================================================
-- WHY: elke deur die een datum in de boeken schrijft testte alleen de VORM
-- (/^\d{4}-\d{2}-\d{2}$/). Dat is geen datumcontrole: "2062-03-01" en "1926-07-04" komen er net
-- zo makkelijk doorheen als vandaag, en één verschoven cijfer in een datumveld is een van de
-- gewoonste vergissingen die er is. Wat dat ene cijfer verzet:
--
--   · invoices.payment_date bepaalt onder het KASSTELSEL in welk kwartaal de BTW valt — ook in
--     een kwartaal dat al is ingediend, zonder dat één scherm dat zegt;
--   · bank_tx_invoices.paid_on is dezelfde datum per deelbetaling, en daarmee de bron waaruit de
--     factuurdatum opnieuw wordt afgeleid als een betaling wordt verplaatst of teruggedraaid;
--   · cash_entries.entry_date draagt een LOPEND saldo: één onmogelijke dag sleept elk eindsaldo
--     erna mee, in het kasboek dat de boekhouder leest en in de negatieve-kas-getuige die de
--     aangifte blokkeert (drawer-witness.ts);
--   · daily_turnover.turnover_date is dezelfde ziekte aan de omzetkant — de spookdag die de
--     kasstand voorgoed ophoogt (zie [DATE-WINDOW] in src/lib/turnover-import.ts).
--
-- De app weigert dit inmiddels aan alle deuren (src/lib/payment-date.ts, gedeeld door
-- /api/invoice/pay-toggle, /api/email/confirm/[id] en /api/cash). Dit bestand is de riem onder
-- die bretels: code verandert, deuren komen erbij, en een controle die alleen in de route staat
-- is een controle die de volgende route kan vergeten.
--
-- WAAROM EEN TRIGGER EN GEEN CHECK-CONSTRAINT:
--   · een CHECK moet bestaande rijen valideren bij het toevoegen — dus precies de rij die je
--     wilt vinden, laat de migratie mislukken. Een trigger raakt bestaande rijen niet aan;
--   · een CHECK met een bewegende bovengrens (CURRENT_DATE) is een bekend foot-gun bij
--     dump/restore. Een trigger heeft dat probleem niet;
--   · en een trigger kan uitleggen wat er mis is, in plaats van "violates check constraint".
--
-- HET VENSTER IS EXPRES RUIM: [2000-01-01, vandaag + 7 dagen]. Dit is niet de regel van de app
-- (die staat op "morgen", waar de eigenaar te horen krijgt waarom) maar de vloer eronder: alleen
-- het fysiek onmogelijke. Een verkeerd jaartal zit er JAREN naast, nooit dagen — dus deze marge
-- kan geen enkele echte boeking tegenhouden, ook niet bij een apparaatklok die voorloopt, een
-- tijdzoneverschil tussen server en Amsterdam, of een bankafschrift met een eigen valutadatum.
--
-- WAT DIT NIET DOET: bestaande rijen veranderen of weigeren. De trigger vuurt bij INSERT en
-- alleen bij een UPDATE die de datumkolom zelf aanraakt (UPDATE OF), zodat een oude rij met een
-- rare datum gewoon bewerkt en gerepareerd kan worden. Onderaan staat een VERIFY-query die de
-- rijen die er nu al staan opsomt.
--
-- ÉÉN GEVOLG OM TE WETEN (getest, niet aangenomen): door `UPDATE OF <kolom>` hangt de trigger aan
-- die kolom, dus een latere `ALTER TABLE ... DROP COLUMN` op zo'n datumkolom vraagt om CASCADE.
-- Dat is hier eerder een kenmerk dan een last: een geldkolom hoort niet stilletjes te verdwijnen.
--
-- APPLY: draai dit hele bestand in de Supabase SQL editor. Er wordt niets verwijderd.
-- Idempotent / opnieuw uit te voeren.
-- =====================================================================

BEGIN;

-- ── De regel, één keer ────────────────────────────────────────────────────────────────────────
-- Generiek in de kolomnaam (TG_ARGV[0]) zodat vier tabellen niet vier kopieën van dezelfde
-- grens krijgen die uit elkaar kunnen lopen — dezelfde reden waarom de app-kant één
-- payment-date.ts heeft in plaats van een test per route.
CREATE OR REPLACE FUNCTION public.assert_bookkeeping_date_sane()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_col   text := TG_ARGV[0];
  v_value date;
  v_floor date := DATE '2000-01-01';
  v_ceil  date := CURRENT_DATE + 7;
BEGIN
  -- Dynamische veldtoegang: de functie hoort niet te weten hoe de kolom heet, alleen wat de
  -- grens is.
  EXECUTE format('SELECT ($1).%I', v_col) INTO v_value USING NEW;

  -- NULL is een geldig antwoord en betekent "niet bekend / niet betaald" — dat is precies wat
  -- een teruggedraaide betaling achterlaat.
  IF v_value IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_value < v_floor OR v_value > v_ceil THEN
    RAISE EXCEPTION
      '[PAY-DATE-SANE] % op %.% kan niet kloppen: % (toegestaan: % t/m %)',
      v_col, TG_TABLE_SCHEMA, TG_TABLE_NAME, v_value, v_floor, v_ceil
      USING
        ERRCODE = '22008',  -- datetime_field_overflow
        HINT = 'Controleer het jaartal. Een boeking ligt niet in de toekomst en niet voor 2000.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assert_bookkeeping_date_sane() IS
  '[PAY-DATE-SANE] BEFORE-trigger: weigert een boekingsdatum buiten [2000-01-01, CURRENT_DATE + 7]. De kolomnaam komt uit TG_ARGV[0]. NULL is toegestaan. Bewust ruim: dit is de absolute ondergrens onder de striktere regel van de app (src/lib/payment-date.ts), niet een tweede mening erover.';

-- ── De deuren ─────────────────────────────────────────────────────────────────────────────────
-- Elke trigger wordt alleen gezet als tabel én kolom bestaan: de migraties van dit project
-- worden met de hand toegepast, dus dit bestand mag nooit omvallen op een kolom die in deze
-- omgeving nog niet is aangekomen (bank_tx_invoices.paid_on komt bijvoorbeeld uit
-- invoice_manual_payments.sql).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('invoices',        'payment_date'),
      ('bank_tx_invoices','paid_on'),
      ('cash_entries',    'entry_date'),
      ('daily_turnover',  'turnover_date')
    ) AS v(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t.tbl AND column_name = t.col
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tbl || '_' || t.col || '_sane', t.tbl);
      -- UPDATE OF <kolom>: de trigger bemoeit zich alleen met een schrijfactie die DEZE datum
      -- aanraakt. Een bestaande rij met een rare datum blijft dus gewoon bewerkbaar (status
      -- wijzigen, bedrag corrigeren) — en te repareren.
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.assert_bookkeeping_date_sane(%L)',
        t.tbl || '_' || t.col || '_sane', t.col, t.tbl, t.col
      );
      RAISE NOTICE '[PAY-DATE-SANE] trigger gezet op public.%(%)', t.tbl, t.col;
    ELSE
      RAISE NOTICE '[PAY-DATE-SANE] overgeslagen: public.%(%) bestaat hier nog niet', t.tbl, t.col;
    END IF;
  END LOOP;
END;
$$;

COMMIT;

-- ── VERIFY ────────────────────────────────────────────────────────────────────────────────────
-- 1. De functie en de triggers staan er. Verwacht: 1 functie, en één rij per bestaande kolom.
SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assert_bookkeeping_date_sane'
) AS has_assert_bookkeeping_date_sane;

SELECT c.relname AS tabel, t.tgname AS trigger
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE '%\_sane'
ORDER BY 1;

-- 2. Wat er NU al staat en buiten het venster valt. De trigger raakt deze rijen niet aan — hij
--    voorkomt nieuwe. Dit is de lijst om met de hand te bekijken: elke rij hier is een boeking
--    in een kwartaal waar hij niet hoort. Verwacht: vier keer leeg.
--
--    Vier losse query's, geen UNION: als een van deze kolommen in jouw omgeving nog niet bestaat
--    (de migraties hier worden met de hand toegepast), faalt alleen díe regel en zie je de andere
--    drie gewoon. De migratie zelf is op dat moment al gecommit.
SELECT 'invoices.payment_date' AS bron, id::text AS rij, payment_date AS datum
FROM public.invoices
WHERE payment_date IS NOT NULL AND (payment_date < DATE '2000-01-01' OR payment_date > CURRENT_DATE + 7)
ORDER BY datum;

SELECT 'bank_tx_invoices.paid_on' AS bron, id::text AS rij, paid_on AS datum
FROM public.bank_tx_invoices
WHERE paid_on IS NOT NULL AND (paid_on < DATE '2000-01-01' OR paid_on > CURRENT_DATE + 7)
ORDER BY datum;

SELECT 'cash_entries.entry_date' AS bron, id::text AS rij, entry_date AS datum
FROM public.cash_entries
WHERE entry_date IS NOT NULL AND (entry_date < DATE '2000-01-01' OR entry_date > CURRENT_DATE + 7)
ORDER BY datum;

SELECT 'daily_turnover.turnover_date' AS bron, id::text AS rij, turnover_date AS datum
FROM public.daily_turnover
WHERE turnover_date IS NOT NULL AND (turnover_date < DATE '2000-01-01' OR turnover_date > CURRENT_DATE + 7)
ORDER BY datum;

-- 3. Snelle rooktest (weigert de trigger echt?). Draai desgewenst met de hand; hij hoort te
--    eindigen met de melding hieronder en verandert niets:
--
--   BEGIN;
--     UPDATE public.invoices SET payment_date = DATE '2062-03-01'
--     WHERE id = (SELECT id FROM public.invoices WHERE payment_date IS NOT NULL LIMIT 1);
--     -- verwacht: ERROR [PAY-DATE-SANE] payment_date op public.invoices kan niet kloppen: 2062-03-01
--   ROLLBACK;
