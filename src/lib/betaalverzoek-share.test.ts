// npx tsx --test src/lib/betaalverzoek-share.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappShareText, whatsappShareUrl } from "./betaalverzoek-share";

test("the customer reads the number, the amount in Dutch notation and the link", () => {
  const text = whatsappShareText({ invoiceNumber: "2026-0012", amount: 1234.5, url: "https://boekbrug.nl/pay/x" });
  // Intl writes a narrow no-break space after the euro sign; match the shape, not the byte.
  assert.match(text, /^Factuur 2026-0012: €\s1\.234,50\. Betaal veilig via https:\/\/boekbrug\.nl\/pay\/x$/);
});

test("a concept without a number still reads as an invoice, never as 'Factuur :'", () => {
  assert.match(whatsappShareText({ invoiceNumber: "  ", amount: 10, url: "u" }), /^Factuur: /);
});

test("the wa.me link carries the text URL-encoded, and nothing else", () => {
  const url = whatsappShareUrl({ invoiceNumber: "1", amount: 1, url: "https://boekbrug.nl/pay/x" });
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(url.slice("https://wa.me/?text=".length)), whatsappShareText({ invoiceNumber: "1", amount: 1, url: "https://boekbrug.nl/pay/x" }));
});
