// src/app/dashboard/beheer/BeheerScherm.tsx
// [BEHEER] Pure presentation — the page hands it a finished overview, it renders. No fetching,
// no language of its own beyond its Dutch labels (this is an operator screen, Dutch-only like
// the accountant module and for the same reason: its one reader chose no language setting).

import type { BeheerOverview } from "@/lib/beheer";
import type { SystemHealth, EventSummary } from "@/lib/beheer-health";

const CARD: React.CSSProperties = { background: "#fff", border: "1px solid #E0E0E0", borderRadius: 12, padding: "16px 20px" };
const TH: React.CSSProperties = { textAlign: "start", fontSize: 12, fontWeight: 600, color: "#5F6368", padding: "6px 10px", borderBottom: "1px solid #E0E0E0" };
const TD: React.CSSProperties = { fontSize: 13, color: "#202124", padding: "7px 10px", borderBottom: "1px solid #F1F3F4" };

function Tel({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ ...CARD, minWidth: 120 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#202124" }}>{n}</div>
      <div style={{ fontSize: 12.5, color: "#5F6368" }}>{label}</div>
    </div>
  );
}

/**
 * [BEHEER-GEZOND] Draaien de achtergrondtaken nog?
 *
 * Bovenaan, vóór de accounts, en dat is geen smaak: een gestopte cron geeft geen foutmelding en
 * verandert niets aan het scherm — geen herinneringen meer, geen bankregels meer, geen
 * betaaltermijn die op tijd wordt gemeld — terwijl de rest van deze pagina er normaal uitziet.
 * Het is het enige blok hier dat een storing kan tonen die nergens anders zichtbaar is.
 */
function Systeem({ systeem }: { systeem: SystemHealth }) {
  // [NO-SILENT-EMPTY] Onleesbaar is een derde stand, geen groene. Op de pagina die bestaat om te
  // zeggen of de machine draait, mag "we konden niet kijken" nooit als "alles goed" lezen.
  if (!systeem.readable) {
    return (
      <div style={{ ...CARD, borderColor: "#B3261E" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#B3261E" }}>De cron-hartslag is niet te lezen</div>
        <div style={{ fontSize: 12.5, color: "#5F6368", marginTop: 4, lineHeight: 1.5 }}>
          We weten dus niet of de achtergrondtaken nog draaien. Dat is geen bevestiging dat er iets stuk is,
          en ook geen bevestiging dat alles goed gaat — het is precies het geval waarin niemand het merkt.
        </div>
      </div>
    );
  }
  const kleur = (h: string) => (h === "ok" ? "#1E8E3E" : h === "nog-niet-langs" ? "#5F6368" : "#B3261E");
  return (
    <div style={{ ...CARD, borderColor: systeem.allWell ? "#E0E0E0" : "#B3261E" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: systeem.allWell ? "#1E8E3E" : "#B3261E", marginBottom: 8 }}>
        {systeem.allWell
          ? `Alle ${systeem.crons.length} achtergrondtaken draaien`
          : `${systeem.attention.length} van ${systeem.crons.length} achtergrondtaken hebben aandacht nodig`}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {systeem.crons.map((c) => (
            <tr key={c.job}>
              <td style={{ ...TD, fontWeight: c.needsAttention ? 600 : 400 }}>{c.job}</td>
              <td style={{ ...TD, color: kleur(c.health), whiteSpace: "nowrap" }}>{c.health}</td>
              {/* "nog nooit" is een echt antwoord en het antwoord op "is deze cron ooit gedraaid?" —
                  precies de vraag na een deploy die een nieuwe taak toevoegt. */}
              <td style={{ ...TD, color: "#5F6368", whiteSpace: "nowrap" }}>
                {c.lastRunAt === null ? "nog nooit" : c.hoursAgo === 0 ? "< 1 uur" : `${c.hoursAgo} uur`}
              </td>
              <td style={{ ...TD, color: "#5F6368" }}>{c.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * [STORINGSBEELD] Wat er de laatste dagen misging.
 *
 * Geen logboek. Vierduizend regels ruwe tekst beantwoorden de vraag niet; "welke storing, hoe vaak,
 * wanneer voor het laatst" wel — en dat is ook precies wat de tabel draagt, want die bewaart met
 * opzet geen message en geen context (system_events.sql legt uit waarom: drie kolommen kunnen geen
 * klantgegeven lekken). De zin staat in de serverlog en in Sentry, met de toegang die daarbij past.
 */
function Storingen({ storingen }: { storingen: EventSummary }) {
  // [NO-SILENT-EMPTY] "Er ging niets mis" is een goed antwoord en een ANDER antwoord dan "we konden
  // niet kijken". Op een beheerpagina mogen die twee nooit hetzelfde zijn — de tweede is precies de
  // toestand waarin een storing onopgemerkt doorloopt.
  if (!storingen.readable) {
    return (
      <div style={{ ...CARD, borderColor: "#B3261E" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#B3261E" }}>Het storingsbeeld is niet te lezen</div>
        <div style={{ fontSize: 12.5, color: "#5F6368", marginTop: 4, lineHeight: 1.5 }}>
          We weten dus niet of er de afgelopen {storingen.days} dagen iets is misgegaan. Dat is niet hetzelfde
          als &quot;er ging niets mis&quot;.
        </div>
      </div>
    );
  }
  if (storingen.groups.length === 0) {
    return (
      <div style={{ ...CARD }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1E8E3E" }}>
          Geen afgevangen storingen in {storingen.days} dagen
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...CARD }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#202124", marginBottom: 8 }}>
        {storingen.total} afgevangen storing{storingen.total === 1 ? "" : "en"} in {storingen.days} dagen
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {storingen.groups.map((g) => (
            <tr key={g.tag}>
              <td style={{ ...TD, fontWeight: 600 }}>{g.tag}</td>
              <td style={{ ...TD, color: g.severity === "data-integrity" ? "#B3261E" : "#5F6368", whiteSpace: "nowrap" }}>
                {g.severity}
              </td>
              {/* Frequentie eerst, want dat is het verschil tussen "dit gebeurde ooit" en "dit
                  gebeurt nu" — en dat is wat een beheerder in één blik moet zien. */}
              <td style={{ ...TD, whiteSpace: "nowrap" }}>{g.count}×</td>
              <td style={{ ...TD, color: "#5F6368", whiteSpace: "nowrap" }}>
                {g.hoursAgo === null ? "" : g.hoursAgo === 0 ? "< 1 uur geleden" : `${g.hoursAgo} uur geleden`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BeheerScherm({ overview, systeem, storingen }: { overview: BeheerOverview; systeem: SystemHealth; storingen: EventSummary }) {
  const { users, links, counts } = overview;
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 20, fontFamily: "'Roboto', -apple-system, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#202124", margin: 0 }}>Beheer</h1>

      <Systeem systeem={systeem} />
      <Storingen storingen={storingen} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Tel n={counts.total} label="accounts" />
        <Tel n={counts.owners} label="ondernemers" />
        <Tel n={counts.accountants} label="boekhouders" />
        <Tel n={counts.links} label="koppelingen" />
      </div>

      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 10px" }}>Accounts</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={TH}>Naam</th><th style={TH}>E-mail</th><th style={TH}>Rol</th><th style={TH}>Plan</th><th style={TH}>Sinds</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={TD}>{u.name}</td>
                  <td style={TD}>{u.email ?? "—"}</td>
                  <td style={TD}>{u.role}</td>
                  <td style={TD}>{u.plan}</td>
                  <td style={TD}>{u.createdAt ?? "—"}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td style={TD} colSpan={5}>Nog geen accounts.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 10px" }}>Boekhouder ↔ klant</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr><th style={TH}>Boekhouder</th><th style={TH}>Klant</th><th style={TH}>Sinds</th></tr>
            </thead>
            <tbody>
              {links.map((l, i) => (
                <tr key={i}>
                  <td style={TD}>{l.accountantName}</td>
                  <td style={TD}>{l.clientName}</td>
                  <td style={TD}>{l.since ?? "—"}</td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr><td style={TD} colSpan={3}>Nog geen koppelingen.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ fontSize: 12, color: "#80868b", margin: 0, lineHeight: 1.5 }}>
        Alleen-lezen. Koppelen, ontkoppelen en rollen lopen via de partijen zelf — dit scherm geeft
        overzicht, geen tweede deur.
      </p>
    </main>
  );
}
