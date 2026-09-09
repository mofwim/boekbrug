-- [TARIEF-KLANT] Het tarief dat je met DEZE klant hebt afgesproken.
--
-- Het uurtarief werd per uur ingetypt. Een adviseur met vier opdrachtgevers heeft vier tarieven,
-- en het veld is optioneel — dus het meest getoonde signaal van de hele app ("uren zonder tarief
-- vallen straks buiten de factuur") ontstaat op precies dat lege veld. Dit haalt de aanleiding
-- weg in plaats van de waarschuwing.
--
-- Vult alleen een LEEG tarief. Wat de ondernemer zelf intypt wint altijd: een uur tegen een
-- afwijkend tarief is een afspraak, geen vergissing.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS default_hourly_rate numeric(10,2)
  CHECK (default_hourly_rate IS NULL OR default_hourly_rate >= 0);
COMMENT ON COLUMN public.clients.default_hourly_rate IS
  '[TARIEF-KLANT] The rate agreed with THIS customer, ex btw. Fills an empty rate when an hour is written for them; never overwrites what the owner typed. Null = no rate agreed.';
