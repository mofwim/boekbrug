-- [OFFERTE-WERK] De geaccepteerde offerte wordt het werk.
--
-- Tot nu toe eindigde een offerte op één manier: "Maak factuur aan". Voor een vak met een
-- werkscherm is dat een stap te vroeg — de klant zei ja tegen een bedrag, en DAARNA wordt het
-- werk gedaan, lopen de uren, komen de bonnen. De ondernemer typte de afspraak dus over.
--
-- Eén offerte wordt precies één stuk werk (UNIQUE): een afspraak die tweemaal werk wordt, is een
-- afspraak die tweemaal gefactureerd kan worden. De offerte zelf wordt gearchiveerd op het moment
-- dat het werk ontstaat — hetzelfde als bij de factuurconversie, en om dezelfde reden: er mag
-- daarna maar één deur naar het geld openstaan. Het werk verwijderen zet hem terug.
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS offerte_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_items_offerte_once_idx ON public.work_items(offerte_id) WHERE offerte_id IS NOT NULL;
COMMENT ON COLUMN public.work_items.offerte_id IS
  '[OFFERTE-WERK] The accepted offerte this work came from. Unique: one offerte becomes one piece of work, so the agreement cannot be turned into two.';
