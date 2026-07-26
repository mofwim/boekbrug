-- [BANK-TX-STATEMENT-LINK] Link every bank transaction back to the statement file it was
-- imported from. Without this, deleting a bank statement could not reverse the transactions it
-- introduced (there was no join key), so a delete left the derived bookings — paid invoices,
-- matched links, and pos_income card-commission — stranded and pointing at a file that no longer
-- exists. Re-importing a corrected statement then ADDED the corrected lines on top of the old
-- wrong ones (dedup only skips identical rows), doubling omzet + acquirer commission. This column
-- is the prerequisite for a true cascade-reverse on statement delete.
--
-- ON DELETE SET NULL: a direct doc delete never breaks the FK; the delete-statement route does the
-- booking reversal FIRST (it needs the link to find the rows), then removes the file.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS statement_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_statement_doc
  ON public.bank_transactions (statement_document_id);
