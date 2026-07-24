-- [PUSH] Web Push (VAPID) subscription store — one row per device/browser.
--
-- Bridges the existing in-app `notifications` events to the device as system
-- notifications. Non-breaking: a new table only; a user with no subscription
-- simply never gets a push (the in-app notification is unchanged).
--
-- A push endpoint is globally unique per subscription, so `endpoint` is the
-- natural key (UNIQUE) and the subscribe API UPSERTs on it — re-subscribing the
-- same browser refreshes its keys/last_seen instead of duplicating. A user can
-- have many rows (phone + laptop + installed PWA). Writes go through the API,
-- which sets user_id from the authenticated session (it can never be spoofed);
-- the sender reads via service_role (bypasses RLS) to fan out to every device.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,          -- the push service URL (natural key)
  p256dh       text NOT NULL,                 -- client public key (payload encryption)
  auth         text NOT NULL,                 -- client auth secret (payload encryption)
  user_agent   text,                          -- best-effort device label for the UI
  created_at   timestamp with time zone DEFAULT now(),
  last_seen_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A user may read and remove their OWN device subscriptions. Inserts/updates are
-- done server-side via service_role (like `notifications`), so no authenticated
-- INSERT/UPDATE policy is granted — the session can never write another user_id.
DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id);
