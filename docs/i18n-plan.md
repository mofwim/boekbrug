# BoekBrug App i18n — Architecture Plan (RFC)

Owner: the i18n workstream. Status: **foundation prepared; app rollout waiting
for the app to stabilise** (per product owner). This document is the plan; the
runtime primitives live in `src/lib/i18n/`.

---

## 1. Decision: one app + an i18n layer (NOT a separate app)

A fully separate app/fork per language was considered and **rejected**:

- **Drift & double maintenance** — every feature, fix and tax-figure update would
  have to be done 2–4×. The app is under active development; a fork diverges in
  weeks and becomes unmaintainable.
- **Data & users don't split by language** — an expat ZZP'er works inside the
  Dutch system (Belastingdienst, KvK), may switch NL↔EN, and may have a Dutch
  accountant on the *same* data. One codebase, one database, one billing.
- **Doubled infra** (auth, billing, DB) or a split-brain data problem.

**Chosen approach:** a single codebase with a lightweight i18n layer. **Dutch is
the default locale and its behaviour is unchanged** — i18n is *additive*: strings
move into a catalog and are looked up via `t()`, with fallback to Dutch. A Dutch
user sees no difference.

---

## 2. Two locale surfaces (already split correctly)

| Surface | Rendering | Locale source | Status |
|---|---|---|---|
| **Public / marketing** (blog, tools, pricing) | SSG, per-locale **URL prefix** (`/en`, `/ar`, `/tr`) | the URL | ✅ shipped (4 languages, RTL) |
| **Authenticated app** (`/dashboard/*`) | client + auth | the **user's saved preference** | ⏳ this plan |

The public side stays URL-prefixed (good for SEO). The dashboard is behind login
and client-rendered, so its language should come from a **per-user preference**,
not the URL. These two systems coexist; this RFC is about the dashboard.

---

## 3. Runtime design (zero new dependencies)

Deliberately **no `next-intl` / `react-intl`** — adding a dependency + its build
integration mid-active-development is disruptive, and the app's needs (static UI
strings + simple interpolation) are met by a tiny custom layer that is trivial to
swap later. All of it is new files under `src/lib/i18n/` — **it touches no
existing component**, so it cannot conflict with the team's in-flight work.

- `config.ts` — `AppLocale` (`nl|en|ar|tr`), `APP_LOCALES`, `DEFAULT_APP_LOCALE`,
  and `APP_LOCALE_META` (dir for RTL, native label, Intl tag).
- `messages/{nl,en,ar,tr}.ts` — the string catalog. **`nl` is the source of
  truth** (typed `as const`); the others are deep-partial and fall back to `nl`.
- `t.ts` — `translate(locale, key, vars?)`: dot-path lookup, `{var}`
  interpolation, `nl` fallback, and returns the key itself if a string is missing
  (so gaps are visible, never a crash).
- `I18nProvider.tsx` — a client context carrying the current locale, plus
  `useT()`, `useLocale()`, `useDir()` hooks.

Usage in a component (later): `const t = useT()` → `t('nav.invoices')`.

---

## 4. Where the locale comes from (rollout, not now)

The provider takes a `locale` prop and defaults to `nl`. When rolling out, the
locale is resolved once (server layout or a small client bootstrap) from, in
order: the user's **saved profile preference** → browser `Accept-Language` →
`nl`. Persisting the preference needs a `locale` column on `profiles` — a DB
migration that is **the app team's call**, done at rollout time, not now.

---

## 5. RTL for the dashboard

Arabic needs `dir="rtl"` on the app shell and logical CSS (`padding-inline-*`,
`margin-inline-*`, `border-inline-*`) instead of left/right. This is a real pass
over the dashboard's styles and is scheduled as its **own phase** after the
strings are extracted. The blog already proves the pattern (RTL + Noto Sans
Arabic).

---

## 6. Rollout phases (each after the area is stable)

0. **Foundation** — this doc + `src/lib/i18n/` primitives + seeded common catalog. ✅ *(prepared now — additive, no conflicts)*
1. **Wire the provider** — resolve + provide the locale in the dashboard shell; add a language switch in settings. *(small, touches the shell — do when app has settled)*
2. **Extract per area** — one stable dashboard area at a time (e.g. Settings → Klanten → Facturen …): move its Dutch strings into the catalog, wrap with `t()`, translate EN/AR/TR. Extract only **stable** areas to avoid churn.
3. **RTL pass** — logical CSS + `dir` for Arabic across the dashboard.
4. **Locale persistence** — `profiles.locale` column + save/read the preference.
5. **QA** — exercise the authenticated flows per language (needs a test account — see §8).

---

## 7. Guardrails

- **Dutch behaviour never changes** — `nl` is default and the fallback; wrapping a
  string must render byte-identically for a Dutch user.
- **No fabricated features** in any translation; figures stay identical to source
  (same rule that governed the blog).
- **Extract only stable areas** — never mass-edit components the team is actively
  changing; coordinate to keep merge conflicts near zero.
- **Keep the catalog the single source** — no hardcoded UI strings once an area is
  migrated.

---

## 8. Open items / what I need at rollout

- **A test account** (or a network-open environment) to QA the logged-in flows —
  the sandbox can't authenticate, so post-login screens can't be verified here.
- **Which languages for the app UI** — default assumption is the same four as the
  portal (nl/en/ar/tr); confirm at rollout.
- **Go-ahead to touch app-core** — phases 1–4 edit dashboard code; that is the
  boundary the owner authorises when the version is ready.

Until then: the foundation sits ready and inert, and I remain the translation +
consistency authority.
