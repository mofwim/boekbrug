"use client";

// src/components/kas/KasboekVergelijken.tsx
// [KASBOEK-NAAST-KAS] "Mijn boekhouder stuurde het kasboek" — het scherm dat het naast je kas legt.
//
// ── WAT DIT SCHERM OPLOST ──
//
// Een echte klant leverde zijn kwartaalkasboek aan: 91 dagen, € 22.377,02 aan contante uitgaven.
// De app kende er € 1.402,87 van — alleen wat via een factuur contant was afgeboekt. De rest —
// een leverancier, een deel salaris, een privé-opname, de marktinkopen — stond alleen in dat
// bestand. Zijn lade stond ruim € 19.000 te hoog en het kwartaal begon ónder nul, wat fysiek niet
// kan en het eerste is waar een kasadministratie op wordt afgewezen.
//
// ── EN WAAROM ER GEEN KNOP IS DIE ALLES BOEKT ──
//
// Omdat het bestand het niet weet. De boekhouder schrijft € 1.754,35 op één regel met drie
// betalingen erin, en één daarvan staat al in de app. Alles overnemen boekt die dubbel — en een
// dubbele uitgave VERLAAGT het saldo, wat pas maanden later opvalt. Daarom rekent de app alleen
// het VERSCHIL per dag uit (dat is aftrekken, geen gok) en kiest de eigenaar welke dagen erin
// mogen, met de categorie erbij. Die categorie kan de app niet weten: kosten, salaris en privé
// komen alle drie voorbij in dezelfde kolom.
//
// De dagen die kloppen staan er niet bij. 84 van de 91 in orde is een getal in de kop, geen lijst
// van 91 regels waar niemand doorheen komt.

import { useRef, useState } from "react";

type Verdict = "ontbreekt" | "app_meer";

interface DayRow {
  date: string;
  fileSpent: number;
  appSpent: number;
  delta: number;
  verdict: Verdict;
  description: string | null;
  fileReceived: number;
  appReceived: number;
}

interface Vergelijking {
  period: { from: string; to: string };
  openingBalance: number | null;
  closingBalance: number | null;
  headline: string;
  summary: { days: number; missingDays: number; missingTotal: number; extraDays: number; extraTotal: number; equalDays: number };
  days: DayRow[];
  warnings: string[];
}

/** De categorieën die de eigenaar zelf mag boeken — cash.ts houdt de andere drie dicht. */
const CATEGORIEEN: { value: string; label: string }[] = [
  { value: "kosten", label: "Kost" },
  { value: "salaris", label: "Salaris" },
  { value: "prive", label: "Privé" },
  { value: "transfer", label: "Overboeking" },
];

const eur = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nlDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${Number(m)}-${y}`;
};

/** De lijst en de knop, zonder ophalen — zo kan tests/render hem echte dagen geven. */
export function VergelijkingLijst({
  data,
  keuze,
  onToggle,
  onCategorie,
  onBoek,
  bezig,
  resultaat,
}: {
  data: Vergelijking;
  keuze: Record<string, string | null>;
  onToggle: (date: string) => void;
  onCategorie: (date: string, category: string) => void;
  onBoek: () => void;
  bezig?: boolean;
  resultaat?: string | null;
}) {
  const teBoeken = data.days.filter((d) => d.verdict === "ontbreekt" && keuze[d.date]);
  const totaal = teBoeken.reduce((s, d) => s + d.delta, 0);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{data.headline}</p>
      <p style={{ fontSize: 12.5, color: "#5F6368", margin: 0 }}>
        {nlDate(data.period.from)} t/m {nlDate(data.period.to)} · beginsaldo {eur(data.openingBalance ?? 0)} · eindsaldo{" "}
        {eur(data.closingBalance ?? 0)}
      </p>

      {data.warnings.length > 0 && (
        // Het blad klopt niet met zichzelf. Dat staat bóven de lijst, want het zegt iets over ELKE
        // regel eronder — een gat in de keten betekent dat er een dag ontbreekt in het bestand zelf.
        <div role="alert" style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: 10 }}>
          {data.warnings.slice(0, 4).map((w, i) => (
            <p key={i} style={{ fontSize: 12.5, color: "#8D6E00", margin: i ? "4px 0 0" : 0 }}>{w}</p>
          ))}
        </div>
      )}

      {data.days.length === 0 ? (
        <p style={{ fontSize: 13, color: "#188038", margin: 0 }}>
          Er is niets te doen: elke dag in dit kasboek komt overeen met je kas.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {data.days.map((d) => {
            const missend = d.verdict === "ontbreekt";
            const gekozen = keuze[d.date] ?? null;
            return (
              <div
                key={d.date}
                style={{
                  border: "1px solid #E0E0E0",
                  borderRadius: 10,
                  padding: 10,
                  background: missend ? "#fff" : "#FAFAFA",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{nlDate(d.date)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: missend ? "#B3261E" : "#5F6368" }}>
                    {missend ? eur(d.delta) : `+${eur(Math.abs(d.delta))} in je kas`}
                  </span>
                </div>

                <p style={{ fontSize: 12.5, color: "#3C4043", margin: 0, lineHeight: 1.4 }}>
                  {/* De omschrijving van de boekhouder, ONGEWIJZIGD: dat is het enige waaraan de
                      eigenaar kan zien wat dit bedrag was. */}
                  {d.description || "— geen omschrijving in het kasboek —"}
                </p>
                <p style={{ fontSize: 11.5, color: "#5F6368", margin: 0 }}>
                  kasboek {eur(d.fileSpent)} · je kas {eur(d.appSpent)}
                </p>

                {missend ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                      <input type="checkbox" checked={!!gekozen} onChange={() => onToggle(d.date)} aria-label={`Boek ${nlDate(d.date)}`} />
                      Boek {eur(d.delta)} als
                    </label>
                    <select
                      value={gekozen ?? "kosten"}
                      onChange={(e) => onCategorie(d.date, e.target.value)}
                      disabled={!gekozen}
                      aria-label={`Categorie voor ${nlDate(d.date)}`}
                      style={{ fontSize: 12.5, padding: "4px 6px", borderRadius: 6, border: "1px solid #DADCE0" }}
                    >
                      {CATEGORIEEN.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  // Nooit een knop. Deze boeking hangt meestal aan een factuur met een bon eronder;
                  // weghalen op grond van een blad zou bewijs vernietigen.
                  <p style={{ fontSize: 12, color: "#5F6368", margin: 0, fontStyle: "italic" }}>
                    Deze uitgave kent je kas wél en het kasboek niet. Wij halen hem niet weg — vraag je
                    boekhouder of hij hem mist.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {teBoeken.length > 0 && (
        <button
          type="button"
          onClick={onBoek}
          disabled={bezig}
          style={{
            background: "#0B57D0", color: "#fff", border: "none", borderRadius: 10,
            padding: "10px 14px", fontSize: 13.5, fontWeight: 600, cursor: bezig ? "wait" : "pointer",
          }}
        >
          {bezig ? "Bezig…" : `Boek ${teBoeken.length} ${teBoeken.length === 1 ? "dag" : "dagen"} — ${eur(totaal)}`}
        </button>
      )}

      {resultaat && <p style={{ fontSize: 13, color: "#188038", margin: 0 }}>{resultaat}</p>}
    </div>
  );
}

export default function KasboekVergelijken() {
  const [data, setData] = useState<Vergelijking | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [keuze, setKeuze] = useState<Record<string, string | null>>({});
  const [resultaat, setResultaat] = useState<string | null>(null);
  const invoer = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBezig(true); setFout(null); setResultaat(null); setData(null); setKeuze({});
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/kasboek/vergelijk", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setFout(json?.detail || json?.error || "Vergelijken mislukt.");
        return;
      }
      setData(json as Vergelijking);
    } catch {
      setFout("Vergelijken mislukt — controleer je verbinding.");
    } finally {
      setBezig(false);
    }
  }

  async function boek() {
    if (!data) return;
    const days = data.days
      .filter((d) => d.verdict === "ontbreekt" && keuze[d.date])
      .map((d) => ({ date: d.date, amount: d.delta, category: keuze[d.date], description: d.description ?? "" }));
    if (days.length === 0) return;
    setBezig(true); setFout(null);
    try {
      const res = await fetch("/api/kasboek/vergelijk", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setFout(json?.detail || json?.error || "Boeken mislukt.");
        return;
      }
      setResultaat(`${json.booked} ${json.booked === 1 ? "dag" : "dagen"} geboekt — ${eur(json.total)}. Je kassaldo is bijgewerkt.`);
      // De vergelijking is nu verouderd: opnieuw uploaden geeft het nieuwe verschil. Hem laten
      // staan zou de eigenaar dezelfde dagen een tweede keer laten aanvinken.
      setData(null); setKeuze({});
    } catch {
      setFout("Boeken mislukt — controleer je verbinding.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,0.08)", padding: 14, display: "grid", gap: 10 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#5F6368", letterSpacing: 0.4, margin: 0 }}>
        KASBOEK VAN JE BOEKHOUDER
      </p>
      <p style={{ fontSize: 13, color: "#3C4043", margin: 0, lineHeight: 1.45 }}>
        Stuurde je boekhouder een kasboek in Excel? Laad het hier en we leggen het dag voor dag naast
        je eigen kas. Wat je kas mist, kun je per dag bijboeken — je kiest zelf wat het was.
      </p>

      <input
        ref={invoer}
        type="file"
        accept=".xlsx,.xls,.csv"
        aria-label="Kasboek kiezen"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        style={{ fontSize: 12.5 }}
      />

      {bezig && !data && <p style={{ fontSize: 13, color: "#5F6368", margin: 0 }}>Bezig met lezen…</p>}
      {fout && <p role="alert" style={{ fontSize: 13, color: "#B3261E", margin: 0 }}>{fout}</p>}
      {resultaat && !data && <p style={{ fontSize: 13, color: "#188038", margin: 0 }}>{resultaat}</p>}

      {data && (
        <VergelijkingLijst
          data={data}
          keuze={keuze}
          onToggle={(date) => setKeuze((k) => ({ ...k, [date]: k[date] ? null : "kosten" }))}
          onCategorie={(date, category) => setKeuze((k) => ({ ...k, [date]: category }))}
          onBoek={() => void boek()}
          bezig={bezig}
          resultaat={null}
        />
      )}
    </div>
  );
}
