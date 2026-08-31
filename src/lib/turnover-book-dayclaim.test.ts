// [DAG-GECLAIMD] Mag een dagrapport een dag inpikken die de eigenaar al met de hand boekte?
// Run: npx tsx --test src/lib/turnover-book-dayclaim.test.ts
//
// Het antwoord is "meestal wel", en dat is het hele punt van dit bestand.
//
// Een kassawinkel HOORT beide te hebben. financial-result.ts zegt het zelf: de contante
// dagopbrengst komt twee keer binnen — één keer als daily_turnover.cash_amount uit de Z-bon, één
// keer als kasregel, "omdat dat de standaardcategorie van de Kas-pagina is en de natuurlijke manier
// om diezelfde lade te noteren" — en de covered-day-regel slaat die tweede notering dan terecht
// over. Nagemeten op productie: 92 van de 93 dagomzetten dragen een eigen cash_amount.
//
// Een eerdere versie van deze regel weigerde ELKE import zodra er een contante omzetregel op zo'n
// dag stond. Dat had precies de normale werkwijze geblokkeerd van de enige soort gebruiker die deze
// import gebruikt. Deze tests staan er zodat dat niet nog eens gebeurt: ze pinnen de weigering én,
// belangrijker, dat hij de gewone gevallen met rust laat.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bookTurnoverRows } from "./turnover-book";
import type { DailyTurnover } from "./turnover";

/** Een dag die op 21% uitkomt; cash/pin worden per test gezet. */
const dag = (over: Partial<DailyTurnover>): DailyTurnover => ({
  turnover_date: "2026-05-12",
  base_0: 0, base_9: 0, base_21: 1000,
  btw_9: 0, btw_21: 210,
  total_incl: 1210,
  pin_amount: 1210, cash_amount: 0, other_amount: 0,
  ...over,
} as DailyTurnover);

/**
 * Een Supabase-stand-in. `kasDagen` zijn de dagen waarop een contante omzetregel staat; de upsert
 * wordt geteld zodat een test kan zien of er ECHT is geschreven.
 */
function client(kasDagen: string[], opts: { leesFout?: boolean } = {}) {
  const state = { upserts: 0 };
  const kasQuery = () => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const m of ["select", "eq", "in", "is", "order"]) q[m] = self;
    q.range = () => Promise.resolve(
      opts.leesFout
        ? { data: null, error: { message: "canceling statement due to statement timeout" } }
        : { data: kasDagen.map((d) => ({ entry_date: d })), error: null },
    );
    return q;
  };
  const api = {
    from(table: string) {
      if (table === "cash_entries") return kasQuery();
      return { upsert: () => { state.upserts++; return Promise.resolve({ error: null }); } };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { api: api as any, state };
}

test("[DAG-GECLAIMD] een Z-bon MÉT contant mag een dag met kasboekingen gewoon overnemen", async () => {
  // Het normale geval, en 92 van de 93 dagen in productie. De Z-bon meldt zijn eigen contant, dus
  // de kasregel is de tweede notering van datzelfde geld en hoort overgeslagen te worden. Dit
  // weigeren zou de gewone maandimport van een kassawinkel onmogelijk maken.
  const { api, state } = client(["2026-05-12"]);
  const r = await bookTurnoverRows(api, "u1", [dag({ cash_amount: 300, pin_amount: 910 })], "z_report");
  assert.equal(r.ok, true, `de gewone import werd geweigerd: ${r.rejected[0] ?? ""}`);
  assert.equal(state.upserts, 1, "er is niets geschreven");
  assert.deepEqual(r.rejected, []);
});

test("[DAG-GECLAIMD] een Z-bon ZONDER contant mag zo'n dag niet claimen", async () => {
  // Het gemeten gevaar: een dagrapport met alleen de pintransacties die de terminal zag. De dag
  // wordt dan 'covered' en de handmatig geboekte contante verkoop wordt overgeslagen als
  // dubbeltelling — terwijl er niets is dat hem dekt. € 300 contant verdwijnt uit omzet én 1a.
  const { api, state } = client(["2026-05-12"]);
  const r = await bookTurnoverRows(api, "u1", [dag({ cash_amount: 0 })], "z_report");
  assert.equal(r.ok, false, "de gevaarlijke vorm werd wél doorgelaten");
  assert.equal(state.upserts, 0, "er is geschreven terwijl de import geweigerd is");
  assert.match(r.rejected[0] ?? "", /2026-05-12/, "de weigering noemt de dag niet");
  assert.match(r.rejected[0] ?? "", /geen contant/i, "de weigering zegt niet waaróm");
});

test("[DAG-GECLAIMD] zonder kasboeking op die dag is er niets aan de hand", async () => {
  const { api, state } = client([]);
  const r = await bookTurnoverRows(api, "u1", [dag({ cash_amount: 0 })], "z_report");
  assert.equal(r.ok, true, `een dag zonder kasboeking werd geweigerd: ${r.rejected[0] ?? ""}`);
  assert.equal(state.upserts, 1);
});

test("[DAG-GECLAIMD] de Kassa mag de dag die hij zelf opbouwt altijd herschrijven", async () => {
  // rebuildTillDay schrijft met TILL_SOURCE na élk ticket. Die tegenhouden zou de Kassa breken.
  const { api, state } = client(["2026-05-12"]);
  const r = await bookTurnoverRows(api, "u1", [dag({ cash_amount: 0 })], "manual");
  assert.equal(r.ok, true, "de Kassa kan zijn eigen dag niet meer schrijven");
  assert.equal(state.upserts, 1);
});

test("[DAG-GECLAIMD] een mislukte lezing weigert — 'ik weet het niet' is geen toestemming", async () => {
  // De lezing beantwoordt "claimt iets deze dag al?". Een time-out die als "nee" doorgaat is
  // precies het antwoord dat de contante boeking laat verdwijnen.
  const { api, state } = client(["2026-05-12"], { leesFout: true });
  const r = await bookTurnoverRows(api, "u1", [dag({ cash_amount: 0 })], "z_report");
  assert.equal(r.ok, false);
  assert.equal(state.upserts, 0);
  assert.match(r.rejected[0] ?? "", /niet nagaan/i);
});
