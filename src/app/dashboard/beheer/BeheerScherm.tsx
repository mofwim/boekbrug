// src/app/dashboard/beheer/BeheerScherm.tsx
// [BEHEER] Pure presentation — the page hands it a finished overview, it renders. No fetching,
// no language of its own beyond its Dutch labels (this is an operator screen, Dutch-only like
// the accountant module and for the same reason: its one reader chose no language setting).

import type { BeheerOverview } from "@/lib/beheer";
import type { SystemHealth, EventSummary } from "@/lib/beheer-health";
import { caughtErrorPct, type ReaderQuality } from "@/lib/reader-quality";

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
 * [LEESKWALITEIT] Hoe vaak moest een mens de machine verbeteren — en bij WIE.
 *
 * Het getal dat dit paneel bestaat om te weerleggen is het percentage. Op één echte administratie
 * stond het op 0,9%, en dat las als "verwaarloosbaar". Die vijf correcties waren één leverancier,
 * vijf creditnota's, allemaal binnen 42 seconden rechtgezet door iemand die net had uitgevogeld
 * wat er mis was: het model gaf is_credit_note=false op een document dat "€ -33,87" afdrukte.
 *
 * Per leverancier is dat geen ruis maar een sjabloon. Vandaar dat de leverancierslijst hier boven
 * het percentage staat en niet eronder.
 */
function Leeskwaliteit({ q }: { q: ReaderQuality | null }) {
  // [NO-SILENT-EMPTY] Niet kunnen kijken is geen nul. Op het paneel dat over leesfouten gaat, is
  // "geen fouten gevonden" en "we konden de vraag niet stellen" het gevaarlijkste paar om te
  // verwarren — de eerste stelt gerust, de tweede hoort dat juist niet te doen.
  if (!q) {
    return (
      <section style={{ ...CARD, borderColor: "#B3261E" }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#B3261E", margin: "0 0 6px" }}>Leeskwaliteit is niet te lezen</h2>
        <p style={{ fontSize: 12.5, color: "#5F6368", margin: 0, lineHeight: 1.5 }}>
          De vraag kon niet gesteld worden. Dat is géén bevestiging dat de lezer het goed doet.
        </p>
      </section>
    );
  }

  const pct = caughtErrorPct(q);
  return (
    <section style={CARD}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 4px" }}>Leeskwaliteit</h2>
      <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 14px", lineHeight: 1.5 }}>
        Hoe vaak een mens een gelezen bedrag of rekeningnummer heeft moeten verbeteren, over de
        laatste 90 dagen. Dit is de fout die IEMAND ZAG — een misllezing die niemand opmerkte, ziet
        er van hier af uit als een goede lezing.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tel n={q.read} label="facturen gelezen" />
        <Tel n={q.amountCorrected} label="bedrag verbeterd" />
        <Tel n={q.ibanCorrected} label="rekeningnummer verbeterd" />
        <div style={{ ...CARD, minWidth: 120, borderColor: q.afterPayment > 0 ? "#B3261E" : "#E0E0E0" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: q.afterPayment > 0 ? "#B3261E" : "#202124" }}>{q.afterPayment}</div>
          <div style={{ fontSize: 12.5, color: "#5F6368" }}>verbeterd ná betaling</div>
        </div>
      </div>

      {pct !== null && (
        <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 14px" }}>
          Gevonden foutpercentage: <strong style={{ color: "#202124" }}>{pct.toFixed(1)}%</strong>.
        </p>
      )}

      {/* De leverancierslijst BOVEN de losse correcties: fouten komen per sjabloon, niet los. */}
      {q.troubleSuppliers.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, color: "#202124", margin: "0 0 6px" }}>
            Leveranciers met meer dan één verbetering
          </h3>
          <p style={{ fontSize: 12, color: "#5F6368", margin: "0 0 8px", lineHeight: 1.5 }}>
            Twee keer dezelfde leverancier is zelden toeval — dat is meestal één documentsoort die de
            lezer niet aankan, en die herhaalt zich bij elke volgende factuur van dat bedrijf.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={TH}>Leverancier</th><th style={TH}>Verbeterd</th><th style={TH}>Van hoeveel</th></tr></thead>
              <tbody>
                {q.troubleSuppliers.map((s) => (
                  <tr key={s.supplierName}>
                    <td style={TD}>{s.supplierName}</td>
                    <td style={TD}>{s.corrected}</td>
                    <td style={TD}>{s.read}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={TH}>Wanneer</th><th style={TH}>Leverancier</th><th style={TH}>Wat</th><th style={TH}>Was</th><th style={TH}>Werd</th></tr></thead>
          <tbody>
            {q.recent.map((c) => (
              <tr key={c.invoiceId}>
                <td style={TD}>{new Date(c.atMs).toISOString().slice(0, 10)}</td>
                <td style={TD}>{c.supplierName}</td>
                <td style={TD}>{c.what}</td>
                <td style={TD}>{c.what === "iban" ? (c.ibanBefore ?? "—") : (c.amountBefore ?? "—")}</td>
                <td style={TD}>{c.what === "iban" ? (c.ibanAfter ?? "—") : (c.amountAfter ?? "—")}</td>
              </tr>
            ))}
            {q.recent.length === 0 && (
              <tr><td style={TD} colSpan={5}>Geen enkele verbetering in deze periode.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
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

export function BeheerScherm({ overview, systeem, storingen, leeskwaliteit }: { overview: BeheerOverview; systeem: SystemHealth; storingen: EventSummary; leeskwaliteit: ReaderQuality | null }) {
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

      <Leeskwaliteit q={leeskwaliteit} />

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
