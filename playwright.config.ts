import { defineConfig, devices } from '@playwright/test';

/**
 * [PUBLIC-SMOKE] Playwright, actually wired up.
 *
 * This file shipped as the generator's scaffold: `baseURL` and `webServer` were both commented
 * out, so there was nothing to point a test AT and nothing to start — and the only spec in
 * ./tests was the sample that browses playwright.dev. In effect the project had a browser test
 * runner installed and no test of its own.
 *
 * That gap has a shape. The three gates this repo does run (`tsc --noEmit`, the node unit tests,
 * `next build`) are all STATIC: none of them ever serves a request. So a page can be written,
 * type-check, build, prerender — and still be unreachable. That is exactly what happened to
 * /eerlijk-gebruik, a page the terms call "volledig openbaar" that the middleware redirected to
 * /login. No static gate can see it: the page is fine, the guard is fine, the PAIR is broken.
 *
 * One browser project (chromium). The smoke test asserts HTTP status codes on the public surface,
 * which is a property of the server rather than of the renderer — running it in three engines
 * would triple the time for the same response headers.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* 'list' prints results into the terminal/CI log. The default 'html' reporter tries to open a
     browser at the end of a headless run and otherwise hides the failure behind a command. */
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * The server under test. `next start` serves the PRODUCTION build — the same artefact the build
   * gate already produces and the same one Vercel runs, so the middleware behaves here the way it
   * behaves there. (`next dev` would too, but it recompiles per request, which turns a sweep over
   * forty-odd routes into minutes.)
   *
   * Run `npx next build` first; in CI that is the step immediately before this one.
   * reuseExistingServer locally, so an already-running `npm start` is used instead of fighting
   * over the port — never on CI, where a stale server would quietly test the wrong build.
   */
  webServer: {
    command: 'npx next start -p 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    /**
     * DELIBERATELY FAKE credentials, and the sweep is honest with them.
     *
     * `next build` runs with an empty environment on purpose ([BUILD-NO-SECRETS] in ci.yml) — that
     * is what makes it a gate. SERVING is different: several server components construct a Supabase
     * client while rendering, and the client library refuses to be constructed without a URL and a
     * key at all, so with a truly empty environment the homepage throws before the guard is even
     * the question. These two values get past that constructor and point at a host that does not
     * exist, which is exactly the state the public surface must survive: no database, no session,
     * no secrets — a logged-out visitor on a page that should not need any of them.
     *
     * They are not a way to sneak a real project into CI. If a test ever starts needing genuine
     * keys, it stopped being a public-surface test.
     */
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://smoke.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'smoke-anon-key',
    },
  },
});
