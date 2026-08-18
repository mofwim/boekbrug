"use client";

// src/components/beveiliging/ToegangPaneel.tsx
// [BEVEILIGING] "Who can open this administration" — the panel that renders the answer.
//
// It holds NO data of its own and asks nothing: every row arrives as a prop. That is what lets
// tests/render/ hand it a bookkeeper, a revoked member and an incomplete read and assert what
// appears — the branch that matters most here is the one where a read FAILED, and a component that
// fetched for itself could only ever be tested against a working database.
//
// ── WHAT THIS PANEL IS NOT ALLOWED TO DO ──
//
// Say "alleen jij" on a read that did not finish. The whole screen exists so that a zzp'er can
// check whether anyone else is in his books; a wrongly reassuring answer here is worse than no
// screen at all, because he would stop looking. src/lib/security-overview.ts computes `complete`
// for exactly this, and the two sentences below are chosen by it and never by counting rows.

import { formatDateNL } from "@/lib/format-nl";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AccessHolder } from "@/lib/security-overview";

/** The role word for a holder. English identifiers, Dutch sentences from the catalogue. */
const ROLE_KEY: Record<AccessHolder["kind"], MessageKey> = {
  owner: "bev.rol.eigenaar",
  bookkeeper: "bev.rol.boekhouder",
  member: "bev.rol.medewerker",
};

export type ToegangPaneelProps = {
  holders: AccessHolder[];
  /** Did every source answer? False means the list is a floor, not a total. */
  complete: boolean;
  /** How many people, or null when that could not be established. */
  count: number | null;
  /** The catalogue, handed in so this component holds no language — see AGENTS.md. */
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Where "toegang beheren" goes. A link, because ending access is a decision with its own screen. */
  manageHref: string;
};

export function ToegangPaneel({ holders, complete, count, t, manageHref }: ToegangPaneelProps) {
  // The headline sentence, chosen by `complete` and never by holders.length. Three outcomes:
  //   · we read everything and there is only the owner  → "alleen jij", which is a promise
  //   · we read everything and there are more           → the number, which is a fact
  //   · something did not answer                        → say that, and print no number at all
  const headline = !complete
    ? t("bev.wie.onvolledig")
    : count !== null && count > 1
      ? t("bev.wie.aantal", { aantal: count })
      : t("bev.wie.alleenJij");

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t("bev.wie.titel")}</p>

      {/* amber when the answer is incomplete, so the eye separates "this is the list" from "this is
          as much of the list as we could read". role="alert" only in that case: a complete answer is
          not an alert. */}
      <p
        role={complete ? undefined : "alert"}
        className={`text-sm leading-relaxed ${complete ? "text-gray-500" : "text-amber-700"}`}
      >
        {headline}
      </p>

      <div className="border-t border-gray-100 pt-3 space-y-3">
        {holders.map((holder, index) => (
          // The key is the revoke id where there is one, and the position where there is not — a
          // holder without an id is precisely the row we could not identify, and two of them must
          // still render as two rows.
          <div key={holder.revokeId ?? `${holder.kind}-${index}`} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 break-words">
                {/* A name we could not read says so. It is not a person called "Onbekend", and the
                    difference is the one this screen is about: we know someone is there. */}
                {holder.name ?? t("bev.naamOnbekend")}
              </p>
              {holder.email && (
                // dir="ltr": an e-mail address is not language, and in Arabic it must not be laid
                // out from the right.
                <p dir="ltr" className="text-xs text-gray-500 break-all" style={{ textAlign: "start" }}>
                  {holder.email}
                </p>
              )}
              {holder.since && (
                <p className="text-xs text-gray-400">{t("bev.sinds", { datum: formatDateNL(holder.since) })}</p>
              )}
            </div>
            <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {t(ROLE_KEY[holder.kind])}
            </span>
          </div>
        ))}
      </div>

      {/* Ending someone's access is not a button on a summary. It happens on the screen that owns
          that decision, which already knows how to explain what revoking does and what it does not
          undo — the invoices a medewerker issued stay in the number series. A second, quicker way to
          do it here would be the one with none of that around it. */}
      <div className="pt-1">
        <a
          href={manageHref}
          className="inline-block border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50"
        >
          {t("bev.beheren")}
        </a>
      </div>
    </div>
  );
}
