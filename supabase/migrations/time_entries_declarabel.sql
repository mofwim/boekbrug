-- [DECLARABEL] Mag dit uur ooit op een factuur?
--
-- De urenregistratie bestond om uren in een FACTUUR te veranderen, dus wat een ondernemer
-- opschreef was de declarabele helft. Het urencriterium (1.225 uur) vraagt om beide helften:
-- acquisitie, administratie, reistijd, offertes maken en leren tellen volledig mee. Een
-- dienstverlener met 900 declarabele uren en 400 uur indirect werk telde zichzelf dus 400 uur
-- tekort tegen de grootste aftrekpost die hij heeft.
--
-- Andersom net zo belangrijk: een niet-declarabel uur heeft geen tarief, en zonder deze kolom
-- las de app dat als "uur zonder tarief valt straks buiten de factuur" — een waarschuwing over
-- werk dat nooit gefactureerd hoort te worden.
--
-- Default true: elk uur dat vóór deze kolom is geschreven, is geschreven om te factureren.
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.time_entries.billable IS
  '[DECLARABEL] May this hour ever go on an invoice? Default true — every hour recorded before this column existed was written down to be billed. False = acquisitie, administratie, leren: it counts for the urencriterium and never for an invoice.';
-- De vraag die elke dag wordt gesteld: welke declarabele uren staan nog op geen factuur.
CREATE INDEX IF NOT EXISTS time_entries_billable_open_idx
  ON public.time_entries(user_id, worked_on)
  WHERE invoice_id IS NULL AND billable;
