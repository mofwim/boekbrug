-- =====================================================================
-- [MOVE-PAYMENT] Een geboekte betaling van de ENE factuur naar de ANDERE verplaatsen.
-- BoekBrug · Juli 2026
-- =====================================================================
-- WAAROM: geld belandt op de verkeerde factuur. Een leverancier stuurt dezelfde rekening twee
-- keer (de tweede gecorrigeerd), de matcher kiest de verkeerde van twee gelijke bedragen, of de
-- eigenaar tikt de betaling handmatig op de bovenste rij. Tot nu toe was het antwoord: draai de
-- betaling terug op A, zoek de banklijn opnieuw op, boek hem op B. Drie handelingen, en tussen de
-- eerste en de laatste bestaat het geld nergens — de factuur die het wél kreeg staat open, de
-- banklijn staat weer bij "Te bevestigen", en als de eigenaar daar stopt (telefoon gaat, batterij
-- leeg) blijft de administratie in die halve staat achter. Precies het soort stille schade waar
-- een boekhoudapp niet in mag handelen.
--
-- Verplaatsen is één handeling en hoort dus één TRANSACTIE te zijn. Alles hieronder gebeurt in
-- deze functie: de koppelrij verhuist, beide facturen krijgen hun amount_paid opnieuw afgeleid uit
-- de OVERGEBLEVEN koppelingen, en beide statussen volgen dat. Er is geen moment waarop het geld
-- op nul facturen staat, en geen moment waarop het op twee staat.
--
-- MODEL: een betaling IS een rij in bank_tx_invoices (amount_applied), met of zonder banklijn
-- erachter (een handmatige deelbetaling heeft transaction_id NULL + paid_on + method). Verplaatsen
-- = die ene rij een andere invoice_id geven. Daarmee blijft de ene waarheid staan die de rest van
-- het systeem al gebruikt:
--
--     invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)
--
-- WAT DEZE FUNCTIE WEIGERT, en waarom ze weigert in plaats van iets slims te doen:
--   · De doelfactuur heeft niet genoeg open staan. Dan zou verplaatsen ofwel overbetalen, ofwel
--     het bedrag stilletjes splitsen (deel verplaatsen, rest laten staan). Allebei zijn een
--     antwoord dat de eigenaar niet gegeven heeft, en het tweede is niet eens zichtbaar. Dus:
--     weigeren, met beide bedragen erbij, zodat het scherm kan zeggen wat er wél open staat.
--   · Dezelfde banklijn is al aan de doelfactuur gekoppeld. Samenvoegen zou twee boekingen tot
--     één maken zonder spoor; dat is geen verplaatsing meer.
--   · Andere richting. Geld dat naar een leverancier ging kan nooit een verkoopfactuur voldoen.
--   · De boekhouder heeft een van beide verwerkt. Zijn grendel gaat voor, aan beide kanten.
--
-- APPLY: draai dit hele bestand in de Supabase SQL editor (één transactie).
-- Niets hier verwijdert data. Idempotent / opnieuw te draaien.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.move_invoice_payment(
  p_user_id           uuid,
  p_link_id           uuid,   -- bank_tx_invoices.id — DE betaling, niet "de betalingen van"
  p_target_invoice_id uuid
)
RETURNS TABLE (
  applied            numeric,
  source_invoice_id  uuid,
  source_amount_paid numeric,
  source_status      text,
  target_amount_paid numeric,
  target_status      text,
  target_is_paid     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id        uuid;
  v_src_id       uuid;
  v_amount       numeric;
  v_paid_on      date;
  v_method       text;
  v_first_id     uuid;
  v_second_id    uuid;
  v_src_status   text;
  v_src_acc      text;
  v_src_dir      text;
  v_src_total    numeric;
  v_tgt_status   text;
  v_tgt_acc      text;
  v_tgt_dir      text;
  v_tgt_total    numeric;
  v_tgt_paid     numeric;
  v_tgt_remain   numeric;
  v_src_sum      numeric;
  v_tgt_sum      numeric;
  v_src_new_st   text;
  v_tgt_new_st   text;
  v_tgt_is_paid  boolean;
  v_pay_date     date;
  v_src_date     date;
  v_src_method   text;
  v_pay_method   text;
  v_tx_left      integer;
  -- Eén cent speling, gelijk aan apply_bank_payment: OCR-totalen kunnen een afrondingstik
  -- schelen, en "binnen een cent gedekt" is betaald.
  v_eps          numeric := 0.01;
BEGIN
  -- Aanroepgarantie, gelijk aan apply_bank_payment/book_bank_batch: sessieclient → auth.uid() =
  -- gebruiker; service-role → NULL (vastgezet via p_user_id). Een andere ingelogde gebruiker: nee.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] caller % may not move payments for %', auth.uid(), p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- ── De betaling zelf. Vergrendeld: een gelijktijdige ontkoppeling of tweede verplaatsing van
  --    dezelfde rij blokkeert hier en ziet daarna de nieuwe werkelijkheid.
  SELECT l.transaction_id, l.invoice_id, coalesce(l.amount_applied, 0), l.paid_on, l.method
    INTO v_tx_id, v_src_id, v_amount, v_paid_on, v_method
  FROM public.bank_tx_invoices l
  WHERE l.id = p_link_id AND l.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] payment not found' USING ERRCODE = '55000';
  END IF;

  IF v_src_id = p_target_invoice_id THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] same invoice' USING ERRCODE = '55000';
  END IF;

  -- Een koppelrij van vóór [PARTIAL-PAY] draagt geen bedrag. We weten dan niet WAT we verplaatsen,
  -- en een bedrag verzinnen is het ene wat hier niet mag. Ontkoppelen en opnieuw boeken is voor
  -- die rijen de eerlijke weg.
  IF v_amount <= 0 THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] payment has no recorded amount' USING ERRCODE = '55000';
  END IF;

  -- Dezelfde banklijn al op de doelfactuur? Dan zou de verplaatsing botsen met
  -- bank_tx_invoices_unique_pair, en samenvoegen maakt van twee boekingen stilletjes één.
  IF v_tx_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bank_tx_invoices
    WHERE transaction_id = v_tx_id AND invoice_id = p_target_invoice_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target already linked to this transaction' USING ERRCODE = '55000';
  END IF;

  -- ── Beide facturen vergrendelen, in VASTE volgorde op id. Twee eigenaren die tegelijk in
  --    tegengestelde richting verplaatsen zouden elkaar anders klemzetten; oplopend op id kan dat
  --    per definitie niet.
  v_first_id  := LEAST(v_src_id, p_target_invoice_id);
  v_second_id := GREATEST(v_src_id, p_target_invoice_id);
  PERFORM 1 FROM public.invoices
    WHERE id = v_first_id AND (sender_id = p_user_id OR receiver_id = p_user_id)
    FOR UPDATE;
  PERFORM 1 FROM public.invoices
    WHERE id = v_second_id AND (sender_id = p_user_id OR receiver_id = p_user_id)
    FOR UPDATE;

  SELECT i.status, i.accountant_status, i.direction, abs(coalesce(i.total_inc_btw, 0))
    INTO v_src_status, v_src_acc, v_src_dir, v_src_total
  FROM public.invoices i
  WHERE i.id = v_src_id AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] source invoice not found / not owned' USING ERRCODE = '55000';
  END IF;

  SELECT i.status, i.accountant_status, i.direction, abs(coalesce(i.total_inc_btw, 0)), coalesce(i.amount_paid, 0)
    INTO v_tgt_status, v_tgt_acc, v_tgt_dir, v_tgt_total, v_tgt_paid
  FROM public.invoices i
  WHERE i.id = p_target_invoice_id AND (i.sender_id = p_user_id OR i.receiver_id = p_user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target invoice not found / not owned' USING ERRCODE = '55000';
  END IF;

  -- De grendel van de boekhouder gaat voor, aan BEIDE kanten: verplaatsen verandert het bedrag
  -- waar hij al mee gerekend heeft, of dat nu de bron of het doel is.
  IF v_src_acc = 'verwerkt' OR v_tgt_acc = 'verwerkt' THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] invoice locked by accountant (verwerkt)' USING ERRCODE = '55000';
  END IF;

  -- Geld dat naar een leverancier ging kan geen verkoopfactuur voldoen, en omgekeerd.
  IF v_src_dir IS DISTINCT FROM v_tgt_dir THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] direction mismatch' USING ERRCODE = '55000';
  END IF;

  -- Het doel moet een factuur zijn die geld KAN ontvangen. 'processing' staat er bewust niet bij:
  -- een nog ongecontroleerde inkoopfactuur mag niet via deze weg betaald raken (haar bedragen
  -- komen ongezien uit de AI, en betaald telt mee in de BTW). 'archived' en 'draft' evenmin.
  IF v_tgt_status NOT IN ('received', 'sent', 'overdue') THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target not payable' USING ERRCODE = '55000';
  END IF;
  IF v_tgt_total <= 0 THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target has no total to settle' USING ERRCODE = '55000';
  END IF;

  -- Past het? Niet passen betekent overbetalen óf stilletjes splitsen. Allebei zijn een antwoord
  -- dat de eigenaar niet gaf. Het bedrag dat wél open staat gaat mee in de melding, zodat het
  -- scherm kan zeggen wat er kan in plaats van alleen dat het niet kan.
  v_tgt_remain := v_tgt_total - v_tgt_paid;
  IF v_amount > v_tgt_remain + v_eps THEN
    RAISE EXCEPTION '[MOVE-PAYMENT] target remaining % is less than payment %', v_tgt_remain, v_amount
      USING ERRCODE = '55000';
  END IF;

  -- ── De verplaatsing zelf: één rij, één kolom. Bedrag, datum en methode gaan ongewijzigd mee —
  --    het is dezelfde betaling, hij hoort alleen ergens anders.
  UPDATE public.bank_tx_invoices
  SET invoice_id = p_target_invoice_id
  WHERE id = p_link_id AND user_id = p_user_id;

  -- De banklijn draagt één "representatieve" invoice_id voor het scherm. Wees hij naar de bron en
  -- is er van deze lijn niets meer op die bron over, dan moet hij mee — anders wijst de Bank-pagina
  -- naar een factuur die deze betaling niet meer heeft.
  IF v_tx_id IS NOT NULL THEN
    SELECT count(*) INTO v_tx_left
    FROM public.bank_tx_invoices
    WHERE transaction_id = v_tx_id AND invoice_id = v_src_id AND user_id = p_user_id;
    IF v_tx_left = 0 THEN
      UPDATE public.bank_transactions
      SET invoice_id = p_target_invoice_id
      WHERE id = v_tx_id AND user_id = p_user_id AND invoice_id = v_src_id;
    END IF;
  END IF;

  -- ── Beide amount_paid opnieuw AFLEIDEN uit de overgebleven koppelingen. Niet optellen en
  --    aftrekken: afleiden. Zo kan deze functie geen drift introduceren, ook niet als er naast
  --    deze betaling nog termijnen op een van beide facturen staan.
  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_src_sum
  FROM public.bank_tx_invoices WHERE invoice_id = v_src_id AND user_id = p_user_id;
  IF v_src_total > 0 AND v_src_sum > v_src_total THEN v_src_sum := v_src_total; END IF;
  IF v_src_sum < 0 THEN v_src_sum := 0; END IF;

  SELECT coalesce(sum(coalesce(amount_applied, 0)), 0) INTO v_tgt_sum
  FROM public.bank_tx_invoices WHERE invoice_id = p_target_invoice_id AND user_id = p_user_id;
  IF v_tgt_total > 0 AND v_tgt_sum > v_tgt_total THEN v_tgt_sum := v_tgt_total; END IF;
  IF v_tgt_sum < 0 THEN v_tgt_sum := 0; END IF;

  -- ── Bron: het geld is weg, dus een 'paid' die op deze betaling steunde mag niet blijven staan.
  --    Terug naar de open status die de richting bewijst (gelijk aan /api/bank/unlink). Blijft er
  --    niets over, dan gaan ook de betaalvelden leeg — anders leest de factuur als betaald op een
  --    datum waarop er niets meer geboekt staat.
  v_src_new_st := v_src_status;
  IF v_src_status = 'paid' AND v_src_sum < v_src_total - v_eps THEN
    v_src_new_st := CASE WHEN v_src_dir = 'incoming' THEN 'received' ELSE 'sent' END;
  END IF;
  IF v_src_sum <= 0 THEN
    UPDATE public.invoices
    SET amount_paid = 0, status = v_src_new_st,
        payment_method = NULL, marked_paid_at = NULL, payment_date = NULL
    WHERE id = v_src_id;
  ELSE
    -- Blijven er termijnen achter, dan moet de betaaldatum van de bron OPNIEUW worden afgeleid.
    -- Hem laten staan is een stille fout met gevolgen: payment_date bepaalt in welk kwartaal een
    -- betaling meetelt onder het kasstelsel, en na het weghalen van de EERSTE termijn zou de
    -- factuur blijven beweren dat er in mei betaald is terwijl het overgebleven geld in juni
    -- binnenkwam. Dat is een verkeerde aangifte die nergens een melding geeft. Dus: de vroegste
    -- OVERGEBLEVEN betaling bepaalt datum én methode — een banklijn levert zijn eigen datum, een
    -- handmatige termijn draagt paid_on/method zelf.
    SELECT coalesce(l.paid_on, bt.date), coalesce(l.method, 'bank')
      INTO v_src_date, v_src_method
    FROM public.bank_tx_invoices l
    LEFT JOIN public.bank_transactions bt ON bt.id = l.transaction_id AND bt.user_id = p_user_id
    WHERE l.invoice_id = v_src_id AND l.user_id = p_user_id
    ORDER BY coalesce(l.paid_on, bt.date) NULLS LAST, l.created_at
    LIMIT 1;

    UPDATE public.invoices
    SET amount_paid    = v_src_sum,
        status         = v_src_new_st,
        payment_date   = coalesce(v_src_date, payment_date),
        payment_method = coalesce(v_src_method, payment_method)
    WHERE id = v_src_id;
  END IF;

  -- ── Doel: de datum en methode van DEZE betaling, niet van vandaag. Een banklijn levert zijn
  --    eigen datum; een handmatige termijn draagt paid_on/method zelf. De kasstelsel-aangifte
  --    hangt aan die datum, dus "nu" invullen zou de betaling naar een ander kwartaal schuiven.
  v_pay_method := coalesce(v_method, 'bank');
  v_pay_date   := v_paid_on;
  IF v_pay_date IS NULL AND v_tx_id IS NOT NULL THEN
    SELECT date INTO v_pay_date FROM public.bank_transactions WHERE id = v_tx_id AND user_id = p_user_id;
  END IF;

  v_tgt_is_paid := v_tgt_sum >= v_tgt_total - v_eps;
  IF v_tgt_is_paid THEN
    v_tgt_new_st := 'paid';
    UPDATE public.invoices
    SET amount_paid = v_tgt_total, status = 'paid',
        payment_method = v_pay_method, marked_paid_at = now(),
        payment_date = coalesce(payment_date, v_pay_date)
    WHERE id = p_target_invoice_id;
  ELSE
    v_tgt_new_st := v_tgt_status;
    UPDATE public.invoices
    SET amount_paid = v_tgt_sum,
        payment_method = coalesce(payment_method, v_pay_method),
        payment_date = coalesce(payment_date, v_pay_date)
    WHERE id = p_target_invoice_id;
  END IF;

  RETURN QUERY SELECT v_amount, v_src_id, v_src_sum, v_src_new_st, v_tgt_sum, v_tgt_new_st, v_tgt_is_paid;
END;
$$;

COMMENT ON FUNCTION public.move_invoice_payment(uuid, uuid, uuid) IS
  '[MOVE-PAYMENT] Verplaatst ATOMAIR één geboekte betaling (bank_tx_invoices-rij, bank of handmatig) naar een andere factuur: de koppelrij verhuist, de banklijn volgt als er van hem niets op de bron overblijft, en beide amount_paid worden opnieuw afgeleid uit de overgebleven koppelingen met de statussen erachteraan. Weigert (55000) bij te weinig openstaand op het doel, een doel dat al aan dezelfde banklijn hangt, een richtingsverschil, een niet-betaalbare doelstatus, een verwerkt-grendel aan een van beide kanten, en bij een koppelrij zonder vastgelegd bedrag.';

REVOKE ALL ON FUNCTION public.move_invoice_payment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_invoice_payment(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- De functie bestaat. Moet true zijn.
SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'move_invoice_payment'
) AS heeft_move_invoice_payment;
