# Contributing to BoekBrug

## Language: English in the code, Dutch on the screen

**Everything a developer reads is English. Everything a Dutch entrepreneur reads stays Dutch.**

This is the one rule that applies to every change, from every contributor — human or AI agent.
It is not a style preference. BoekBrug is a Dutch bookkeeping app for Dutch freelancers, so the
words on screen are part of what the product *is*; the code around them is read by whoever
maintains it next, and that audience is not guaranteed to read Dutch.

### English — no exceptions

| Where | Example |
|---|---|
| Function, variable, type, constant and parameter names | `canAccessInvoice`, `SALES_SCREENS`, `ownerId` |
| Object and interface fields | `trailWritten`, `overdueAmount` |
| File and directory names under `src/lib/` | `acting-for.ts`, `sales-overview.ts` |
| Comments and doc comments, however long | see `src/lib/acting-for.ts` |
| Test names and assertion messages | `test("a revoked link grants nothing, immediately")` |
| Commit messages, branch names, PR titles and bodies | |
| New documentation in `docs/` | |

### Dutch — this is content, not code

Translating any of the following would change the product, so leave it in Dutch:

- UI text: button labels, screen headings, empty states, validation messages a user reads;
- PDF and e-mail text, and everything under `src/content/legal/`;
- URL segments (`/dashboard/verkoop`, `/dashboard/klanten`) — a user reads the address bar;
- values stored in the database (`role = 'verkoop'`, unit names such as `"uur"` and `"stuks"`).
  Renaming one of those is a **migration**, not a rename;
- Dutch domain terms with no English equivalent in this context: `btw`, `kvk`, `iban`,
  `aangifte`, `creditnota`, `zzp`. Keep them as they are; do not invent translations.

When a Dutch sentence has to live inside an English file — a user-facing error message, for
instance — add one line saying why. See the note at the top of `src/lib/owner-only.ts`.

### This rule is forward-looking

Large parts of the existing codebase are still Dutch inside. **Do not start a mass rename.**
Convert a file to English when you are already changing it for another reason, and put the
rename in its own commit so the real change stays reviewable.

## Gates before you push

Every change must pass all three, on the result of merging `main` into your branch:

```bash
git fetch origin main
git merge origin/main          # resolve conflicts on your branch, not on main
npx tsc --noEmit
npx tsx --test src/lib/*.test.ts src/content/legal/*.test.ts
npx next build
```

More than one session works on this repo at a time. Gates on your own branch prove that *your*
change works, not that the combination works — and the combination is what gets deployed.

AI agents working in this repo read the same rules from [`AGENTS.md`](./AGENTS.md).
