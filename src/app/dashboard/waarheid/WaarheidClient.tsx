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
import { useSearchParams } from "next/navigation";
import { FONT, COLUMN } from "@/lib/design/tokens";
// [TZ] Amsterdam's day/year and the DD-MM-YYYY filing date — never the reader's own zone.
import { amsterdamToday, formatDateNL } from "@/lib/format-nl";
import { assessBtwCertainty } from "@/lib/btw-certainty";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { cardPanelVisible, cardStatsVisible } from '@/lib/card-panel'

// [HEADER-SYSTEM] This screen previously shipped its own Inter font — the only
// Inter surface in an otherwise Roboto app. It now uses the shared FONT token
// (Roboto). The local `M` palette below is kept (its values already match the
// M3 tokens); only the font was the cross-app inconsistency.
const M = {
  primary: "#1a73e8", surface: "#fff", onSurface: "#202124", muted: "#5f6368",
  line: "#e8eaed", goodBg: "#e6f4ea", warnBg: "#fef7e0", warnFg: "#7a4f00",
};
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

// [NAMED-QUARTER] "quarter" is the explicit ?year&quarter lens — the picker below. It is what lets
// this screen reach ANY historical quarter, which used to be the only thing /dashboard/resultaat
// could do that this screen could not (that page is now a redirect here).
type Lens = "this-quarter" | "last-quarter" | "quarter" | "ytd" | "all";

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
  // [VRAAGPOST] Bankmutaties zonder categorie: bewust NIET meegeteld hierboven, en daarom
  // juist wél te noemen. Optioneel getypt zodat een oudere API-respons dit scherm niet breekt.
  ongecategoriseerdBankIn?: number;
  ongecategoriseerdBankUit?: number;
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
  // [FILING-NO-OVERWRITE] TRUE when the server could not read the filing state. `filed: null` then
  // means UNKNOWN, not "not filed" — and the difference matters here more than anywhere: the file
  // button is what overwrites a frozen snapshot, so it must not be offered on a guess.
  filedUnknown?: boolean;
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
    // [KAART-CONTROLE] The triangle's own figures, absorbed from /dashboard/resultaat.
    // totalCommission is what the reconciliation MEASURED (EFT gross − bank net);
    // commissionBooked is what actually landed in kosten — under kasstelsel that is deliberately
    // 0, and the two must therefore be shown as two different things, never as one.
    totalCommission: number;
    commissionBooked: number;
    acquirerFeeInvoices: number;
    eftSettlements: number;
    // [COM-IN-DE-REGEL] The commission the BANK LINE states outright ("BRUTO … /COM …"). A second,
    // independent source for the same cost: measured without any terminal file, and on an ING shop
    // the ONLY source there is. Optional so an older /api/truth response still renders.
    statedCommission?: { total: number; gross: number; lines: number; unverified: number };
    statedCommissionBooked?: boolean;
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

// [TAAL] Labels live in the catalogue; the table keeps only the keys.
const LENSES = [
  { key: "this-quarter", labelKey: "wh.lens.ditKwartaal" },
  { key: "last-quarter", labelKey: "wh.lens.vorigKwartaal" },
  { key: "ytd", labelKey: "wh.lens.ditJaar" },
  { key: "all", labelKey: "filter.all" },
] as const satisfies ReadonlyArray<{ key: Lens; labelKey: string }>;

/** The period the screen is looking at: a relative lens, or an explicit quarter from the picker. */
interface Period { lens: Lens; year?: number; quarter?: number }

/** The query string for a period — the ONE place a Period becomes a request. */
function periodQuery(p: Period): string {
  return p.lens === "quarter"
    ? `lens=quarter&year=${p.year}&quarter=${p.quarter}`
    : `lens=${p.lens}`;
}

/**
 * [NAMED-QUARTER] The period this screen OPENS on, from ?year&quarter.
 *
 * /dashboard/resultaat now redirects here and carries its year/quarter along, so a bookmark of
 * "Q1 2024" keeps working and lands on that quarter instead of silently on the current one — the
 * same deep-link honesty the quarterly screen was missing. Anything absent or out of range simply
 * opens on the default lens; a truth screen never guesses at a period it could not parse.
 */
function periodFromParams(get: (k: string) => string | null): Period {
  const y = Number(get("year"));
  const q = Number(get("quarter"));
  const valid = Number.isInteger(y) && y >= 2000 && y <= 2100 && Number.isInteger(q) && q >= 1 && q <= 4;
  return valid ? { lens: "quarter", year: y, quarter: q } : { lens: "this-quarter" };
}

export default function WaarheidClient() {
  const t = translator(useLocale())
  const dialog = useDialog();
  const toast = useToast();
  // [NAMED-QUARTER] One `period` instead of a bare lens, so the explicit quarter picker and the
  // relative chips are the same piece of state and cannot drift out of sync with each other.
  // Seeded from ?year&quarter (the redirect from the old /dashboard/resultaat carries them).
  const sp = useSearchParams();
  const initialPeriod = periodFromParams((k) => sp.get(k));
  const [period, setPeriod] = useState<Period>(initialPeriod);
  // Open the picker when we arrived ON a named quarter, so the control that produced the period is
  // visible rather than the owner wondering where "Q1 2024" came from.
  const [pickerOpen, setPickerOpen] = useState(initialPeriod.lens === "quarter");
  // [TZ] The Amsterdam year, never the device's: this bounds which quarters are reachable, and
  // a phone in another zone must not be able to open — or hide — a period the rest of the app
  // judges by the Dutch calendar (format-nl.ts).
  const curYear = Number(amsterdamToday().slice(0, 4));
  const [pickYear, setPickYear] = useState(initialPeriod.year ?? curYear);
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
  const load = useCallback(async (p: Period) => {
    const gen = ++reqGen.current;
    const isStale = () => gen !== reqGen.current;
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setLoading(true); setError(false);
    try {
      const res = await fetch(`/api/truth?${periodQuery(p)}`, { signal: ctrl.signal });
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
  useEffect(() => { void (async () => { await load(period); })(); }, [period, load]);

  // [TRUTH-FILED] Mark this quarter as filed (freeze the snapshot) / un-file it (unlock).
  //
  // [ONE-FILING-DOOR] This is now the ONLY place in the app that writes btw_filings. The
  // Kwartaaloverzicht used to file and unlock as well, with its own copy of this flow — and a copy
  // is where a fix goes missing: two of the corrections made here (reading the DELETE response, and
  // not offering an override for "kwartaal loopt nog") stayed unmade over there for a release. That
  // screen now SHOWS the state and links here for the action. Keep it that way: if a third surface
  // ever needs to file, it links here too.
  const setFiled = useCallback(async (mark: boolean) => {
    if (!data?.quarter || !data?.year) return;
    setFiling(true);
    try {
      if (mark) {
        // [FILING-GATE] Server warns (409) when the quarter has unconfirmed invoices not yet in the
        // figures. Surface it; the owner can still proceed (their declaration) → re-POST acknowledge.
        //
        // [FILING-NO-OVERWRITE] There are now two distinct 409s that the owner may answer, and they
        // ask different questions: "are the figures complete enough?" (acknowledge) and "may we
        // replace the aangifte you already filed?" (replace). Each is confirmed on its own, and
        // whatever was confirmed rides along on every retry — so answering the second question can
        // never quietly undo the first.
        const post = (extra: Record<string, unknown>) =>
          fetch("/api/btw/file", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year: data.year, quarter: data.quarter, ...extra }),
          });
        const flags: { acknowledge?: true; replace?: true } = {};
        let filedOk = false;
        // At most three passes: the first attempt plus one per question the server can ask.
        for (let attempt = 0; attempt < 3 && !filedOk; attempt++) {
          const res = await post(flags);
          if (res.ok) { filedOk = true; break; }
          if (res.status !== 409) {
            toast(t('wh.filed.mislukt'), { tone: "error" });
            return;
          }
          const j = await res.json().catch(() => ({}));
          // [FILING-WINDOW] A quarter that has not ended yet is NOT the owner's judgement call —
          // there is no aangifte to have filed. Say so and stop; do not offer to override.
          if (j?.error === "quarter_not_ended") {
            toast(j?.reason ?? t('wh.filed.looptNog'), { tone: "error" });
            return;
          }
          // [FILING-NO-OVERWRITE] Replacing a filing destroys the record of what was declared —
          // the very thing the divergence banner on this page is computed from. So the dialog
          // states the two figures rather than asking an abstract "weet je het zeker?".
          if (j?.error === "already_filed") {
            if (flags.replace) { toast(j?.reason ?? t('wh.filed.opnieuwMislukt'), { tone: "error" }); return; }
            const proceed = await dialog.confirm({
              title: t('wh.filed.vervangVraag'),
              message: j?.reason ?? t('wh.filed.vervangUitleg'),
              confirmLabel: t('wh.filed.vervangBevestig'),
              danger: true,
            });
            if (!proceed) return;
            flags.replace = true;
            continue;
          }
          // [FILING-GATE] This is the most consequential confirmation in the
          // app — the owner is declaring a quarter finished while the server
          // says it is not. It deserves the app's own dialog, with the server's
          // reason as the body rather than glued onto the question with \n\n.
          if (flags.acknowledge) { toast(t('wh.filed.mislukt'), { tone: "error" }); return; }
          const proceed = await dialog.confirm({
            title: t('wh.filed.tochVraag'),
            message: j?.reason ?? t('wh.filed.nietGecontroleerd'),
            confirmLabel: t('wh.filed.tochBevestig'),
            danger: true,
          });
          if (!proceed) return;
          flags.acknowledge = true;
        }
        // A loop that ran out of passes never wrote anything — never let that look like success.
        if (!filedOk) { toast(t('wh.filed.mislukt'), { tone: "error" }); return; }
      } else {
        // [UNFILE-FEEDBACK] The response used to be discarded, so a failed unlock looked exactly
        // like a successful one: the reload simply re-rendered the still-filed quarter and the
        // owner was left to conclude the button does nothing. Mirror the file path — say it failed,
        // and in the server's own words when it wrote them (the route distinguishes "this quarter
        // is not filed (any more)" from "we could not read it", and those are different problems).
        const res = await fetch(`/api/btw/file?year=${data.year}&quarter=${data.quarter}`, { method: "DELETE" });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast(
            typeof j?.reason === "string" && j.reason.trim()
              ? j.reason.trim()
              : t('wh.filed.ongedaanMislukt'),
            { tone: "error" },
          );
          return;
        }
      }
      await load(period);
    } finally {
      setFiling(false);
    }
  }, [data, period, load, dialog, toast]);

  const r = data?.result;
  // [COM-IN-DE-REGEL] The commission the bank line stated itself, when the response carries it.
  const statedCom = data?.reconciliation?.statedCommission;
  const isQuarterLens = !!(data?.quarter && data?.year);
  const div = data?.filed?.divergence;
  // [BTW-CERTAINTY] How much weight the BTW amount may be given — see btw-certainty.ts.
  const certainty = assessBtwCertainty({
    btwSaldo: r?.btwSaldo ?? 0,
    omzet: r?.omzet ?? 0,
    cashOmzetZonderBtw: r?.cashOmzetZonderBtw ?? 0,
  });
  // [NOG-TE-DOEN] Everything that makes the figures above incomplete, as ONE list with an exit per
  // item. It used to be four loose ⚠️ paragraphs in small grey-orange body text below the cards:
  // individually honest, collectively a wall an owner skims past. Grouping them turns "here is what
  // is wrong" into "here is what to do next", which is the only form of it anyone acts on.
  const todos: { text: string; href: string; cta: string }[] = [];
  if (data && r) {
    if ((r.cashOmzetZonderBtw ?? 0) > 0) {
      const bank = (r.omzetZonderBtwNonCash ?? 0) > 0;
      todos.push({
        text: t('wh.todo.zonderTarief', { bedrag: eur.format(r.cashOmzetZonderBtw ?? 0) }),
        href: bank ? "/dashboard/dagomzet" : "/dashboard/kas",
        cta: bank ? t('wh.todo.naarDagomzet') : t('wh.todo.naarKas'),
      });
    }
    if (data.unconfirmedIncomingCount > 0) {
      todos.push({
        text: data.unconfirmedIncomingCount === 1
          ? t('wh.todo.ongecontroleerdEen')
          : t('wh.todo.ongecontroleerdMeer', { n: data.unconfirmedIncomingCount }),
        href: "/dashboard/incoming",
        cta: t('wh.todo.controleren'),
      });
    }
    if (data.datelessVerifiedCount > 0) {
      todos.push({
        text: data.datelessVerifiedCount === 1
          ? t('wh.todo.geenDatumEen')
          : t('wh.todo.geenDatumMeer', { n: data.datelessVerifiedCount }),
        href: "/dashboard/facturen",
        cta: t('wh.todo.datumInvullen'),
      });
    }
    if (data.undatedPaidCount > 0) {
      todos.push({
        text: data.undatedPaidCount === 1
          ? t('wh.todo.betaaldatumEen')
          : t('wh.todo.betaaldatumMeer', { n: data.undatedPaidCount }),
        href: "/dashboard/bank",
        cta: t('wh.todo.koppelen'),
      });
    }
    // [VRAAGPOST] Bankgeld dat nog geen categorie heeft telt NIET mee in de cijfers hierboven —
    // terecht, want een geraden categorie is een verkeerd getal. Maar het werd ook niet genoemd,
    // en dan leest een eigenaar met duizenden euro's ongecodeerde mutaties een resultaat dat niet
    // fout is en ook zijn resultaat niet is. Dit is precies de lijst waar dat hoort: alles wat de
    // cijfers hierboven onvolledig maakt, met een uitgang per regel.
    //
    // In en uit apart, nooit gesaldeerd: € 10.000 erin en € 10.000 eruit is niet "niets mist",
    // dat zijn twee onverklaarde feiten.
    const vraagIn = r.ongecategoriseerdBankIn ?? 0;
    const vraagUit = r.ongecategoriseerdBankUit ?? 0;
    if (vraagIn + vraagUit > 0) {
      const delen = [
        vraagIn > 0 ? t('wh.todo.erbij', { bedrag: eur.format(vraagIn) }) : null,
        vraagUit > 0 ? t('wh.todo.eraf', { bedrag: eur.format(vraagUit) }) : null,
      ].filter(Boolean).join(` ${t('wh.todo.en')} `);
      todos.push({
        text: t('wh.todo.bankZonderCategorie', { delen }),
        href: "/dashboard/bank",
        cta: t('wh.todo.categoriseren'),
      });
    }
  }

  return (
    <div style={{ maxWidth: COLUMN.work, margin: "0 auto", padding: "16px 14px 96px", fontFamily: FONT, color: M.onSurface }}>
      {/* [HEADER-SYSTEM] The page title ("Waarheid") and back live in the shared
          sub-page bar (DashboardChrome/STATIC_TITLES). The old in-body h1 that
          repeated it was removed; this descriptive intro line stays. */}
      <p style={{ fontSize: 13.5, color: M.muted, margin: "0 0 16px", lineHeight: 1.5 }}>
        {t('wh.intro')}
      </p>

      {/* Time lens */}
      <div style={{ display: "flex", gap: 8, marginBottom: pickerOpen ? 10 : 18, overflowX: "auto", paddingBottom: 2 }}>
        {LENSES.map((l) => (
          <button
            key={l.key}
            onClick={() => { setPeriod({ lens: l.key }); setPickerOpen(false); }}
            style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 980, border: "none", cursor: "pointer",
              fontFamily: FONT, fontSize: 13.5, fontWeight: 600,
              background: period.lens === l.key ? M.primary : "#f1f3f4",
              color: period.lens === l.key ? "#fff" : "#3c4043",
            }}
          >
            {t(l.labelKey)}
          </button>
        ))}
        {/* [NAMED-QUARTER] The explicit quarter — absorbed from /dashboard/resultaat, which was the
            only screen that could reach one. Shown as a chip so a picked quarter reads as the
            selected period exactly like the relative lenses do. */}
        <button
          onClick={() => setPickerOpen((o) => !o)}
          style={{
            flexShrink: 0, padding: "8px 14px", borderRadius: 980, border: "none", cursor: "pointer",
            fontFamily: FONT, fontSize: 13.5, fontWeight: 600,
            background: period.lens === "quarter" ? M.primary : "#f1f3f4",
            color: period.lens === "quarter" ? "#fff" : "#3c4043",
          }}
        >
          {period.lens === "quarter" ? `Q${period.quarter} ${period.year}` : t('wh.anderKwartaal')} ▾
        </button>
      </div>

      {/* [NAMED-QUARTER] Q1–Q4 + a year stepper, the same control /dashboard/resultaat carried.
          The year cannot run past the current one: a quarter that has not started has no figures to
          show, and offering it would produce a confident € 0,00 for a period nobody has traded in. */}
      {pickerOpen && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 14 }}>
          {[1, 2, 3, 4].map((q) => {
            const active = period.lens === "quarter" && period.quarter === q && period.year === pickYear;
            return (
              <button
                key={q}
                onClick={() => setPeriod({ lens: "quarter", year: pickYear, quarter: q })}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
                  fontSize: 13.5, fontWeight: 600,
                  border: `1px solid ${active ? M.primary : M.line}`,
                  background: active ? M.primary : M.surface,
                  color: active ? "#fff" : M.onSurface,
                }}
              >
                Q{q}
              </button>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", gap: 4, paddingInlineStart: 6 }}>
            <button
              onClick={() => setPickYear((y) => Math.max(2015, y - 1))}
              title={t('wh.vorigJaar')}
              style={{ width: 26, height: 26, border: "none", background: "none", cursor: "pointer", color: M.primary, fontSize: 18, lineHeight: 1 }}
            >‹</button>
            <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 38, textAlign: "center" }}>{pickYear}</span>
            <button
              onClick={() => setPickYear((y) => Math.min(y + 1, curYear))}
              disabled={pickYear >= curYear}
              title={t('wh.volgendJaar')}
              style={{
                width: 26, height: 26, border: "none", background: "none", fontSize: 18, lineHeight: 1,
                cursor: pickYear >= curYear ? "default" : "pointer",
                color: pickYear >= curYear ? M.line : M.primary,
                opacity: pickYear >= curYear ? 0.5 : 1,
              }}
            >›</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "56px 0", color: M.muted, fontSize: 14 }}>{t('wh.berekenen')}</div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "40px 24px", color: M.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 600, color: M.onSurface, marginBottom: 6 }}>{t('wh.fout.laden')}</div>
          <button onClick={() => load(period)} style={{ marginTop: 8, background: M.primary, color: "#fff", border: "none", borderRadius: 980, padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>{t('inkoop.opnieuwProberen')}</button>
        </div>
      ) : data && r ? (
        <>
          {/* Period + living/final/filed state */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{data.label}</span>
            {data.filed ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3730a3", background: "#e8eaf6", borderRadius: 980, padding: "2px 10px" }}>
                {t('wh.chip.ingediend')}
              </span>
            ) : data.filedUnknown ? (
              /* [FILING-NO-OVERWRITE] Not "loopt nog" and not "afgesloten": both are claims about a
                 period whose state we could not read. */
              <span style={{ fontSize: 11.5, fontWeight: 700, color: M.warnFg, background: M.warnBg, borderRadius: 980, padding: "2px 10px" }}>
                {t('wh.chip.onbekend')}
              </span>
            ) : data.isLiveWindow ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: M.warnFg, background: M.warnBg, borderRadius: 980, padding: "2px 10px" }}>{t('wh.chip.looptNog')}</span>
            ) : (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#137333", background: M.goodBg, borderRadius: 980, padding: "2px 10px" }}>{t('wh.chip.afgesloten')}</span>
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
                {div.needsSuppletie ? t('kw.suppletieNodig') : t('wh.div.gewijzigd')}
              </div>
              {/* [DIVERGENCE-SPLIT] Two independent stories, each told only when it is true.
                  The banner used to fire on `changed` (ANY of five deltas) and then narrate the BTW
                  regardless — so a late 0%-BTW cost invoice, or a correction that moved verschuldigd
                  and voorbelasting equally, produced "de BTW is met € 0,00 gestegen (je moet meer
                  betalen)". Nonsense on the one screen that has to be believed. */}
              <div style={{ fontSize: 12.5, color: div.needsSuppletie ? "#7a1c1c" : M.warnFg, lineHeight: 1.5 }}>
                {div.btwChanged && (
                  <>
                    {t('wh.sindsIndiening')} <strong>{eur.format(Math.abs(div.btwSaldoDelta))}</strong> {div.btwSaldoDelta > 0 ? t('kw.gestegen') : t('kw.gedaald')}
                    {" "}({div.btwSaldoDelta > 0 ? t('wh.div.meerBetalen') : t('wh.div.meerTerug')}).{" "}
                    {div.needsSuppletie
                      ? t('wh.div.suppletieMeer')
                      : t('wh.div.suppletieOnder')}
                  </>
                )}
                {/* The profit moved without the BTW moving: nothing to correct at the Belastingdienst
                    now, but the figure that ends up in the inkomstenbelasting is no longer the one
                    that was filed. Previously computed, returned — and never shown. */}
                {div.resultaatChanged && (
                  <>
                    {div.btwChanged && <br />}
                    {t('wh.div.resultaatMet')} <strong>{eur.format(Math.abs(div.resultaatDelta))}</strong>{" "}
                    {div.resultaatDelta > 0 ? t('kw.gestegen') : t('kw.gedaald')}
                    {div.btwChanged ? "." : ` ${t('wh.div.terwijlGelijk')}`}
                  </>
                )}
                {/* Something moved that is neither: omzet and kosten shifted by the same amount, or
                    only a BTW component did. Never claim a euro figure we are not showing. */}
                {!div.btwChanged && !div.resultaatChanged && (
                  <>{t('wh.div.onderliggend')}</>
                )}
              </div>
            </div>
          )}

          {/* Resultaat — the headline. Plain words first: an owner reads "wat hou je over",
              not "resultaat". The bookkeeping term stays as the small second line so the
              accountant's vocabulary is still learnable from the screen. */}
          <div style={{ background: M.surface, border: `1px solid ${M.line}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>{t('wh.overhouden')}</div>
            <div style={{ fontSize: 11.5, color: M.muted, marginBottom: 6 }}>{t('wh.sub.resultaat')}</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, color: r.resultaat >= 0 ? "#137333" : "#c5221f" }}>
              {eur.format(r.resultaat)}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              <Stat label={t('wh.omzet')} value={eur.format(r.omzet)} sub={t('wh.sub.omzet')} />
              <Stat label={t('wh.kosten')} value={eur.format(r.kosten)} sub={t('wh.sub.kosten')} />
            </div>
          </div>

          {/* BTW position.

              [BTW-CERTAINTY] The caveat lives ON the number now. computeResult never guesses a BTW
              rate, so revenue booked without one sits in omzet while its BTW is simply absent from
              this figure — correct arithmetic that used to be rendered as a large, confident amount
              with the explanation five blocks below it in grey body text. On a real account that
              produced "BTW terug te ontvangen € 2.779,58" while every euro of € 44.255 of revenue
              still had no rate: the owner is told they get €2.779 back when in truth they owe. The
              rule that decides how much weight the amount may carry is btw-certainty.ts. */}
          <div style={{
            background: M.surface, borderRadius: 18, padding: 20, marginBottom: 12,
            border: `1px solid ${certainty.level === "sign-could-flip" ? "#fbbc04" : M.line}`,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <div style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>
              {certainty.level === "sign-could-flip"
                ? t('wh.btw.nogNiet')
                : r.btwSaldo >= 0 ? t('wh.btw.moetBetalen') : t('wh.btw.terug')}
            </div>
            <div style={{ fontSize: 11.5, color: M.muted, marginBottom: 6 }}>
              {certainty.level === "sign-could-flip"
                ? t('wh.btw.eerstTarieven')
                : r.btwSaldo >= 0 ? t('wh.btw.aanBd') : t('wh.btw.vanBd')}
            </div>
            <div style={{
              fontSize: 26, fontWeight: 800,
              // A number that could still swing the other way is not shown in the confident
              // near-black of a settled figure; it is greyed to the weight it has actually earned.
              color: certainty.level === "sign-could-flip" ? M.muted : M.onSurface,
            }}>
              {eur.format(Math.abs(r.btwSaldo))}
              {certainty.level === "sign-could-flip" && (
                <span style={{ fontSize: 13, fontWeight: 600, color: M.muted }}> {t('wh.btw.voorlopig')}</span>
              )}
            </div>

            {/* The one sentence that changes what this amount means — directly under it, in the
                same card, never further down the page. */}
            {certainty.level === "sign-could-flip" && (
              <div style={{ background: M.warnBg, borderRadius: 12, padding: "10px 12px", marginTop: 12, fontSize: 12.5, color: M.warnFg, lineHeight: 1.5 }}>
                {t('wh.geldTerugMaar')} <strong>{eur.format(certainty.unrated)}</strong> {t('wh.btw.zonderTariefRest')}
              </div>
            )}
            {certainty.level === "incomplete" && (
              <div style={{ fontSize: 12.5, color: M.warnFg, marginTop: 10, lineHeight: 1.5 }}>
                {t('wh.btw.incompleet', { bedrag: eur.format(certainty.unrated) })}
              </div>
            )}

            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              {/* Plain meaning as the label, the aangifte's own word underneath — the owner can
                  follow the screen AND recognise the term when the accountant uses it. */}
              <Stat label={t('wh.overOmzet')} value={eur.format(r.btwVerschuldigd)} sub={t('wh.sub.verschuldigd')} />
              <Stat label={t('wh.overInkopen')} value={eur.format(r.btwVoorbelasting)} sub={t('wh.sub.voorbelasting')} />
            </div>
            {/* Quarter lens → the aangifte for this exact period is one tap away (same numbers).
                [EEN-DEUR] En dat is /dashboard/aangifte, niet /dashboard/quarterly. Twee schermen
                droegen de naam "de aangifte" en ze zijn niet hetzelfde: de correcties uit eerdere
                ingediende kwartalen (met de knop "Verwerkt in deze aangifte"), de art. 29-blokken
                en de ICP-opgaaf bestaan alleen op /aangifte — en sinds kort ook de uitleg voor wie
                zélf indient. Wie via deze link liep, kwam op het scherm zónder dat alles en kon
                dus indienen zonder de correctie te zien die de app voor déze aangifte had
                uitgerekend. De kwartaalpagina blijft gewoon bestaan en bereikbaar; wat verandert
                is waar de zin "naar de aangifte" heen wijst. */}
            {data.quarter && data.year && (
              <Link
                href={`/dashboard/aangifte?year=${data.year}&quarter=${data.quarter}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 14, fontSize: 13.5, fontWeight: 600, color: M.primary, textDecoration: "none" }}
              >
                {t('wh.naarAangifte')}
                <span className="material-symbols-outlined icon-dir" style={{ fontSize: 18 }} aria-hidden>chevron_right</span>
              </Link>
            )}
          </div>

          {/* [KAART-CONTROLE] The card-takings triangle (kassa · terminal · bank), absorbed from
              /dashboard/resultaat when that screen became a redirect here.

              Its visibility condition is deliberately WIDER than the one it replaces. The old card
              appeared only when `eftSettlements > 0 || commissionBooked > 0 || grossMismatchDays > 0`
              — while the sentence telling the owner to UPLOAD the terminal receipt lived inside it.
              A shop that had never uploaded one produced none of those three (no EFT rows, no
              commission without an eftGross, no mismatch without two sides to compare), so the card
              stayed hidden: the only shop that needed the instruction was the only one that could
              not see it, and its acquirer commission was missing from kosten in silence. Any card
              activity at all now opens it, including the days that are merely incomplete. */}
          {/* [COM-IN-DE-REGEL] Both gates live in card-panel.ts now — they were inline conditions
              listing the triangle's figures and nothing else, which stopped being complete the
              moment a commission could also come from the bank line. A JSX condition is not
              somewhere a test can reach, and this one decided whether a booked cost is explained
              to anyone at all. */}
          {cardPanelVisible(data.reconciliation) && (
            <div style={{ background: M.surface, border: `1px solid ${M.line}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              <div style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>
                {t('wh.pinGecontroleerd')}
              </div>
              <div style={{ fontSize: 11.5, color: M.muted, marginBottom: 10 }}>
                {t('wh.pin.sub')}
              </div>
              {/* [NO-ZERO-LEAD] Two stats reading "€ 0,00" and "0" were the first thing a shop with
                  nothing uploaded yet saw — a confident answer to a question nobody had been able to
                  ask. When there is nothing measured, skip the figures and go straight to the one
                  line that says what to do; the numbers appear once they mean something. */}
              {cardStatsVisible(data.reconciliation) && (
                <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
                  {/* [KAS-COMMISSION] MEASURED vs BOOKED are two different numbers and are labelled as
                      such. Under kasstelsel the triangle delta is deliberately not auto-booked (the fee
                      is deductible when the acquirer's own invoice is PAID), so `commissionBooked` is 0
                      while `totalCommission` can be hundreds of euros. The screen this replaces showed
                      only the booked figure next to the flat claim "de commissie is verwerkt in het
                      resultaat hierboven" — so a kasstelsel shop read "€ 0,00" on a control surface
                      that had in fact measured a real cost. */}
                  <Stat label={t('wh.kostenAutomaat')} value={eur.format(data.reconciliation.totalCommission)} sub={t('wh.pin.gemeten')} />
                  <Stat label={t('wh.afrekeningen')} value={String(data.reconciliation.eftSettlements)} sub={t('wh.pin.vanTerminal')} />
                </div>
              )}
              <p style={{ fontSize: 12.5, color: M.muted, lineHeight: 1.55, margin: 0 }}>
                {data.scheme === "kas"
                  ? t('wh.pin.kasUitleg')
                  : data.reconciliation.commissionBooked > 0
                    ? `${t('wh.pin.geboekt', { bedrag: eur.format(data.reconciliation.commissionBooked) })}${data.reconciliation.acquirerFeeInvoices > 0 ? ` ${t('wh.pin.overige', { bedrag: eur.format(data.reconciliation.acquirerFeeInvoices) })}` : ""}`
                    : data.reconciliation.acquirerFeeInvoices > 0
                      ? t('wh.pin.acquirer', { bedrag: eur.format(data.reconciliation.acquirerFeeInvoices) })
                      /* [COM-IN-DE-REGEL] "Waiting for a terminal settlement" is the wrong sentence for
                         a shop whose bank names the commission outright — it asks for a file that
                         would add nothing. Say what is actually missing instead. */
                      : (data.reconciliation.statedCommission?.total ?? 0) > 0
                        ? ""
                        : data.reconciliation.eftSettlements > 0
                          ? t('wh.pin.zodra')
                          : t('wh.pin.geenBron')}
              </p>
              {/* [COM-IN-DE-REGEL] What the bank said out loud, and whether it is in the figures.
                  Kept separate from the triangle's own sentence above: that one is a DERIVED figure
                  from three witnesses, this one is a number the bank quoted and that proved itself
                  against the amount credited. A reader must be able to tell which is which. */}
              {statedCom && statedCom.total > 0 && (
                <p style={{ fontSize: 12.5, color: M.muted, lineHeight: 1.55, margin: '8px 0 0' }}>
                  {t('wh.pin.uitBankregel', {
                    regels: statedCom.lines,
                    bedrag: eur.format(statedCom.total),
                    bruto: eur.format(statedCom.gross),
                    tarief: `${(100 * statedCom.total / statedCom.gross).toFixed(2).replace('.', ',')}%`,
                  })}{' '}
                  {data.scheme === "kas"
                    ? ''
                    : data.reconciliation.statedCommissionBooked
                      ? t('wh.pin.uitBankregelGeboekt')
                      : t('wh.pin.uitBankregelNietGeboekt')}
                </p>
              )}
              {statedCom && statedCom.unverified > 0 && (
                <p style={{ fontSize: 12, color: M.muted, lineHeight: 1.55, margin: '6px 0 0' }}>
                  {t('wh.pin.uitBankregelOnleesbaar', { n: statedCom.unverified })}
                </p>
              )}
              {data.reconciliation.grossMismatchDays > 0 && (
                <div style={{ background: M.warnBg, borderRadius: 12, padding: "10px 12px", marginTop: 10, fontSize: 12.5, color: M.warnFg, lineHeight: 1.5 }}>
                  {t('wh.pin.mismatch', { n: data.reconciliation.grossMismatchDays })}
                </div>
              )}
              {data.reconciliation.commissionIssueDays > 0 && (
                <div style={{ background: M.warnBg, borderRadius: 12, padding: "10px 12px", marginTop: 10, fontSize: 12.5, color: M.warnFg, lineHeight: 1.5 }}>
                  {t('wh.pin.commissieDagen', { n: data.reconciliation.commissionIssueDays })}
                </div>
              )}
              {data.reconciliation.incompleteDays > 0 && (
                <p style={{ fontSize: 12.5, color: M.muted, margin: "10px 0 0", lineHeight: 1.5 }}>
                  {t('wh.pin.incompleteDagen', { n: data.reconciliation.incompleteDays })}
                </p>
              )}
            </div>
          )}

          {/* [NOG-TE-DOEN] The reasons the figures above are incomplete, as ONE block with an exit
              per item. This was four to six loose ⚠️ paragraphs in small grey-orange body text:
              each one honest, all of them together a wall an owner skims. A shop owner does not
              need a list of what is wrong; they need to know what to open next. Same facts, same
              parity with the filing gate — different job. */}
          {todos.length > 0 && (
            <div style={{ background: M.warnBg, border: "1px solid #fbbc04", borderRadius: 18, padding: "16px 18px", marginBottom: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: M.warnFg }}>
                {t('wh.nogTeDoen')}
              </div>
              <div style={{ fontSize: 12, color: M.warnFg, opacity: 0.85, margin: "2px 0 6px" }}>
                {t('wh.teLaag')}
              </div>
              {todos.map((t) => (
                <TodoRow key={t.href + t.text} text={t.text} href={t.href} cta={t.cta} />
              ))}
            </div>
          )}

          {/* The quiet footnotes: true of the figures, but nothing to act on. Kept small and last,
              which is exactly where things you cannot do anything about belong. */}
          <div style={{ fontSize: 12.5, color: M.muted, lineHeight: 1.6, padding: "0 4px" }}>
            {/* [SCHEME] This line was hardcoded to "op basis van factuurdatum" for everyone — the
                literal opposite of the truth for an owner on the kasstelsel, whose BTW is computed
                on the PAID date (financial-result.ts). A wrong sentence about which date drives the
                figures is the one thing this screen cannot afford. */}
            <p style={{ margin: "0 0 6px" }}>
              {data.scheme === "kas"
                ? t('wh.voet.kas')
                : t('wh.voet.factuur')}
            </p>
            {/* [SCHEME-SPAN] A window that crosses the factuur→kas switch has no single correct
                basis; say which one was used rather than let two lenses disagree in silence. */}
            {data.spansSchemeChange && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                {data.schemeSince ? t('wh.voet.overstapPer', { datum: data.schemeSince }) : t('wh.voet.overstap')}{" "}
                {data.scheme === "kas" ? t('wh.voet.berekendKas') : t('wh.voet.berekendFactuur')}
              </p>
            )}
            {data.estimatedPortionCount > 0 && (
              <p style={{ margin: "0 0 6px" }}>
                {data.estimatedPortionCount === 1
                  ? t('wh.voet.schattingEen')
                  : t('wh.voet.schattingMeer', { n: data.estimatedPortionCount })}
              </p>
            )}
            {/* [EXCEPTION-COUNT] The one-line "N kassadagen nog niet gereconcilieerd" that used to
                sit here is gone: the Kaart-controle card above now names each exception separately
                and says what to do about it. Repeating the total underneath would be the same fact
                twice, in less useful words. */}
            {/* [LEDGER-READ] Never present a check that did not run as a check that passed. */}
            {data.reconciliation.pinLedgerAvailable === false && (
              <p style={{ margin: "0 0 6px" }}>
                {t('wh.voet.grootboek')}
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
                  {/* [TZ] formatDateNL pins Europe/Amsterdam; toLocaleDateString used the reader's
                      own zone, so a filing stamped near midnight showed a different day depending
                      on where the phone was. On a legal record the date is the record. */}
                  <span style={{ fontSize: 12.5, color: M.muted }}>
                    {t('wh.filed.ingediendOp', { datum: formatDateNL(data.filed.filedAt) })}
                  </span>
                  <button
                    onClick={() => setFiled(false)}
                    disabled={filing}
                    style={{ background: "none", border: "none", color: M.muted, fontSize: 12.5, fontWeight: 600, cursor: filing ? "default" : "pointer", textDecoration: "underline", padding: 0 }}
                  >
                    {filing ? t('act.bezig') : t('wh.filed.ongedaan')}
                  </button>
                </div>
              ) : (
                /* [FILING-WINDOW] The button used to be offered for the CURRENT quarter too, and
                   the server happily froze a snapshot halfway through it. From that moment every
                   further sale reads as a divergence against a period that was never filed, and
                   past €1.000 the screen starts demanding a suppletie for an aangifte that does not
                   exist. A quarter can only have been filed once it is over — the server enforces
                   this (409 quarter_not_ended); here we simply do not offer it. */
                /* [FILING-NO-OVERWRITE] …and not while the filing state is UNKNOWN. This button is
                   the one that can replace a frozen aangifte, and `filed === null` used to mean
                   both "not filed" and "we could not read it". Offering it on the second one is
                   how a failed read turned into a lost record. */
                <button
                  onClick={() => setFiled(true)}
                  disabled={filing || data.quarterEnded === false || data.filedUnknown === true}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: 12,
                    background: data.quarterEnded === false || data.filedUnknown ? "#f1f3f4" : M.primary,
                    border: "none", color: data.quarterEnded === false || data.filedUnknown ? "#9aa0a6" : "#fff",
                    fontWeight: 700, fontSize: 14,
                    cursor: filing || data.quarterEnded === false || data.filedUnknown ? "default" : "pointer",
                  }}
                >
                  {filing ? t('act.bezig') : t('wh.filed.markeer')}
                </button>
              )}
              <p style={{ fontSize: 11.5, color: M.muted, margin: "8px 2px 0", lineHeight: 1.5 }}>
                {data.filedUnknown
                  ? t('wh.filed.uitlegOnbekend')
                  : !data.filed && data.quarterEnded === false
                    ? t('wh.filed.uitlegLooptNog')
                    : t('wh.filed.uitlegVastleggen')}
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// `sub` is the quiet second line: the bookkeeping term under a plain-language label, or the plain
// meaning under a figure. It exists so the screen can be read without a glossary while still using
// the words the aangifte and the accountant use.
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#80868b", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/** One row in "Nog te doen" — what is missing, and the screen that fixes it. */
function TodoRow({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderTop: `1px solid ${M.line}` }}>
      <div style={{ flex: 1, fontSize: 13, color: M.onSurface, lineHeight: 1.5 }}>{text}</div>
      <Link href={href} style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: M.primary, textDecoration: "none", whiteSpace: "nowrap" }}>
        {cta} ›
      </Link>
    </div>
  );
}
