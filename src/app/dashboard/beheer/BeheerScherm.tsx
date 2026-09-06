// src/app/dashboard/beheer/BeheerScherm.tsx
// [BEHEER] Pure presentation — the page hands it a finished overview, it renders. No fetching,
// and no language of its own: every label is a catalogue key, rendered in the owner's language.
//
// [TAAL] This screen used to be Dutch-only on purpose ("its one reader chose no language
// setting"). Its one reader is the owner of the product, and the owner reads Arabic — the same
// reversal the accountant module went through. `locale` is a prop rather than a hook because
// this is a server component; it defaults to Dutch so a caller that passes nothing (the render
// tests, an older page) sees exactly what it saw before.
//
// What stays as the libraries write it: the hold-reason labels (hold-reasons.ts), the cron notes
// (cron-heartbeat.ts) and the job names. Those are the libraries' words, not this screen's.

import type { BeheerOverview } from "@/lib/beheer";
import type { SystemHealth, EventSummary } from "@/lib/beheer-health";
import type { CronHealth } from "@/lib/cron-heartbeat";
import { caughtErrorPct, type ReaderQuality } from "@/lib/reader-quality";
import { handsOffPct, type HoldSummary } from "@/lib/hold-reasons";
import { DEFAULT_LOCALE, LOCALE_META, resolveLocale, type Locale } from "@/lib/i18n/locale";
import { translator, type Translator } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/messages";

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

/** The six health states of cron-heartbeat.ts, as words. The judgement stays there. */
const HEALTH_KEY: Record<CronHealth, MessageKey> = {
  "ok": "beh.gezond.ok",
  "nog-niet-langs": "beh.gezond.nogNietLangs",
  "nooit-gedraaid": "beh.gezond.nooitGedraaid",
  "afgebroken": "beh.gezond.afgebroken",
  "gefaald": "beh.gezond.gefaald",
  "te-lang-stil": "beh.gezond.teLangStil",
};

/**
 * Een bedrag uit het auditspoor, leesbaar.
 *
 * Het spoor bewaart de rij zoals hij was, en dat is een JSON-getal: op het scherm verscheen
 * "6.8100000000000005" naast "-6.8100000000000005". Dat is geen leesfout van de app maar de
 * gewone drijvende-komma-staart van een optelling — alleen staat hij hier op een scherm dat over
 * geldbedragen gaat, en daar leest zo'n reeks als een fout in de administratie.
 *
 * Het SPOOR wordt niet aangeraakt: dat is machinaal bewijs en blijft staan zoals het is
 * vastgelegd. Alleen de weergave rondt af, zoals elk ander bedrag in deze app — in de taal van de
 * lezer, met Latijnse cijfers in het Arabisch (zie locale.ts).
 */
function bedragUitSpoor(raw: string | null, locale: Locale): string {
  if (raw === null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString(LOCALE_META[locale].intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function Leeskwaliteit({ q, t, locale }: { q: ReaderQuality | null; t: Translator; locale: Locale }) {
  // [NO-SILENT-EMPTY] Niet kunnen kijken is geen nul. Op het paneel dat over leesfouten gaat, is
  // "geen fouten gevonden" en "we konden de vraag niet stellen" het gevaarlijkste paar om te
  // verwarren — de eerste stelt gerust, de tweede hoort dat juist niet te doen.
  if (!q) {
    return (
      <section style={{ ...CARD, borderColor: "#B3261E" }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#B3261E", margin: "0 0 6px" }}>{t("beh.lees.onleesbaarKop")}</h2>
        <p style={{ fontSize: 12.5, color: "#5F6368", margin: 0, lineHeight: 1.5 }}>
          {t("beh.lees.onleesbaarUitleg")}
        </p>
      </section>
    );
  }

  const pct = caughtErrorPct(q);
  return (
    <section style={CARD}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 4px" }}>{t("beh.lees.kop")}</h2>
      <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 14px", lineHeight: 1.5 }}>
        {t("beh.lees.uitleg")}
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tel n={q.read} label={t("beh.lees.gelezen")} />
        <Tel n={q.amountCorrected} label={t("beh.lees.bedragVerbeterd")} />
        <Tel n={q.ibanCorrected} label={t("beh.lees.ibanVerbeterd")} />
        <div style={{ ...CARD, minWidth: 120, borderColor: q.afterPayment > 0 ? "#B3261E" : "#E0E0E0" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: q.afterPayment > 0 ? "#B3261E" : "#202124" }}>{q.afterPayment}</div>
          <div style={{ fontSize: 12.5, color: "#5F6368" }}>{t("beh.lees.naBetaling")}</div>
        </div>
      </div>

      {pct !== null && (
        <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 14px" }}>
          {t("beh.lees.foutpercentage")} <strong style={{ color: "#202124" }}>{pct.toFixed(1)}%</strong>.
        </p>
      )}

      {/* De leverancierslijst BOVEN de losse correcties: fouten komen per sjabloon, niet los. */}
      {q.troubleSuppliers.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 600, color: "#202124", margin: "0 0 6px" }}>
            {t("beh.lees.leveranciersKop")}
          </h3>
          <p style={{ fontSize: 12, color: "#5F6368", margin: "0 0 8px", lineHeight: 1.5 }}>
            {t("beh.lees.leveranciersUitleg")}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={TH}>{t("beh.lees.leverancier")}</th><th style={TH}>{t("beh.lees.verbeterd")}</th><th style={TH}>{t("beh.lees.vanHoeveel")}</th></tr></thead>
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
          <thead><tr><th style={TH}>{t("beh.lees.wanneer")}</th><th style={TH}>{t("beh.lees.leverancier")}</th><th style={TH}>{t("beh.lees.wat")}</th><th style={TH}>{t("beh.lees.was")}</th><th style={TH}>{t("beh.lees.werd")}</th></tr></thead>
          <tbody>
            {q.recent.map((c) => (
              <tr key={c.invoiceId}>
                <td style={TD}>{new Date(c.atMs).toISOString().slice(0, 10)}</td>
                <td style={TD}>{c.supplierName}</td>
                <td style={TD}>{c.what}</td>
                <td style={TD}>{c.what === "iban" ? (c.ibanBefore ?? "—") : bedragUitSpoor(c.amountBefore, locale)}</td>
                <td style={TD}>{c.what === "iban" ? (c.ibanAfter ?? "—") : bedragUitSpoor(c.amountAfter, locale)}</td>
              </tr>
            ))}
            {q.recent.length === 0 && (
              <tr><td style={TD} colSpan={5}>{t("beh.lees.geen")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * [WAAROM-VASTGEHOUDEN] Welke weigering kost de eigenaar de meeste minuten.
 *
 * Dit paneel is geen kwaliteitscijfer. Een weigering is de app die voorzichtig doet, en
 * voorzichtig doen is goed — geen enkele regel hieronder is een fout. Het is een WERKLIJST,
 * geordend naar tijd: bovenaan staat de reden die, één keer opgelost, de meeste uren teruggeeft.
 *
 * Waarom dat hier hoort en niet in een query: op één echte administratie had 59% van de inkomende
 * documenten een mensenhand nodig, en dat werd pas zichtbaar toen iemand toevallig ging tellen.
 * De belofte van dit product is "doe jouw werk, de rest doen wij" — dan is dit percentage de
 * belofte zelf, en hoort het te staan waar de operator kijkt.
 */
function Vastgehouden({ s, t }: { s: HoldSummary | null; t: Translator }) {
  // [NO-SILENT-EMPTY] Niets kunnen meten is geen lege wachtrij. "Er is geen werk" is precies het
  // antwoord dat je niet mag geven als je de vraag niet hebt kunnen stellen.
  if (!s) {
    return (
      <section style={{ ...CARD, borderColor: "#B3261E" }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#B3261E", margin: "0 0 6px" }}>{t("beh.vast.onleesbaarKop")}</h2>
        <p style={{ fontSize: 12.5, color: "#5F6368", margin: 0, lineHeight: 1.5 }}>
          {t("beh.vast.onleesbaarUitleg")}
        </p>
      </section>
    );
  }

  const vanzelf = handsOffPct(s);
  return (
    <section style={CARD}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 4px" }}>{t("beh.vast.kop")}</h2>
      <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 14px", lineHeight: 1.5 }}>
        {t("beh.vast.uitleg")}
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tel n={s.total} label={t("beh.vast.binnen")} />
        <Tel n={s.advanced} label={t("beh.vast.vanzelf")} />
        <div style={{ ...CARD, minWidth: 120, borderColor: s.held > s.advanced ? "#B3261E" : "#E0E0E0" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: s.held > s.advanced ? "#B3261E" : "#202124" }}>{s.held}</div>
          <div style={{ fontSize: 12.5, color: "#5F6368" }}>{t("beh.vast.handwerk")}</div>
        </div>
      </div>

      {vanzelf !== null && (
        <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 14px" }}>
          {t("beh.vast.vanzelfVerwerkt")} <strong style={{ color: "#202124" }}>{vanzelf.toFixed(1)}%</strong>.
        </p>
      )}

      {/* [NO-SILENT-EMPTY] Vastgehouden zonder vastgelegde reden staat APART en nooit in de
          ranglijst: alles van vóór deze meting draagt er geen, en dat mag geen categorie worden
          die eruitziet alsof hij verklaard is. Loopt hij weer op, dan is een pad gestopt met
          opschrijven — en dan is de ranglijst eronder stil onvolledig. */}
      {s.unrecorded > 0 && (
        <div style={{ ...CARD, borderColor: "#E37400", background: "#FEF7E0", marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#202124" }}>
            {t("beh.vast.zonderReden", { u: s.unrecorded, h: s.held })}
          </div>
          <div style={{ fontSize: 12, color: "#5F6368", marginTop: 4, lineHeight: 1.5 }}>
            {t("beh.vast.zonderRedenUitleg")}
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={TH}>{t("beh.vast.reden")}</th><th style={TH}>{t("beh.vast.aantal")}</th><th style={TH}>{t("beh.vast.aandeel")}</th><th style={TH}>{t("beh.vast.vooralBij")}</th></tr></thead>
          <tbody>
            {s.reasons.map((r) => (
              <tr key={r.reason}>
                <td style={TD}>
                  <div>{r.label}</div>
                  <div style={{ fontSize: 11, color: "#9AA0A6", fontFamily: "monospace" }}>{r.reason}</div>
                </td>
                <td style={TD}>{r.count}</td>
                <td style={TD}>{r.sharePct.toFixed(1)}%</td>
                <td style={TD}>
                  {r.topSuppliers.length === 0
                    ? <span style={{ color: "#9AA0A6" }}>{t("beh.vast.verspreid")}</span>
                    : r.topSuppliers.map((l) => `${l.supplierName} (${l.count})`).join(", ")}
                </td>
              </tr>
            ))}
            {s.reasons.length === 0 && (
              <tr><td style={TD} colSpan={4}>{t("beh.vast.geen")}</td></tr>
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
function Systeem({ systeem, t }: { systeem: SystemHealth; t: Translator }) {
  // [NO-SILENT-EMPTY] Onleesbaar is een derde stand, geen groene. Op de pagina die bestaat om te
  // zeggen of de machine draait, mag "we konden niet kijken" nooit als "alles goed" lezen.
  if (!systeem.readable) {
    return (
      <div style={{ ...CARD, borderColor: "#B3261E" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#B3261E" }}>{t("beh.hartslagOnleesbaar")}</div>
        <div style={{ fontSize: 12.5, color: "#5F6368", marginTop: 4, lineHeight: 1.5 }}>
          {t("beh.hartslagOnleesbaarUitleg")}
        </div>
      </div>
    );
  }
  const kleur = (h: string) => (h === "ok" ? "#1E8E3E" : h === "nog-niet-langs" ? "#5F6368" : "#B3261E");
  return (
    <div style={{ ...CARD, borderColor: systeem.allWell ? "#E0E0E0" : "#B3261E" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: systeem.allWell ? "#1E8E3E" : "#B3261E", marginBottom: 8 }}>
        {systeem.allWell
          ? t("beh.alleTakenDraaien", { n: systeem.crons.length })
          : t("beh.takenAandacht", { a: systeem.attention.length, n: systeem.crons.length })}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {systeem.crons.map((c) => (
            <tr key={c.job}>
              <td style={{ ...TD, fontWeight: c.needsAttention ? 600 : 400 }}>{c.job}</td>
              <td style={{ ...TD, color: kleur(c.health), whiteSpace: "nowrap" }}>{t(HEALTH_KEY[c.health] ?? "beh.gezond.ok")}</td>
              {/* "nog nooit" is een echt antwoord en het antwoord op "is deze cron ooit gedraaid?" —
                  precies de vraag na een deploy die een nieuwe taak toevoegt. */}
              <td style={{ ...TD, color: "#5F6368", whiteSpace: "nowrap" }}>
                {c.lastRunAt === null ? t("beh.nogNooit") : c.hoursAgo === 0 ? t("beh.minderDanUur") : t("beh.uren", { n: c.hoursAgo ?? 0 })}
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
function Storingen({ storingen, t }: { storingen: EventSummary; t: Translator }) {
  // [NO-SILENT-EMPTY] "Er ging niets mis" is een goed antwoord en een ANDER antwoord dan "we konden
  // niet kijken". Op een beheerpagina mogen die twee nooit hetzelfde zijn — de tweede is precies de
  // toestand waarin een storing onopgemerkt doorloopt.
  if (!storingen.readable) {
    return (
      <div style={{ ...CARD, borderColor: "#B3261E" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#B3261E" }}>{t("beh.storingOnleesbaar")}</div>
        <div style={{ fontSize: 12.5, color: "#5F6368", marginTop: 4, lineHeight: 1.5 }}>
          {t("beh.storingOnleesbaarUitleg", { days: storingen.days })}
        </div>
      </div>
    );
  }
  if (storingen.groups.length === 0) {
    return (
      <div style={{ ...CARD }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1E8E3E" }}>
          {t("beh.geenStoringen", { days: storingen.days })}
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...CARD }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#202124", marginBottom: 8 }}>
        {storingen.total === 1
          ? t("beh.storingenEen", { days: storingen.days })
          : t("beh.storingenMeer", { n: storingen.total, days: storingen.days })}
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
                {g.hoursAgo === null ? "" : g.hoursAgo === 0 ? t("beh.minderDanUurGeleden") : t("beh.urenGeleden", { n: g.hoursAgo })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BeheerScherm({
  overview, systeem, storingen, leeskwaliteit, vastgehouden, locale: wanted,
}: {
  overview: BeheerOverview; systeem: SystemHealth; storingen: EventSummary;
  leeskwaliteit: ReaderQuality | null; vastgehouden: HoldSummary | null;
  /** The reader's language. Absent means Dutch — see the note at the top. */
  locale?: Locale;
}) {
  const locale = resolveLocale(wanted ?? DEFAULT_LOCALE);
  const t = translator(locale);
  const { users, links, counts } = overview;
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 20, fontFamily: "'Roboto', -apple-system, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#202124", margin: 0 }}>{t("beh.titel")}</h1>

      <Systeem systeem={systeem} t={t} />
      <Storingen storingen={storingen} t={t} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Tel n={counts.total} label={t("beh.accounts")} />
        <Tel n={counts.owners} label={t("beh.ondernemers")} />
        <Tel n={counts.accountants} label={t("beh.boekhouders")} />
        <Tel n={counts.links} label={t("beh.koppelingen")} />
      </div>

      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 10px" }}>{t("beh.accountsKop")}</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={TH}>{t("beh.naam")}</th><th style={TH}>{t("beh.email")}</th><th style={TH}>{t("beh.rol")}</th><th style={TH}>{t("beh.plan")}</th><th style={TH}>{t("beh.sinds")}</th>
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
                <tr><td style={TD} colSpan={5}>{t("beh.nogGeenAccounts")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Vastgehouden s={vastgehouden} t={t} />
      <Leeskwaliteit q={leeskwaliteit} t={t} locale={locale} />

      <section style={CARD}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 10px" }}>{t("beh.koppelKop")}</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr><th style={TH}>{t("beh.boekhouder")}</th><th style={TH}>{t("beh.klant")}</th><th style={TH}>{t("beh.sinds")}</th></tr>
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
                <tr><td style={TD} colSpan={3}>{t("beh.nogGeenKoppelingen")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ fontSize: 12, color: "#80868b", margin: 0, lineHeight: 1.5 }}>
        {t("beh.alleenLezen")}
      </p>
    </main>
  );
}
