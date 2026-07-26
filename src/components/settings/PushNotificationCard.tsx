"use client";
// src/components/settings/PushNotificationCard.tsx
// [PUSH] The opt-in card for the Instellingen page. Shows the right control (or a
// clear, honest message) for every device state — never a dead button.

import { usePushNotifications } from "@/lib/use-push-notifications";

export function PushNotificationCard() {
  const { status, error, enable, disable } = usePushNotifications();

  // On unconfigured/unsupported there is nothing the user can do — hide the card
  // entirely rather than showing a broken toggle.
  if (status === "unconfigured" || status === "unsupported") return null;

  const on = status === "on";
  const busy = status === "loading";

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Meldingen
      </p>
      <p className="text-sm text-gray-500">
        Ontvang een melding op dit apparaat bij belangrijke gebeurtenissen —
        een betaalde factuur, een nieuw bonnetje in je mailbox, of je
        kwartaalaangifte die klaarstaat.
      </p>

      {status === "denied" ? (
        <p className="text-sm text-amber-600">
          Meldingen zijn geblokkeerd in je browser. Zet ze weer aan via de
          slot-/instellingen-knop naast de adresbalk, en probeer daarna opnieuw.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <button
            onClick={on ? disable : enable}
            disabled={busy}
            className={
              on
                ? "border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                : "bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            }
          >
            {busy ? "Even geduld…" : on ? "Meldingen uitzetten" : "Meldingen aanzetten"}
          </button>
          {on && <span className="text-sm text-green-600">✓ Aan op dit apparaat</span>}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <p className="text-xs text-gray-400">
        Op de iPhone werkt dit alleen als je BoekBrug eerst aan je beginscherm
        toevoegt (installeert als app).
      </p>
    </div>
  );
}
