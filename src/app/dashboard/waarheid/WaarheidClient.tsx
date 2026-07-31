"use client";

// [TRUTH-LENS] The living financial truth + a unified time lens. ONE number set, re-sliced by the
// lens (Dit kwartaal / Vorig kwartaal / Dit jaar / Alles). Every figure comes from /api/truth,
// which runs computeResultForRange — the SAME reconcile engine /api/result feeds the quarter view
// from, over a different window. The lens windows nest (quarter ⊆ jaar ⊆ alles), so the periods can
// never contradict each other. A window that runs past today is "living" (loopt nog), not final.
//
// Note on "the same figure as the aangifte": the engine is shared, but the Belastingdienst rubrieken
// are rounded to whole euros and 5a is the sum of the ROUNDED rubrieken (aangifte.ts), so the
// concept-aangifte total can sit a euro or two off the exact cents shown here. That is the
// aangifte's rounding, not a second truth — see the footnote rendered under the BTW card.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FONT } from "@/lib/design/tokens";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";

// [HEADER-SYSTEM] This screen previously shipped its own Inter font — the only
// Inter surface in an otherwise Roboto app. It now uses the shared FONT token
// (Roboto). The local `M` palette below is kept (its values already match the
// M3 tokens); only the font was the cross-app inconsistency.
const M = {
  primary: "#1a73e8", surface: "#fff", onSurface: "#202124", muted: "#5f6368",
  line: "#e8eaed", goodBg: "#e6f4ea", warnBg: "#fef7e0", warnFg: "#7a4f00",
};
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

type Lens = "this-quarter" | "last-quarter" | "ytd" | "all";

interface TruthResult {
  omzet: number; kosten: number; resultaat: number;
  btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number;
  // [HONESTY] Revenue booked with NO BTW rate (cash/bank/un-split till day): counted in omzet
  // but its BTW is NOT in btwSaldo. On the screen literally titled "je financiële waarheid" this
  // must be surfaced, exactly like Resultaat/Brug do — else "BTW te betalen" reads silently too low.
  cashOmzetZonderBtw?: number;
  // Of that total, the part from BANK revenue or an un-split till day — its rate comes from the
  // Z-report (Dagomzet), not from Kas. Lets the fix guidance point at ONE screen instead of both.
  omzetZonderBtwNonCash?: number;
}
interface Divergence {
  changed: boolean;
  omzetDelta: number; kostenDelta: number;
  btwVerschuldigdDelta: number; btwVoorbelastingDelta: number; btwSaldoDelta: number;
  needsSuppletie: boolean;
  // [DIVERGENCE-SPLIT] `changed` covers all five deltas; these two say WHICH story to tell, so the
  // banner can never announce a BTW move of € 0,00. See btw-filing.ts.
  btwChanged: boolean; resultaatChanged: boolean; resultaatDelta: number;
}
interface FiledInfo {
  filedAt: string;
  // The frozen snapshot, exactly the columns btw_filings stores. This was typed as TruthResult,
  // which promises a `resultaat` the table has no column for and the API never sends — a type that
  // would have let a future reader render `figures.resultaat` as "undefined". The profit story
  // lives on the divergence (resultaatDelta), which is derived from omzet/kosten.
  figures: {
    omzet: number; kosten: number;
    btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number;
  };
  divergence: Divergence;
}
interface TruthResponse {
  ok: boolean;
  lens: Lens; label: string; quarter: number | null; year: number | null;
  isLiveWindow: boolean;
  filed: FiledInfo | null;
  // [FILING-WINDOW] null unless the lens is a single quarter; false while that quarter still runs.
  quarterEnded: boolean | null;
  result: TruthResult;
  datelessVerifiedCount: number;
  reconciliation: {
    grossMismatchDays: number;
    incompleteDays: number;
    // Days whose card payout/commission is suspect — they book no commission, so the period's
    // costs are knowingly incomplete. Mutually exclusive with the two above; safe to sum.
    commissionIssueDays: number;
    // FALSE → the PIN-grootboek cross-check could not run, so "no mismatches" is weaker than it
    // looks. Never present an unrun check as a clean one.
    pinLedgerAvailable: boolean;
  };
  // [HONESTY-PARITY] Why a figure may be incomplete — at parity with /api/result + /api/readiness.
  scheme: "factuur" | "kas";
  undatedPaidCount: number;
  estimatedPortionCount: number;
  unconfirmedIncomingCount: number;
  // [SCHEME-SPAN] The window straddles the owner's factuur→kas switch.
  spansSchemeChange: boolean;
  schemeSince: string | null;
}

const LENSES: { key: Lens; label: string }[] = [
  { key: "this-quarter", label: "Dit kwartaal" },
  { key: "last-quarter", label: "Vorig kwartaal" },
  { key: "ytd", label: "Dit jaar" },
  { key: "all", label: "Alles" },
];

export default function WaarheidClient() {
  const dialog = useDialog();
  const toast = useToast();
  const [lens, setLens] = useState<Lens>("this-quarter");
  const [data, setData] = useState<TruthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filing, setFiling] = useState(false);

  // [LENS-RACE] Every lens re-runs the whole reconcile pipeline server-side, and the lenses are not
  // equally expensive — "Alles" walks years of invoices, bank lines, kassadagen and card payouts
  // while "Dit kwartaal" walks three months. Tapping Alles and then Dit kwartaal therefore lets the
  // SLOW response land LAST and overwrite the fast one, leaving the chip on "Dit kwartaal" while the
  // heading, the amounts and the file button all belong to "Alles". Wrong period, right-looking
  // screen, no error — the worst failure mode this page has.
  //
  // Every request now carries a generation number: only the newest may write state, and starting a
  // new one ABORTS the previous fetch so the browser and the server stop working on an answer
  // nobody will read. Both live in refs — they must survive re-renders and must never cause one.
  const reqGen = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const load = useCallback(async (l: Lens) => {
    const gen = ++reqGen.current;
    const isStale = () => gen !== reqGen.current;
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setLoading(true); setError(false);
    try {
      const res = await fetch(`/api/truth?lens=${l}`, { signal: ctrl.signal });
      // [SESSION] An expired session answers 401. Showing "kon je waarheid niet laden" with a retry
      // that can only 401 again strands the owner; send them to the login they actually need.
      if (res.status === 401) { window.location.href = "/login"; return; }
      const json = await res.json();
      if (isStale()) return;
      if (!res.ok || !json.ok) { setError(true); setData(null); }
      else setData(json as TruthResponse);
    } catch {
      // An abort lands here too — a superseded request must never paint the error state.
      if (isStale()) return;
      setError(true); setData(null);
    } finally {
      // …nor clear the spinner the newer request is still showing.
      if (!isStale()) setLoading(false);
    }
  }, []);

  // The async wrapper keeps `load`'s opening setState out of the effect BODY (react-hooks/
  // set-state-in-effect) while running on the same tick as before — the same shape the quarterly
  // screen uses. Ordering is handled by the generation counter above, not by this wrapper.
  useEffect(() => { void (async () => { await load(lens); })(); }, [lens, load]);

  // [TRUTH-FILED] Mark this quarter as filed (freeze the snapshot) / un-file it (unlock).
  const setFiled = useCallback(async (mark: boolean) => {
    if (!data?.quarter || !data?.year) return;
    setFiling(true);
    try {
      if (mark) {
        // [FILING-GATE] Server warns (409) when the quarter has unconfirmed invoices not yet in the
        // figures. Surface it; the owner can still proceed (their declaration) → re-POST acknowledge.
        const res = await fetch("/api/btw/file", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: data.year, quarter: data.quarter }),
        });
        if (res.status === 409) {
          const j = await res.json().catch(() => ({}));
          // [FILING-WINDOW] A quarter that has not ended yet is NOT the owner's judgement call —
          // there is no aangifte to have filed. Say so and stop; do not offer to override.
          if (j?.error === "quarter_not_ended") {
            toast(j?.reason ?? "Dit kwartaal loopt nog — je kunt het pas na afloop als ingediend markeren.", { tone: "error" });
            return;
          }
          // [FILING-GATE] This is the most consequential confirmation in the
          // app — the owner is declaring a quarter finished while the server
          // says it is not. It deserves the app's own dialog, with the server's
          // reason as the body rather than glued onto the question with \n\n.
          const proceed = await dialog.confirm({
            title: "Toch als ingediend markeren?",
            message: j?.reason ?? "Dit kwartaal is nog niet volledig gecontroleerd.",
            confirmLabel: "Ja, markeer als ingediend",
            danger: true,
          });
          if (!proceed) return;
          const res2 = await fetch("/api/btw/file", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year: data.year, quarter: data.quarter, acknowledge: true }),
          });
          if (!res2.ok) { toast("Markeren als ingediend is niet gelukt — probeer het opnieuw.", { tone: "error" }); return; }
        } else if (!res.ok) {
          toast("Markeren als ingediend is niet gelukt — probeer het opnieuw.", { tone: "error" }); return;
        }
      } else {
        // [UNFILE-FEEDBACK] The response used to be discarded, so a failed unlock looked exactly
        // like a successful one: the reload simply re-rendered the still-filed quarter and the
        // owner was left to conclude the button does nothing. Mirror the file path — say it failed.
        const res = await fetch(`/api/btw/file?year=${data.year}&quarter=${data.quarter}`, { method: "DELETE" });
        if (!res.ok) { toast("Indiening ongedaan maken is niet gelukt — probeer het opnieuw.", { tone: "error" }); return; }
      }
      await load(lens);
    } finally {
      setFiling(false);
    }
  }, [data, lens, load, dialog, toast]);

  const r = data?.result;
  const isQuarterLens = !!(data?.quarter && data?.year);
  const div = data?.filed?.divergence;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 14px 96px", fontFamily: FONT, color: M.onSurface }}>
      {/* [HEADER-SYSTEM] The page title ("Waarheid") and back live in the shared
          sub-page bar (DashboardChrome/STATIC_TITLES). The old in-body h1 that
          repeated it was removed; this descriptive intro line stays. */}
      <p style={{ fontSize: 13.5, color: M.muted, margin: "0 0 16px", lineHeight: 1.5 }}>
        Eén doorlopend beeld, live berekend uit je facturen, bank en kas. Kies een periode.
      </p>

      {/* Time lens */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, overflowX: "auto", paddingBottom: 2 }}>
        {LENSES.map((l) => (
          <button
            key={l.key}
            onClick={() => setLens(l.key)}
            style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 980, border: "none", cursor: "pointer",
              fontFamily: FONT, fontSize: 13.5, fontWeight: 600,
              background: lens === l.key ? M.primary : "#f1f3f4",
              color: lens === l.key ? "#fff" : "#3c4043",
            }}
          >
            {l.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "56px 0", color: M.muted, fontSize: 14 }}>Bezig met berekenen…</div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "40px 24px", color: M.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 600, color: M.onSurface, marginBottom: 6 }}>Kon je waarheid niet laden</div>
          <button onClick={() => load(lens)} style={{ marginTop: 8, background: M.primary, color: "#fff", border: "none", borderRadius: 980, padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>Opnieuw proberen</button>
        </div>
      ) : data && r ? (
        <>
          {/* Period + living/final/filed state */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{data.label}</span>
            {data.filed ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3730a3", background: "#e8eaf6", borderRadius: 980, padding: "2px 10px" }}>
                🔒 Ingediend · definitief
              </span>
            ) : data.isLiveWindow ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: M.warnFg, background: M.warnBg, borderRadius: 980, padding: "2px 10px" }}>loopt nog</span>
            ) : (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#137333", background: M.goodBg, borderRadius: 980, padding: "2px 10px" }}>afgesloten periode</span>
            )}
          </div>

          {/* [TRUTH-FILED] Divergence since filing → the suppletie heads-up. This is the payoff of
              the whole "living truth vs frozen aangifte" split: the only app that tells the owner a
              late invoice moved a quarter they already sent to the Belastingdienst. */}
          {data.filed && div?.changed && (
            <div style={{
              background: div.needsSuppletie ? "#fce8e6" : M.warnBg,
              border: `1px solid ${div.needsSuppletie ? "#e57373" : "#fbbc04"}`,
              borderRadius: 14, padding: "12px 14px", marginBottom: 14,
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: div.needsSuppletie ? "#a50e0e" : M.warnFg, marginBottom: 4 }}>
                {div.needsSuppletie ? "⚠️ Suppletie nodig" : "Let op — dit kwartaal is gewijzigd"}
              </div>
              {/* [DIVERGENCE-SPLIT] Two independent stories, each told only when it is true.
                  The banner used to fire on `changed` (ANY of five deltas) and then narrate the BTW
                  regardless — so a late 0%-BTW cost invoice, or a correction that moved verschuldigd
                  and voorbelasting equally, produced "de BTW is met € 0,00 gestegen (je moet meer
                  betalen)". Nonsense on the one screen that has to be believed. */}
              <div style={{ fontSize: 12.5, color: div.needsSuppletie ? "#7a1c1c" : M.warnFg, lineHeight: 1.5 }}>
                {div.btwChanged && (
                  <>
                    Sinds je indiening is de BTW met <strong>{eur.format(Math.abs(div.btwSaldoDelta))}</strong> {div.btwSaldoDelta > 0 ? "gestegen" : "gedaald"}
                    {" "}(je {div.btwSaldoDelta > 0 ? "moet meer betalen" : "krijgt meer terug"}).{" "}
                    {div.needsSuppletie
                      ? "Dat is meer dan €1.000 — dien een suppletie in bij de Belastingdienst."
                      : "Onder €1.000 mag je dit verwerken in je volgende aangifte."}
                  </>
                )}
                {/* The profit moved without the BTW moving: nothing to correct at the Belastingdienst
                    now, but the figure that ends up in the inkomstenbelasting is no longer the one
                    that was filed. Previously computed, returned — and never shown. */}
                {div.resultaatChanged && (
                  <>
                    {div.btwChanged && <br />}
                    Je resultaat over dit kwartaal is met <strong>{eur.format(Math.abs(div.resultaatDelta))}</strong>{" "}
                    {div.resultaatDelta > 0 ? "gestegen" : "gedaald"}
                    {div.btwChanged ? "." : " terwijl de BTW gelijk bleef — er is dus niets te corrigeren bij de Belastingdienst, maar je winst voor de inkomstenbelasting is veranderd."}
                  </>
                )}
                {/* Something moved that is neither: omzet and kosten shifted by the same amount, or
                    only a BTW component did. Never claim a euro figure we are not showing. */}
                {!div.btwChanged && !div.resultaatChanged && (
                  <>De cijfers van dit kwartaal zijn veranderd sinds je indiening, maar het BTW-saldo en je resultaat zijn gelijk gebleven. Controleer de onderliggende posten.</>
                )}
              </div>
            </div>
          )}

          {/* Resultaat — the headline */}
          <div style={{ background: M.surface, border: `1px solid ${M.line}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 13, color: M.muted, fontWeight: 600, marginBottom: 6 }}>Resultaat (winst)</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, color: r.resultaat >= 0 ? "#137333" : "#c5221f" }}>
              {eur.format(r.resultaat)}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              <Stat label="Omzet" value={eur.format(r.omzet)} />
              <Stat label="Kosten" value={eur.format(r.kosten)} />
            </div>
          </div>

          {/* BTW position */}
          <div style={{ background: M.surface, border: `1px solid ${M.line}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 13, color: M.muted, fontWeight: 600, marginBottom: 6 }}>
              {r.btwSaldo >= 0 ? "BTW te betalen" : "BTW terug te ontvangen"}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: M.onSurface }}>{eur.format(Math.abs(r.btwSaldo))}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              <Stat label="Verschuldigd" value={eur.format(r.btwVerschuldigd)} />
              <Stat label="Voorbelasting" value={eur.format(r.btwVoorbelasting)} />
            </div>
            {/* Quarter lens → the aangifte for this exact period is one tap away (same numbers). */}
            {data.quarter && data.year && (
              <Link
                href={`/dashboard/quarterly?year=${data.year}&quarter=${data.quarter}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 14, fontSize: 13.5, fontWeight: 600, color: M.primary, textDecoration: "none" }}
              >
                Naar de BTW-aangifte van deze periode
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
              </Link>
            )}
          </div>

          {/* Honesty notes — never a silent gap. Every reason these figures could be too low gets a
              line here, and the set is kept at parity with what the filing gate blocks on: an owner
              must never meet a 409 about a problem this screen chose not to mention. */}
          <div style={{ fontSize: 12.5, color: M.muted, lineHeight: 1.6, padding: "0 4px" }}>
            {/* [SCHEME] This line was hardcoded to "op basis van factuurdatum" for everyone — the
                literal opposite of the truth for an owner on the kasstelsel, whose BTW is computed
                on the PAID date (financial-result.ts). A wrong sentence about which date drives the
                figures is the one thing this screen cannot afford. */}
            <p style={{ margin: "0 0 6px" }}>
              {data.scheme === "kas"
                ? "Kasstelsel — op basis van betaaldatum (niet factuurdatum): een onbetaalde factuur telt pas mee zodra hij betaald is."
                : "Op basis van factuurdatum (niet betaaldatum) — dit is je fiscale resultaat, niet je banksaldo."}
            </p>
            {/* [SCHEME-SPAN] A window that crosses the factuur→kas switch has no single correct
                basis; say which one was used rather than let two lenses disagree in silence. */}
            {data.spansSchemeChange && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ Deze periode loopt door je overstap naar het kasstelsel heen{data.schemeSince ? ` (per ${data.schemeSince})` : ""}.
                De cijfers hierboven zijn volledig op {data.scheme === "kas" ? "kasstelsel" : "factuurstelsel"} berekend.
                Bekijk per kwartaal voor de cijfers zoals je ze aangeeft.
              </p>
            )}
            {(r.cashOmzetZonderBtw ?? 0) > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ {eur.format(r.cashOmzetZonderBtw ?? 0)} omzet staat nog zonder BTW-tarief (contante omzet, bankomzet of een
                niet-gesplitste kassadag) — die BTW zit dus niet in het bedrag hierboven.{" "}
                {/* [ZONDER-TARIEF-SOURCE] The engine knows whether this came from bank/till revenue
                    (needs the Z-report split → Dagomzet) or from plain cash (rated at Kas). It was
                    already computed as omzetZonderBtwNonCash and the copy still guessed at both. */}
                {(r.omzetZonderBtwNonCash ?? 0) <= 0
                  ? "Ken het tarief toe bij Kas."
                  : (r.omzetZonderBtwNonCash ?? 0) >= (r.cashOmzetZonderBtw ?? 0)
                    ? "Ken het tarief toe bij Dagomzet."
                    : "Ken het tarief toe bij Kas en Dagomzet."}
              </p>
            )}
            {/* [GATE-PARITY] The filing gate blocks on this and the screen never mentioned it, so
                the first time an owner heard about unconfirmed purchase invoices was the 409 dialog
                after tapping "markeer als ingediend". */}
            {data.unconfirmedIncomingCount > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ {data.unconfirmedIncomingCount} inkoopfactu{data.unconfirmedIncomingCount === 1 ? "ur is" : "ren zijn"} nog niet
                gecontroleerd — {data.unconfirmedIncomingCount === 1 ? "het bedrag en de BTW staan" : "hun bedragen en BTW staan"} nog niet in de cijfers hierboven.
              </p>
            )}
            {data.datelessVerifiedCount > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ {data.datelessVerifiedCount} bevestigde factu{data.datelessVerifiedCount === 1 ? "ur telt" : "ren tellen"} nog niet mee — er ontbreekt een datum.
              </p>
            )}
            {/* [KASSTELSEL] The cash-basis equivalent of a dateless invoice: money that demonstrably
                moved but cannot be placed in a period. /api/aangifte and /api/readiness have always
                warned about it; this screen never received the number. */}
            {data.undatedPaidCount > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ {data.undatedPaidCount} betaalde factu{data.undatedPaidCount === 1 ? "ur mist" : "ren missen"} een betaaldatum —
                die BTW kan nog niet in de juiste periode worden geplaatst, dus de cijfers hierboven zijn mogelijk te laag.
              </p>
            )}
            {data.estimatedPortionCount > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ Bij {data.estimatedPortionCount} betaling{data.estimatedPortionCount === 1 ? "" : "en"} is de betaaldatum een schatting
                (handmatig op betaald gezet) — controleer of de periode klopt.
              </p>
            )}
            {/* [EXCEPTION-COUNT] commissionIssueDays is new here: a day whose bank payout does not
                fit its card takings books NO acquirer commission, so the costs are knowingly
                incomplete. It appeared in the accountant's CSV and nowhere else. */}
            {(data.reconciliation.grossMismatchDays + data.reconciliation.incompleteDays + data.reconciliation.commissionIssueDays) > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ {data.reconciliation.grossMismatchDays + data.reconciliation.incompleteDays + data.reconciliation.commissionIssueDays} kassadag(en) nog niet volledig gereconcilieerd — controleer vóór de aangifte.
              </p>
            )}
            {/* [LEDGER-READ] Never present a check that did not run as a check that passed. */}
            {data.reconciliation.pinLedgerAvailable === false && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ De controle tegen je PIN-grootboek kon niet worden uitgevoerd — eventuele verschillen tussen kassa en grootboek zijn hierboven dus niet meegewogen.
              </p>
            )}
          </div>

          {/* [TRUTH-FILED] File / unlock — only for a single-quarter lens. Filing freezes the
              snapshot so later divergence surfaces as a suppletie; unlocking is always allowed
              (reversible). */}
          {isQuarterLens && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${M.line}` }}>
              {data.filed ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: M.muted }}>
                    Ingediend op {new Date(data.filed.filedAt).toLocaleDateString("nl-NL")}
                  </span>
                  <button
                    onClick={() => setFiled(false)}
                    disabled={filing}
                    style={{ background: "none", border: "none", color: M.muted, fontSize: 12.5, fontWeight: 600, cursor: filing ? "default" : "pointer", textDecoration: "underline", padding: 0 }}
                  >
                    {filing ? "Bezig…" : "Indiening ongedaan maken"}
                  </button>
                </div>
              ) : (
                /* [FILING-WINDOW] The button used to be offered for the CURRENT quarter too, and
                   the server happily froze a snapshot halfway through it. From that moment every
                   further sale reads as a divergence against a period that was never filed, and
                   past €1.000 the screen starts demanding a suppletie for an aangifte that does not
                   exist. A quarter can only have been filed once it is over — the server enforces
                   this (409 quarter_not_ended); here we simply do not offer it. */
                <button
                  onClick={() => setFiled(true)}
                  disabled={filing || data.quarterEnded === false}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: 12,
                    background: data.quarterEnded === false ? "#f1f3f4" : M.primary,
                    border: "none", color: data.quarterEnded === false ? "#9aa0a6" : "#fff",
                    fontWeight: 700, fontSize: 14,
                    cursor: filing || data.quarterEnded === false ? "default" : "pointer",
                  }}
                >
                  {filing ? "Bezig…" : "Markeer als ingediend bij de Belastingdienst"}
                </button>
              )}
              <p style={{ fontSize: 11.5, color: M.muted, margin: "8px 2px 0", lineHeight: 1.5 }}>
                {!data.filed && data.quarterEnded === false
                  ? "Dit kwartaal loopt nog. Zodra het is afgelopen kun je het hier als ingediend markeren en leggen we de cijfers vast."
                  : "Dit legt de cijfers van dit kwartaal vast. Komt er later nog een factuur bij, dan zien we het verschil en zeggen we of een suppletie nodig is."}
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}
