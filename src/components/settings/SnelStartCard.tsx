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
  counts: { klaar: number; doorgestuurd: number; mislukt: number };
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

async function fetchGrootboeken(): Promise<
  { ok: true; grootboeken: Grootboek[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/snelstart/grootboeken");
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "Grootboeken ophalen mislukt" };
    return { ok: true, grootboeken: data.grootboeken ?? [] };
  } catch {
    return { ok: false, error: "Grootboeken ophalen mislukt" };
  }
}

export function SnelStartCard() {
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

  const loadStatus = useCallback(async () => {
    const data = await fetchStatus();
    if (!data) return; // stil: een mislukte statuscheck mag de pagina niet slopen
    setStatus(data);
    setInkoop(data.inkoopGrootboekId ?? "");
    setVerkoop(data.verkoopGrootboekId ?? "");
    return data;
  }, []);

  const loadGrootboeken = useCallback(async () => {
    const result = await fetchGrootboeken();
    if (result.ok) setGrootboeken(result.grootboeken);
    else setError(result.error);
  }, []);

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
      const result = await fetchGrootboeken();
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
        setError(data.error ?? "Koppelen mislukt");
        return;
      }
      setClientKey("");
      setGrootboeken(data.grootboeken ?? []);
      setNotice("SnelStart is gekoppeld. Kies nu op welke rekeningen geboekt moet worden.");
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
        setError(data.error ?? "Opslaan mislukt");
        return;
      }
      setNotice("Rekeningen opgeslagen.");
      await loadStatus();
    } finally {
      setBusy(null);
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
        setError(data.error ?? "Doorsturen mislukt");
        await loadStatus();
        return;
      }
      setResults(data.results ?? []);
      const rest = data.remaining > 0 ? ` Nog ${data.remaining} te gaan.` : "";
      setNotice(
        data.failed > 0
          ? `${data.pushed} geboekt, ${data.failed} niet gelukt.${rest}`
          : `${data.pushed} ${data.pushed === 1 ? "factuur" : "facturen"} geboekt in SnelStart.${rest}`,
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
      setNotice("De koppeling met SnelStart is verbroken.");
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
        Stuur je gecontroleerde facturen en bonnen rechtstreeks als inkoop- en
        verkoopboeking naar je SnelStart-administratie. Alleen facturen die je hebt
        gecontroleerd gaan mee, en elke factuur gaat maar één keer.
      </p>

      {status.status === "needs_reauth" && (
        <p className="text-sm text-amber-600">
          SnelStart accepteert je maatwerksleutel niet meer. Maak in SnelStart een nieuwe
          sleutel aan en plak die hieronder.
        </p>
      )}

      {needsKey ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-key">
              Maatwerksleutel
            </label>
            <input
              id="snelstart-key"
              type="password"
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              placeholder="Plak hier je sleutel uit SnelStart"
              autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <span className="block text-xs text-gray-400 mt-1">
              In SnelStart: Onderhoud → Maatwerk → maak een koppelsleutel aan. De sleutel
              geldt voor één administratie en wordt versleuteld bewaard.
            </span>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-label">
              Naam van de administratie (optioneel)
            </label>
            <input
              id="snelstart-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Bijv. Bakkerij 2026"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
          </div>
          <button
            onClick={connect}
            disabled={busy !== null || clientKey.trim().length < 20}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "connect" ? "Controleren…" : "Koppelen met SnelStart"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-green-600">
              ✓ Gekoppeld{status.administrationLabel ? ` — ${status.administrationLabel}` : ""}
            </span>
            <span className="text-gray-500">{status.counts.doorgestuurd} doorgestuurd</span>
            {status.counts.mislukt > 0 && (
              <span className="text-amber-600">{status.counts.mislukt} mislukt</span>
            )}
          </div>

          {!status.grootboekenIngesteld && (
            <p className="text-sm text-amber-600">
              Kies eerst de rekeningen waarop geboekt moet worden.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-inkoop">
                Inkoop boeken op
              </label>
              <select
                id="snelstart-inkoop"
                value={inkoop}
                onChange={(e) => setInkoop(e.target.value)}
                onFocus={() => grootboeken.length === 0 && void loadGrootboeken()}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">Kies een rekening…</option>
                {grootboeken.map((g) => (
                  <option key={g.id} value={g.id}>
                    {grootboekLabel(g)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="snelstart-verkoop">
                Verkoop boeken op
              </label>
              <select
                id="snelstart-verkoop"
                value={verkoop}
                onChange={(e) => setVerkoop(e.target.value)}
                onFocus={() => grootboeken.length === 0 && void loadGrootboeken()}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="">Kies een rekening…</option>
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
              {busy === "save" ? "Opslaan…" : "Rekeningen opslaan"}
            </button>
            <button
              onClick={push}
              disabled={busy !== null || !status.grootboekenIngesteld || status.counts.klaar === 0}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "push"
                ? "Bezig met boeken…"
                : status.counts.klaar === 0
                  ? "Niets te versturen"
                  : `Stuur ${status.counts.klaar} ${status.counts.klaar === 1 ? "factuur" : "facturen"} door`}
            </button>
            <button
              onClick={disconnect}
              disabled={busy !== null}
              className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              Ontkoppelen
            </button>
          </div>

          {status.lastPushAt && (
            <p className="text-xs text-gray-400">
              Laatst doorgestuurd op {new Date(status.lastPushAt).toLocaleString("nl-NL")}.
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
                <span className="font-medium">{r.invoiceNumber ?? "Zonder nummer"}</span> — {r.error}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
