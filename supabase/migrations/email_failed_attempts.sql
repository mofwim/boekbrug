-- [POISON-PILL] Per-attachment failure counter for the email-sync watermark.
--
-- Problem this fixes: the incremental sync walks messages oldest-first and STOPS the watermark at
-- the first message with an attachment that didn't finish this run (classifyFailed / save error).
-- That is correct for a genuine transient failure — but an attachment that fails EVERY sync (a
-- non-transient error mis-read as transient, a file that always times out, a persistent save/DB
-- error) becomes a poison pill: its message blocks the walk forever, the watermark freezes at that
-- timestamp, and every newer invoice is re-fetched each round and can be starved behind the batch
-- cap. This table counts consecutive failed attempts per attachment so the sync can GIVE UP after
-- SYNC_MAX_ATTEMPTS: the attachment is then kept owner-visible (a could_not_read document) and
-- registered in email_skipped_attachments (reason 'repeatedly_failed', which PHASE 0 treats as
-- terminal), letting the watermark advance past it. A success/duplicate/terminal-skip deletes the
-- row, so a finally-successful flaky file never carries a stale count.

CREATE TABLE IF NOT EXISTS public.email_failed_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- "<messageId>:<filename>" — the same key used across the sync (knownKeys / completedKeys /
  -- email_skipped_attachments.source_message_id).
  source_message_id text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_failed_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT email_failed_attempts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- One counter row per attachment per user — the upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS email_failed_attempts_user_msg_uidx
  ON public.email_failed_attempts (user_id, source_message_id);

ALTER TABLE public.email_failed_attempts ENABLE ROW LEVEL SECURITY;

-- Owner may read their own rows (diagnostics). All writes happen through the service-role pipeline
-- in syncUserEmails, which bypasses RLS — so no insert/update/delete policy is granted to
-- authenticated users. Mirrors how email_skipped_attachments is written.
DROP POLICY IF EXISTS email_failed_attempts_select_own ON public.email_failed_attempts;
CREATE POLICY email_failed_attempts_select_own ON public.email_failed_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
