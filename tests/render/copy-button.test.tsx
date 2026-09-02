// [NUMMER-KOPIEREN] Render + behaviour of the copy button.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", { namedExports: {
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(), usePathname: () => "/dashboard", useParams: () => ({}),
  notFound: () => { throw new Error("notFound"); }, redirect: () => { throw new Error("redirect"); },
}});

const load = async () => {
  const { CopyButton } = await import("../../src/components/ui/CopyButton");
  const { ToastProvider } = await import("../../src/components/ui/Toast");
  return { CopyButton, ToastProvider };
};
const draw = (el: React.ReactElement) => renderToStaticMarkup(el);

test("[NUMMER-KOPIEREN] it renders a labelled button carrying the value", async () => {
  const { CopyButton, ToastProvider } = await load();
  const html = draw(<ToastProvider><CopyButton value="26704047" what="Factuurnummer" /></ToastProvider>);
  assert.match(html, /<button/, "no button rendered — nothing to tap");
  assert.match(html, /aria-label="[^"]*26704047[^"]*"/, "a screen reader must hear WHICH number this copies");
  assert.match(html, /content_copy/, "the icon is the affordance");
});

test("[NUMMER-KOPIEREN] nothing to copy renders nothing", async () => {
  const { CopyButton, ToastProvider } = await load();
  // A button that copies an empty string is a button that lies about having done something.
  for (const leeg of [null, undefined, "", "   "]) {
    const html = draw(<ToastProvider><CopyButton value={leeg} what="Factuurnummer" /></ToastProvider>);
    assert.doesNotMatch(html, /<button/, `rendered a copy button for ${JSON.stringify(leeg)}`);
  }
});

test("[NUMMER-KOPIEREN] the tap target is bigger than the circle", async () => {
  const { CopyButton, ToastProvider } = await load();
  const html = draw(<ToastProvider><CopyButton value="26704047" what="Factuurnummer" /></ToastProvider>);
  // .tap-44 grows the touch area to 44px without moving the layout — a 28px circle in a dense
  // money row is not something to aim at on a phone.
  assert.match(html, /class="[^"]*tap-44/, "the button lost its 44px touch target");
});
