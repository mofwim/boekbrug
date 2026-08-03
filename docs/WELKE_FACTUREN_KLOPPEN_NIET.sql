-- =====================================================================
-- WELKE FACTUREN KLOPPEN NIET? — één query, over de hele administratie.
-- BoekBrug · augustus 2026
-- =====================================================================
-- WHY THIS FILE EXISTS
--
-- The app already flags a broken breakdown on the card you are looking at, and
-- [INVOICE-SCAN] counts them on /dashboard/incoming/manage. Both answer for a SET: the
-- scan covers CONFIRMED purchase invoices (received + paid), the queue shows one card at
-- a time. Neither answers the question an owner asks once they have seen two of these:
-- which invoices, in the whole administration, carry this defect right now — including
-- the ones still sitting in the verify queue, and the sales side nobody was looking at.
--
-- This query does. It reads only; it changes nothing.
--
-- THE DEFECT IT FINDS
--
-- CAN Vleesgroothandel 2034382 is the case that prompted it. The invoice prints two rate
-- lines — 9% over 973,15 and 0% over −3,86 — so the true ex-btw is 969,29, which the
-- invoice itself states. The reader took the 9% base and dropped the 0% line, storing
-- 973,15. Off by exactly 3,86.
--
-- That is one shape of a wider class: any line the reader does not fold into the ex-btw
-- base. Confirmed in this administration so far — statiegeld / emballage / kratten
-- (0%-rated, often NEGATIVE when containers are returned), and a second btw rate on a
-- mixed invoice. The industry literature on invoice OCR names the same offenders:
-- negative credit/return lines, freight and surcharge lines, percentage discounts.
--
-- TWO TESTS, NOT ONE — the same pair src/lib/invoice-scan.ts applies, and for the same
-- reason. Checking only "ex + btw = totaal" misses a whole class: the potato wholesaler
-- stored 26,00 + 13,42 = 39,42, which reconciles to the cent and is still entirely wrong.
-- What betrays it is the RATE: 13,42 over 26,00 is 52%, and no Dutch rate or blend of
-- 0/9/21 reaches that.
--
-- The tolerances are the code's, not new ones: 0.02 is SUM_TOLERANCE (btw-reconcile.ts)
-- and 21 is MAX_NL_RATE (invoice-scan.ts). If those ever change, change them here too —
-- a report that disagrees with the screen is worse than no report.
--
-- WHAT IT DOES NOT DO
--
-- It names no culprit. Where the sum is broken, BOTH repairs are shown: arithmetic cannot
-- tell whether the ex-btw or the btw is the wrong figure, because both readings satisfy
-- the identity. The invoice on paper decides that. Same rule the app follows on screen.
-- =====================================================================

with kandidaat as (
  select
    i.id,
    i.invoice_number,
    i.client_name,
    i.invoice_date,
    i.status,
    i.direction,
    i.invoice_type,
    coalesce(i.total_ex_btw, 0)::numeric  as ex,
    coalesce(i.btw_amount, 0)::numeric    as btw,
    coalesce(i.total_inc_btw, 0)::numeric as incl
  from public.invoices i
  where (i.sender_id = auth.uid() or i.receiver_id = auth.uid())
    -- An archived row is out of the books on purpose; it is not a figure to repair.
    and coalesce(i.status, '') <> 'archived'
    -- A row carrying ONLY a total is not a contradiction — it is an unread breakdown, which
    -- the intake gate already reports in its own words. Counting it here would send the
    -- owner hunting for an error that is really a missing reading.
    and i.total_ex_btw is not null
    and i.btw_amount is not null
),
beoordeeld as (
  select
    k.*,
    round(k.ex + k.btw - k.incl, 2)                                    as verschil,
    round(k.incl - k.btw, 2)                                           as excl_zou_zijn,
    round(k.incl - k.ex, 2)                                            as btw_zou_zijn,
    -- Magnitude ratio, exactly as safecore and the confirm modal do it, so a credit note
    -- carrying positive goods-btw over a negative net base is not falsely flagged.
    case when abs(k.ex) > 0.005
         then round(abs(k.btw / k.ex) * 100)
    end                                                                as tarief
  from kandidaat k
)
select
  case
    when abs(b.verschil) > 0.02 then '① excl + btw ≠ totaal'
    else                             '② tarief kan niet'
  end                                                        as soort,
  b.invoice_number                                           as factuurnummer,
  b.client_name                                              as leverancier,
  b.invoice_date                                             as factuurdatum,
  to_char(b.invoice_date, 'YYYY') || '-Q' ||
    to_char(ceil(extract(month from b.invoice_date) / 3.0), 'FM9')     as kwartaal,
  case when b.direction = 'incoming' then 'inkoop' else 'verkoop' end  as kant,
  b.status,
  b.ex                                                       as opgeslagen_excl,
  b.btw                                                      as opgeslagen_btw,
  b.incl                                                     as opgeslagen_totaal,
  b.verschil,
  -- Both readings, never one. Only shown where the sum is what broke, and only where the
  -- repaired figure implies a rate that could actually exist.
  case when abs(b.verschil) > 0.02
        and b.excl_zou_zijn <> 0
        and round(abs(b.btw / b.excl_zou_zijn) * 100) <= 21
       then b.excl_zou_zijn end                              as of_excl_wordt,
  case when abs(b.verschil) > 0.02
        and b.ex <> 0
        and round(abs(b.btw_zou_zijn / b.ex) * 100) <= 21
       then b.btw_zou_zijn end                               as of_btw_wordt,
  b.tarief                                                   as gevonden_tarief
from beoordeeld b
where abs(b.verschil) > 0.02                     -- ① the sum does not hold
   or (b.tarief is not null and b.tarief > 21)   -- ② the rate cannot exist
-- Biggest money first: that is the order in which they are worth an evening.
order by abs(b.verschil) desc, abs(b.incl) desc;

-- =====================================================================
-- HOE JE DIT LEEST
--
--   soort ①  excl + btw ≠ totaal.  Meestal een 0%-regel die de lezer heeft laten vallen —
--            statiegeld, emballage, kratten (vaak NEGATIEF bij retour), of een tweede
--            btw-tarief. Kijk op de factuur welke van de twee kolommen klopt:
--            `of_excl_wordt` of `of_btw_wordt`. Staat er maar één ingevuld, dan is de
--            andere lezing rekenkundig onmogelijk en is de keuze al gemaakt.
--
--   soort ②  Het tarief kan niet bestaan (boven 21%). Deze halen de sombegrenzing WEL —
--            de drie bedragen kloppen onderling — en zijn toch fout. De aardappelgroothandel
--            stond op 26,00 + 13,42 = 39,42: sluitend, en 52% btw.
--
-- CORRIGEREN doe je in de app, niet hier. In de wachtrij: open de factuur, tik de juiste
-- knop onder "Even controleren" en bevestig. Al geboekt: /dashboard/incoming/manage of de
-- Bank-pagina → "Gegevens corrigeren". Beide schrijven via dezelfde route, met dezelfde
-- controles en hetzelfde audit-spoor — en ze voeden de leveranciersgeheugen, zodat de lezer
-- dezelfde fout bij dezelfde leverancier minder vaak maakt.
--
-- GEEN RIJEN is een echt antwoord: dan klopt op dit moment elke uitsplitsing in je
-- administratie. Het is niet hetzelfde als "er is niets gecontroleerd" — deze query kijkt
-- naar élke niet-gearchiveerde factuur met een uitsplitsing, inkoop én verkoop.
-- =====================================================================
