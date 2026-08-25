// src/app/dashboard/beheer/BeheerScherm.tsx
// [BEHEER] Pure presentation — the page hands it a finished overview, it renders. No fetching,
// no language of its own beyond its Dutch labels (this is an operator screen, Dutch-only like
// the accountant module and for the same reason: its one reader chose no language setting).

import type { BeheerOverview } from "@/lib/beheer";

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

export function BeheerScherm({ overview }: { overview: BeheerOverview }) {
  const { users, links, counts } = overview;
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 20, fontFamily: "'Roboto', -apple-system, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#202124", margin: 0 }}>Beheer</h1>

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
