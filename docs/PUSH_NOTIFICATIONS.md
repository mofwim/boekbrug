# Push notifications (Web Push / VAPID)

Delivers the app's existing in-app `notifications` rows to the user's devices as
system notifications. It is **additive and best-effort**: if push is not
configured, or a user has no subscribed device, nothing changes — the in-app
notification is written exactly as before.

## How it fits together

```
event (invoice paid, bon in mailbox, aangifte klaar, …)
  → createNotification()            src/lib/notifications.ts   (unchanged source of truth: inserts the row)
      → sendPushToUser()            src/lib/push.ts            (best-effort, never throws)
          → web-push → each device  → public/sw.js 'push'      (renders the system notification)
                                     → 'notificationclick'      (focuses the app on the row's link)
```

- **Subscription store:** `push_subscriptions` (migration
  `supabase/migrations/push_subscriptions.sql`) — one row per device, natural key
  `endpoint`, RLS: a user reads/deletes only their own rows; writes go via
  service_role.
- **Opt-in UI:** `PushNotificationCard` on `/dashboard/settings`. It self-hides
  when push is unsupported or unconfigured, so there is never a dead toggle.
- **Pure core (tested):** `src/lib/push-payload.ts` (+ `.test.ts`) — payload
  building, the prune-on-404/410 rule, and the VAPID-configured guard.

## Required environment variables

Generate one keypair (once, per environment) and set:

```bash
npx web-push generate-vapid-keys
```

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | client + server | the VAPID **public** key. Safe to expose. |
| `VAPID_PRIVATE_KEY` | server only | the VAPID **private** key. **Secret** — never commit. |
| `VAPID_SUBJECT` | server only | any address you can be reached at — it does **not** need to be a boekbrug.nl mailbox. `mailto:` + your own email (e.g. your Gmail) is fine, or `https://boekbrug.nl`. Only used by the push service to contact the sender if there's a problem. |

If any of the three is missing, push is simply **off**: the server no-ops and the
settings card hides itself. Rotating the keys invalidates existing subscriptions;
they self-heal because a dead endpoint (410) is pruned on the next send and the
device re-subscribes on its next visit.

## Platform notes

- **Desktop Chrome/Edge/Firefox, Android Chrome:** work out of the box once the
  user opts in.
- **iPhone/iPad (Safari):** Web Push only works for an **installed PWA** (Add to
  Home Screen), since iOS 16.4 — not in a Safari tab. The settings card says so.
- **Android TWA (Play Store build):** forwards these Web Push notifications as
  system notifications; no Firebase/FCM needed for the MVP.
