// tests/render/pay-page-copy.test.tsx
// [KOPIE-EERLIJK] The copy row on the PUBLIC payment page — /pay/[token], the screen the owner's
// CUSTOMER opens to pay an invoice.
//
// It is the highest-consequence copy in the product and had the least coverage: the page's data
// arrives in an effect, so server rendering never reaches this row, and the Playwright smoke test
// only sweeps paths the middleware lets through without a token. The row used to print
// "Gekopieerd" whether or not the clipboard write worked, and what the customer then pastes into
// their banking app is whatever they copied last.
//
// So the three states are asserted to be three DIFFERENT words. An assertion that only checked
// "renders something" would have passed against the bug it exists to catch.

import { test } from 'node:test'
import assert from 'node:assert/strict'

async function load() {
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { CopyRow } = await import('../../src/app/pay/[token]/PayClient')
  const row = (copied: { label: string; ok: boolean } | null) =>
    renderToStaticMarkup(
      React.createElement(CopyRow, {
        label: 'IBAN', value: 'NL91 ABNA 0417 1643 00', raw: 'NL91ABNA0417164300',
        onCopy: () => {}, copied,
      }),
    )
  return { row }
}

test('[KOPIE-EERLIJK] untouched, copied and refused are three different answers', async () => {
  const { row } = await load()
  const idle = row(null)
  const ok = row({ label: 'IBAN', ok: true })
  const failed = row({ label: 'IBAN', ok: false })

  assert.match(idle, /Kopieer</, 'the untapped button does not offer to copy')
  assert.match(ok, /Gekopieerd/, 'a successful copy is not confirmed')
  assert.match(failed, /Niet gelukt/, 'a REFUSED copy still tells the customer it worked')
  // The one that matters: refused must not read as success. Same words = the original defect.
  assert.notEqual(failed, ok, 'a refused copy renders identically to a successful one')
  assert.doesNotMatch(failed, /Gekopieerd/, 'the refused state still says "Gekopieerd"')

  // The IBAN itself is always on screen, in every state — it is what the customer falls back to
  // reading when the clipboard will not take it.
  for (const html of [idle, ok, failed]) assert.match(html, /NL91 ABNA 0417 1643 00/)
})

test('[KOPIE-EERLIJK] a state belonging to a DIFFERENT row does not colour this one', async () => {
  const { row } = await load()
  // Four rows share one `copied` value on this page (IBAN, Bedrag, Naam, Kenmerk). Copying the
  // amount must not make the IBAN row claim it was copied — the customer would stop reading it.
  assert.equal(row({ label: 'Bedrag', ok: true }), row(null))
})
