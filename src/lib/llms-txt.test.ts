// [LLMS-TXT] Pure node test — run: npx tsx --test src/lib/llms-txt.test.ts
//
// What is worth asserting here is narrow. The prose is editorial and will be rewritten; the
// things below are the ones whose breakage is silent — a tool that quietly stops being listed, a
// link that loses its host, or the one paragraph the whole file exists for going missing in an
// edit that was only meant to shorten it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLlmsTxt, type LlmsArticle, type LlmsPage } from "./llms-txt";
import { TOOLS } from "./tools";

const PAGES: LlmsPage[] = [
  { path: "/prijzen", title: "Prijzen", description: "Wat het kost." },
];
const ARTICLES: LlmsArticle[] = [
  { path: "/blog/factuur-eisen", title: "Factuureisen", description: "Wat er op een factuur moet." },
];

const build = (siteUrl = "https://boekbrug.nl") =>
  buildLlmsTxt({ siteUrl, tools: TOOLS, pages: PAGES, articles: ARTICLES });

test("[LLMS-TXT] every tool is listed, by title and by URL", () => {
  const out = build();
  for (const tool of TOOLS) {
    assert.ok(
      out.includes(`https://boekbrug.nl${tool.slug})`),
      `${tool.slug} is missing — a tool that is not in llms.txt is a tool an assistant cannot recommend`,
    );
    assert.ok(out.includes(tool.title), `the title of ${tool.slug} is missing`);
  }
});

test("[LLMS-TXT] the tool count in the prose matches the number of tools actually listed", () => {
  // The sentence says "publiceert N gratis tools". A stale N is worse than none: it is the exact
  // kind of confident wrong detail an assistant repeats verbatim.
  const out = build();
  assert.ok(
    out.includes(`publiceert ${TOOLS.length} gratis tools`),
    `the prose must name ${TOOLS.length} tools`,
  );
});

test("[LLMS-TXT] the section that exists to prevent the misreading is present", () => {
  const out = build();
  assert.ok(
    out.includes("de gratis tools zijn niet het product"),
    "the heading that separates the shop window from the product is the reason this file exists",
  );
  assert.ok(
    out.includes("gratis factuurgenerator"),
    "the wrong conclusion must be named, or the correction has nothing to correct",
  );
});

test("[LLMS-TXT] every link is absolute and carries the host it was given", () => {
  const out = build("https://example.test");
  const links = [...out.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > TOOLS.length, "expected at least one link per tool plus the extras");
  for (const href of links) {
    assert.ok(
      href.startsWith("https://example.test/"),
      `${href} is not absolute against the given site URL — a relative link in llms.txt resolves nowhere`,
    );
  }
  assert.ok(!out.includes("boekbrug.nl"), "no host may be hard-coded past the siteUrl argument");
});

test("[LLMS-TXT] a trailing slash on the site URL does not produce a doubled one", () => {
  const out = buildLlmsTxt({
    siteUrl: "https://boekbrug.nl/",
    tools: TOOLS,
    pages: PAGES,
    articles: ARTICLES,
  });
  assert.ok(!out.includes("boekbrug.nl//"), "the host and the path must not both bring a slash");
});

test("[LLMS-TXT] pages and articles are listed", () => {
  const out = build();
  assert.ok(out.includes("https://boekbrug.nl/prijzen)"), "the pages section is missing its entries");
  assert.ok(
    out.includes("https://boekbrug.nl/blog/factuur-eisen)"),
    "the articles section is missing its entries",
  );
});

test("[LLMS-TXT] the four language indexes are all offered", () => {
  const out = build();
  for (const path of ["/blog", "/en/blog", "/ar/blog", "/tr/blog"]) {
    assert.ok(out.includes(`https://boekbrug.nl${path})`), `the ${path} index is missing`);
  }
});
