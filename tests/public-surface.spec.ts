import { test, expect, type APIRequestContext } from '@playwright/test';
import { PUBLIC_PATHS } from '../src/lib/public-paths';

/**
 * [PUBLIC-SMOKE] Everything a logged-OUT visitor is promised, requested as a logged-out visitor.
 *
 * WHY THIS TEST EXISTS, AND WHY IT IS THIS ONE FIRST
 *
 * The repo's three gates (tsc, the node unit tests, next build) never serve a request, so they
 * share one blind spot: a page that is correct and a guard that is correct can still be a broken
 * pair. /eerlijk-gebruik was exactly that — written, built, linked from the footer of every public
 * page, listed in sitemap.xml, called "volledig openbaar" in the terms, and redirected to /login
 * for every visitor and every crawler. Nothing in the pipeline could see it, because nothing in
 * the pipeline ever asked the server for it.
 *
 * It needs no database, no session and no secrets: with dummy Supabase keys the middleware
 * degrades to "no session" ([ENV-DEGRADE]) and every path below is supposed to be reachable
 * without one anyway. That is what makes it the cheapest gate in the project to keep green.
 *
 * THREE SOURCES, deliberately, because each names a different promise:
 *   1. PUBLIC_PATHS   — what the guard itself claims is public (imported, never copied: a copy
 *                       stops matching the day someone edits the list).
 *   2. sitemap.xml    — what we hand to Google. A redirect here is an SEO promise we break.
 *   3. the footer     — what a human can click from any public page. This is the one that made
 *                       /eerlijk-gebruik visible as a bug to a person rather than to a crawler.
 *
 * The three are not redundant, and this was MEASURED, not assumed: removing /eerlijk-gebruik from
 * PUBLIC_PATHS again and rebuilding makes sweeps 2 and 3 fail with "→ 307" while sweep 1 stays
 * green — because sweep 1 asks the guard about its own list, so an entry that is missing is also
 * missing from what it checks. A forgotten public path can therefore only ever be caught by a
 * source OUTSIDE the guard. Do not "simplify" this file down to one sweep.
 *
 * A path may legitimately answer 404 (a page removed on purpose, /steun without a configured legal
 * entity) or 410. What it may never do is REDIRECT — that is the auth guard taking the page away.
 * So the assertion is "not a redirect", plus "not a server error", which is stricter than a bare
 * 200 check where it matters and honest where a page is simply not there.
 */

/** Paths that need a parameter to mean anything — reachable, but not as a bare prefix. */
const NEEDS_PARAM = new Set([
  '/pay',    // /pay/[token] — the bare prefix is not a page
  '/invite', // /invite/[token]
]);

async function statusOf(request: APIRequestContext, pathname: string): Promise<number> {
  // maxRedirects: 0 — following the redirect would turn a broken public page into a cheerful 200
  // on /login, which is precisely the bug being tested for.
  const res = await request.get(pathname, { maxRedirects: 0, failOnStatusCode: false });
  return res.status();
}

/**
 * Is this answer a failure of the PUBLIC promise?
 *
 * · 3xx — yes, always. That is the guard taking the page away, the bug this file exists for.
 * · 5xx — yes. The page is public and broken.
 * · 404/410 — no. A page can be deliberately absent in this environment: /steun renders only with
 *   a configured legal entity and payment link, so on a bare checkout it correctly 404s. Calling
 *   that a failure would train everyone to ignore a red sweep, which costs more than it catches.
 *   (It is in PUBLIC_PATHS for the case where it DOES exist — being public is the point of it.)
 */
function isPublicFailure(status: number): boolean {
  if (status >= 300 && status < 400) return true;
  if (status >= 500) return true;
  return false;
}

test.describe('public surface', () => {
  test('every path the middleware calls public is reachable without a session', async ({ request }) => {
    const paths = PUBLIC_PATHS.filter((p) => !NEEDS_PARAM.has(p));
    expect(paths.length, 'PUBLIC_PATHS is empty — the import is wrong').toBeGreaterThan(10);

    const failures: string[] = [];
    for (const pathname of ['/', ...paths]) {
      const status = await statusOf(request, pathname);
      if (isPublicFailure(status)) failures.push(`${pathname} → ${status}`);
    }
    // Report ALL of them at once: fixing a public-path list one round-trip per CI run is the kind
    // of feedback loop people stop using.
    expect(failures, `public paths that did not serve: ${failures.join(', ')}`).toEqual([]);
  });

  test('every URL in sitemap.xml is reachable without a session', async ({ request }) => {
    const res = await request.get('/sitemap.xml', { maxRedirects: 0, failOnStatusCode: false });
    expect(res.status(), 'sitemap.xml itself must be fetchable by a crawler').toBe(200);

    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(urls.length, 'sitemap.xml contains no <loc> entries').toBeGreaterThan(5);

    const failures: string[] = [];
    for (const url of urls) {
      // The sitemap carries absolute URLs on the production host; test the PATH against the server
      // under test, not the live site.
      const pathname = new URL(url).pathname;
      const status = await statusOf(request, pathname);
      if (isPublicFailure(status)) failures.push(`${pathname} → ${status}`);
    }
    expect(failures, `sitemap URLs that did not serve: ${failures.join(', ')}`).toEqual([]);
  });

  test('every internal link in the public footer is reachable without a session', async ({ request }) => {
    // The footer is the promise a PERSON can act on: it renders on every public page, so a link in
    // it that bounces to /login is a dead end reached by clicking, not by crawling.
    //
    // Read out of the SERVER-RENDERED html rather than through a browser page. Every assertion in
    // this file is about a status code, so nothing here needs a DOM — and not needing one means the
    // whole sweep runs without a browser binary, which is what lets it be the cheapest gate in CI
    // instead of one that starts by downloading Chromium.
    const home = await request.get('/', { maxRedirects: 0, failOnStatusCode: false });
    expect(home.status(), 'the homepage must render for a logged-out visitor').toBeLessThan(300);
    const html = await home.text();
    const footer = /<footer[\s\S]*?<\/footer>/i.exec(html)?.[0] ?? '';
    expect(footer, 'no <footer> in the homepage html — the sweep would silently check nothing').not.toBe('');

    const hrefs = [...new Set([...footer.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]))];
    expect(hrefs.length, 'no internal footer links found — the extraction is wrong').toBeGreaterThan(3);

    const failures: string[] = [];
    for (const href of hrefs) {
      const status = await statusOf(request, href);
      if (isPublicFailure(status)) failures.push(`${href} → ${status}`);
    }
    expect(failures, `footer links that did not serve: ${failures.join(', ')}`).toEqual([]);
  });

  test('the health endpoint answers for itself instead of dying in the guard', async ({ request }) => {
    // [ENV-DEGRADE] /api/health is the diagnostic for a broken deployment, and the middleware runs
    // in FRONT of it — the matcher deliberately does not exclude /api ([SESSION-REFRESH]). So the
    // guard could take down the very tool built for the outage, and nothing would say so.
    //
    // What this asserts is not "healthy". The endpoint is admin-only (Bearer CRON_SECRET) and will
    // usually answer 401 here, or 503 with "CRON_SECRET staat niet in de omgeving" — both are ITS
    // answer, in its own words, and that is the point. What it may never do is redirect (the guard
    // taking it away) or return a bodiless 500 (the guard throwing before it runs).
    const res = await request.get('/api/health', { maxRedirects: 0, failOnStatusCode: false });
    const status = res.status();
    const isRedirect = status >= 300 && status < 400;
    expect(isRedirect, `/api/health answered ${status}: a redirect means the guard took the diagnostic away`).toBe(false);
    // A middleware that throws produces a bodiless 500; the endpoint's own refusals are JSON.
    const body = await res.json().catch(() => null);
    expect(body, '/api/health must answer with JSON of its own, never a crash in the middleware').not.toBeNull();
  });
});
