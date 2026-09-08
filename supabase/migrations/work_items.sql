-- [WERK] The trade's own work as a row: one primitive under every vertical.
--
-- The owner's decision (8 September 2026): the accounting is not the product. What a mechanic
-- opens the app for is his workshop — the cars of today, who waits for a part, who is ready to
-- invoice. A transporter opens it for his ritten, a builder for his klussen, a cleaner for her
-- opdrachten. Money, btw and the accountant's quarter are what that work PRODUCES, not what the
-- owner is asked to type.
--
-- Read the four entity models side by side and they are one thing with a different noun: a piece
-- of work for one client, with a status, that hours, purchases and documents attach to, and that
-- becomes one invoice. So there is one table. The trade puts its own noun on the screen
-- (Werkorder, Rit, Klus, Opdracht) and its own fields in `fields` (kenteken and km for a garage,
-- van/naar/km/tol for transport); the column set is what every trade shares. Four tables would be
-- four products — the owner's own warning.
--
-- What this deliberately does NOT do, because it is built ON the app and demolishes nothing:
--   · it carries no amounts of its own. Revenue is the invoice it becomes (invoice_id); costs are
--     the purchase invoices that point at it (invoices.work_item_id); hours are time_entries that
--     point at it. Every euro keeps living where the money engines already read it.
--   · it changes no existing behaviour. An owner with no trade, or a trade without a work layer,
--     never sees a row here; the three new columns are nullable and read by nothing old.
--
-- Statuses are one closed set the trades LABEL differently (werk.ts): 'wacht_onderdeel' is a
-- garage word for a state a courier never enters, and the pure module says which trade uses
-- which. The CHECK holds the union so a stray value cannot be written by any door.

CREATE TABLE IF NOT EXISTS public.work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The trade slug (VAKKEN in vak-sjablonen.ts) this row was made under. Kept on the row, not
  -- looked up from the profile at read time: an owner who changes trade keeps his old werkorders
  -- as werkorders.
  vak text NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Kept beside client_id: a walk-in with no client row still has a name on the card.
  client_name text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'bezig', 'wacht_klant', 'wacht_onderdeel', 'klaar', 'gefactureerd', 'geannuleerd')),
  planned_on date,
  done_on date,
  -- Trade fields, validated by werk.ts before they are written: km_stand, klacht (garage);
  -- van, naar, km, tol, brandstof (transport); adres (bouw); locatie, afgesproken_uren (schoonmaak).
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  -- The one sales invoice this work became. Set by /api/werk/[id]/factuur through the ordinary
  -- draft door; never by hand.
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_items_select_own ON public.work_items;
CREATE POLICY work_items_select_own ON public.work_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS work_items_insert_own ON public.work_items;
CREATE POLICY work_items_insert_own ON public.work_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS work_items_update_own ON public.work_items;
CREATE POLICY work_items_update_own ON public.work_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS work_items_delete_own ON public.work_items;
CREATE POLICY work_items_delete_own ON public.work_items
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_work_items_user_status ON public.work_items (user_id, status);
CREATE INDEX IF NOT EXISTS idx_work_items_user_vehicle ON public.work_items (user_id, vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_invoice ON public.work_items (invoice_id) WHERE invoice_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_work_items_updated_at ON public.work_items;
CREATE TRIGGER set_work_items_updated_at
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- What attaches to a piece of work. Nullable, read by nothing that existed before, so every
-- current screen and engine behaves exactly as it did.
ALTER TABLE public.invoices     ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL;
ALTER TABLE public.documents    ADD COLUMN IF NOT EXISTS work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_work_item     ON public.invoices (work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_work_item ON public.time_entries (work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_work_item    ON public.documents (work_item_id) WHERE work_item_id IS NOT NULL;

COMMENT ON TABLE public.work_items IS
  '[WERK] One piece of work for one client — werkorder, rit, klus, opdracht — with a status, that '
  'hours, purchases and documents attach to and that becomes one invoice. Carries no amounts: '
  'revenue is invoice_id, costs are invoices.work_item_id, hours are time_entries.work_item_id.';
COMMENT ON COLUMN public.invoices.work_item_id IS
  '[WERK] For a purchase invoice: the piece of work this cost belongs to. For a sales invoice the '
  'link runs the other way (work_items.invoice_id).';

-- [WERK-REGELS] What the work will CHARGE, in the trade's own line kinds. Measured against the
-- simple tools small garages, couriers, builders and cleaners actually use (docs/MARKT.md): a
-- werkorder carries arbeid and onderdelen, a werkbon uren, materiaal and meerwerk, a rit a
-- ritprijs or km × tarief plus wachttijd — and "Maak factuur" copies those lines onto the invoice.
-- Costs stay where they were (purchase invoices attached by work_item_id); these are sales lines.
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.work_items.lines IS
  '[WERK] What the work will charge, in the trade''s own line kinds (arbeid, onderdeel, materiaal, '
  'meerwerk, ritprijs, km, wachttijd): description, quantity, unit, unit_price ex btw, btw_rate. '
  'Validated by werk.ts; copied onto the invoice by /api/werk/[id]/factuur.';
