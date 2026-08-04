-- accountant_invoice_mandate.sql
-- [MANDAAT] The client authorises their accountant to issue invoices in their name.
--
-- WHY THIS IS ALLOWED AT ALL
--   Art. 35 lid 1 Wet OB creates, in so many words, the possibility that an invoice is issued
--   "in zijn naam en voor zijn rekening ... door een derde" — in the entrepreneur's name and for
--   their account, by a third party. So an accountant MAY invoice for their client. What does not
--   move is the responsibility: the entrepreneur remains liable for the invoice meeting every
--   requirement of art. 35a. Every design choice below follows from that one sentence.
--
-- WHAT THAT MEANS CONCRETELY, AND WHERE IT IS ENFORCED
--   1. ONE number series per company. The number is minted from the CLIENT's series, never the
--      accountant's — same rule, same reason as the sales member (see company_members_sales_role.sql).
--   2. The client must be able to see who did it. Every row already carries created_by; the send
--      route notifies the client on every invoice sent in their name.
--   3. The client must be able to STOP it, instantly and alone. Revoking is one UPDATE, and it
--      takes effect on the accountant's next click — no grace period.
--
-- WHY IT IS A SEPARATE TABLE AND NOT A COLUMN ON accountant_clients
--   Because it is a permission with a history, not a setting. Granted, revoked, granted again —
--   each is a row, nothing is ever deleted, and "on 12 March this accountant was allowed to invoice
--   for me" stays answerable years later. That is what art. 35a responsibility needs: a trail. A
--   boolean column answers only "now", and answers it by overwriting the evidence.
--
-- WHY THERE IS NO authenticated INSERT/UPDATE POLICY
--   accountant_clients_insert_consent.sql is the scar this rule comes from: an INSERT policy whose
--   only condition was "name yourself as the accountant" let anyone link themselves to any client
--   with one PostgREST call. A mandate is strictly MORE dangerous than a link — it issues invoices
--   under someone else's VAT number. So it repeats the fix that worked: every write goes through a
--   vetted server route on service_role, and the table grants the session nothing but SELECT.

-- ── The table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accountant_invoice_mandates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The entrepreneur who grants it. Their series, their VAT number, their responsibility.
  zzper_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The accountant who receives it.
  accountant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  -- Set ⇒ the mandate grants nothing from that moment on. Rows are never deleted: a revoked
  -- mandate is the proof that it once existed, which is exactly what an audit asks about.
  revoked_at    timestamptz,
  -- Who ended it. Either party may: the client withdraws, or the accountant declines the job.
  revoked_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- A client cannot hold two live mandates for the same accountant. Re-granting after a revoke is a
-- NEW row (revoked_at IS NOT NULL on the old one), so the history stays intact.
CREATE UNIQUE INDEX IF NOT EXISTS accountant_invoice_mandates_one_active
  ON public.accountant_invoice_mandates (zzper_id, accountant_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS accountant_invoice_mandates_accountant
  ON public.accountant_invoice_mandates (accountant_id) WHERE revoked_at IS NULL;

ALTER TABLE public.accountant_invoice_mandates ENABLE ROW LEVEL SECURITY;

-- Both parties may READ it — the client to see what they granted, the accountant to see what they
-- may do. Nobody may write through a session; see the header.
DROP POLICY IF EXISTS accountant_invoice_mandates_select ON public.accountant_invoice_mandates;
CREATE POLICY accountant_invoice_mandates_select ON public.accountant_invoice_mandates
  FOR SELECT TO authenticated
  USING (zzper_id = auth.uid() OR accountant_id = auth.uid());

-- ── The one question the rest of this file asks ──────────────────────────────
-- SECURITY DEFINER because both callers below run inside SECURITY DEFINER / trigger context where
-- the session's RLS is not what decides. STABLE, not IMMUTABLE: it reads tables.
--
-- It deliberately re-checks the accountant_clients LINK as well. A mandate without a link is a
-- mandate to a stranger — that combination should be impossible (the grant route requires the
-- link), and the cheapest place to make "should be" into "is" is here, where every path passes.
CREATE OR REPLACE FUNCTION public.has_active_invoice_mandate(
  p_accountant uuid,
  p_client     uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.accountant_invoice_mandates m
      JOIN public.accountant_clients ac
        ON ac.accountant_id = m.accountant_id
       AND ac.zzper_id      = m.zzper_id
     WHERE m.accountant_id = p_accountant
       AND m.zzper_id      = p_client
       AND m.revoked_at IS NULL
  );
$$;

-- ── The number series — the third exception, and the last one ────────────────
-- next_invoice_seq() refuses to mint unless you ARE the owner or you are an active 'verkoop'
-- member of theirs. A mandated accountant is the third case, and it is added the same way the
-- second one was: not by opening the guard, but by widening it by exactly one clause.
--
-- auth.uid() IS NULL stays unconditionally forbidden. That is the load-bearing half: it is why no
-- server route can quietly mint a number on service_role, and adding an accountant must not become
-- the reason that stops being true.
--
-- The rest of the function is taken over LITERALLY from company_members_sales_role.sql — same
-- atomic INSERT..ON CONFLICT, same forward-only behaviour. Nothing changes about how a number comes
-- into being, only about who may ask for one.
CREATE OR REPLACE FUNCTION public.next_invoice_seq(
  p_user_id uuid,
  p_year    int,
  p_type    text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
BEGIN
  IF auth.uid() IS NULL
     OR ( auth.uid() <> p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM public.company_members cm
             WHERE cm.member_id = auth.uid()
               AND cm.owner_id  = p_user_id
               AND cm.role      = 'verkoop'
               AND (cm.revoked_at IS NULL OR cm.revoked_at > now())
          )
          -- [MANDAAT] Art. 35 lid 1: an invoice may be issued in the entrepreneur's name and for
          -- their account by a third party. This is that third party — and only while the client
          -- says so. Revoking is one UPDATE and lands on the very next allocation.
          AND NOT public.has_active_invoice_mandate(auth.uid(), p_user_id)
     )
  THEN
    RAISE EXCEPTION
      '[FACTUUR-B] next_invoice_seq: caller % may not allocate for %',
      auth.uid(), p_user_id
      USING ERRCODE = '42501';   -- insufficient_privilege
  END IF;

  IF p_type NOT IN ('factuur','creditnota','pro_forma') THEN
    RAISE EXCEPTION '[FACTUUR-B] next_invoice_seq: invalid type %', p_type
      USING ERRCODE = '22023';   -- invalid_parameter_value
  END IF;

  IF p_year < 0 THEN
    RAISE EXCEPTION '[FACTUUR-B] next_invoice_seq: invalid year %', p_year
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
  VALUES (p_user_id, p_year, p_type, 1)
  ON CONFLICT (user_id, year, type)
  DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_seq;
END;
$$;

-- ── The write guard — widened by one case, and no wider ──────────────────────
-- prevent_accountant_amount_changes() (invoice_accountant_write_guard.sql) locks a linked
-- accountant out of every financially-relevant column, because their only legitimate invoice write
-- was accountant_status. Issuing an invoice needs two of those columns — status and invoice_number
-- — so the guard has to learn one new sentence.
--
-- It is deliberately the narrowest sentence that makes the feature work. ALL of these must hold:
--   · an active mandate from this invoice's owner to this accountant;
--   · the accountant CREATED this draft themselves (created_by), so they can never finish, alter or
--     re-price an invoice the client made;
--   · the row is still a draft, so nothing that already carries a number can be touched;
--   · sender_id, receiver_id and direction do not move — the invoice stays the client's, stays
--     outgoing, and cannot be pushed into another tenant's books.
-- Everything outside that is refused exactly as before, including by this same accountant one
-- second after the invoice is sent.
CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Exception 1: service_role / pipeline (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Exception 2: ZZP invoice owner (sender) may change anything
  IF OLD.sender_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  -- Exception 3: receiver of an incoming invoice (mark-as-paid)
  IF OLD.receiver_id = auth.uid() AND OLD.direction = 'incoming' THEN
    RETURN NEW;
  END IF;
  -- [MANDAAT] Exception 4: a mandated accountant issuing a draft THEY made for THIS client.
  IF OLD.status = 'draft'
     AND OLD.created_by = auth.uid()
     AND NEW.sender_id   IS NOT DISTINCT FROM OLD.sender_id
     AND NEW.receiver_id IS NOT DISTINCT FROM OLD.receiver_id
     AND NEW.direction   IS NOT DISTINCT FROM OLD.direction
     AND public.has_active_invoice_mandate(auth.uid(), OLD.sender_id)
  THEN
    RETURN NEW;
  END IF;
  -- Everyone else (accountant) — protected columns. The accountant's only
  -- legitimate invoice write is accountant_status; every financially-relevant
  -- column is locked here.
  IF (NEW.total_ex_btw        IS DISTINCT FROM OLD.total_ex_btw)        OR
     (NEW.btw_amount          IS DISTINCT FROM OLD.btw_amount)          OR
     (NEW.total_inc_btw       IS DISTINCT FROM OLD.total_inc_btw)       OR
     (NEW.invoice_date        IS DISTINCT FROM OLD.invoice_date)        OR
     (NEW.due_date            IS DISTINCT FROM OLD.due_date)            OR
     (NEW.sender_id           IS DISTINCT FROM OLD.sender_id)           OR
     (NEW.receiver_id         IS DISTINCT FROM OLD.receiver_id)         OR
     (NEW.direction           IS DISTINCT FROM OLD.direction)           OR
     (NEW.status              IS DISTINCT FROM OLD.status)              OR
     (NEW.amount_paid         IS DISTINCT FROM OLD.amount_paid)         OR
     (NEW.payment_method      IS DISTINCT FROM OLD.payment_method)      OR
     (NEW.payment_date        IS DISTINCT FROM OLD.payment_date)        OR
     (NEW.marked_paid_at      IS DISTINCT FROM OLD.marked_paid_at)      OR
     (NEW.payment_prepared_at IS DISTINCT FROM OLD.payment_prepared_at) OR
     (NEW.pay_token           IS DISTINCT FROM OLD.pay_token)           OR
     (NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number)      OR
     (NEW.invoice_type        IS DISTINCT FROM OLD.invoice_type)
  THEN
    RAISE EXCEPTION
      'Permission denied: only the invoice owner can modify amounts, dates, status or payment fields (invoice_id: %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_accountant_amount_changes ON public.invoices;
CREATE TRIGGER prevent_accountant_amount_changes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_accountant_amount_changes();

-- =====================================================================
-- CHECK — run this block AFTER applying. It is the difference between
-- "applied" and "applied and verified".
-- =====================================================================
-- 1) Is it all there?
--    SELECT to_regclass('public.accountant_invoice_mandates') AS mandaten,
--           (SELECT count(*) FROM pg_proc WHERE proname = 'has_active_invoice_mandate') AS fn;
--    Expected: both filled / 1.
--
-- 2) The guard still refuses a stranger. As accountant A, with NO mandate from client C:
--    SELECT public.next_invoice_seq('<C>', 2026, 'factuur');
--    Expected: ERROR 42501 — caller may not allocate for.
--
-- 3) And accepts a mandated one. After the client grants it:
--    SELECT public.has_active_invoice_mandate('<A>', '<C>');   -- expected: t
--
-- 4) Revoking lands immediately:
--    UPDATE public.accountant_invoice_mandates SET revoked_at = now() WHERE ...;
--    SELECT public.has_active_invoice_mandate('<A>', '<C>');   -- expected: f

-- ── NAGEKOMEN: de rijen die de boekhouder MOET kunnen zien om te kunnen versturen ─────────────
-- [MANDAAT-RLS] Dit ontbrak, en zonder dit werkte de hele functie niet.
--
-- De drie bewakers hierboven regelen wat de boekhouder MAG. Ze zeggen niets over wat hij ZIET, en
-- dat is een aparte vraag met een eigen antwoord: RLS. De bestaande boekhouderspolicies hangen
-- allemaal aan de gegenereerde kolom `shared`:
--
--     shared boolean GENERATED ALWAYS AS (status = ANY (ARRAY['sent','received','paid'])) STORED
--
-- Een CONCEPT is dus per definitie niet `shared`. Gevolg, en het is precies de volgorde waarin het
-- misging: /api/invoice/draft schrijft de factuur met service_role (dat lukt), waarna
-- /api/invoice/send hem met de SESSIE-client terugleest — en nul rijen krijgt. De route antwoordt
-- "Factuur niet gevonden", het concept blijft achter in de administratie van de klant, en elke
-- nieuwe poging maakt er nog één. Ook als de leesregel er wél was geweest, had de UPDATE die het
-- nummer vastlegt niets geraakt: invoices_accountant_update_v2 eist óók `shared = true`.
--
-- Waarom dit RLS wordt en geen service_role. Het zou makkelijker zijn om die twee queries op de
-- pipeline-client te zetten, en dat is elders in dit product ook het patroon (accountant-access.ts).
-- Maar service_role zet `auth.uid()` op NULL, en dan slaat prevent_accountant_amount_changes()
-- over — inclusief de nauwe uitzondering 4 die hierboven met zoveel zorg is opgeschreven. De
-- factuur uitgeven is het moment waarop die bewaker er het meest toe doet. Dus krijgt de sessie
-- precies genoeg rechten om dat ene ding te doen, en blijft de trigger eroverheen staan.
--
-- Elke voorwaarde hieronder is dezelfde als in uitzondering 4, met opzet: een leesrecht dat ruimer
-- is dan het schrijfrecht laat een boekhouder rondkijken in concepten die hij nooit mag aanraken.

DROP POLICY IF EXISTS invoices_mandate_draft_read ON public.invoices;
CREATE POLICY invoices_mandate_draft_read ON public.invoices
  FOR SELECT TO authenticated
  USING (
    status = 'draft'
    AND created_by = auth.uid()
    AND public.has_active_invoice_mandate(auth.uid(), sender_id)
  );

-- De UPDATE die het nummer vastlegt en de status op 'sent' zet.
--   USING     kijkt naar de OUDE rij: nog een concept, en van hem.
--   WITH CHECK kijkt naar de NIEUWE rij, en mag daarom NIET op status = 'draft' staan — na deze
--              update is hij 'sent'. Wat er wél moet blijven gelden: hij is nog steeds van deze
--              boekhouder, en het mandaat leeft nog. Alles wat verder niet mag bewegen
--              (bedragen, sender_id, richting) staat in de trigger, die hier gewoon overheen loopt.
DROP POLICY IF EXISTS invoices_mandate_draft_issue ON public.invoices;
CREATE POLICY invoices_mandate_draft_issue ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    status = 'draft'
    AND created_by = auth.uid()
    AND public.has_active_invoice_mandate(auth.uid(), sender_id)
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_active_invoice_mandate(auth.uid(), sender_id)
  );

-- De regels, want de PDF wordt uit de regels gerenderd.
-- invoice_lines_select_accountant bestaat al, maar eist `i.status = 'paid'` — bedoeld voor het
-- nakijken van een afgeronde factuur, niet voor het maken van er een. Zonder deze policy rendert
-- de PDF met een lege regeltabel: een factuur zonder inhoud, met een verbruikt nummer.
-- Niet beperkt tot 'draft': een herverzending na een mislukte mail leest ze opnieuw.
DROP POLICY IF EXISTS invoice_lines_mandate_read ON public.invoice_lines;
CREATE POLICY invoice_lines_mandate_read ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_lines.invoice_id
      AND i.created_by = auth.uid()
      AND public.has_active_invoice_mandate(auth.uid(), i.sender_id)
  ));

-- =====================================================================
-- CONTROLE 5 — de policies die hierboven ontbraken.
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='public'
--      AND policyname IN ('invoices_mandate_draft_read','invoices_mandate_draft_issue',
--                         'invoice_lines_mandate_read');
--   Verwacht: drie rijen. Ontbreken ze, dan geeft ELKE factuur namens een klant een 404.
