-- [ARTIKELEN] The coded line-item catalog — gateway #1 of the Big Five. A store/ZZP's
-- recurring invoice lines saved once, reused with a code or a search: "22 → Transport tafel,
-- €45, 21%". It turns the catalog into the language of the owner's work — the data-gravity
-- anchor: leaving means rebuilding it from scratch (the Excel pain).
--
-- DECOUPLED from invoices by design: an invoice line COPIES description/price/rate at
-- creation (invoice_lines already stores them), so editing or archiving an article NEVER
-- rewrites a past invoice. The catalog is a convenience source, not a foreign key — history
-- stays exactly as it was billed.
--
-- Opt-in by use, own-row RLS, mirrors daily_turnover / eft_settlements. NEW table only.

CREATE TABLE IF NOT EXISTS public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text,                              -- optional shortcut ("22"); unique per owner when set
  description text NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,  -- ex-BTW, like invoice_lines.unit_price
  btw_rate numeric NOT NULL DEFAULT 21,   -- 21 / 9 / 0
  unit text,                              -- optional ("stuk", "uur", "km")
  active boolean NOT NULL DEFAULT true,    -- soft archive: hidden from the picker, kept for history
  usage_count integer NOT NULL DEFAULT 0, -- times used on an invoice line — powers "most used" sort
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- One code per owner (when a code is given). Two NULL codes are allowed (codes are optional).
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_user_code
  ON public.articles (user_id, code) WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_user_active
  ON public.articles (user_id, active, usage_count DESC);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS articles_select_own ON public.articles;
CREATE POLICY articles_select_own ON public.articles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS articles_insert_own ON public.articles;
CREATE POLICY articles_insert_own ON public.articles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS articles_update_own ON public.articles;
CREATE POLICY articles_update_own ON public.articles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS articles_delete_own ON public.articles;
CREATE POLICY articles_delete_own ON public.articles
  FOR DELETE TO authenticated USING (user_id = auth.uid());
