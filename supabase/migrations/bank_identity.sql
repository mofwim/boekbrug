-- [BANK-IDENTITY] Persisted financial identity for bank transactions + learned memory.
--
-- Gives every bank line an identity beyond "which invoice did it pay?": kosten /
-- omzet / prive / transfer / tax / fee / pos_income. The AI + a per-counterpart
-- memory suggest it; the owner confirms. Once confirmed for a counterpart, the memory
-- auto-applies next time — the system gets smarter with use.
--
-- Non-breaking: only NEW nullable columns + a NEW table. Safe to apply at any time;
-- no existing code depends on these until the categorize UI ships.

-- ── bank_transactions: identity columns ──────────────────────────────────────
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS category_source text
    CHECK (category_source IN ('ai', 'memory', 'user', 'rule')),
  ADD COLUMN IF NOT EXISTS category_confirmed boolean NOT NULL DEFAULT false;

-- ── counterpart_memory: learned category per counterpart ─────────────────────
CREATE TABLE IF NOT EXISTS public.counterpart_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  counterpart_key text NOT NULL,      -- normalized (PSP/legal-suffix stripped, lowercased)
  category text NOT NULL,
  times_seen integer NOT NULL DEFAULT 1,
  last_used_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT counterpart_memory_unique UNIQUE (user_id, counterpart_key)
);

ALTER TABLE public.counterpart_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY counterpart_memory_select_own ON public.counterpart_memory
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY counterpart_memory_insert_own ON public.counterpart_memory
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY counterpart_memory_update_own ON public.counterpart_memory
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY counterpart_memory_delete_own ON public.counterpart_memory
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_counterpart_memory_lookup
  ON public.counterpart_memory (user_id, counterpart_key);
