// tests/render/supplier-picker.test.tsx
// [RENDER-GATE] Does the supplier picker survive a render — including the half no other gate sees?
//
// Run: npm run test:render
//
// The panel under the supplier name field is only on screen while that field has focus, and
// nothing in this repo's gate set can focus anything: tsc and next build never call a component,
// test:render draws the FIRST paint, and the Playwright sweep never logs in. So a panel that threw
// the moment it opened would pass every gate — the exact blind spot the header of
// money-screens.test.tsx describes. SupplierSuggestionPanel is exported for that reason: handed a
// real suggestion, it can be rendered here.
//
// The matching itself is proven in src/lib/supplier-suggest.test.ts. What this file asserts is
// that the owner can READ the result: the names, the account numbers that tell two of them apart,
// the count that is held back, and — the one that decides whether a correction is trustworthy —
// that a FAILED read never renders as "you have no supplier by that name".

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://render-gate.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "render-gate-anon-key";

mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard/incoming",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

/** What the owner READS. Raw markup answers /400/ with a border-radius; text nodes do not. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// This owner's registry, including the island the picker exists to merge: the delivery stamp the
// reader took for a sender ("Jim Ketels") next to the company that actually sends the invoices.
const REGISTRY = [
  { id: "a", name: "W. Ketels en Zoon Eierhandel", iban: "NL89RABO0131703501" },
  { id: "b", name: "Jim Ketels", iban: null },
  { id: "c", name: "CAN Vleesgroothandel B.V.", iban: "NL20ABNA0458266515" },
];

test("[LEVERANCIER-KIEZEN] the panel draws the suppliers, and the account that tells two apart", async () => {
  const { SupplierSuggestionPanel } = await import("../../src/components/invoice/SupplierNameInput");
  const { suggestSuppliers } = await import("../../src/lib/supplier-suggest");

  const suggestion = suggestSuppliers("kete", REGISTRY);
  assert.equal(suggestion.matches.length, 2, "the fixture must reach the row branch, or nothing below is tested");

  const html = renderToStaticMarkup(
    React.createElement(SupplierSuggestionPanel, {
      suggestion, active: 0, unavailable: false, newNotice: true, listId: "sug", onPick() {},
    }),
  );
  const text = textOf(html);

  assert.match(text, /W\. Ketels en Zoon Eierhandel/, "the company the owner is looking for");
  assert.match(text, /Jim Ketels/, "and the island beside it — hiding it would hide the merge");
  assert.match(text, /NL89RABO0131703501/, "the account you pay them on, so two near-identical names are separable");
  // The rows are pickable, and the keyboard's position is announced.
  assert.match(html, /role="option"/);
  assert.match(html, /aria-selected="true"/, "the highlighted row is marked, not only coloured");
});

test("[ZOEK-EERLIJK] a capped panel says how many it did not show", async () => {
  const { SupplierSuggestionPanel } = await import("../../src/components/invoice/SupplierNameInput");
  const { suggestSuppliers, SUPPLIER_SUGGEST_LIMIT } = await import("../../src/lib/supplier-suggest");

  const many = Array.from({ length: SUPPLIER_SUGGEST_LIMIT + 3 }, (_, i) => ({
    id: `s${i}`, name: `Groothandel ${String.fromCharCode(65 + i)}`, iban: null,
  }));
  const suggestion = suggestSuppliers("groothandel", many);
  assert.equal(suggestion.hidden, 3, "the fixture must actually hold something back");

  const text = textOf(renderToStaticMarkup(
    React.createElement(SupplierSuggestionPanel, {
      suggestion, active: -1, unavailable: false, newNotice: true, listId: "sug", onPick() {},
    }),
  ));
  assert.match(text, /Nog 3 meer/, "an owner who reads six and concludes six types a second spelling");
});

test("[NO-SILENT-EMPTY] a failed read is not the same sentence as an empty list", async () => {
  const { SupplierSuggestionPanel } = await import("../../src/components/invoice/SupplierNameInput");
  const { suggestSuppliers } = await import("../../src/lib/supplier-suggest");

  const nothing = suggestSuppliers("zzz niets", REGISTRY);
  assert.equal(nothing.matches.length, 0, "the fixture must reach the no-match branch");

  // A list that WAS read and does not hold this name: confirming will create a supplier, and the
  // owner is told so before they press it, not after.
  const missed = textOf(renderToStaticMarkup(
    React.createElement(SupplierSuggestionPanel, {
      suggestion: nothing, active: -1, unavailable: false, newNotice: true, listId: "sug", onPick() {},
    }),
  ));
  assert.match(missed, /Nog geen leverancier met deze naam/);
  assert.doesNotMatch(missed, /kon niet worden geladen/);

  // A list that could NOT be read knows nothing about this name, so it may not imply anything
  // about it. This is the assertion that matters: the wrong sentence here invites the owner to
  // create a duplicate of a supplier they already have.
  const failed = textOf(renderToStaticMarkup(
    React.createElement(SupplierSuggestionPanel, {
      suggestion: nothing, active: -1, unavailable: true, newNotice: true, listId: "sug", onPick() {},
    }),
  ));
  assert.match(failed, /kon niet worden geladen/);
  assert.doesNotMatch(failed, /Nog geen leverancier met deze naam/);

  // And a brand-new account — a list that is genuinely empty and was read fine — says nothing at
  // all. There is no second spelling to warn about when there is no first one.
  const fresh = textOf(renderToStaticMarkup(
    React.createElement(SupplierSuggestionPanel, {
      suggestion: suggestSuppliers("wat dan ook", []), active: -1, unavailable: false,
      newNotice: false, listId: "sug", onPick() {},
    }),
  ));
  assert.equal(fresh, "", "a new owner is not told about a list they do not have yet");
});

test("[LEVERANCIER-KIEZEN] the verify queue's own name field is the picker, not a bare text box", async () => {
  const { ConfirmPaidModal } = await import("../../src/app/dashboard/incoming/IncomingInvoicesClient");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  const { DialogProvider } = await import("../../src/components/ui/Dialog");
  const { classifyImportHealth } = await import("../../src/lib/import-health");

  // Invoice 26004628, as it arrived: the reader took a delivery stamp for the sender, and said so.
  const base = {
    id: "n1", client_name: "Jim Ketels", client_email: null, invoice_type: "factuur",
    total_ex_btw: 38.8, btw_amount: 3.49, total_inc_btw: 42.29, amount_paid: 0,
    invoice_date: "2026-09-01", invoice_number: "26004628", source: "upload",
    pdf_url: null, document_id: null, created_at: "2026-09-01T09:38:00Z",
    folder_id: null, folder_name: null,
    field_confidence: { client_name: 0.4 },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoice = { ...base, health: classifyImportHealth(base as any) };

  const html = renderToStaticMarkup(
    React.createElement(DialogProvider, null,
      React.createElement(ToastProvider, null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement(ConfirmPaidModal as any, {
          invoice, startEditing: true, suppliers: REGISTRY, suppliersUnavailable: false,
          onVerify() {}, onPay() {}, onCancel() {},
        }))),
  );

  assert.match(html, /role="combobox"/, "the supplier field offers what the owner already has");
  assert.match(html, /aria-autocomplete="list"/);
  // The name still arrives in the field — the picker replaced the input, not the value.
  assert.match(html, /value="Jim Ketels"/);
  // The panel is shut on the first paint: it belongs to a focused field, and a list covering the
  // amounts the moment the modal opens is worse than no list.
  assert.doesNotMatch(html, /role="listbox"/);
});
