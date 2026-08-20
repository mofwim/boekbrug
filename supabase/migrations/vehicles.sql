-- =====================================================================
-- [VOERTUIG] The cars a garage works on, and when their APK runs out.
-- BoekBrug · August 2026
-- =====================================================================
-- WHY: every Dutch garage system — Motira, Sleutl, GarageOS, GarageManager — is built around two
-- facts this app did not hold: the VEHICLE and its APK expiry date. That is not decoration. A
-- mechanic does not think in customers, he thinks in cars: "de grijze Golf van dinsdag" is a
-- vehicle with a history, and the person attached to it changes the day the car is sold. Asked to
-- record a job, he had nowhere to put a kenteken and would type "Reparatie Golf" as a free line.
--
-- And the APK date is the one thing in this product line that hands a shop a reason to contact a
-- customer again WITHOUT buying it: a fixed, dated, legally required return visit, known months
-- ahead. Every one of those systems sells reminders on it.
--
-- ── THIS IS NOT A MONEY SOURCE, AND MUST NOT BECOME ONE ──
-- A vehicle carries no amount, no rate and no btw. Nothing here reaches financial-result, the
-- aangifte, the drawer or daily_turnover. The value is the RECORD and the REMINDER, and keeping
-- money out means this whole feature cannot be wrong about a euro. A job that costs something is
-- rung up on the Kassa or sent as an invoice, both of which already exist and both of which own
-- their own truth. If a later change wants to link the two, the link belongs on THAT side.
--
-- ── RDW ──
-- The RDW open-data API returns make, model and APK expiry for any Dutch plate, free. It is
-- deliberately not wired up: the response field names could not be verified against a live call
-- from the environment this was written in, and a parser on guessed field names reads as working
-- while silently storing the wrong car. The plate and the date are typed for now; when the shape is
-- confirmed the lookup enriches these same columns and nothing here changes.
--
-- Opt-in by use: an owner who never adds a vehicle never creates a row and never sees the surface.
-- Non-breaking: a new table only.
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Stored BARE and uppercase ("12ABC3"), never with the dashes. A Dutch owner types the same
  -- plate five ways — "12-ab-3", "12 AB 3", "12ab3" — and a lookup matching only one of them
  -- creates a second record for a car that is already there. The dashes are a display concern:
  -- displayKenteken() in vehicle.ts derives them from the sidecode shape.
  kenteken text NOT NULL,
  description text,          -- "Volkswagen Golf" — typed, or one day from RDW
  customer_name text,
  customer_phone text,
  -- The APK expiry. NULL is a real and common state: a garage types a plate the moment a car is in
  -- front of it and often does not know the date yet. apkStatus() reports that as 'unknown' rather
  -- than 'ok' on purpose — a reminder list that silently forgets the cars it has no date for is
  -- worthless, because the ones it forgets are invisible by construction.
  apk_expiry date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  -- One record per plate per owner. A garage that types the same car twice on two visits should
  -- find the first record, not build a second history beside it.
  CONSTRAINT vehicles_unique_plate UNIQUE (user_id, kenteken)
);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicles_select_own ON public.vehicles;
CREATE POLICY vehicles_select_own ON public.vehicles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS vehicles_insert_own ON public.vehicles;
CREATE POLICY vehicles_insert_own ON public.vehicles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS vehicles_update_own ON public.vehicles;
CREATE POLICY vehicles_update_own ON public.vehicles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS vehicles_delete_own ON public.vehicles;
CREATE POLICY vehicles_delete_own ON public.vehicles
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- The two access patterns: the whole list, and the ones whose APK is nearest.
CREATE INDEX IF NOT EXISTS idx_vehicles_user_apk
  ON public.vehicles (user_id, apk_expiry);

COMMENT ON TABLE public.vehicles IS
  '[VOERTUIG] Cars a garage works on, with their APK expiry. NOT a money source: carries no amount, '
  'rate or btw and is read by no financial engine. Kenteken stored bare and uppercase; see vehicle.ts.';
