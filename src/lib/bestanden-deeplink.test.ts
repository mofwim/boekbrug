// [BESTANDEN-WIJS] Pure node test — run: npx tsx --test src/lib/bestanden-deeplink.test.ts
//
// The link that answers "where did my file go?". Both halves of this existed for months —
// /dashboard/bestanden reads ?folder= and ?focus=, and /api/intake sends the target saying in its
// own comment that it is "so the client can deep-link + focus" — and nothing joined them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bestandenDeepLink, targetFromIntake, BESTANDEN_PATH } from "./bestanden-deeplink";

test("[BESTANDEN-WIJS] the link opens the folder AND focuses the file", () => {
  const url = bestandenDeepLink({ documentId: "doc-1", folderId: "fold-9" });
  assert.equal(url, `${BESTANDEN_PATH}?folder=fold-9&focus=doc-1`);
  // Both parameters, because either alone is a worse answer than the sentence it replaces: a
  // folder with no focus drops the owner into two hundred files, and a focus with no folder makes
  // the screen find it without ever showing where it lives.
  assert.match(url ?? "", /folder=/);
  assert.match(url ?? "", /focus=/);

  // A file in the root is a real case, not a missing folder — `focus` still finds it.
  assert.equal(bestandenDeepLink({ documentId: "doc-1", folderId: null }), `${BESTANDEN_PATH}?focus=doc-1`);
});

test("[BESTANDEN-WIJS] no document id means NO link", () => {
  // The rule. Without an id there is nothing to focus, and a link that lands on the root of the
  // file tree looks like it worked while telling the owner nothing — worse than the plain sentence.
  assert.equal(bestandenDeepLink({ documentId: "", folderId: "fold-9" }), null);
  assert.equal(bestandenDeepLink({ documentId: "   ", folderId: "fold-9" }), null);
  assert.equal(bestandenDeepLink(null), null);
  assert.equal(bestandenDeepLink(undefined), null);
  // …and a folder on its own never earns one either.
  assert.equal(bestandenDeepLink({ documentId: "", folderId: null }), null);
});

test("[BESTANDEN-WIJS] both intake shapes are read — including the duplicate one", () => {
  // A stored document: the id is at the top level.
  assert.deepEqual(
    targetFromIntake({ ok: true, destination: "document", document_id: "doc-1", folder_id: "fold-9" }),
    { documentId: "doc-1", folderId: "fold-9" },
  );

  // A REFUSED duplicate: the file that matters is the one already there, so the id lives under
  // `existing`. This is the shape the upload screen never read — which is exactly why the row that
  // says "Dit bestand staat al in: 2026 / Q2 / april / Facturen" printed that path as dead text.
  assert.deepEqual(
    targetFromIntake({ duplicate: true, error: "Dit bestand staat al in: …", existing: { id: "doc-7", folder_id: "fold-3", folder_name: "Facturen" } }),
    { documentId: "doc-7", folderId: "fold-3" },
  );

  // Root-level duplicate.
  assert.deepEqual(
    targetFromIntake({ duplicate: true, existing: { id: "doc-7", folder_id: null } }),
    { documentId: "doc-7", folderId: null },
  );
});

test("[BESTANDEN-WIJS] a response with no target yields none, never a half one", () => {
  for (const junk of [null, undefined, {}, { ok: true }, { existing: null }, { existing: {} },
                      { document_id: 42 }, { existing: { id: 42 } }, "nonsense", []]) {
    assert.equal(targetFromIntake(junk), null, `${JSON.stringify(junk)} carries no target`);
  }
  // A folder without an id is not a target — the id is what makes it findable.
  assert.equal(targetFromIntake({ folder_id: "fold-9" }), null);
  assert.equal(targetFromIntake({ existing: { folder_id: "fold-9" } }), null);
});

test("[BESTANDEN-WIJS] an id that would break the URL is encoded, not pasted", () => {
  // Ids are uuids today. URLSearchParams is used anyway, because the day one is not a uuid is the
  // day a raw `&` in it silently becomes a second parameter and the focus is lost.
  const url = bestandenDeepLink({ documentId: "a&b=c", folderId: "x y" }) ?? "";
  assert.doesNotMatch(url.split("?")[1] ?? "", /[^=&]&[^=]*=[^&]*&/, "no smuggled parameters");
  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("focus"), "a&b=c", "the id survives the round trip intact");
  assert.equal(params.get("folder"), "x y");
});
