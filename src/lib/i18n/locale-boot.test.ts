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

import { LOCALE_BOOT_SCRIPT, PREFIXED_LOCALES, RTL_LOCALES } from './locale-boot'
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, localePrefix } from './locale'
import { hasLocaleCookie, LOCALE_COOKIE, readLocaleCookie } from './use-locale'

/**
 * Run the boot script the way a browser would, over a document and a location that have only
 * what it touches. The path defaults to '/' — the unprefixed Dutch surface — so every test
 * written before the URL became a source still asks exactly what it asked then.
 */
function boot(cookie: string, pathname = '/'): { lang: string; dir: string } {
  const documentElement = { lang: 'nl', dir: 'ltr' }
  const document = { cookie, documentElement }
  new Function('document', 'location', LOCALE_BOOT_SCRIPT)(document, { pathname })
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
  // Same for the prefix list: Dutch is canonical and must never appear in it, or the script
  // would read '/nl' as a language and stamp a prefix the router does not serve.
  assert.ok(!PREFIXED_LOCALES.includes(DEFAULT_LOCALE), 'Dutch must not carry a URL prefix')
  assert.deepEqual(PREFIXED_LOCALES, ['en', 'ar', 'tr'])
})

// ---------------------------------------------------------------------------------------------
// [TAAL] The URL as a source of language, and why it outranks the cookie.
// ---------------------------------------------------------------------------------------------

test('[TAAL] an Arabic article turns the document around with no cookie at all', () => {
  // This is the visitor the Arabic articles exist for: arrived from a search engine, has never
  // seen this site, carries nothing. Before the URL was read, they got Arabic text in a
  // left-to-right document announcing itself as Dutch.
  assert.deepEqual(boot('', '/ar/blog/zzp-belasting-2026'), { lang: 'ar', dir: 'rtl' })
  assert.deepEqual(boot('', '/ar/blog'), { lang: 'ar', dir: 'rtl' })
  assert.deepEqual(boot('', '/ar/prijzen'), { lang: 'ar', dir: 'rtl' })
})

test('[TAAL] every prefixed language boots from its own URL', () => {
  for (const l of PREFIXED_LOCALES) {
    assert.deepEqual(
      boot('', `${localePrefix(l)}/blog`), { lang: l, dir: LOCALE_META[l].dir },
      `${l} does not boot from its own prefix`,
    )
  }
})

test('[TAAL] the document outranks the reader — a page is the language it is written in', () => {
  // An owner who reads Dutch opening an Arabic article still gets an Arabic document, and an
  // owner who reads Arabic opening the English page still gets a left-to-right one. The cookie
  // describes the reader; the prefix describes the text on the screen.
  assert.deepEqual(boot(`${LOCALE_COOKIE}=nl`, '/ar/blog/x'), { lang: 'ar', dir: 'rtl' })
  assert.deepEqual(boot(`${LOCALE_COOKIE}=ar`, '/en/prijzen'), { lang: 'en', dir: 'ltr' })
  assert.deepEqual(boot(`${LOCALE_COOKIE}=ar`, '/tr/blog'), { lang: 'tr', dir: 'ltr' })
})

test('[TAAL] an unprefixed path still honours the cookie, because that is the dashboard', () => {
  // /dashboard is translated by preference, not by URL. Nothing above may take that away.
  assert.deepEqual(boot(`${LOCALE_COOKIE}=ar`, '/dashboard/facturen'), { lang: 'ar', dir: 'rtl' })
  assert.deepEqual(boot(`${LOCALE_COOKIE}=tr`, '/dashboard'), { lang: 'tr', dir: 'ltr' })
})

test('[TAAL] a Dutch route whose name merely starts with a language code is not that language', () => {
  // The match is on the whole first segment. A prefix match would make '/entree' English and
  // '/artikelen' Arabic — both of which are real Dutch words this app could route on.
  for (const path of ['/entree', '/artikelen', '/enquete', '/trechter', '/arbeid']) {
    assert.deepEqual(boot('', path), { lang: 'nl', dir: 'ltr' }, `${path} must stay Dutch`)
  }
})

test('[TAAL] the Dutch surface is left exactly as the markup built it', () => {
  // Dutch is canonical and unprefixed, so there is nothing to change and nothing to write.
  assert.deepEqual(boot('', '/'), { lang: 'nl', dir: 'ltr' })
  assert.deepEqual(boot('', '/blog/zzp-belasting-2026'), { lang: 'nl', dir: 'ltr' })
  assert.deepEqual(boot('', '/factuur-maken/loodgieter'), { lang: 'nl', dir: 'ltr' })
  // '/nl/...' is not a route this app serves; it must not be honoured as one either.
  assert.deepEqual(boot('', '/nl/blog'), { lang: 'nl', dir: 'ltr' })
})

test('[TAAL] it cannot throw when the location is missing or strange', () => {
  // Same reasoning as the cookie: this runs on the first line of every page in the app.
  for (const pathname of ['', '//', '/ar', '/AR/blog', '/%%%']) {
    assert.doesNotThrow(() => boot('', pathname), `pathname ${JSON.stringify(pathname)} threw`)
  }
  assert.doesNotThrow(() => {
    new Function('document', 'location', LOCALE_BOOT_SCRIPT)(
      { cookie: '', documentElement: {} },
      { get pathname(): string { throw new Error('no location') } },
    )
  })
})

// ── [TAAL-VOLGT-MEE] "No cookie" and "chose Dutch" are different answers ────────────────────────
//
// The account only speaks into silence: a device that was never told which language the owner
// reads gets the one their account remembers, and a device where they DID choose keeps that
// choice. That rule stands entirely on hasLocaleCookie() being able to tell those two apart —
// readLocaleCookie() cannot, because it resolves an absent cookie to Dutch, which is right for
// rendering and would here overrule an owner who deliberately picked Dutch on this device.

test('[TAAL-VOLGT-MEE] an absent cookie is not the same as a Dutch one', () => {
  const g = globalThis as { document?: { cookie: string } }
  const before = g.document
  try {
    g.document = { cookie: '' }
    assert.equal(hasLocaleCookie(), false, 'nothing stored')
    assert.equal(readLocaleCookie(), DEFAULT_LOCALE, '…and reading it still renders Dutch')

    g.document = { cookie: `${LOCALE_COOKIE}=nl` }
    assert.equal(hasLocaleCookie(), true, 'Dutch chosen ON PURPOSE must not read as silence')

    g.document = { cookie: `${LOCALE_COOKIE}=ar` }
    assert.equal(hasLocaleCookie(), true)

    // Other cookies alone are still silence — and a cookie whose value is not a language of this
    // app is silence too, or a stale/garbled value would permanently block the account's answer.
    g.document = { cookie: 'sb-access-token=abc; other=1' }
    assert.equal(hasLocaleCookie(), false)
    g.document = { cookie: `${LOCALE_COOKIE}=klingon` }
    assert.equal(hasLocaleCookie(), false, 'an unusable value is not a choice')

    // It must find the cookie when it is not the first one on the header.
    g.document = { cookie: `other=1; ${LOCALE_COOKIE}=ar; more=2` }
    assert.equal(hasLocaleCookie(), true)
    assert.equal(readLocaleCookie(), 'ar')
  } finally {
    if (before === undefined) delete g.document
    else g.document = before
  }
})
