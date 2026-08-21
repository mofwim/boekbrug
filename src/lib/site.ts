// src/lib/site.ts
// [SEO] Canonical absolute site URL, used by metadataBase, sitemap and robots.
// Falls back to the production domain when NEXT_PUBLIC_BASE_URL is unset (e.g.
// during a placeholder build). No trailing slash.

export const SITE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://boekbrug.nl').replace(/\/+$/, '')

export const absoluteUrl = (path: string): string =>
  `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`

/**
 * [CANONIEK] Is the canonical host one we can safely advertise?
 *
 * ── WHY THIS IS WORTH A CHECK AT ALL ──
 *
 * SITE_URL is the host printed into sitemap.xml, into robots.txt, into every canonical and every
 * Open Graph URL. It is a single string, it is read from the environment, and NOTHING in the app
 * changes visibly when it is wrong — the pages still render, the build is green, the smoke test
 * passes because it tests PATHS against the server under test rather than the host in the file.
 *
 * What breaks is outside the app, weeks later, in a console the owner may not open. Set it to the
 * www host while the deployment canonicalises to the apex (or the reverse) and every URL in the
 * sitemap answers 301. Google files all of them under "Page with redirect" and indexes none of
 * them; Bing reports the sitemap as unusable. The site is fine, the content is fine, and it simply
 * stops being indexed.
 *
 * That was worth writing down because it is the failure a real Search Console report LOOKS like:
 * boekbrug.nl reported 28 pages as "Page with redirect", and every one of them was a www URL —
 * which is the healthy version, the www duplicate bouncing to the apex we advertise. Flip the
 * variable and the identical report would mean the opposite, with nothing to tell the two apart.
 *
 * So: the app cannot know which host the hosting provider made primary, and this does not pretend
 * to. It names the three shapes that are wrong on their own terms, and /api/health prints the host
 * it resolved so the answer is one request away instead of one crawl cycle.
 */
export function siteUrlIssue(url: string = SITE_URL): { code: string; gevolg: string } | null {
  const raw = (url ?? '').trim()
  if (raw === '') {
    return { code: 'leeg', gevolg: 'Er is geen canonieke URL; sitemap en canonicals wijzen nergens heen.' }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { code: 'ongeldig', gevolg: `"${raw}" is geen geldige URL, dus sitemap.xml en robots.txt bevatten onzin.` }
  }
  if (parsed.protocol !== 'https:') {
    return { code: 'niet-https', gevolg: 'De canonieke URL is geen https; elke vermelde URL wordt doorgestuurd.' }
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return { code: 'met-pad', gevolg: 'De canonieke URL bevat een pad; elke sitemap-URL krijgt dat pad er dubbel bij.' }
  }
  // The classic one, and the reason this function exists. Not "www is wrong" — www is wrong HERE,
  // because every document in this repo, the default in this file and the DNS the app is deployed
  // behind all use the apex. A www value means the environment disagrees with all of them, and the
  // only symptom is that search engines stop indexing.
  if (parsed.hostname.startsWith('www.')) {
    return {
      code: 'www-prefix',
      gevolg:
        'De canonieke URL staat op www, terwijl de rest van de app de kale domeinnaam gebruikt. ' +
        'Als het hostingplatform naar de kale naam doorstuurt, wordt élke URL in sitemap.xml een ' +
        'redirect en indexeert Google er geen enkele.',
    }
  }
  return null
}
