// src/lib/i18n/locale-boot.ts
// [TAAL] The three lines that make the document right-to-left before it is painted.
// Run: npx tsx --test src/lib/i18n/locale-boot.test.ts
//
// WHY A SCRIPT IN <head> AND NOT next/headers
//
// The obvious way to render <html lang="ar" dir="rtl"> is to read the cookie in the root layout
// with cookies() from next/headers. It is also the wrong way here, and the reason is not style:
// cookies() opts a route into DYNAMIC rendering, and the root layout is inherited by every route
// in the app. One call there turns 53 statically generated Arabic blog articles, the marketing
// pages and every tool into server-rendered-on-request pages. The whole funnel that brings Arab
// shop owners here is SSG, and it would stop being SSG to set two attributes.
//
// The alternative usually reached for — set them in a client effect — is worse in a different
// way: the document paints left-to-right and then flips. On an Arabic screen that is not a subtle
// flicker, it is the entire layout jumping sides after first paint.
//
// A synchronous script in <head> runs BEFORE the body is painted and before hydration, on a page
// that is still fully static. It is the same trick a dark-mode toggle uses, for the same reason.
//
// WHY THE SOURCE LIVES HERE INSTEAD OF INSIDE THE JSX
//
// Because a string injected with dangerouslySetInnerHTML is invisible to every gate this repo
// runs: tsc does not parse it, eslint does not lint it, and the render test cannot execute it. A
// typo in it fails silently and permanently, in Arabic only. As an exported constant it can at
// least be run against a fake document in a test — which is what locale-boot.test.ts does.
//
// It is deliberately tiny, and it must stay that way. It cannot import anything (it runs before
// any bundle), so the cookie name and three language lists — every language, the prefixed ones,
// the right-to-left ones — are inlined into it. All three are DERIVED from locale.ts at build
// time rather than typed out, and the test below asserts the strings that come out still agree
// with the vocabulary, which is the only honest way to keep two copies.

import { LOCALE_COOKIE } from './use-locale'
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, type Locale } from './locale'

/** The languages written right to left, derived from the table so it cannot drift by hand. */
export const RTL_LOCALES: Locale[] = LOCALES.filter((l) => LOCALE_META[l].dir === 'rtl')

/**
 * The languages that carry a URL prefix — everything except Dutch, which is canonical and
 * unprefixed (see localePrefix in locale.ts). Derived, so adding a language to LOCALES teaches
 * the boot script about it without a second edit here.
 */
export const PREFIXED_LOCALES: Locale[] = LOCALES.filter((l) => l !== DEFAULT_LOCALE)

/**
 * The pre-paint script. Works out the document's language and stamps `lang` and `dir` on <html>.
 *
 * TWO SOURCES, AND THE URL OUTRANKS THE COOKIE
 *
 * The cookie says what the OWNER reads. A `/ar` or `/tr` prefix says what THIS DOCUMENT is
 * written in. They answer different questions, and when both are present the document wins —
 * a page's language is a property of its text, not of whoever opened it.
 *
 * Reading the cookie alone, as this script first did, was wrong in both directions at once:
 *
 *   - An Arabic article read by an owner who never set the cookie — which is every visitor
 *     arriving from a search engine, the entire funnel the Arabic articles exist for — was
 *     served `lang="nl" dir="ltr"` over Arabic text. A screen reader announces that in Dutch,
 *     and the layout never turns around.
 *   - A Dutch tool page opened by an owner whose cookie says `ar` had the whole page flipped
 *     right-to-left over Dutch text. The mirror image of the same mistake.
 *
 * The first of those is the one that matters commercially: 53 Arabic and 53 Turkish articles are
 * the only surface of this product no Dutch competitor has, and they were announcing themselves
 * as Dutch to everyone who arrived cold.
 *
 * WHAT THIS STILL DOES NOT FIX, DELIBERATELY
 *
 * An unprefixed public page (`/factuur-maken`, `/prijzen`) is Dutch text, but it has no prefix to
 * read, so an owner carrying an `ar` cookie still gets it right-to-left. Fixing that needs the
 * script to know which unprefixed routes are translated (`/dashboard`) and which are Dutch source
 * text — a routing fact that would become a third copy in a file that already carries two under
 * protest. It belongs in the layout that knows its own segment, not here.
 *
 * Defensive on purpose: it runs before anything else and a throw here would be an uncaught error
 * on the very first line of every page in the app. There is nothing to gain from failing loudly —
 * if neither source can be read, Dutch is already in the markup and is the correct answer.
 */
export const LOCALE_BOOT_SCRIPT = `(function(){try{` +
  `var l=null;` +
  // The first path segment: '' on '/', 'ar' on '/ar/blog/x', 'blog' on '/blog/x'.
  `var s=location.pathname.split('/')[1];` +
  `if(${JSON.stringify(PREFIXED_LOCALES)}.indexOf(s)>-1){l=s}else{` +
  `var m=document.cookie.match(/(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)/);` +
  `if(m){var c=decodeURIComponent(m[1]);` +
  `if(${JSON.stringify(LOCALES)}.indexOf(c)>-1){l=c}}}` +
  `if(!l)return;` +
  `document.documentElement.lang=l;` +
  `document.documentElement.dir=${JSON.stringify(RTL_LOCALES)}.indexOf(l)<0?'ltr':'rtl';` +
  `}catch(e){}})()`
