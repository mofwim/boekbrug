-- supabase/migrations/bank_auto_book_blocked.sql
-- [AUTO-BOEK-ONGEDAAN] De eigenaar heeft een automatische boeking teruggedraaid. Doe hem niet
-- binnen het uur opnieuw.
--
-- runBankAutoConfirm koppelt een bankregel aan een factuur en zet die factuur op 'paid'. Het is
-- expliciet omkeerbaar bedoeld — de kop van die module zegt "fully reversible (owner can unlink)"
-- en het scherm zegt het letterlijk tegen de eigenaar: "One tap on Ontkoppelen above undoes it."
--
-- Die belofte houdt geen uur stand. /api/bank/unlink zet de regel terug op status 'pending' en
-- invoice_id NULL, en herstelt de factuur naar 'received'/'sent'. Dat is precies de toestand
-- waaruit auto-confirm boekt: hij leest `status = 'pending'` en facturen `neq status 'paid'`. Het
-- bewijs is niet veranderd — hetzelfde bedrag, dezelfde IBAN, dezelfde tegenpartij — dus de
-- volgende cron-ronde neemt dezelfde beslissing en legt dezelfde koppeling terug.
--
-- Het concrete geval: een leverancier incasseert elke maand EUR 89,00. De januarifactuur staat nog
-- open, de maartfactuur is nog niet binnen. Op 3 maart komt een afschrijving van EUR 89,00 op de
-- bekende IBAN binnen, dus de tier is 'certain' en de cron zet de JANUARIfactuur op betaald met
-- betaaldatum 03-03. De eigenaar ziet de verkeerde maand en tikt Ontkoppelen. Binnen het uur staat
-- het er weer, en onder het kasstelsel staat de BTW van die factuur dan in het verkeerde kwartaal.
--
-- Waarom een kolom en niet een bestaande: auto_match_reason betekent iets anders (de app heeft dit
-- op bedrag alleen geboekt, niemand heeft het nagekeken) en wordt sinds vandaag juist GEWIST zodra
-- een mens de regel overneemt. Er twee dingen mee zeggen maakt beide onbetrouwbaar.
--
-- Idempotent. Verandert niets aan bestaande rijen: de kolom is NULL voor alles wat er staat, en
-- zolang de migratie niet is gedraaid slaat de app hem over (columnExists in column-probe.ts) en
-- gedraagt zich exact zoals vandaag.
--
-- ⚠️ NIET TOEGEPAST door de assistent. Draai hem zelf in de Supabase SQL-editor, of laat hem
-- liggen: er gaat niets stuk zolang hij er niet is — behalve dat een teruggedraaide boeking
-- terugkomt, zoals nu.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS auto_book_blocked_at timestamptz;

COMMENT ON COLUMN public.bank_transactions.auto_book_blocked_at IS
  'Wanneer de eigenaar een AUTOMATISCHE koppeling van deze regel ongedaan maakte. Zolang dit staat boekt runBankAutoConfirm de regel niet opnieuw; hij gaat naar de matcher, waar een mens hem koppelt. Een handmatige bevestiging laat hem staan: de regel is dan al opgelost.';

-- De lezing die hem gebruikt is `.is("auto_book_blocked_at", null)` op de pending-selectie van
-- auto-confirm. Partieel, want alleen NULL wordt gezocht en alleen binnen pending.
CREATE INDEX IF NOT EXISTS bank_transactions_auto_book_open_idx
  ON public.bank_transactions (user_id)
  WHERE auto_book_blocked_at IS NULL AND status = 'pending';
