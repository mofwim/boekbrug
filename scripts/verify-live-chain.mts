// scripts/verify-live-chain.mts
// [KETEN] De laatste controle die dit project niet had: klopt wat de LIVE app zegt met wat er in
// de database staat?
//
// Run (op een machine die de Supabase-host kan bereiken):
//   npx next build && npx next start -p 3100
//   CHAIN_EMAIL=demo@boekbrug.nl CHAIN_PASSWORD=… npx tsx scripts/verify-live-chain.mts
//   (het wachtwoord staat in de kluis, niet hier — [DEMO-DICHT]: deze repository is openbaar,
//    en het demoaccount mag sinds src/lib/demo-tenant.ts geen mail versturen of documenten lezen)
//
// Environment:
//   CHAIN_BASE_URL   default http://127.0.0.1:3100
//   CHAIN_EMAIL      een eigenaar; de demo-tenant uit scripts/seed-demo-account.sql
//   CHAIN_PASSWORD
//   CHAIN_YEAR / CHAIN_QUARTER   welk kwartaal (standaard: alle kwartalen met omzet)
//
// LEEST ALLEEN. Geen enkele schrijfopdracht staat in dit bestand.
//
// ── WAAROM DIT BESTAND BESTAAT ──
//
// docs/MONEY_PATH_AUDIT_2026-08.md §6 zet dit al weken op nummer één: "a live upload → DB →
// /api/result pass. The proof RECONCILIATION_TRIANGLE.md names as final and that no amount of unit
// testing substitutes for." Dat laatste is letterlijk waar. `npm run gates` roept Supabase geen
// enkele keer aan: tsc, de unit-tests, de rendertests en next build zijn allemaal STATISCH, en de
// e2e-test veegt alleen de publieke pagina's. Er is dus geen enkele controle die zegt of de cijfers
// die een eigenaar op zijn scherm ziet, horen bij de rijen die onder hem in de database staan.
//
// ── WAT DIT WÉL EN NIET BEWIJST ──
//
// De defecten van deze week zaten geen enkele keer in de rekenkernen. Ze zaten in de ASSEMBLAGE:
// een sleutel die klopte maar in de rij stond die het ongedaan maken weghaalt; een definitie die
// twee keer was gespeld; een lezing die "niets gevonden" teruggaf omdat ze was afgekapt. Precies
// die laag zit tussen de database en het antwoord van de API, en precies die laag heeft geen test.
//
// Daarom vergelijkt dit bestand niet twee keer dezelfde motor met zichzelf. Het rekent de
// invarianten met KALE REKENKUNDE over de ruwe rijen — optellen, aftrekken, vergelijken — en legt
// die naast wat de live API teruggeeft. Waar die twee uit elkaar lopen, zit de fout in de
// assemblage, en dat is het enige wat deze controle wil vinden.
//
// Wat het NIET is: een bewijs dat de rekenregels kloppen. Dat doen de unit-tests, en die zijn goed.
//
// ── WAAROM READ-ONLY ──
//
// Dit draait tegen een echte database. Een script dat rijen aanmaakt om ze daarna weer weg te
// halen, laat bij elke afgebroken run iets achter — en de eerste keer dat iemand hem per ongeluk op
// de echte administratie richt, is dat geen test meer maar een boeking. De keten is met bestaande
// rijen net zo goed te controleren.

import { createServerClient, createChunks, stringToBase64URL } from "@supabase/ssr";
import { round2 } from "../src/lib/invoice-totals";
import { fetchAllRows } from "../src/lib/supabase-paginate";

const BASE = process.env.CHAIN_BASE_URL ?? "http://127.0.0.1:3100";
const EMAIL = process.env.CHAIN_EMAIL;
const PASSWORD = process.env.CHAIN_PASSWORD;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!EMAIL || !PASSWORD) {
  console.error("[KETEN] CHAIN_EMAIL en CHAIN_PASSWORD zijn verplicht — gebruik de demo-tenant.");
  process.exit(2);
}
if (!SUPA_URL || !SUPA_KEY) {
  console.error("[KETEN] NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY ontbreken (zet .env.local of exporteer ze).");
  process.exit(2);
}

// ── Uitslag ───────────────────────────────────────────────────────────────────
// Elke controle is een ZIN over geld, geen veldnaam. Wie dit leest om drie uur 's nachts moet uit
// de regel zelf kunnen opmaken wat er mis is.
let passed = 0;
const failures: string[] = [];
function check(claim: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`  ✓ ${claim}`); return; }
  failures.push(detail ? `${claim}\n      ${detail}` : claim);
  console.log(`  ✗ ${claim}${detail ? `\n      ${detail}` : ""}`);
}
/** Geld vergelijken op de cent. Alles daaronder is drijvende-komma-ruis, niet een verschil. */
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
const eur = (n: number) => `€ ${n.toFixed(2)}`;

// ── 1. Inloggen zoals een eigenaar dat doet ───────────────────────────────────
// De routes lezen hun sessie uit een COOKIE, met @supabase/ssr (supabase-server.ts). Dus laten we
// die cookie door datzelfde pakket schrijven, in een potje in het geheugen: dan bepaalt de
// bibliotheek zelf hoe hij heet, hoe hij gecodeerd is en of hij in stukken moet — en kan dat nooit
// uit de pas lopen met wat de route terugleest. Een zelfbedachte `sb-access-token=…` logt niemand
// in, en zou hieronder ELKE controle rood maken om een reden die niets met geld te maken heeft.
const jar = new Map<string, string>();
const supabase = createServerClient(SUPA_URL, SUPA_KEY, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (list) => {
      for (const c of list) {
        if (c.value) jar.set(c.name, c.value);
        else jar.delete(c.name);
      }
    },
  },
});

const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: EMAIL, password: PASSWORD,
});
if (authErr || !auth.session) {
  console.error(`[KETEN] inloggen mislukt: ${authErr?.message ?? "geen sessie"}`);
  console.error(`[KETEN] De machine waar dit draait moet de Supabase-host kunnen bereiken.`);
  process.exit(2);
}
const ownerId = auth.session.user.id;

// Het potje hoort nu gevuld te zijn — signInWithPassword wacht zijn eigen SIGNED_IN-melding af, en
// dáárin schrijft @supabase/ssr de cookie weg. Blijft het toch leeg, dan zetten we hem alsnog met
// de PUBLIEKE bouwstenen van hetzelfde pakket: dezelfde naam, dezelfde codering, dezelfde opdeling.
if (jar.size === 0) {
  const key = (supabase.auth as unknown as { storageKey: string }).storageKey;
  for (const c of createChunks(key, `base64-${stringToBase64URL(JSON.stringify(auth.session))}`)) {
    jar.set(c.name, c.value);
  }
}
if (jar.size === 0) {
  console.error("[KETEN] De sessie is er, maar er komt geen cookie uit. Zonder die cookie is er");
  console.error("[KETEN] niets gecontroleerd — dit zegt niets over de boekhouding.");
  process.exit(2);
}
const cookieHeader = [...jar]
  .map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`)
  .join("; ");

console.log(`[KETEN] ingelogd als ${EMAIL}`);
console.log(`[KETEN] app:    ${BASE}`);

/** Gegooid als de APP ons niet herkent. Dat is een opstartprobleem, geen geldprobleem. */
class NotLoggedIn extends Error {}

/** De API aanroepen mét de sessiecookie, langs precies dezelfde weg als de browser. */
async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader } });
  if (r.status === 401 || r.status === 403) throw new NotLoggedIn(`${path} → HTTP ${r.status}`);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

// Eén plek waar een niet-herkende sessie de run STOPT in plaats van hem rood te kleuren. Dit is
// het verschil tussen "ik kon niet kijken" en "je boeken kloppen niet", en een controle die die
// twee door elkaar haalt is erger dan geen controle: hij laat iemand zoeken naar een fout in de
// administratie terwijl er alleen een cookie miste.
function bailIfNotLoggedIn(e: unknown): void {
  if (!(e instanceof NotLoggedIn)) return;
  console.error(`\n[KETEN] De app herkent deze sessie niet (${e.message}).`);
  console.error(`[KETEN] Er is dus NIETS gecontroleerd — dit zegt niets over de boekhouding.`);
  console.error(`[KETEN] Draait ${BASE} met dezelfde NEXT_PUBLIC_SUPABASE_URL als dit script?`);
  process.exit(2);
}

// ── 2. De ruwe rijen, door RLS heen ───────────────────────────────────────────
// Dezelfde weg die de eigenaar zelf heeft: wat hier terugkomt is wat hij mag zien.
type Inv = {
  id: string; direction: string | null; status: string | null; invoice_type: string | null;
  total_ex_btw: number | null; btw_amount: number | null; total_inc_btw: number | null;
  amount_paid: number | null; invoice_date: string | null;
};
type Link = { invoice_id: string; amount_applied: number | null };

// [PAGINATION] Gepagineerd, en dat is hier geen detail maar de kern. PostgREST kapt stil af op
// ~1000 rijen (supabase-paginate.ts). Een controle die de eerste duizend koppelingen leest en de
// rest niet, meldt een keurig betaalde factuur als half betaald — een ROOD antwoord over geld,
// veroorzaakt door het meetinstrument. Dit bestand bestaat juist om dat soort afkapping te
// vinden; het mag er zelf als laatste aan lijden.
let invoices: Inv[];
let links: Link[];
try {
  invoices = (await fetchAllRows((from, to) => supabase
    .from("invoices")
    .select("id, direction, status, invoice_type, total_ex_btw, btw_amount, total_inc_btw, amount_paid, invoice_date")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .order("id", { ascending: true })
    .range(from, to))) as unknown as Inv[];
} catch (e) {
  console.error(`[KETEN] facturen niet te lezen: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
try {
  links = (await fetchAllRows((from, to) => supabase
    .from("bank_tx_invoices")
    .select("invoice_id, amount_applied")
    .eq("user_id", ownerId)
    .order("id", { ascending: true })
    .range(from, to))) as unknown as Link[];
} catch (e) {
  console.error(`[KETEN] betalingskoppelingen niet te lezen: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

console.log(`[KETEN] ${invoices.length} facturen · ${links.length} koppelingen\n`);
if (invoices.length === 0) {
  console.error("[KETEN] Deze tenant heeft geen facturen — er valt niets te controleren.");
  console.error("[KETEN] Draai scripts/seed-demo-account.sql, of wijs CHAIN_EMAIL naar een tenant met data.");
  process.exit(2);
}

// ── 3. De invariant waar alles op rust ────────────────────────────────────────
// invoices.amount_paid = Σ amount_applied. Kale rekenkunde: geen motor, geen aanname.
console.log("— het betaalde bedrag is de som van de betalingen —");
{
  const applied = new Map<string, number>();
  for (const l of links) {
    if (!l.invoice_id) continue;
    applied.set(l.invoice_id, (applied.get(l.invoice_id) ?? 0) + Math.abs(Number(l.amount_applied) || 0));
  }
  const scheef = invoices
    .filter((i) => applied.has(i.id))
    .map((i) => ({ i, som: round2(applied.get(i.id)!), paid: round2(Math.max(0, Number(i.amount_paid) || 0)) }))
    .filter((r) => !eq(r.som, r.paid));
  check(
    `elke factuur met koppelingen toont exact wat er is toegepast (${applied.size} gecontroleerd)`,
    scheef.length === 0,
    scheef.slice(0, 4).map((r) => `${r.i.id}: betaald ${eur(r.paid)} vs koppelingen ${eur(r.som)}`).join("\n      "),
  );
}

// ── 4. Wat de LIVE app zegt, tegen wat de rijen zeggen ────────────────────────
// Per kwartaal waarin de eigenaar iets heeft staan.
const kwartalen = process.env.CHAIN_YEAR && process.env.CHAIN_QUARTER
  ? [{ year: Number(process.env.CHAIN_YEAR), quarter: Number(process.env.CHAIN_QUARTER) }]
  : [...new Set(invoices
      .map((i) => i.invoice_date)
      .filter((d): d is string => !!d && /^\d{4}-\d{2}/.test(d))
      .map((d) => {
        const [y, m] = d.split("-").map(Number);
        return `${y}-${Math.floor((m - 1) / 3) + 1}`;
      }))]
      .sort()
      .map((k) => ({ year: Number(k.split("-")[0]), quarter: Number(k.split("-")[1]) }));

type ResultBody = {
  ok: boolean; year: number; quarter: number; scheme?: string;
  result: {
    omzet: number; kosten: number; resultaat: number;
    btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number;
    salesByRate?: Array<{ rate: number; omzet: number; btw: number }>;
  };
};

for (const { year, quarter } of kwartalen) {
  console.log(`\n— Q${quarter} ${year}: de app tegen de rijen —`);
  let body: ResultBody;
  try {
    body = await api<ResultBody>(`/api/result?year=${year}&quarter=${quarter}`);
  } catch (e) {
    bailIfNotLoggedIn(e);
    check(`/api/result antwoordt voor Q${quarter} ${year}`, false, e instanceof Error ? e.message : String(e));
    continue;
  }
  const r = body.result;

  // 4a. Het resultaat is omzet min kosten. Twee getallen die de app zelf teruggeeft; als die niet
  //     op elkaar aansluiten is er geen enkele reden om de rest te geloven.
  check(
    `resultaat = omzet − kosten (${eur(r.omzet)} − ${eur(r.kosten)} = ${eur(r.resultaat)})`,
    eq(round2(r.resultaat), round2(r.omzet - r.kosten)),
    `teruggegeven ${eur(r.resultaat)}, gerekend ${eur(round2(r.omzet - r.kosten))}`,
  );

  // 4b. Hetzelfde voor het BTW-saldo.
  check(
    `btw-saldo = verschuldigd − voorbelasting (${eur(r.btwSaldo)})`,
    eq(round2(r.btwSaldo), round2(r.btwVerschuldigd - r.btwVoorbelasting)),
    `teruggegeven ${eur(r.btwSaldo)}, gerekend ${eur(round2(r.btwVerschuldigd - r.btwVoorbelasting))}`,
  );

  // 4c. De rubrieken tellen op tot de verschuldigde BTW. Het bestand belooft dit met zoveel
  //     woorden ("its BTW sums EXACTLY to btwVerschuldigd") en het is het getal dat op het
  //     formulier van de Belastingdienst terechtkomt.
  if (r.salesByRate && r.salesByRate.length > 0) {
    const som = round2(r.salesByRate.reduce((s, b) => s + b.btw, 0));
    check(
      `de rubrieken tellen op tot de verschuldigde btw (${eur(som)})`,
      eq(som, round2(r.btwVerschuldigd)),
      `rubrieken ${eur(som)} vs verschuldigd ${eur(round2(r.btwVerschuldigd))}`,
    );
  }

  // 4d. Geen enkel bedrag mag onleesbaar zijn. NaN en Infinity zijn wat rekenen op een half
  //     gelezen getal oplevert, en ze reizen stil door elke optelling heen.
  const cijfers: Array<[string, number]> = [
    ["omzet", r.omzet], ["kosten", r.kosten], ["resultaat", r.resultaat],
    ["btw verschuldigd", r.btwVerschuldigd], ["voorbelasting", r.btwVoorbelasting], ["btw-saldo", r.btwSaldo],
  ];
  const kapot = cijfers.filter(([, v]) => !Number.isFinite(v));
  check(`elk bedrag is een leesbaar getal`, kapot.length === 0, kapot.map(([n]) => n).join(", "));

  // 4e. Omzet en kosten zijn NETTO bedragen (ex btw). Een omzet die kleiner is dan de btw erover
  //     kan niet: bij 21% hoort de btw ruim onder de helft van de omzet te blijven. Dit vangt de
  //     klassieke verwisseling van incl. en excl., die nergens anders opvalt omdat beide getallen
  //     op zichzelf plausibel zijn.
  if (r.omzet > 0) {
    check(
      `de verschuldigde btw past bij de omzet (${eur(r.btwVerschuldigd)} op ${eur(r.omzet)})`,
      r.btwVerschuldigd <= r.omzet * 0.30 + 0.01,
      `btw is ${((r.btwVerschuldigd / r.omzet) * 100).toFixed(1)}% van de omzet — hoger dan enig NL-tarief`,
    );
  }

  // 4f. En de aangifte over hetzelfde kwartaal mag niet iets anders zeggen dan het resultaat.
  //     Twee eindpunten, één waarheid: dit is precies het soort verschil dat deze week vier keer
  //     de oorzaak was, en dat geen enkele unit-test kan zien.
  try {
    const aang = await api<{
      aangifte?: {
        verschuldigd: number; voorbelasting: number; saldo: number;
        rows: Array<{ code: string; btw: number }>;
      };
    }>(`/api/aangifte?year=${year}&quarter=${quarter}`);
    const a = aang.aangifte;
    if (a) {
      // 5g IS 5a − 5b. Het papieren formulier zegt het zo, en dit is precies de plek waar die
      // twee eerder uit elkaar liepen: één scherm rekende het saldo terug uit een opgeslagen
      // veld in plaats van uit de twee rubrieken die er direct boven staan.
      check(
        `5g is 5a − 5b (${a.saldo} = ${a.verschuldigd} − ${a.voorbelasting})`,
        eq(a.saldo, a.verschuldigd - a.voorbelasting),
      );
      // En 5a is de som van de rubrieken erboven — het optelsommetje dat een boekhouder met de
      // hand overdoet zodra hij het concept naast het formulier legt.
      const rubriekBtw = (a.rows ?? []).reduce((sum, row) => sum + (Number(row.btw) || 0), 0);
      check(
        `de rubrieken tellen op tot 5a (${rubriekBtw} vs ${a.verschuldigd})`,
        eq(rubriekBtw, a.verschuldigd),
      );
      // De aangifte rondt op hele euro's per rubriek; het resultaat niet. Eén euro speling per
      // kant is de afronding zelf, meer is een verschil.
      check(
        `de aangifte en het resultaat noemen dezelfde verschuldigde btw (${a.verschuldigd} vs ${eur(r.btwVerschuldigd)})`,
        Math.abs(a.verschuldigd - r.btwVerschuldigd) <= 1.01,
        `aangifte ${a.verschuldigd}, resultaat ${eur(r.btwVerschuldigd)}`,
      );
      check(
        `…en dezelfde voorbelasting (${a.voorbelasting} vs ${eur(r.btwVoorbelasting)})`,
        Math.abs(a.voorbelasting - r.btwVoorbelasting) <= 1.01,
        `aangifte ${a.voorbelasting}, resultaat ${eur(r.btwVoorbelasting)}`,
      );
    }
  } catch (e) {
    bailIfNotLoggedIn(e);
    // /api/aangifte kan om eigen redenen weigeren (een niet-afgesloten kwartaal). Dat is geen
    // ketenfout, dus het telt hier niet mee — stil overslaan is hier eerlijker dan rood.
  }

  // 4g. Twee deuren op hetzelfde kwartaal moeten hetzelfde bedrag noemen.
  //
  //     De kop van /api/result belooft het met zoveel woorden: "a thin wrapper over the shared
  //     computeResultForRange pipeline (also used by /api/truth's living-truth lens) so a quarter
  //     and any other window can never disagree." Die belofte staat in een commentaarregel en
  //     wordt nergens nagerekend — en een belofte in commentaar is precies het soort ding dat waar
  //     blijft tot iemand er één keer langs bouwt.
  //
  //     Het waarheidsscherm en het resultaatscherm zijn wat een eigenaar naast elkaar openslaat.
  //     Noemen die twee een ander bedrag over hetzelfde kwartaal, dan weet hij niet meer welke van
  //     de twee zijn boekhouding is — en dat is geen weergavefout maar een geldfout.
  try {
    const truth = await api<{ result: ResultBody["result"] }>(
      `/api/truth?lens=quarter&year=${year}&quarter=${quarter}`,
    );
    const t = truth.result;
    const verschil = (
      [
        ["omzet", r.omzet, t.omzet],
        ["kosten", r.kosten, t.kosten],
        ["resultaat", r.resultaat, t.resultaat],
        ["btw verschuldigd", r.btwVerschuldigd, t.btwVerschuldigd],
        ["voorbelasting", r.btwVoorbelasting, t.btwVoorbelasting],
        ["btw-saldo", r.btwSaldo, t.btwSaldo],
      ] as Array<[string, number, number]>
    ).filter(([, a, b]) => !eq(round2(a), round2(b)));
    check(
      `het waarheidsscherm noemt hetzelfde als het resultaat over Q${quarter} ${year}`,
      verschil.length === 0,
      verschil.map(([n, a, b]) => `${n}: resultaat ${eur(a)} vs waarheid ${eur(b)}`).join("\n      "),
    );
  } catch (e) {
    bailIfNotLoggedIn(e);
    check(`/api/truth antwoordt voor Q${quarter} ${year}`, false, e instanceof Error ? e.message : String(e));
  }
}

// ── 5. Uitslag ────────────────────────────────────────────────────────────────
console.log(`\n${failures.length === 0 ? "✅" : "❌"} ${passed} geslaagd, ${failures.length} mislukt`);
if (failures.length > 0) {
  console.log(`\nWat er niet klopt tussen de database en wat de app zegt:\n`);
  for (const f of failures) console.log(`  · ${f}`);
  console.log(
    `\nDe rekenkernen zijn hier niet in beeld — die hebben hun eigen tests. Een verschil hier zit\n` +
    `in de laag ertussen: welke rijen worden gelezen, en hoe ze worden samengevoegd.\n`,
  );
}
process.exit(failures.length === 0 ? 0 : 1);
