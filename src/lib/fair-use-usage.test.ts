// [FAIR-USE] Pure node test — run: npx tsx --test src/lib/fair-use-usage.test.ts
//
// Getest wordt wat zonder database te testen valt: de periodesleutel, de vertaling van plan
// naar grens, de meting uit nagebootste tabellen, en de faalrichting. De atomaire optelling
// zelf woont in fair_use_usage.sql en heeft daar een CONTROLE-blok.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COUNTED_METRICS,
  currentPeriod,
  exceededMessage,
  limitForPlan,
  measureUsage,
} from "./fair-use-usage";
import { FAIR_USE_LIMITS, evaluateFairUse, fairUseLimit } from "./fair-use";

test("de periodesleutel is de kalendermaand in UTC", () => {
  assert.equal(currentPeriod(new Date("2026-07-26T12:00:00.000Z")), "2026-07");
  assert.equal(currentPeriod(new Date("2026-01-01T00:00:00.000Z")), "2026-01");
  // De maandgrens hangt niet af van de tijdzone van de server: één minuut vóór middernacht
  // UTC op 31 december hoort nog bij december, ook als het ergens al januari is.
  assert.equal(currentPeriod(new Date("2026-12-31T23:59:59.000Z")), "2026-12");
  assert.equal(currentPeriod(new Date("2027-01-01T00:00:00.000Z")), "2027-01");
});

test("alleen wat per maand gebeurt wordt geteld; de rest wordt gemeten", () => {
  assert.deepEqual([...COUNTED_METRICS], ["aiDocuments", "invoicesSent"]);
  for (const key of COUNTED_METRICS) {
    assert.equal(fairUseLimit(key).perMonth, true);
  }
  // De gemeten metrieken staan bewust NIET in de teller — een geteld getal kan uit de pas
  // lopen met de werkelijkheid, een gemeten getal niet.
  for (const limit of FAIR_USE_LIMITS.filter((l) => !l.perMonth)) {
    assert.equal((COUNTED_METRICS as readonly string[]).includes(limit.key), false);
  }
});

test("alleen het gratis plan krijgt een harde grens mee", () => {
  assert.equal(limitForPlan("aiDocuments", "free"), fairUseLimit("aiDocuments").free);
  // 0 betekent in de database: tellen, maar niet begrenzen. Wie betaalt loopt niet
  // halverwege de maand tegen een muur.
  assert.equal(limitForPlan("aiDocuments", "plus"), 0);
  assert.equal(limitForPlan("aiDocuments", "boekhouder"), 0);
});

test("de melding bij overschrijding komt letterlijk uit de gepubliceerde tekst", () => {
  for (const limit of FAIR_USE_LIMITS) {
    assert.equal(exceededMessage(limit.key), limit.onExceed);
  }
});

// ── Meten ────────────────────────────────────────────────────────────────────

/** Minimale nabootsing van de Supabase-querybouwer die measureUsage gebruikt. */
function fakeClient(tables: {
  usage_counters?: Array<{ metric: string; count: number }>;
  documents?: Array<{ file_size: number | null }>;
  email_connections?: number;
  /** Tabellen die een fout gooien — om de faalrichting te testen. */
  broken?: string[];
}) {
  return {
    from(table: string) {
      if (tables.broken?.includes(table)) {
        throw new Error(`tabel ${table} bestaat niet`);
      }
      const chain = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) =>
          opts?.head
            ? { eq: () => Promise.resolve({ count: tables.email_connections ?? 0 }) }
            : chain,
        eq: () => chain,
        or: () => Promise.resolve({ data: tables.documents ?? [] }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: tables.usage_counters ?? [] }),
      };
      return chain;
    },
  };
}

test("de stand combineert getelde en gemeten metrieken", async () => {
  const usage = await measureUsage(
    fakeClient({
      usage_counters: [
        { metric: "aiDocuments", count: 37 },
        { metric: "invoicesSent", count: 8 },
        // Een metriek die niet geteld hoort te worden moet worden genegeerd, ook als hij
        // ooit per ongeluk in de tabel belandt.
        { metric: "storageMb", count: 999_999 },
      ],
      documents: [{ file_size: 1024 * 1024 * 3 }, { file_size: 1024 * 1024 * 2 }, { file_size: null }],
      email_connections: 1,
    }),
    "user-1",
    new Date("2026-07-26T00:00:00.000Z"),
  );

  assert.equal(usage.aiDocuments, 37);
  assert.equal(usage.invoicesSent, 8);
  assert.equal(usage.storageMb, 5, "gemeten uit documents, niet uit de teller");
  assert.equal(usage.mailboxes, 1);
  assert.equal(
    usage.administrations,
    undefined,
    "administraties worden niet gemeten zolang de functie niet bestaat",
  );

  // En die stand hoort gewoon door evaluateFairUse te komen.
  const status = evaluateFairUse(usage);
  assert.equal(status.withinLimits, true);
});

test("een onbereikbare tabel kost niemand een handeling", async () => {
  // Regel 2 en 3 uit fair-use.ts: onze storing mag nooit de gebruiker raken. Een ontbrekende
  // meting leest als 0 en dus nooit als overschrijding.
  const usage = await measureUsage(
    fakeClient({ broken: ["usage_counters", "documents", "email_connections"] }),
    "user-1",
  );
  assert.equal(usage.aiDocuments, undefined);
  assert.equal(usage.storageMb, undefined);
  assert.equal(usage.mailboxes, undefined);
  assert.equal(evaluateFairUse(usage).withinLimits, true);
});

test("de prullenbak telt niet mee in de opslag", async () => {
  // Wie opruimt hoort dat meteen terug te zien; anders voelt opruimen zinloos. De filter
  // zit in de query (trashed is null of false), dus hier bewijzen we alleen dat wat de
  // query teruggeeft ook is wat er wordt opgeteld.
  const usage = await measureUsage(
    fakeClient({ documents: [{ file_size: 1024 * 1024 * 10 }] }),
    "user-1",
  );
  assert.equal(usage.storageMb, 10);
});

test("een lege administratie zit netjes binnen elke grens", async () => {
  const usage = await measureUsage(fakeClient({}), "nieuwe-gebruiker");
  assert.equal(usage.storageMb, 0);
  assert.equal(usage.mailboxes, 0);
  const status = evaluateFairUse(usage);
  assert.equal(status.withinLimits, true);
  assert.deepEqual(status.nearLimit, []);
});
