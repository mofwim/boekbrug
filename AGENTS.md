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

## The screen has more than one language now — the documents still do not

The app has published in four languages since the blog was built: 53 articles each in `nl`, `en`,
`ar` and `tr`, with an `/ar/blog` route and a locale table that knows Arabic is right-to-left. The
product was Dutch-only for a structural reason, not a linguistic one — that table lived in
`src/lib/blog.ts`, which reads the filesystem and may never be imported by a screen. It now lives
in `src/lib/i18n/locale.ts`, and `blog.ts` re-exports it.

So "Dutch on the screen" becomes: **Dutch is the SOURCE language of everything on screen, and the
screen may be shown in another one.**

- New user-facing text goes in `src/lib/i18n/messages.ts`, written in Dutch first. Dutch is
  required per key; other languages are optional and a gap falls back to Dutch — never to a key,
  never to a blank. A bookkeeping app with `sent.action.view` on a button is worse than one in a
  language the owner reads less comfortably.
- **A noun inside a sentence is not a parameter.** `Een verstuurde {woord} pas je niet aan` works
  in Dutch and breaks Arabic agreement and Turkish suffix harmony. Give the document type its own
  key per sentence.
- **A sentence that points at a button names the button as it is written.** While the nav still
  says `Facturen`, the Arabic sentence says `Facturen` too — otherwise the owner hunts for a word
  that is nowhere in the interface.
- **A component holds no language of its own.** Copy lives in a pure module (see
  `invoice-sent-notice.ts`), the component renders what it is handed, and text direction travels
  with the words on the same object. One hard-coded string left in a component is how a
  translation stays permanently half-finished — the screen still looks right in Dutch, so nothing
  points at the gap.
- Use `textAlign: 'end'` and `paddingInlineStart`, never `right`/`paddingLeft`. Physical sides are
  wrong in exactly one language, which is the one nobody checks.

**What is never translated, in any language:** the invoice PDF, the e-mail that carries it, the
e-factuur XML, and everything in `src/content/legal/`. Those are read by a Dutch customer, an
accountant and the Belastingdienst — not by the owner's language setting. Translating them would
change what the documents ARE, and would leave an owner sending a Dutch company a bill it cannot
book. Database values and URL segments stay Dutch for the reasons already given above.

The `[TAAL]` gates in `lifecycle-gates.test.ts` enforce the mechanical half of this: the vocabulary
stays importable, every key used exists, every key declared is rendered, and the translated panel
carries no Dutch of its own.

**The accountant module (`src/modules/accountant/`) is deliberately Dutch-only.** Its user is the
boekhouder — a Dutch professional reading Dutch administraties under Dutch law. The owner's
language setting describes the OWNER, and applying it to the accountant's screens would translate
an interface for someone who never chose a language. If a non-Dutch accountant ever becomes a real
audience, that is a product decision first and a translation second.

# More than one session works on this repo

`main` moves while you work: another session merges its own branch, and sometimes it touches the
same file you do. That happened twice on 31 July, once with a real conflict in
`src/app/register/page.tsx`.

**Before you push to `main`: merge `main` into YOUR branch first and run the gates on the
result.**

```bash
git fetch origin main
git merge origin/main          # resolve conflicts here, not on main
npm run gates                  # tsc · unit · render · eslint · build · smoke
```

`npm run gates` runs them in order and stops at the first failure. The individual steps are
`test:unit`, `test:render`, `test:e2e` in package.json; the build runs without secrets
(LIVE_GAAN.md §0).

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

# A green gate set does not mean the screen opens

`tsc`, `eslint` and `next build` never CALL a component, and the Playwright smoke test only sweeps
the public surface — every path the middleware lets through without a session. So a `/dashboard/*`
screen that throws on every render passes all of them.

That is not hypothetical. `/dashboard/incoming/manage` went through the entire set with a `const`
read seventy lines before it was declared, inside a `.filter()` callback that runs during render.
TypeScript does not model *when* a closure runs, so it type-checked; the build compiled it; the
smoke test never logs in. The screen would have been white with
`Cannot access 'onlyFlagged' before initialization` in the console.

`npm run test:render` (tests/render/) closes that class: it renders the money screens with
`react-dom/server` and asserts the output is not empty. Under a second, no browser, no session, no
database — the components take their data as props. **Hand it rows that exercise the branches**:
the same bug is invisible against an empty list, because `[].filter(cb)` never calls `cb`.

When you add a screen to this line, add it there.
