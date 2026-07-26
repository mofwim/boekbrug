// public/sw.js
// [PWA] Minimal, deliberately conservative service worker.
//
// It does two things, both additive and safe:
//   1. Offline fallback: when a top-level navigation fails because the device is
//      offline, it shows a branded /offline.html instead of the browser's error
//      page. That's all PWABuilder needs to see a real PWA, and it makes
//      BoekBrug installable as a proper app on every platform.
//   2. [PUSH] Web Push: renders system notifications pushed from the server
//      (see the 'push' + 'notificationclick' handlers at the bottom).
//
// What it intentionally does NOT do — because this is an auth-heavy, server-
// rendered financial app where stale content would be dangerous:
//   - It never caches or serves cached versions of live pages while online
//     (navigations are always network-first; the cache is a failure fallback).
//   - It never touches /api/*, data requests, or authenticated responses.
// This keeps sessions, RLS and money data always fresh — the SW can only ever
// add an offline page, never replace real content.
//
// A future push-notification feature would extend THIS worker (a 'push' +
// 'notificationclick' handler); nothing else in the app has to change.

const CACHE = "boekbrug-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // {cache:'reload'} bypasses the HTTP cache so we precache a fresh copy.
      cache.add(new Request(OFFLINE_URL, { cache: "reload" }))
    )
  );
  // Activate this worker as soon as it's installed (don't wait for old tabs).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Only intercept full-page navigations. Everything else (assets, API, data,
  // fetch/XHR) goes straight to the network untouched.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        // Network-first: the live server always wins when we're online.
        return await fetch(event.request);
      } catch {
        // Offline → serve the cached branded fallback page.
        const cache = await caches.open(CACHE);
        const cached = await cache.match(OFFLINE_URL);
        return cached ?? Response.error();
      }
    })()
  );
});

// ─── [PUSH] Web Push notifications ──────────────────────────────────────────
// Renders a system notification from the payload sent by src/lib/push.ts
// (buildPushPayload). Defensive by design: a malformed/absent payload still
// yields a valid, branded notification instead of throwing inside the worker.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload (or none) — fall back to plain text, then to defaults.
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch {
      data = {};
    }
  }

  const title = (data && typeof data.title === "string" && data.title.trim()) || "BoekBrug";
  const body = (data && typeof data.body === "string") ? data.body : "";
  // Only ever navigate to an in-app path; anything else defaults to /dashboard.
  const url = (data && typeof data.url === "string" && data.url.startsWith("/")) ? data.url : "/dashboard";
  const tag = (data && typeof data.tag === "string" && data.tag.trim()) || "boekbrug";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,               // same tag replaces (never stacks) the previous one
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }).catch(() => {
      // Showing a notification must never reject the push event.
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an existing app tab and route it there, rather than opening a duplicate.
      for (const client of all) {
        if ("focus" in client) {
          try {
            await client.focus();
            if ("navigate" in client) await client.navigate(target);
            return;
          } catch {
            // fall through to openWindow
          }
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
