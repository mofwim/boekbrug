"use client";
// src/app/ServiceWorkerRegister.tsx
// [PWA] Registers the offline-fallback service worker (public/sw.js) on the
// client. Rendered once from the root layout. Feature-detected and best-effort:
// if registration fails (older browser, private mode) the app is completely
// unaffected — the worker only ever adds an offline fallback page.

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal: the app works fine without the offline fallback.
      });
    };
    // Defer to after load so SW registration never competes with first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
