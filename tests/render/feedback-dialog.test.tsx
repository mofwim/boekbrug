// tests/render/feedback-dialog.test.tsx
// [FEEDBACK-MIDDEN] The report dialog, really rendered, open.
//
// The lifecycle gate reads the SOURCE and can confirm the overlay says alignItems: 'center'. It
// cannot see what React hands the browser: whether that style reaches the element the owner taps,
// or whether the panel still carries the bottom sheet's square corners. The rendered HTML is where
// those questions have answers, and it costs no browser.
//
// The closed state is rendered too — the flag button itself, where every report starts — because a
// component that throws on render passes tsc, eslint and the build alike (AGENTS.md).

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The App Router hooks throw outside a router; usePathname sits at the top of FeedbackButton.
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/dashboard/facturen",
    useParams: () => ({}),
    notFound: () => { throw new Error("[RENDER-GATE] the component called notFound()"); },
    redirect: (to: string) => { throw new Error(`[RENDER-GATE] the component redirected to ${to}`); },
  },
});

async function render(props: { defaultOpen?: boolean }) {
  const { default: FeedbackButton } = await import("../../src/components/feedback/FeedbackButton");
  return renderToStaticMarkup(React.createElement(FeedbackButton, props));
}

// The opening tag of the first element carrying `needle`, so a style assertion is about THAT
// element and not about some other one further down the page.
function openingTag(html: string, needle: string): string {
  const at = html.indexOf(needle);
  assert.ok(at > 0, `no element carries ${needle}`);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

test("[FEEDBACK-MIDDEN] closed: the flag button renders, parked above the bar and the page's own button", async () => {
  const html = await render({});
  assert.ok(html.includes('aria-label="Er ging iets mis — stuur ons een bericht"'), "the flag button is there, in Dutch");
  assert.ok(html.includes(">flag<"), "…with its icon");
  assert.ok(html.includes("bottom:calc(92px + var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px))"),
    "…above the BottomNav and the upload FAB, which share the corner");
  assert.ok(!html.includes('role="dialog"'), "the dialog does not open by itself");
});

test("[FEEDBACK-MIDDEN] open: a centred dialog with the bar kept clear, not a sheet on the bottom edge", async () => {
  const html = await render({ defaultOpen: true });

  const overlay = openingTag(html, 'role="dialog"');
  assert.match(overlay, /align-items:center;justify-content:center/, "the overlay centres the panel");
  assert.match(overlay, /padding:16px;padding-bottom:calc\(16px \+ var\(--bottom-nav-h\) \+ env\(safe-area-inset-bottom\)\)/,
    "the overlay reserves the BottomNav, so the centring box ends where the bar begins");
  assert.ok(!html.includes("align-items:flex-end"), "nothing parks the panel on the bottom edge");

  const panel = openingTag(html, 'class="sheet-scroll"');
  assert.match(panel, /border-radius:16px;/, "a dialog has four rounded corners");
  assert.ok(!html.includes("border-radius:16px 16px 0 0"), "…and not the sheet's square bottom ones");
  assert.match(panel, /max-height:100%;overflow-y:auto/, "the panel is capped to the overlay's box and scrolls inside it");

  // The whole flow is on the screen: the title, the page it was opened on, the box, the image
  // button and the send button — which waits until there are four characters to send.
  for (const s of ["Er ging iets mis", "/dashboard/facturen", "<textarea", "Afbeelding toevoegen", ">Versturen</button>"]) {
    assert.ok(html.includes(s), `the dialog lost: ${s}`);
  }
  assert.match(html, /<button[^>]*disabled=""[^>]*>Versturen<\/button>/, "the send button waits for a message");
});
