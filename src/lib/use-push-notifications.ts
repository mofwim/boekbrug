"use client";
// src/lib/use-push-notifications.ts
// [PUSH] Client hook that owns the Web Push subscription lifecycle for the
// current device. Feature-detected and defensive: on any unsupported browser it
// reports "unsupported" and does nothing — it can never throw into the UI.
//
// State machine (status):
//   unsupported  — no serviceWorker / PushManager / Notification on this browser
//   unconfigured — the app has no VAPID public key (server-side feature off)
//   denied       — the user blocked notifications at the browser level
//   off          — supported + allowed, but this device is not subscribed
//   on           — this device is subscribed and will receive pushes
//   loading      — a subscribe/unsubscribe round-trip is in flight

import { useCallback, useEffect, useState } from "react";

export type PushStatus = "unsupported" | "unconfigured" | "denied" | "off" | "on" | "loading";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** VAPID keys are URL-safe base64; the browser needs the raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [error, setError] = useState<string>("");

  // Reflect the current device state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupported()) { if (!cancelled) setStatus("unsupported"); return; }
      if (!VAPID_PUBLIC_KEY) { if (!cancelled) setStatus("unconfigured"); return; }
      if (Notification.permission === "denied") { if (!cancelled) setStatus("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const enable = useCallback(async () => {
    setError("");
    if (!isSupported() || !VAPID_PUBLIC_KEY) return;
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // Reuse an existing subscription if the browser already has one.
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast: the bytes are a valid BufferSource at runtime; the DOM lib's
          // type narrows ArrayBufferLike away (SharedArrayBuffer union) here.
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("store_failed");
      setStatus("on");
    } catch (err) {
      console.error("[push] enable failed:", err);
      setError("Kon meldingen niet inschakelen — probeer opnieuw.");
      // Reflect the true browser state rather than a guess.
      setStatus(Notification.permission === "denied" ? "denied" : "off");
    }
  }, []);

  const disable = useCallback(async () => {
    setError("");
    if (!isSupported()) return;
    setStatus("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Tell the server first (so it stops sending), then drop it locally.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setStatus("off");
    } catch (err) {
      console.error("[push] disable failed:", err);
      setError("Kon meldingen niet uitschakelen — probeer opnieuw.");
      setStatus("on");
    }
  }, []);

  return { status, error, enable, disable };
}
