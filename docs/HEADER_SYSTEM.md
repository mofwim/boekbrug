# Header system

One place that documents how page headers work across the dashboard, so every
new screen looks and behaves the same. Read this before adding a page or a
sticky bar.

## TL;DR for a new page

- **Do not draw your own top bar, page title, or back button.** The shared
  chrome already renders one for every `/dashboard/*` route.
- Give the route a title by adding it to `STATIC_TITLES` (fixed label) or
  `PATTERN_TITLES` (dynamic route) in `src/components/nav/DashboardChrome.tsx`,
  **or** register a dynamic title at runtime with `useSubPageHeader`.
- Need a button in the bar (refresh, "+ new", a menu)? Pass it through
  `useSubPageHeader({ actions })` — don't build an in-body header row for it.
- Never hardcode the header height. Import `PAGE_HEADER_HEIGHT` /
  `STICKY_BELOW_HEADER` from `@/lib/design/tokens`.
- Use the shared `FONT` (Roboto) and `M3` tokens — no `Inter`, no `system-ui`
  stack, no `#EA4335`.

## The two headers (and one primitive)

There are exactly **two** header components. Keep it that way.

| Component | Where | Renders | Used on |
|-----------|-------|---------|---------|
| `DashboardHeader` (`src/app/dashboard/_shared/index.tsx`) | rendered by the two home pages | logo wordmark, search, role nav, messages / notifications / profile | the ZZP home (`ZzpDashboard`) and the accountant home (`AccountantHome`) only |
| `SubPageHeader` (`src/components/nav/SubPageHeader.tsx`) | mounted **once** by `DashboardChrome` in the dashboard layout | back chevron → canonical parent, `BoekBrug / {title}`, optional actions slot | every other `/dashboard/*` route |

`BackLink` (`src/components/ui/BackLink.tsx`) is the low-level back primitive
(`←  Terug`, resolves the parent from `src/lib/navigation.ts`). Prefer the
shared `SubPageHeader`; only reach for `BackLink` directly on a screen that is
deliberately outside the shared chrome.

Both header components and `BackLink` read their height, surface, border, font,
and accent from `@/lib/design/tokens`, so they stay visually identical.

### Where things sit in the bar

Both bars are full-bleed flex rows — they span the viewport, they are **not**
centred on the 480px page column, and the page column below them is centred as
usual. What keeps them looking like one bar is a single rule:

> The wordmark (and the back chevron) lead. Everything else — role nav links,
> messages, notifications, avatar, a page's `actions` — trails at the right
> edge. Exactly **one** cell in the row is flexible and absorbs the slack
> between the two groups: the **search** cell on the home bar, the **title**
> cell on the sub-page bar. Every other child is `flexShrink: 0`.

Get that wrong and the bar silently breaks on wide screens only. It did: the
home bar's search cell was capped at `maxWidth: 480` while `SearchBar` draws
itself at `maxWidth: 320`, so no child could grow past ~790px total. Beyond
that width the row simply stopped — the wordmark on the left edge, and the nav
link, the two icons and the avatar stranded in the middle of an otherwise empty
bar, while the same controls sat hard right on every sub-page. Give the
flexible cell `flex: 1, minWidth: 0` and **no** max width; cap the control
inside it instead, where the cap belongs.

## How the shared sub-page bar picks a title

`DashboardChrome` (`src/components/nav/DashboardChrome.tsx`) resolves the title
for the current path in this order:

1. A runtime config a page registered with `useSubPageHeader({ title })`
   (dynamic routes: invoice number, client name, …).
2. `STATIC_TITLES` — exact path → fixed label.
3. `PATTERN_TITLES` — a base label for a dynamic route template.

If none match, `DashboardChrome` renders nothing (that is how the two home
pages keep their own `DashboardHeader`, and how a truly standalone screen opts
out).

### Add a static title

```ts
// src/components/nav/DashboardChrome.tsx
const STATIC_TITLES = new Map<string, string>([
  // ...
  ["/dashboard/my-page", "My page"],
]);
```

### Add a dynamic title / an action

```tsx
import { useSubPageHeader } from "@/components/nav/SubPageHeaderContext";

// Inside the client component:
useSubPageHeader(
  {
    title: client.name,          // optional — overrides STATIC/PATTERN
    actions: <RefreshButton />,  // optional — right side of the bar
  },
  [client.name],                 // deps: re-apply when these change
);
```

The config is cleared automatically on unmount, so the next page starts clean.

## Design tokens

From `@/lib/design/tokens`:

- `PAGE_HEADER_HEIGHT` (`56`) — the height of both header bars.
- `STICKY_BELOW_HEADER` — `calc(56px + env(safe-area-inset-top))`; the `top:`
  value for a **secondary** sticky bar that must sit below the header (search /
  filter / sort toolbars on list screens). Never write the `calc()` by hand.
- `M3` — the Material palette (colours). `FONT` — Roboto. `FONT_NUM` — Roboto
  Mono for aligned numbers.

Secondary toolbar example:

```tsx
import { STICKY_BELOW_HEADER } from "@/lib/design/tokens";

<div style={{ position: "sticky", top: STICKY_BELOW_HEADER, zIndex: 40, /* … */ }}>
  {/* search / sort / filter controls */}
</div>
```

## Rules (what NOT to do)

- **No in-body title that repeats the bar.** If the shared bar already shows
  the page name, don't also render an `<h1>` with the same text. Keep a
  descriptive *subtitle* if it adds information; drop the duplicate title.
- **No second back button.** The bar's chevron is the one back affordance.
  Don't add an in-body `← Terug` / `arrow_back` / "Home" link.
- **No hardcoded `56`.** Use `PAGE_HEADER_HEIGHT` / `STICKY_BELOW_HEADER`.
- **No `maxWidth` on the bar's flexible cell.** It is what pushes the trailing
  controls to the right edge; a cap there strands them mid-bar on wide screens.
  Cap the control inside the cell instead. See "Where things sit in the bar".
- **No off-palette fonts or colours.** Use `FONT` (not `Inter`, not a
  `system-ui` stack) and `M3` (e.g. `M3.error` `#B3261E`, never `#EA4335`).
  This is not only about consistency: `#EA4335` measures 3.9:1 on white,
  `#34A853` 3.1:1 and `#E37400` 3.1:1 — all below the 4.5:1 an ordinary word
  needs. The `M3` values are the same hues taken dark enough to read. When you
  want the bright brand tone for a *fill* (a dot, a bar, a solid block, where
  3:1 applies), the tokens carry it as `M3.successFill` / `warningFill` /
  `errorFill`. See the header of `src/lib/design/tokens.ts`.
- **Don't add a third header component.** Extend `SubPageHeader` (or the
  `useSubPageHeader` actions slot) instead.
- **Both bars carry `viewTransitionName: 'page-header'`.** That is what holds
  the bar still while the page slides underneath it during a navigation. If you
  build a third sticky bar, give it the same name or the header will slide.
- **No `!important` on a shared element rule**, and be careful the other way
  too: an inline `style` beats a class, so anything a media query has to be
  able to change (a size, a `display`) must live in CSS, not inline. Both
  mistakes have bitten this codebase — see `docs/MOTION_SYSTEM.md`.

## Known intentional exceptions

These screens keep a bespoke header on purpose; touch them only with a
dedicated change, not a mechanical sweep:

- **`bestanden` (`BestandenPage`)** — a Drive-style bar with folder-history
  navigation and a search field in the title slot. Its back is folder-aware,
  not route-parent, so it can't use the generic bar as-is.
- **`invoice/[id]`** — keeps a *secondary* context toolbar (invoice number,
  status chip, actions, PDF) stacked below the shared bar. The shared bar still
  provides the back + generic "Factuur" title; the toolbar offsets with
  `STICKY_BELOW_HEADER`.

## History

The unification pass (see the `[HEADER-SYSTEM]` comments across the codebase)
collapsed 5+ ad-hoc header patterns onto the two components above: it removed
duplicate in-body titles on ~12 screens, retired hand-rolled back links, fixed
the only two font outliers (`waarheid` used Inter, `vandaag` used `system-ui`),
moved every colour/height onto tokens, and replaced the `56px` magic numbers
with `PAGE_HEADER_HEIGHT`.
