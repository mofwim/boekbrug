-- supabase/migrations/rls_initplan_wrap_auth_calls.sql
-- [RLS-INITPLAN] auth.uid() → (select auth.uid()), in elke policy die hem per RIJ aanriep.
-- BoekBrug · 1 september 2026 · TOEGEPAST op de productiedatabase, met de controle hieronder.
--
-- ── WAAROM DIT GEEN COSMETICA IS ──
--
-- Een kale auth.uid() in een policy is een functieaanroep die Postgres per rij opnieuw doet. In
-- een scalaire subquery gewikkeld wordt hij één keer berekend (een InitPlan) en daarna hergebruikt.
-- De uitkomst is identiek — auth.uid() is STABLE — maar het verschil groeit met de administratie:
-- bij 600 facturen merk je niets, bij 50.000 is het het verschil tussen een scherm dat opent en
-- een scherm waar je op wacht. De adviseur van Supabase telde 157 policies met dit patroon.
--
-- ── WAAROM DIT VEILIG WAS, EN NIET "waarschijnlijk veilig" ──
--
-- 1. De tekst is niet met de hand overgetikt. De lus leest elke policy zoals de database hem zelf
--    rendert, vervangt precies twee letterlijke reeksen, en zet hem terug.
-- 2. ALTER POLICY, geen DROP + CREATE. Rollen, commando en de permissive-vlag blijven ongemoeid,
--    en er is geen moment waarop de policy weg is.
-- 3. Vooraf ging de volledige oude stand naar rls_backup.policies_20260901 (een schema buiten de
--    PostgREST-gevel, alleen met de service-rol te lezen).
-- 4. Achteraf is élke policy TERUGGEREKEND — het wikkelen weer weggehaald — en vergeleken met die
--    momentopname. Uitkomst: 162 vóór, 162 ná, 0 verdwenen, 0 nieuw, 0 met een andere betekenis,
--    0 met een andere rol/commando/permissive.
-- 5. En daarna een echte proef als ingelogde eigenaar: van 610 facturen zag hij zijn eigen 554 en
--    0 vreemde; van 610 documenten zijn eigen 567 en 0 vreemde; zijn eigen profiel en 0 andere.
--    Allebei de helften tellen — niet buitengesloten, en niets opengezet.
--
-- Alleen policies die nog NIET gewikkeld waren, zodat dit bestand nooit dubbel kan wikkelen.

DO $$
DECLARE r record; v_sql text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual,'') LIKE '%auth.uid()%' OR coalesce(qual,'') LIKE '%auth.email()%'
        OR coalesce(with_check,'') LIKE '%auth.uid()%' OR coalesce(with_check,'') LIKE '%auth.email()%')
      AND coalesce(qual,'') NOT LIKE '%SELECT auth.%'
      AND coalesce(with_check,'') NOT LIKE '%SELECT auth.%'
    ORDER BY tablename, policyname
  LOOP
    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF r.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)',
        replace(replace(r.qual, 'auth.uid()', '(select auth.uid())'),
                'auth.email()', '(select auth.email())'));
    END IF;
    IF r.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)',
        replace(replace(r.with_check, 'auth.uid()', '(select auth.uid())'),
                'auth.email()', '(select auth.email())'));
    END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- =====================================================================
-- CONTROLE (apart draaien). Moet 0 geven op alle drie.
-- =====================================================================
-- select
--   count(*) filter (where coalesce(qual,'') like '%auth.uid()%' and coalesce(qual,'') not like '%SELECT auth.uid()%') as nog_kaal_using,
--   count(*) filter (where coalesce(with_check,'') like '%auth.uid()%' and coalesce(with_check,'') not like '%SELECT auth.uid()%') as nog_kaal_check,
--   count(*) filter (where coalesce(qual,'') like '%SELECT ( SELECT auth.%') as dubbel
-- from pg_policies where schemaname = 'public';
