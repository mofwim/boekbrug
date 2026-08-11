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
// any bundle), so the cookie name and the RTL language list are repeated here — the test below
// asserts they still agree with locale.ts, which is the only honest way to keep two copies.

import { LOCALE_COOKIE } from './use-locale'
import { LOCALES, LOCALE_META, type Locale } from './locale'

/** The languages written right to left, derived from the table so it cannot drift by hand. */
export const RTL_LOCALES: Locale[] = LOCALES.filter((l) => LOCALE_META[l].dir === 'rtl')

/**
 * The pre-paint script. Reads the language cookie and stamps `lang` and `dir` on <html>.
 *
 * Defensive on purpose: it runs before anything else and a throw here would be an uncaught error
 * on the very first line of every page in the app. There is nothing to gain from failing loudly —
 * if the cookie cannot be read, Dutch is already in the markup and is the correct answer.
 */
export const LOCALE_BOOT_SCRIPT = `(function(){try{` +
  `var m=document.cookie.match(/(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)/);` +
  `if(!m)return;` +
  `var l=decodeURIComponent(m[1]);` +
  `if(${JSON.stringify(LOCALES)}.indexOf(l)<0)return;` +
  `document.documentElement.lang=l;` +
  `document.documentElement.dir=${JSON.stringify(RTL_LOCALES)}.indexOf(l)<0?'ltr':'rtl';` +
  `}catch(e){}})()`
