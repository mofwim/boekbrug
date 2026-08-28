-- =====================================================================
-- [LEVERANCIER-INTAKE] De vijf die al binnen zijn — alleen de koppeling
-- =====================================================================
-- Gemeten op 28-08-2026: 15 inkoopfacturen met een IBAN en zonder leverancier.
-- Voor 5 daarvan bestaat al een leveranciersrij met precies dat IBAN; de andere
-- 10 zijn leveranciers die het systeem simpelweg nog niet kent, en die horen
-- niet met de hand aangemaakt te worden.
--
-- WAAROM NIET supplier_backfill.sql OPNIEUW DRAAIEN:
-- die zet óók client_name = de naam van de leverancier. Dat was juist op de dag
-- dat hij geschreven werd, maar sindsdien kan de eigenaar een naam gecorrigeerd
-- hebben — en dan overschrijft een herstelactie een menselijke correctie met een
-- machinale. Deze query raakt client_name niet aan. Alleen de koppeling die
-- ontbrak.
--
-- Idempotent: hij doet niets aan rijen die al een supplier_id hebben.

-- ── STAP 1  KIJKEN (verandert niets) ─────────────────────────────────────────
-- Verwacht: 5 regels. Lees ze door voordat je stap 2 draait.
select inv.id,
       inv.invoice_date,
       inv.client_name          as naam_op_de_factuur,
       s.name                   as naam_van_de_leverancier,
       inv.vendor_iban,
       inv.total_inc_btw
  from public.invoices inv
  join public.suppliers s
    on s.user_id = inv.receiver_id
   and s.iban = upper(regexp_replace(coalesce(inv.vendor_iban, ''), '\s', '', 'g'))
 where inv.direction = 'incoming'
   and inv.status in ('processing', 'received')
   and inv.supplier_id is null
   and inv.vendor_iban is not null
   and length(regexp_replace(inv.vendor_iban, '\s', '', 'g')) >= 15
 order by inv.invoice_date;

-- ── STAP 2  KOPPELEN ─────────────────────────────────────────────────────────
-- Verwacht: UPDATE 5.
update public.invoices as inv
   set supplier_id = s.id
  from public.suppliers as s
 where s.user_id = inv.receiver_id
   and s.iban = upper(regexp_replace(coalesce(inv.vendor_iban, ''), '\s', '', 'g'))
   and inv.direction = 'incoming'
   and inv.status in ('processing', 'received')
   and inv.supplier_id is null
   and inv.vendor_iban is not null
   and length(regexp_replace(inv.vendor_iban, '\s', '', 'g')) >= 15;

-- ── STAP 3  CONTROLE ─────────────────────────────────────────────────────────
-- Verwacht: leverancier_bestaat_al = 0. De 10 onbekende leveranciers blijven
-- staan en dat hoort: de app maakt er vanzelf een aan zodra dezelfde afzender
-- nog een factuur stuurt, want vanaf nu lopen alle vijf de binnenkomstwegen
-- langs de leveranciersregistratie.
select count(*) filter (where s.id is not null) as leverancier_bestaat_al,
       count(*) filter (where s.id is null)     as leverancier_onbekend
  from public.invoices inv
  left join public.suppliers s
    on s.user_id = inv.receiver_id
   and s.iban = upper(regexp_replace(coalesce(inv.vendor_iban, ''), '\s', '', 'g'))
 where inv.direction = 'incoming'
   and inv.status in ('processing', 'received')
   and inv.supplier_id is null
   and inv.vendor_iban is not null
   and length(regexp_replace(inv.vendor_iban, '\s', '', 'g')) >= 15;
