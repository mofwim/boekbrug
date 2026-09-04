-- [NUL-POST] Het deel van total_ex_btw waarop GEEN btw zit.
--
-- Statiegeld, emballage, europallets en kratten dragen geen btw. Elk Nederlands boekhoudpakket
-- (jortt, Silvasoft, SnelStart, Acumulus) boekt zo'n post als een APARTE 0%-regel naast de belaste
-- goederenregel. BoekBrug had daar geen veld voor, dus verdween het bedrag in total_ex_btw — en
-- daarmee klopte het afgeleide tarief niet meer: btw / ex landt dan tussen de wettelijke tarieven.
--
-- Gemeten op productie: 52 van 479 geboekte inkoopfacturen (€ 40.761) berekenen een tarief dat
-- geen 0/9/21 is terwijl excl + btw exact het totaal is. Aardappelgroothandel Altena komt op 6,50%,
-- Elegance Brands op 8,38%, Vars Foods op 8,45% — precies het beeld van een onbelaste post die in
-- de grondslag verstopt zit.
--
-- ZIT IN total_ex_btw, NIET ERNAAST. Dat is de Nederlandse conventie: een 0%-regel telt gewoon mee
-- in het bedrag exclusief btw, dus excl + btw = totaal blijft precies zoals het was. Alleen het
-- TARIEF wordt voortaan over de belaste grondslag (excl - onbelast) gerekend. Zou dit bedrag
-- ernaast staan, dan zou elke bestaande som in de app opeens niet meer kloppen.
--
-- DEFAULT 0 en NOT NULL: een factuur zonder 0%-post is de normale factuur, en null zou elke
-- optelling verderop in een null veranderen.
alter table public.invoices
  add column if not exists untaxed_amount numeric not null default 0;

comment on column public.invoices.untaxed_amount is
  '[NUL-POST] Het deel van total_ex_btw waarop geen btw zit (statiegeld, emballage, europallets). '
  'Zit IN total_ex_btw, niet ernaast: excl + btw = totaal blijft gelden. Het btw-tarief hoort '
  'berekend te worden over (total_ex_btw - untaxed_amount).';
