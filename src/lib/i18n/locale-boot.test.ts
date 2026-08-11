// [TAAL] Pure node test — run: npx tsx --test src/lib/i18n/locale-boot.test.ts
//
// LOCALE_BOOT_SCRIPT is a string injected with dangerouslySetInnerHTML, which means every gate
// this repo runs is blind to it: tsc does not parse it, eslint does not lint it, next build does
// not compile it, and the render test cannot execute it. A typo in there fails silently and
// permanently — and only in Arabic, so nobody testing in Dutch will ever see it.
//
// So it gets run. Against a fake document, in-process, with `new Function` — the same way the
// browser will run it, which is the only way to find out whether it works.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LOCALE_BOOT_SCRIPT, RTL_LOCALES } from './locale-boot'
import { LOCALES, LOCALE_META } from './locale'
import { LOCALE_COOKIE } from './use-locale'

/** Run the boot script the way a browser would, over a document that only has what it touches. */
function boot(cookie: string): { lang: string; dir: string } {
  const documentElement = { lang: 'nl', dir: 'ltr' }
  const document = { cookie, documentElement }
  new Function('document', LOCALE_BOOT_SCRIPT)(document)
  return { lang: documentElement.lang, dir: documentElement.dir }
}

test('[TAAL] the boot script is valid JavaScript at all', () => {
  // The whole point: this string is never parsed by anything else in the pipeline.
  assert.doesNotThrow(() => new Function('document', LOCALE_BOOT_SCRIPT))
})

test('[TAAL] an Arabic cookie makes the document right-to-left before it is painted', () => {
  const out = boot(`${LOCALE_COOKIE}=ar`)
  assert.deepEqual(out, { lang: 'ar', dir: 'rtl' })
})

test('[TAAL] every language the app has boots to its own direction', () => {
  for (const l of LOCALES) {
    assert.deepEqual(
      boot(`${LOCALE_COOKIE}=${l}`), { lang: l, dir: LOCALE_META[l].dir },
      `${l} boots wrong`,
    )
  }
})

test('[TAAL] no cookie leaves the statically built markup exactly as it is', () => {
  // The markup says lang="nl" dir="ltr" and it is SSG. Touching it when there is nothing to
  // change would be a write on every page load for no reason.
  assert.deepEqual(boot(''), { lang: 'nl', dir: 'ltr' })
  assert.deepEqual(boot('other=1; something=else'), { lang: 'nl', dir: 'ltr' })
})

test('[TAAL] a cookie the app cannot honour is ignored, not obeyed', () => {
  // A cookie is user-writable. `lang="<script>"` on the root element is not an injection by
  // itself, but a document claiming a language that does not exist is a real bug — and the guard
  // that prevents it is one indexOf that is easy to drop.
  for (const junk of ['de', 'ar-EG', 'AR', '', 'nl ', '<script>', 'javascript:1']) {
    assert.deepEqual(
      boot(`${LOCALE_COOKIE}=${encodeURIComponent(junk)}`), { lang: 'nl', dir: 'ltr' },
      `${JSON.stringify(junk)} must not reach the document`,
    )
  }
})

test('[TAAL] it finds the cookie when it is not the first one', () => {
  // Real browsers send a pile of them. A match on /^name=/ would work in every hand-written test
  // and fail on every real request.
  assert.equal(boot(`sb-access-token=x; ${LOCALE_COOKIE}=ar; theme=dark`).lang, 'ar')
  assert.equal(boot(`${LOCALE_COOKIE}=ar; theme=dark`).lang, 'ar')
  assert.equal(boot(`theme=dark; ${LOCALE_COOKIE}=ar`).lang, 'ar')
})

test('[TAAL] a cookie whose NAME merely ends in ours is not ours', () => {
  // `boekbrug_taal` vs `mijn_boekbrug_taal`. The \s* after the semicolon is what separates them,
  // and it is exactly the kind of detail that gets simplified away.
  assert.deepEqual(boot(`mijn_${LOCALE_COOKIE}=ar`), { lang: 'nl', dir: 'ltr' })
})

test('[TAAL] it cannot throw — it runs before everything else on every page', () => {
  // An uncaught error on the first line of <head> is a broken page, in every language, for a
  // preference nobody needs to have honoured. Dutch is already in the markup.
  assert.doesNotThrow(() => {
    new Function('document', LOCALE_BOOT_SCRIPT)({
      get cookie(): string { throw new Error('blocked by the browser') },
      documentElement: {},
    })
  })
})

test('[TAAL] the copies inside the script still agree with locale.ts', () => {
  // The script cannot import anything — it runs before any bundle exists — so the cookie name and
  // the language list are repeated inside it. Two copies of one fact is the defect class this
  // repo keeps finding, and the only honest answer when they genuinely cannot be shared is a test
  // that fails the day they disagree.
  assert.ok(LOCALE_BOOT_SCRIPT.includes(LOCALE_COOKIE), 'the cookie name drifted')
  for (const l of LOCALES) {
    assert.ok(LOCALE_BOOT_SCRIPT.includes(`"${l}"`), `${l} is missing from the script's list`)
  }
  // And RTL_LOCALES is derived, not typed twice — this asserts the derivation still finds Arabic.
  assert.deepEqual(RTL_LOCALES, ['ar'])
})
