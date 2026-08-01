<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Language: English in the code, Dutch on the screen

**Everything a developer reads is English. Everything a Dutch entrepreneur reads stays Dutch.**
That line runs straight through the repo, and it is not a style preference — the product is a
Dutch bookkeeping app for Dutch freelancers, so its words on screen are part of what it is.

English — no exceptions:

- identifiers: functions, variables, types, constants, parameters, object fields;
- file and directory names under `src/lib/`;
- comments and doc comments, however long;
- test names (`test("…")`) and assertion messages;
- commit messages and PR titles/bodies;
- new documentation in `docs/`.

Dutch — these are content, not code, and translating them would change the product:

- UI text, button labels, screen headings, error messages shown to a user;
- PDF and e-mail text, and everything in `src/content/legal/`;
- URL segments (`/dashboard/verkoop`, `/dashboard/klanten`) — a user reads those;
- values stored in the database (`role = 'verkoop'`, unit names like `"uur"`, `"stuks"`) —
  renaming those is a migration, not a rename;
- Dutch domain terms that have no English equivalent in this context: `btw`, `kvk`, `iban`,
  `aangifte`, `creditnota`, `zzp`. Keep them as they are; do not invent translations.

When a Dutch sentence has to live inside an English file, say why in one line — see the note at
the top of `src/lib/owner-only.ts`.

**This rule is forward-looking.** Large parts of the existing codebase are still Dutch inside.
Do not start a mass rename. Convert a file to English when you are already changing it for
another reason, and keep the rename in its own commit so the real change stays readable.

# More than one session works on this repo

`main` moves while you work: another session merges its own branch, and sometimes it touches the
same file you do. That happened twice on 31 July, once with a real conflict in
`src/app/register/page.tsx`.

**Before you push to `main`: merge `main` into YOUR branch first and run the gates on the
result.**

```bash
git fetch origin main
git merge origin/main          # resolve conflicts here, not on main
npx tsc --noEmit
npx tsx --test src/lib/*.test.ts src/content/legal/*.test.ts
npx next build                 # without secrets — see LIVE_GAAN.md §0
```

Why this is not optional: gates on your own branch prove that YOUR change works, not that the
COMBINATION works — and the combination is what gets deployed. A merge that automerges cleanly
can still be broken (two sessions calling the same function differently produce no conflict, but
do produce a failure).

Two things that go with it:

- **A conflict is usually additive.** Two sessions improving the same screen rarely solve the
  same problem. Look at what each side DOES before picking one; the answer is often "keep both".
- **Then check that the merge did not silently eat anything.** An automerge also succeeds when it
  loses your block. Count your own markers (`grep -c "[YOUR-TAG]"`) in the files you touched, and
  look at the built HTML rather than the source where you can.
