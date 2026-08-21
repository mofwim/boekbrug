// [CANONIEK] Run: npx tsx --test src/lib/site.test.ts
//
// Two halves, and the second one is the reason this file exists at all.
//
// The first half tests siteUrlIssue() as a value: five shapes of a wrong canonical host, and the
// healthy one. Ordinary.
//
// The second half is a gate over the source, because the value half cannot see the failure. There
// is exactly one canonical host in this app, and its whole job is to be printed into places nobody
// looks at while working: sitemap.xml, robots.txt, every canonical link, every og:url. A second
// host introduced anywhere — a hardcoded www in a page, a sitemap that stops reading SITE_URL —
// changes nothing anyone can see. The build stays green. The screens stay right. The site simply
// stops being indexed, weeks later, in a console the owner may never open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { SITE_URL, absoluteUrl, siteUrlIssue } from "./site";

// ─── The rule, as a value ────────────────────────────────────────────────────────────

test("[CANONIEK] a plain https apex is the healthy answer, and says nothing", () => {
  assert.equal(siteUrlIssue("https://boekbrug.nl"), null);
  // Trailing slash is what SITE_URL already strips, but the check must not depend on that having
  // happened — it is also called on raw environment values in tests and scripts.
  assert.equal(siteUrlIssue("https://boekbrug.nl/"), null);
  // And a different apex is fine too: this check is about SHAPE, not about which domain we own.
  assert.equal(siteUrlIssue("https://staging.boekbrug.nl"), null);
});

test("[CANONIEK] the deployed value itself passes", () => {
  // The one assertion that is about THIS deployment rather than about the function. If someone sets
  // NEXT_PUBLIC_BASE_URL to something malformed, the build that carries it fails here rather than
  // in Search Console.
  assert.equal(siteUrlIssue(), null, `NEXT_PUBLIC_BASE_URL resolved to ${SITE_URL}, which this app cannot advertise`);
  assert.equal(absoluteUrl("/tools"), `${SITE_URL}/tools`);
});

test("[CANONIEK] a www host is named, because it is the failure that looks healthy", () => {
  // THE ONE THAT MATTERS. Every document in this repo, the fallback in site.ts and the DNS this is
  // deployed behind use the apex. A www value means the environment disagrees with all of them —
  // and the only symptom is that every URL in the sitemap answers 301 and Google indexes none.
  const issue = siteUrlIssue("https://www.boekbrug.nl");
  assert.equal(issue?.code, "www-prefix");
  assert.match(issue!.gevolg, /sitemap/, "the consequence must name where it bites, not just say 'wrong'");
});

test("[CANONIEK] empty, invalid, plain http and a path each have their own answer", () => {
  assert.equal(siteUrlIssue("")?.code, "leeg");
  assert.equal(siteUrlIssue("   ")?.code, "leeg", "whitespace is empty");
  assert.equal(siteUrlIssue("boekbrug.nl")?.code, "ongeldig", "a bare host is not a URL — new URL() throws on it");
  assert.equal(siteUrlIssue("http://boekbrug.nl")?.code, "niet-https");
  assert.equal(siteUrlIssue("https://boekbrug.nl/app")?.code, "met-pad");
  assert.equal(siteUrlIssue("https://boekbrug.nl/?ref=x")?.code, "met-pad", "a query string is a path problem too");

  // Every code carries a consequence in Dutch. A code alone is a note to a developer; this endpoint
  // is read by whoever deployed, and "leeg" on its own tells them nothing to do.
  for (const bad of ["", "boekbrug.nl", "http://boekbrug.nl", "https://boekbrug.nl/app", "https://www.boekbrug.nl"]) {
    const issue = siteUrlIssue(bad);
    assert.ok(issue && issue.gevolg.length > 30, `"${bad}" produced a code with no explanation`);
  }
});

// ─── The gate, over the source ───────────────────────────────────────────────────────

const read = (file: string) => readFileSync(file, "utf8");

test("[CANONIEK] every place that prints the host reads the one constant", () => {
  // sitemap.ts, robots.ts and the metadataBase in layout.tsx are the three files whose output is
  // read by a crawler and by nobody else. A literal host in any of them is a second source of
  // truth that can drift from the first without a single visible symptom.
  const printers = [
    { file: "src/app/sitemap.ts", must: "SITE_URL" },
    { file: "src/app/robots.ts", must: "SITE_URL" },
    { file: "src/app/layout.tsx", must: "new URL(SITE_URL)" },
  ];
  for (const { file, must } of printers) {
    const src = read(file);
    assert.ok(src.includes(must), `${file} no longer builds its URLs from ${must}`);
    assert.ok(
      /from ['"]@\/lib\/site['"]/.test(src),
      `${file} does not import the canonical host from @/lib/site`,
    );
  }
  // robots.txt names the sitemap AND the canonical host — the two statements a crawler uses to
  // decide the www duplicate is not a separate site.
  const robots = read("src/app/robots.ts");
  assert.match(robots, /sitemap:\s*`\$\{SITE_URL\}\/sitemap\.xml`/);
  assert.match(robots, /host:\s*SITE_URL/);
});

test("[CANONIEK] nothing in the app writes a www version of our own domain", () => {
  // The inverse failure of the one above, and the cheaper one to introduce: someone pastes a www
  // URL into a page's JSON-LD or a mail template. It renders fine. It also tells a crawler that the
  // page's canonical identity lives on a host we do not advertise, which is how a duplicate becomes
  // the indexed one.
  //
  // Scoped to OUR apex on purpose. "www." on its own is everywhere and legitimately so — the SVG
  // namespace is http://www.w3.org, Google's OAuth endpoints live on www.googleapis.com. A gate
  // that flags those gets switched off within a week, and a gate nobody trusts protects nothing.
  const apex = new URL(SITE_URL).hostname.replace(/^www\./, "");
  const wwwHost = new RegExp(`www\\.${apex.replace(/\./g, "\\.")}`, "i");

  const files = execFileSync("git", ["ls-files", "src", "public", "next.config.ts"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f !== "" && f !== "src/lib/site.test.ts");
  const offenders: string[] = [];
  for (const file of files) {
    let src: string;
    try {
      src = read(file);
    } catch {
      continue;
    }
    if (wwwHost.test(src)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files hardcode www.${apex}; the app advertises the apex everywhere else:\n` +
      offenders.map((f) => `  · ${f}`).join("\n"),
  );

  // And the three files a crawler actually reads carry no www host at all, whoever owns it. A
  // sitemap or a canonical that points at another site's www is a different bug with the same
  // effect: it hands our indexing to a host we do not control.
  for (const file of ["src/app/sitemap.ts", "src/app/robots.ts", "src/app/layout.tsx"]) {
    assert.doesNotMatch(read(file), /(https?:\/\/|["'`])www\./, `${file} names a www host`);
  }
});

test("[CANONIEK] /api/health actually asks the question", () => {
  // A gate matching a bare identifier passes on a file where only the import survived — that has
  // happened twice in this repo. So this matches the CALL.
  const health = read("src/app/api/health/route.ts");
  assert.match(health, /siteUrlIssue\(/, "the deploy check no longer looks at the canonical host");
  assert.match(
    health,
    /canoniek/,
    "the health report must name the host it resolved — the whole point is that the answer is one request away",
  );
});
