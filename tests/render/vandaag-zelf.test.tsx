// tests/render/vandaag-zelf.test.tsx
// [ZIEL] The one sentence on Vandaag: what BoekBrug did by itself, what waits — and silence when
// nothing was booked or the read failed.
import test from "node:test";
import assert from "node:assert/strict";
import { zelfZin } from "../../src/app/dashboard/vandaag/VandaagClient";
import { translator } from "../../src/lib/i18n/t";

const t = translator("nl") as unknown as (k: string, v?: Record<string, string | number>) => string;

test("[ZIEL] self over total, and what waits", () => {
  assert.equal(zelfZin({ self: 42, hand: 5, waiting: 3 }, t), "Deze week deed BoekBrug 42 van 47 boekingen zelf. 3 dingen wachten op jou.");
  assert.equal(zelfZin({ self: 10, hand: 0, waiting: 1 }, t), "Deze week deed BoekBrug 10 van 10 boekingen zelf. Eén ding wacht op jou.");
  assert.equal(zelfZin({ self: 3, hand: 3, waiting: 0 }, t), "Deze week deed BoekBrug 3 van 6 boekingen zelf. Niets wacht op jou.");
});

test("[ZIEL] nothing booked → only what waits; nothing at all → silence; a failed read → silence", () => {
  assert.equal(zelfZin({ self: 0, hand: 0, waiting: 2 }, t), "2 dingen wachten op jou.");
  assert.equal(zelfZin({ self: 0, hand: 0, waiting: 0 }, t), null);
  assert.equal(zelfZin(null, t), null);
  assert.equal(zelfZin(undefined, t), null);
});
