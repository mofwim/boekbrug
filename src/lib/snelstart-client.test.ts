// [SNELSTART] Pure node test — run: npx tsx --test src/lib/snelstart-client.test.ts
//
// Test de HTTP-kant met een geïnjecteerde fetch: geen netwerk, geen sleutels. Wat hier
// vastligt is precies wat er bij een echte koppeling misgaat als je het verkeerd doet:
// een token dat per factuur opnieuw wordt opgehaald, een ingetrokken sleutel die als
// "controleer je factuur" wordt gepresenteerd, of een leveranciersnaam met een apostrof
// die de OData-filter openbreekt.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyStatus,
  clearSnelStartTokenCache,
  createSnelStartClient,
  dutchSnelStartError,
  normalizeBtwTarieven,
  normalizeGrootboeken,
  odataEscape,
  SnelStartError,
  SNELSTART_API_BASE,
  SNELSTART_TOKEN_URL,
} from "./snelstart-client";

const SUB = "test-subscription-key";
const KEY = "maatwerksleutel-abcdefghijklmnopqrstuvwxyz";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Bouwt een nep-fetch die de opgegeven antwoorden op volgorde teruggeeft en elke
 *  aanroep vastlegt. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i++;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(spec.body === undefined ? "" : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: { "Content-Type": "application/json", ...(spec.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const tokenOk = { body: { access_token: "tok-1", token_type: "bearer", expires_in: 3600 } };

// Elke test begint met een lege token-cache: die is module-breed en zou anders overlopen.
function fresh() {
  clearSnelStartTokenCache();
}

test("de sleutel wordt volgens de B2B-conventie geruild tegen een token", async () => {
  fresh();
  const { impl, calls } = fakeFetch([tokenOk, { body: [] }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });
  await client.getBtwTarieven();

  assert.equal(calls[0].url, SNELSTART_TOKEN_URL);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0].body, `grant_type=clientkey&clientkey=${encodeURIComponent(KEY)}`);

  // En het echte verzoek draagt BEIDE geheimen: token én subscription key.
  assert.equal(calls[1].url, `${SNELSTART_API_BASE}/btwtarieven`);
  assert.equal(calls[1].headers.Authorization, "Bearer tok-1");
  assert.equal(calls[1].headers["Ocp-Apim-Subscription-Key"], SUB);
});

test("het token wordt hergebruikt tot vlak voor het verloopt", async () => {
  fresh();
  let clock = 1_000_000;
  const { impl, calls } = fakeFetch([tokenOk, { body: [] }, { body: [] }, tokenOk, { body: [] }]);
  const client = createSnelStartClient({
    clientKey: KEY,
    subscriptionKey: SUB,
    fetchImpl: impl,
    now: () => clock,
  });

  await client.getBtwTarieven();
  await client.getBtwTarieven();
  // Twee leesacties, maar één token-ronde: precies wat een batch van vijftig facturen
  // goedkoop houdt.
  assert.equal(calls.filter((c) => c.url === SNELSTART_TOKEN_URL).length, 1);

  // Voorbij de levensduur → nieuw token.
  clock += 3_600_000;
  await client.getBtwTarieven();
  assert.equal(calls.filter((c) => c.url === SNELSTART_TOKEN_URL).length, 2);
});

test("een afgewezen sleutel heet INVALID_KEY, niet 'controleer je factuur'", async () => {
  fresh();
  // De token-endpoint antwoordt op een ingetrokken sleutel met 400 (OAuth invalid_grant).
  const { impl } = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });

  await assert.rejects(
    () => client.getBtwTarieven(),
    (err: unknown) => err instanceof SnelStartError && err.code === "INVALID_KEY",
  );
});

test("een 401 op een verzoek gooit het dode token weg", async () => {
  fresh();
  const { impl, calls } = fakeFetch([tokenOk, { status: 401 }, tokenOk, { body: [] }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });

  await assert.rejects(
    () => client.getBtwTarieven(),
    (err: unknown) => err instanceof SnelStartError && err.code === "INVALID_KEY",
  );

  // De volgende poging haalt een NIEUW token op in plaats van op het dode door te gaan.
  await client.getBtwTarieven();
  assert.equal(calls.filter((c) => c.url === SNELSTART_TOKEN_URL).length, 2);
});

test("429 draagt de wachttijd van SnelStart mee", async () => {
  fresh();
  const { impl } = fakeFetch([tokenOk, { status: 429, headers: { "Retry-After": "45" } }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });

  await assert.rejects(
    () => client.getBtwTarieven(),
    (err: unknown) =>
      err instanceof SnelStartError && err.code === "RATE_LIMITED" && err.retryAfterSeconds === 45,
  );
});

test("een netwerkstoring is een NETWORK-fout, geen crash", async () => {
  fresh();
  const impl = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });

  await assert.rejects(
    () => client.getBtwTarieven(),
    (err: unknown) => err instanceof SnelStartError && err.code === "NETWORK",
  );
});

test("zonder subscription key op de server komt er geen verzoek uit", () => {
  fresh();
  const saved = process.env.SNELSTART_SUBSCRIPTION_KEY;
  delete process.env.SNELSTART_SUBSCRIPTION_KEY;
  try {
    assert.throws(
      () => createSnelStartClient({ clientKey: KEY }),
      (err: unknown) => err instanceof SnelStartError && err.code === "NOT_CONFIGURED",
    );
  } finally {
    if (saved !== undefined) process.env.SNELSTART_SUBSCRIPTION_KEY = saved;
  }
});

test("een relatienaam met een apostrof breekt de OData-filter niet open", async () => {
  fresh();
  assert.equal(odataEscape("Jan's Groothandel"), "Jan''s Groothandel");

  const { impl, calls } = fakeFetch([tokenOk, { body: [{ id: "rel-1", naam: "Jan's Groothandel" }] }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });
  const found = await client.findRelatie("Jan's Groothandel", "Leverancier");

  assert.deepEqual(found, { id: "rel-1", naam: "Jan's Groothandel" });
  const filter = decodeURIComponent(calls[1].url.split("$filter=")[1].split("&")[0]);
  assert.equal(filter, "naam eq 'Jan''s Groothandel' and relatiesoort/any(s: s eq 'Leverancier')");
});

test("een onbekende relatie wordt aangemaakt met de juiste soort", async () => {
  fresh();
  const { impl, calls } = fakeFetch([tokenOk, { body: [] }, { body: { id: "rel-2", naam: "Nieuw BV" } }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });

  assert.equal(await client.findRelatie("Nieuw BV", "Klant"), null);
  const created = await client.createRelatie("Nieuw BV", "Klant");

  assert.equal(created.id, "rel-2");
  assert.equal(calls[2].method, "POST");
  assert.deepEqual(JSON.parse(calls[2].body as string), {
    relatiesoort: ["Klant"],
    naam: "Nieuw BV",
  });
});

test("boekingen gaan naar de endpoint die bij de soort hoort", async () => {
  fresh();
  const { impl, calls } = fakeFetch([tokenOk, { body: { id: "boek-1" } }, { body: { id: "boek-2" } }]);
  const client = createSnelStartClient({ clientKey: KEY, subscriptionKey: SUB, fetchImpl: impl });

  assert.deepEqual(await client.postBoeking("inkoopboeking", { factuurnummer: "A" }), {
    id: "boek-1",
  });
  assert.deepEqual(await client.postBoeking("verkoopboeking", { factuurnummer: "B" }), {
    id: "boek-2",
  });

  assert.equal(calls[1].url, `${SNELSTART_API_BASE}/inkoopboekingen`);
  assert.equal(calls[2].url, `${SNELSTART_API_BASE}/verkoopboekingen`);
});

test("antwoorden worden defensief gelezen — rommel valt eruit, niet om", () => {
  assert.deepEqual(
    normalizeBtwTarieven([
      { btwSoort: "Hoog", btwPercentage: 21 },
      { btwSoort: "Laag", percentage: "9" }, // alternatieve naam + string
      { btwSoort: "Kapot" }, // geen percentage → weg
      null,
      "onzin",
    ]),
    [
      { btwSoort: "Hoog", percentage: 21 },
      { btwSoort: "Laag", percentage: 9 },
    ],
  );
  assert.deepEqual(normalizeBtwTarieven({ niet: "array" }), []);

  assert.deepEqual(
    normalizeGrootboeken([
      { id: "gb-1", nummer: 4000, omschrijving: "Inkopen" },
      { id: "gb-2" }, // mag: nummer/omschrijving zijn optioneel
      { nummer: 8000 }, // zonder id kunnen we niet boeken → weg
    ]),
    [
      { id: "gb-1", nummer: 4000, omschrijving: "Inkopen" },
      { id: "gb-2", nummer: null, omschrijving: "" },
    ],
  );
});

test("statuscodes vertalen naar één oordeel per situatie", () => {
  assert.equal(classifyStatus(401), "INVALID_KEY");
  assert.equal(classifyStatus(403), "FORBIDDEN");
  assert.equal(classifyStatus(404), "NOT_FOUND");
  assert.equal(classifyStatus(429), "RATE_LIMITED");
  assert.equal(classifyStatus(400), "VALIDATION");
  assert.equal(classifyStatus(422), "VALIDATION");
  assert.equal(classifyStatus(503), "SERVER");

  // Elke code heeft een bruikbare Nederlandse tekst.
  for (const code of [
    "NOT_CONFIGURED",
    "INVALID_KEY",
    "FORBIDDEN",
    "RATE_LIMITED",
    "VALIDATION",
    "NOT_FOUND",
    "SERVER",
    "NETWORK",
  ] as const) {
    assert.ok(dutchSnelStartError(code).length > 10);
  }
});
