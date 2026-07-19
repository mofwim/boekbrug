// public/sw.js
// [PWA] Minimal, deliberately conservative service worker.
//
// It does exactly ONE thing: when a top-level navigation fails because the
// device is offline, it shows a branded /offline.html instead of the browser's
// dinosaur/error page. That's all PWABuilder needs to see a real PWA, and it
// makes BoekBrug installable as a proper app on every platform.
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
