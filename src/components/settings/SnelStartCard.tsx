"use client";
// src/components/settings/SnelStartCard.tsx
// [SNELSTART] De koppelkaart op Instellingen — juli 2026
//
// Drie stappen, in deze volgorde, want elke stap heeft de vorige nodig:
//   1. maatwerksleutel plakken  → wij bewijzen live dat hij werkt
//   2. grootboekrekeningen kiezen → zonder rekening kan er niets geboekt worden
//   3. facturen doorsturen        → met een eerlijke uitkomst per factuur
//
// De kaart verbergt zichzelf als de server de koppeling niet aankan (geen subscription
// key): een knop die per definitie niet kan werken is erger dan geen knop.

import { useCallback, useEffect, useState } from "react";
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
// [TAAL] A component holds no language of its own.
import { useLocale } from "@/lib/i18n/use-locale";
import { translator, type Translator } from "@/lib/i18n/t";

interface Grootboek {
  id: string;
  nummer: number | null;
  omschrijving: string;
}

interface Status {
  configured: boolean;
  connected: boolean;
  status?: "active" | "needs_reauth";
  administrationLabel?: string | null;
  grootboekenIngesteld?: boolean;
  inkoopGrootboekId?: string | null;
  verkoopGrootboekId?: string | null;
  lastPushAt?: string | null;
  lastError?: string | null;
  counts: { klaar: number; doorgestuurd: number; onbekend?: number; mislukt: number; tegengehouden?: number };
  // [PUSH-ACK] De facturen die een boeking zouden zijn, maar waar nog een voorbehoud op staat.
  // Met de reden erbij: een aantal zonder namen is geen actie, alleen een verontrusting.
  held?: Array<{
    id: string;
    invoiceNumber: string | null;
    clientName: string | null;
    totalIncBtw: number | null;
    invoiceDate: string | null;
    reasons: string[];
  }>;
}

interface PushResult {
  invoiceId: string;
  invoiceNumber: string | null;
  status: "pushed" | "failed";
  error?: string;
}

/** Losse ophalers, buiten de component: ze raken geen state aan, dus een effect mag ze
 *  aanroepen zonder een cascade van renders te veroorzaken. */
async function fetchStatus(): Promise<Status | null> {
  try {
    const res = await fetch("/api/snelstart/status");
    if (!res.ok) return null;
    return (await res.json()) as Status;
  } catch {
    return null;
  }
}

async function fetchGrootboeken(t: Translator): Promise<
  { ok: true; grootboeken: Grootboek[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/snelstart/grootboeken");
    const data = await res.json();
    if (!res.ok) return { ok: false, error: failureText(res.status, data, t("ss.grootboekenMislukt")) };
    return { ok: true, grootboeken: data.grootboeken ?? [] };
  } catch {
    return { ok: false, error: t("ss.grootboekenMislukt") };
  }
}

export function SnelStartCard() {
  const t = translator(useLocale());
  const [status, setStatus] = useState<Status | null>(null);
  const [clientKey, setClientKey] = useState("");
  const [label, setLabel] = useState("");
  const [grootboeken, setGrootboeken] = useState<Grootboek[]>([]);
  const [inkoop, setInkoop] = useState("");
  const [verkoop, setVerkoop] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "save" | "push" | "disconnect">(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [results, setResults] = useState<PushResult[] | null>(null);
  // [PUSH-ACK] Welke factuur er op dit moment wordt afgetikt — per rij, zodat de andere knoppen
  // bruikbaar blijven en de eigenaar ziet welke er bezig is.
  const [ackBusy, setAckBusy] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const data = await fetchStatus();
    if (!data) return; // stil: een mislukte statuscheck mag de pagina niet slopen
    setStatus(data);
    setInkoop(data.inkoopGrootboekId ?? "");
    setVerkoop(data.verkoopGrootboekId ?? "");
    return data;
  }, []);

  const loadGrootboeken = useCallback(async () => {
    const result = await fetchGrootboeken(t);
    if (result.ok) setGrootboeken(result.grootboeken);
    else setError(result.error);
  }, [t]);

  useEffect(() => {
    // Eén ophaalronde bij het openen van de pagina. Staat de koppeling er al maar zijn de
    // rekeningen nog niet gekozen, dan halen we de lijst meteen mee — anders kijkt de
    // gebruiker naar een lege keuzelijst.
    let alive = true;
    void (async () => {
      const data = await fetchStatus();
      if (!alive || !data) return;
      setStatus(data);
      setInkoop(data.inkoopGrootboekId ?? "");
      setVerkoop(data.verkoopGrootboekId ?? "");

      if (!data.connected || data.grootboekenIngesteld) return;
      const result = await fetchGrootboeken(t);
      if (!alive) return;
      if (result.ok) setGrootboeken(result.grootboeken);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!status || !status.configured) return null;

  async function connect() {
    setBusy("connect");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/snelstart/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, administrationLabel: label || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(failureText(res.status, data, t("ss.koppelenMislukt")));
        return;
      }
      setClientKey("");
      setGrootboeken(data.grootboeken ?? []);
      setNotice(t("ss.gekoppeldKies"));
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  async function saveGrootboeken() {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/snelstart/connect", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inkoopGrootboekId: inkoop, verkoopGrootboekId: verkoop }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(failureText(res.status, data, t("ss.opslaanMislukt")));
        return;
      }
      setNotice(t("ss.rekeningenOpgeslagen"));
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  // [PUSH-ACK] "Ik weet het, stuur toch door" — één factuur, één voorbehoud-set, één spoorregel.
  // Het akkoord wordt op de SERVER vastgelegd, want de poort die het opheft staat daar; een vinkje
  // dat alleen in deze browser leeft is een knop die niets doet.
  async function acknowledge(invoiceId: string) {
    if (ackBusy) return;
    setAckBusy(invoiceId);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/snelstart/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        // De server kent redenen die permanent zijn ("je boekhouder heeft deze al verwerkt") — dan
        // is "probeer opnieuw" een leugen. Zeg wat hij zegt.
        setError(failureText(res.status, data, t("ss.akkoordMislukt")));
        return;
      }
      setNotice(
        Array.isArray(data.acknowledged) && data.acknowledged.length > 0
          ? t("ss.akkoordVast")
          : (data.message ?? t("ss.geenVoorbehoud")),
      );
      // Uit de SERVER opnieuw laden, nooit lokaal wegstrepen: de rij verdwijnt pas als de poort
      // hem werkelijk doorlaat, anders belooft het scherm iets wat de push niet doet.
      await loadStatus();
    } catch {
      setError(t("ss.geenVerbindingAkkoord"));
    } finally {
      setAckBusy(null);
    }
  }

  async function push() {
    setBusy("push");
    setError("");
    setNotice("");
    setResults(null);
    try {
      const res = await fetch("/api/snelstart/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(failureText(res.status, data, t("ss.doorsturenMislukt")));
        await loadStatus();
        return;
      }
      setResults(data.results ?? []);
      const rest = data.remaining > 0 ? t("ss.nogTeGaan", { count: data.remaining }) : "";
      setNotice(
        data.failed > 0
          ? t("ss.deelsGelukt", { pushed: data.pushed, failed: data.failed }) + rest
          : (data.pushed === 1 ? t("ss.geboektEen") : t("ss.geboekt", { count: data.pushed })) + rest,
      );
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    setNotice("");
    try {
      await fetch("/api/snelstart/disconnect", { method: "POST" });
      setResults(null);
      setGrootboeken([]);
      setNotice(t("ss.ontkoppeld"));
      await loadStatus();
    } finally {
      setBusy(null);
    }
  }

  const needsKey = !status.connected || status.status === "needs_reauth";
  const grootboekLabel = (g: Grootboek) =>
    `${g.nummer !== null ? `${g.nummer} — ` : ""}${g.omschrijving || g.id}`;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">SnelStart</p>
      <p className="text-sm text-gray-500">
        {t('ss.uitleg')}
      </p>

      {status.status === "needs_reauth" && (
        <p className="text-sm text-amber-600">
          {t('ss.sleutelOud')}
        </p>
      )}

      {needsKey ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-key">
              {t('ss.sleutel')}
            </label>
            <input
              id="snelstart-key"
              type="password"
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              placeholder={t('ss.sleutelHint')}
              autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <span className="block text-xs text-gray-400 mt-1">
              {t('ss.sleutelWaar')}
            </span>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-label">
              {t('ss.adminNaam')}
            </label>
            <input
              id="snelstart-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('ss.adminNaamHint')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
          </div>
          <button
            onClick={connect}
            disabled={busy !== null || clientKey.trim().length < 20}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "connect" ? t("ss.controleren") : t("ss.koppelen")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-green-600">
              {t('ss.gekoppeld')}{status.administrationLabel ? ` — ${status.administrationLabel}` : ""}
            </span>
            <span className="text-gray-500">{t("ss.doorgestuurd", { count: status.counts.doorgestuurd })}</span>
            {/* [SNELSTART-EERLIJK] Verstuurd, maar zonder bevestiging van SnelStart. Dit hoort
                NIET bij "doorgestuurd" (dat zou beweren dat het geboekt is) en niet bij "mislukt"
                (dat zou beweren dat het niet geboekt is). Het is de enige eerlijke derde categorie,
                en hij hoort blijvend op het scherm te staan — niet alleen in de melding direct na
                een push, die bij het herladen verdwijnt. */}
            {(status.counts.onbekend ?? 0) > 0 && (
              <span className="text-amber-700">
                {t('ss.zonderBevestiging', { count: status.counts.onbekend ?? 0 })}
              </span>
            )}
            {status.counts.mislukt > 0 && (
              <span className="text-amber-600">{t("ss.mislukt", { count: status.counts.mislukt })}</span>
            )}
            {(status.counts.tegengehouden ?? 0) > 0 && (
              <span className="text-amber-700">
                {t('ss.wachtAkkoord', { count: status.counts.tegengehouden ?? 0 })}
              </span>
            )}
          </div>

          {/* [PUSH-ACK] De facturen die een boeking zouden zijn en door een voorbehoud worden
              tegengehouden. Ze staan HIER met naam en reden, niet alleen als aantal: een teller
              zonder namen vertelt de ondernemer dat er iets mis is en niet wat, en dan is de enige
              beschikbare handeling zich zorgen maken.

              Waarom ze überhaupt worden tegengehouden staat in snelstart-mapping.ts. Kort: een
              boeking in de administratie van de boekhouder is niet van ons om terug te nemen — na
              'verwerkt' bevriest de trigger de factuur — dus een voorbehoud dat de wachtrij wél
              kende mag niet ongezien meereizen. En waarom er een knop bij hoort: de eigenaar kan
              naar het papier hebben gekeken en weten dat die "mogelijke dubbele" een tweede echte
              levering is. Een slot zonder sleutel houdt die factuur voorgoed buiten de boeken, en
              dat is data die verdwijnt, geen voorzichtigheid. */}
          {(status.held?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                {t('ss.wachtKop')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                {t('ss.wachtUitleg')}
              </p>
              <ul className="mt-3 space-y-2">
                {status.held!.map((h) => (
                  <li key={h.id} className="rounded-md border border-amber-200 bg-white p-2.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-mono text-xs text-gray-500">{h.invoiceNumber ?? "—"}</span>
                      <span className="font-semibold text-gray-900">{h.clientName ?? "—"}</span>
                      {typeof h.totalIncBtw === "number" && (
                        <span className="ms-auto font-mono text-sm text-gray-900">
                          {h.totalIncBtw.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}
                        </span>
                      )}
                    </div>
                    <ul className="mt-1.5 list-disc space-y-0.5 ps-4 text-xs leading-relaxed text-amber-900">
                      {h.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                    <button
                      onClick={() => acknowledge(h.id)}
                      disabled={ackBusy !== null}
                      className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {ackBusy === h.id ? t("ss.akkoordBezig") : t("ss.akkoordKnop")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!status.grootboekenIngesteld && (
            <p className="text-sm text-amber-600">
              {t('ss.kiesEerst')}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-inkoop">
                {t('ss.inkoopOp')}
              </label>
              <select
                id="snelstart-inkoop"
                value={inkoop}
                onChange={(e) => setInkoop(e.target.value)}
                onFocus={() => grootboeken.length === 0 && void loadGrootboeken()}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">{t("ss.kiesRekening")}</option>
                {grootboeken.map((g) => (
                  <option key={g.id} value={g.id}>
                    {grootboekLabel(g)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-verkoop">
                {t('ss.verkoopOp')}
              </label>
              <select
                id="snelstart-verkoop"
                value={verkoop}
                onChange={(e) => setVerkoop(e.target.value)}
                onFocus={() => grootboeken.length === 0 && void loadGrootboeken()}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">{t("ss.kiesRekening")}</option>
                {grootboeken.map((g) => (
                  <option key={g.id} value={g.id}>
                    {grootboekLabel(g)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={saveGrootboeken}
              disabled={busy !== null || !inkoop || !verkoop}
              className="border border-gray-300 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === "save" ? t("ss.opslaanBezig") : t("ss.rekeningenOpslaan")}
            </button>
            <button
              onClick={push}
              disabled={busy !== null || !status.grootboekenIngesteld || status.counts.klaar === 0}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "push"
                ? t("ss.boekenBezig")
                : status.counts.klaar === 0
                  ? t("ss.nietsTeVersturen")
                  : status.counts.klaar === 1 ? t("ss.stuurDoorEen") : t("ss.stuurDoor", { count: status.counts.klaar })}
            </button>
            <button
              onClick={disconnect}
              disabled={busy !== null}
              className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              {t('ss.ontkoppelen')}
            </button>
          </div>

          {status.lastPushAt && (
            <p className="text-xs text-gray-400">
              {t('ss.laatstDoorgestuurd', { time: new Date(status.lastPushAt).toLocaleString("nl-NL") })}
            </p>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-green-600">{notice}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Per factuur verantwoorden: zonder deze lijst weet de gebruiker alleen dát er iets
          misging, niet wát er niet geboekt is. */}
      {results && results.some((r) => r.status === "failed") && (
        <ul className="text-sm text-gray-600 space-y-1">
          {results
            .filter((r) => r.status === "failed")
            .map((r) => (
              <li key={r.invoiceId}>
                <span className="font-medium">{r.invoiceNumber ?? t("ss.zonderNummer")}</span> — {r.error}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
