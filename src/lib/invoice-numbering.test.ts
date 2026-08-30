// [FACTUUR-B] Pure node test — run: npx tsx --test src/lib/invoice-numbering.test.ts
//
// WHY THIS TEST EXISTS
//
// Article 35 of the Wet OB 1968 requires invoice numbers to be sequential without gaps, and this
// module had no test at all. The allocation itself is atomic (next_invoice_seq), and its contract
// is written down in the file: "We NEVER fabricate a number on error (that would risk a duplicate
// or a gap)."
//
// The step BEFORE it did not follow that rule. resolveFormat read the owner's numbering template
// with `const { data: prof }` and dropped the error, and the fallback was not "no data" — it was a
// DIFFERENT NUMBERING SCHEME. Two things come out of a template and both changed:
//
//   · the printed shape: an owner numbering "045-2026" would get "20260046", a number that does
//     not belong to his series;
//   · which COUNTER it is drawn from. counterYear is derived from the template — a custom template
//     without {year} numbers continuously and draws from the year=0 row, the default contains
//     {year} and draws from the calendar-year row. So a failed read allocated from the wrong
//     sequence, and next_invoice_seq INCREMENTS it, leaving the two series permanently diverged
//     from one transient hiccup.
//
// A stub is the only way to see this: it is a failed READ, and every test that hands the module a
// working database sees the same numbers either way.

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { generateInvoiceNumber } from "./invoice-numbering";
// [NUMMER-JAAR] Dezelfde klok als de functie die wordt getest. Hier stond `new Date().getFullYear()`
// — precies de aanroep die deze module heeft afgeschaft, in de test die de afschaffing bewaakt.
// Tussen 23:00 UTC op 31 december en middernacht is Nederland al in het nieuwe jaar en de server
// niet, dus één uur per jaar verwachtte deze test het VORIGE jaar in een nummer dat het nieuwe
// draagt. Eén uur per jaar is precies vaak genoeg om een keer een groene suite rood te maken op
// het moment dat niemand tijd heeft om uit te zoeken waarom.
import { amsterdamYear } from "./format-nl";

type RpcArgs = { p_user_id: string; p_year: number; p_type: string };

/** A supabase stub: one profiles answer, one sequence, and a record of what the RPC was asked. */
function stub(profileAnswer: { data: unknown; error: { message: string } | null }, seq: number) {
  const calls: RpcArgs[] = [];
  const query = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => profileAnswer;
    q.single = async () => profileAnswer;
    return q;
  };
  const client = {
    from: () => query(),
    rpc: async (_fn: string, args: RpcArgs) => {
      calls.push(args);
      return { data: seq, error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

const ok = (template: string | null, padding?: number) => ({
  data: { invoice_number_template: template, invoice_number_padding: padding },
  error: null,
});

test("[NUMBER-READ-HONEST] a failed template read numbers NOTHING", () => {
  return (async () => {
    const { client, calls } = stub({ data: null, error: { message: "connection reset" } }, 46);
    const number = await generateInvoiceNumber(client, "u1", "factuur");
    assert.equal(number, "", "an unreadable scheme must refuse, not fall back to another one");
    // And it must not have burned a sequence number on the way out. A consumed counter with no
    // invoice behind it IS the gap Article 35 forbids — the refusal has to come first.
    assert.deepEqual(calls, [], "next_invoice_seq must not be called once the scheme is unknown");
  })();
});

test("[NUMBER-READ-HONEST] both callers already turn that into a clean 500", () => {
  // Not a behaviour test — a statement of the contract this refusal relies on. api/invoice/send and
  // api/invoice/creditnota both guard with `if (!generated)`. If either ever stops, an empty string
  // becomes an invoice number.
  const send = readFileSync("src/app/api/invoice/send/route.ts", "utf8");
  const credit = readFileSync("src/app/api/invoice/creditnota/route.ts", "utf8");
  assert.match(send, /if \(!generated\)/, "send must still refuse an empty number");
  assert.match(credit, /if \(!creditnotaNumber\)/, "creditnota must still refuse an empty number");
});

test("[FACTUUR-B] a custom template is honoured, shape and padding", () => {
  return (async () => {
    const { client } = stub(ok("{seq}-{year}", 3), 46);
    assert.equal(await generateInvoiceNumber(client, "u1", "factuur"), "046-2026".replace("2026", String(amsterdamYear())));
  })();
});

test("[FACTUUR-B] no template falls back to the product default", () => {
  return (async () => {
    const year = amsterdamYear();
    const { client } = stub(ok(null), 46);
    assert.equal(await generateInvoiceNumber(client, "u1", "factuur"), `${year}0046`);
  })();
});

test("[FACTUUR-B] creditnota and pro forma keep the system format, never the custom one", () => {
  return (async () => {
    const year = amsterdamYear();
    // Even with a custom factuur template configured: customization is factuur-only, because a
    // credit note that adopted the sales series would collide with it.
    const { client } = stub(ok("{seq}-{year}", 3), 46);
    assert.equal(await generateInvoiceNumber(client, "u1", "creditnota"), `CR-${year}0046`);
    assert.equal(await generateInvoiceNumber(client, "u1", "pro_forma"), `PF-${year}0046`);
  })();
});

test("[FACTUUR-B] the template decides WHICH counter is drawn from — the heart of the bug", () => {
  return (async () => {
    const year = amsterdamYear();

    // {year} present → yearly reset → keyed by the calendar year.
    const yearly = stub(ok("{year}{seq}", 4), 46);
    await generateInvoiceNumber(yearly.client, "u1", "factuur");
    assert.equal(yearly.calls[0]?.p_year, year, "a yearly template must draw from the year counter");

    // {year} absent → continuous → keyed by the 0 sentinel. This is the series a wrong fallback
    // would have silently abandoned, and it is the one that can never be reconciled afterwards.
    const continuous = stub(ok("{seq}", 7), 46);
    await generateInvoiceNumber(continuous.client, "u1", "factuur");
    assert.equal(continuous.calls[0]?.p_year, 0, "a continuous template must draw from the 0 counter");

    // The two are different rows, which is exactly why silently swapping schemes is unrecoverable.
    assert.notEqual(yearly.calls[0]?.p_year, continuous.calls[0]?.p_year);
  })();
});
