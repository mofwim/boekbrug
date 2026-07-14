# BoekBrug — Growth & Customer-Acquisition Plan (2026)

How the knowledge portal (`/blog` + free tools) turns Google searches into
BoekBrug signups. This is the strategy behind the content and cross-links; the
*mechanics* of how to add articles/tools live in `docs/blog-developer-guide.md`,
and the editorial principles in `docs/kennisbank-content-strategie.md`.

> **Scope of this document / of my mandate.** Everything here concerns the
> **portal** (blog, tool→blog links, SEO, on-page conversion copy). The app's
> functional code (the calculators/tools' logic, auth, dashboard, APIs) is **out
> of scope and must not be modified**. Items that would require app/tool changes
> are listed in §6 as **hand-off recommendations for the product/dev team**, not
> things the portal work touches.

---

## 1. The funnel (what we are optimising)

```
Google search  →  free tool / article ranks  →  visitor reads / calculates
              →  trust (plain answer, real product)  →  tool CTA  →  /register
```

Two engines feed it:

- **Slow-compounding engine — SEO.** 35 NL + 35 EN articles and 7 free tools.
  Compounds for months; it is the durable, un-buyable asset. Most of the work
  below feeds this.
- **Fast engines — distribution, partnerships, ads.** Off-site, mostly manual or
  paid. **These are the owner's lane, not the portal's** (see §7).

---

## 2. What the market research told us (July 2026)

Full findings: two research sweeps (search-demand + competitor teardown). The
decision-relevant conclusions:

1. **Free calculators/invoice generators are an open lane.** The big incumbents
   (Moneybird, e-Boekhouden, Tellow, Jortt, SnelStart, Exact, Acumulus) mostly do
   **not** lead-gen with public calculators — that SERP is owned by small SEO
   sites. BoekBrug already has 7 tools (incl. **AI invoice/receipt scanning**, a
   genuine differentiator). We are at parity-or-ahead on tools; the job is to
   **rank and convert** them, not build a moat we already have.
2. **Expat / English is the biggest un-defended wedge.** Only Exact offers real
   English; Acumulus and SnelStart have none. Expats are served by half-translated
   UIs or expensive English-speaking accountants. BoekBrug's blog is already
   bilingual — English *interactive tools* are the thin spot (see §6, dev item).
3. **The bookkeeper-bridge is a distribution channel, not just a tagline.**
   Incumbents acquire ZZP'ers *through* accountants. BoekBrug is built for this
   ("de brug tussen jou en je boekhouder") but needs an explicit invite/referral
   motion (see §6, dev item).
4. **2026 is a high-search tax year** — three live news hooks driving anxious,
   high-intent searches *right now*:
   - **Zelfstandigenaftrek cut** €2.470 (2025) → **€1.200 (2026)**.
   - **Wet DBA enforcement** restarted; from 1 Jan 2026 *vergrijpboetes* are
     possible again (see the article for the exact nuance).
   - **Kilometervergoeding** €0,23 → **€0,25** (retroactive to 1 Jan 2026) — much
     of the ranking SERP is still stale at €0,23.
5. **The winning content shape is "tool + explanation + product CTA" clusters**,
   not standalone calculators. Every competitor has a bare BTW calc; few connect
   calculator → "what this means for you" → "let BoekBrug do it." That bundle is
   where free traffic converts.

---

## 3. Content gap map (portal-scope — this is what I build)

Ranked by (demand × conversion potential × how beatable the current SERP is).
Each is a plain-language NL article **paired with an EN mirror**, ending in a
tool CTA, wired into a topic cluster. ✅ = shipped in this initiative.

| # | Topic | NL slug | Cluster | Why it converts |
|---|-------|---------|---------|-----------------|
| 1 | **Wet DBA / schijnzelfstandigheid 2026** | `wet-dba-schijnzelfstandigheid-2026` | zzp-starten | Hot 2026 news hook, anxious audience; positions BoekBrug as "run a real, defensible business" |
| 2 | **Aftrekposten ZZP 2026** (all deductions) | `aftrekposten-zzp-2026` | zzp-belasting-2026 | Income-tax-season evergreen; leads to net-income tool |
| 3 | **Urencriterium & urenregistratie** | `urencriterium-urenregistratie-zzp` | zzp-belasting-2026 | Unlocks the (shrinking) zelfstandigenaftrek; admin-proof angle |
| 4 | **Aangifte inkomstenbelasting stap-voor-stap** | `aangifte-inkomstenbelasting-zzp` | zzp-belasting-2026 | Mar–May spike; filing anxiety → wants software |
| 5 | **Offerte maken** | `offerte-maken-zzp` | factuur-maken-gids | One click from the invoice tool; quote→invoice funnel |
| 6 | **30%-regeling & ZZP — het eerlijke antwoord** | `30-procent-regeling-zzp` | zzp-belasting-2026 | Corrects a common expat misconception; trust builder |

Cover images reuse the existing `public/blog/*.png` product screenshots.

### Later content candidates (not yet built)
- "Beste bonnetjes-/factuur-scannen app 2026" — **only if honest** (no fabricated
  reviews; frame as an objective feature comparison incl. BoekBrug).
- MKB-winstvrijstelling deep-dive; startersaftrek deep-dive.
- DAFT-visa → eenmanszaak admin funnel (EN) — underserved, motivated US audience.
- Per-sector uurtarief 2026 benchmarks (IT/zorg/bouw) — needs sourced data.

---

## 4. Seasonal calendar (when to publish/refresh)

Publish or refresh ~3–4 weeks **before** each spike.

| Window | Spikes | Target |
|--------|--------|--------|
| Year start (Jan) | new rates | `...2026` refreshes: uurtarief, zelfstandigenaftrek, kilometervergoeding |
| 31 Jan / 30 Apr / **31 Jul** / 31 Oct | BTW-aangifte deadlines | the deadline hub + btw-aangifte tool |
| 1 Mar – 1 May | **income-tax season (biggest)** | aftrekposten, aangifte IB, deadlines |
| ~3 Dec | KOR sign-up deadline | KOR article/check |

The four quarterly BTW deadlines are a recurring 4×/year engine — one evergreen
"BTW-aangifte deadlines 2026" hub (already shipped) captures all of them.

---

## 5. On-page conversion (portal-scope tightening)

- **One clear tool CTA per article** (already enforced by `ToolCTA`).
- **Tighten the handoff copy**: "you calculated X for free — keep it in BoekBrug
  and it flows to your BTW-aangifte and your boekhouder."
- **Bilingual discoverability**: `🌐 EN` link in `PublicHeader` (all pages) +
  prominent language-switch button on the index and in each article (shipped).
- **Internal linking**: blog → tools (`ToolCTA`, in-body links) and tools → blog
  (`KennisbankLinks`) — keep every new article wired both ways.

---

## 6. Hand-off recommendations for the product/dev team (OUT of portal scope)

These are the highest-leverage moves that require **app/tool changes** and so are
**not** done by the portal work. Flagged here so the team can prioritise them.

1. **English versions of the 7 free tools at `/en/...`.** The single biggest
   keyword wedge (near-zero competition on "Dutch VAT calculator", "invoice
   generator Netherlands", "freelance net income Netherlands"). Requires i18n of
   the tool components — an app change. The EN blog already exists to feed them
   internal links.
2. **Bookkeeper referral / "for bookkeepers" landing + invite flow.** Turn the
   bridge into a real acquisition channel (one accountant → their whole ZZP book).
   The plumbing exists (`/api/accountant/invite`, UBL export); it needs a
   front-door and an incentive.
3. **New free tools** (each a fresh ranking surface, supporting articles already
   written): *belasting-reserveren* calculator, *offerte* generator, *KOR-check*,
   *urencriterium* checker, downloadable *factuur/offerte template* library.
4. **Visible trust signals** on public pages: real review score, "rechtstreeks/
   Belastingdienst-proof", bank/integration badges. Lifts tool→signup conversion.
   (Use only *real* figures — never fabricate reviews.)

---

## 7. The owner's lane (off-site — not code)

- Register the site in **Google Search Console**, submit the sitemap, watch
  indexing/queries. (The sandbox can't reach Google; the technical SEO — sitemap,
  robots, canonical, hreflang, JSON-LD — is already wired, so this is a
  one-time account step.)
- Distribute new articles in **ZZP/expat communities** (Facebook ZZP groups,
  LinkedIn, r/Netherlands, expat forums).
- **Bookkeeper outreach** for the referral channel.
- Paid search/social **only after** the free engine and trust signals are in.

---

## 8. Guardrails (non-negotiable — same as the content guardrails)

- **Only shipped features** in product claims; never roadmap. (Bank = statement
  *upload*; BoekBrug *exports* UBL, does not file; VAT is *prepared*, not
  auto-filed.)
- **Verify every tax/legal figure** against an authoritative source
  (Belastingdienst/KVK) and keep it in sync with the live calculators. Leave a
  `#` YAML note listing the numbers checked.
- **Plain language (~B1)**, short sentences, jargon explained — expat-friendly.
- **No future dates.** `publishedAt`/`updatedAt` ≤ today.
- **Links only on tool pages** — no calculator/tool logic changes.

---

### Verified 2026 figures used in this initiative (checked July 2026)

| Figure | 2026 value | Source |
|--------|-----------|--------|
| Zelfstandigenaftrek | € 1.200 (was € 2.470) | Belastingdienst |
| Startersaftrek | € 2.123 | Belastingdienst |
| MKB-winstvrijstelling | 12,7% | Belastingplan 2026 |
| Urencriterium | 1.225 uur | Belastingdienst |
| Kilometervergoeding | € 0,25 / km (retroactive 1 Jan) | Rijksoverheid |
| Box 1 schijf 1 | 35,75% t/m € 38.883 | Belastingplan 2026 |
| Box 1 schijf 2 | 37,56% € 38.883–€ 78.426 | Belastingplan 2026 |
| Box 1 schijf 3 | 49,50% boven € 78.426 | Belastingplan 2026 |
| Zvw-bijdrage (ZZP) | 4,85% | matches live net-income tool |
| Wet DBA | 2025 = zachte landing; vanaf 1 jan 2026 *vergrijpboetes* bij opzet/grove schuld mogelijk, nog geen *verzuimboetes*; naheffing mogelijk t/m 1 jan 2025 | KVK / Belastingdienst |
