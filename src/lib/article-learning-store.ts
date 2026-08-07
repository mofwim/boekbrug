// src/lib/article-learning-store.ts
// [ARTIKEL-LEREN] The writing half: read the catalog, apply the plan from article-learning.ts.
// The DECISION lives there and is tested there; this file only performs it.
//
// WHY IT IS A MODULE AND NOT A HELPER IN A ROUTE
// It started as a local function in /api/invoice/draft, under the belief that a draft is the only
// place a human types invoice lines for the first time. That was wrong: PUT /api/invoice/[id]
// REPLACES a draft's lines wholesale, so every line added on the edit screen is newly typed text —
// and for many owners that is the ordinary route (a quick draft, finished properly afterwards).
//
// The moment a second door needed it, copying the function was the obvious move and the wrong one.
// Two copies of a rule drift, and they drift without a single test turning red — which is the same
// defect this codebase has been digging out of the skipped-import panel and the ai_doc_type column.
// So it moved here, once, and both doors call it.

import { planCatalogLearning, documentTeachesCatalog, type LearnableLine } from "./article-learning";

/**
 * The client to write with. It must be able to read and write `articles` for `ownerId` — for an
 * owner that is the ordinary RLS client, but a verkoopmedewerker needs the service-role one,
 * because `articles` carries no policy for an employee (see the note in /api/articles). Choosing
 * is the caller's job; the ownership scoping below is not, and is applied on every statement here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArticleStoreClient = any;

/**
 * Teach the line-item catalog what a document just said.
 *
 * BEST-EFFORT BY CONSTRUCTION. Every failure path is a `return`, never a throw, and nothing here
 * can answer the browser. Both callers run this AFTER the invoice and its lines are safely written,
 * so there is nothing left that a failure could usefully abort — and a catalog is a convenience
 * beside an invoice, never a condition for one.
 *
 * Silence is not the same as safety, so every give-up logs why.
 */
export async function learnFromLines(args: {
  db: ArticleStoreClient;
  ownerId: string;
  /** `invoices.invoice_type` or the route's own word for it — documentTeachesCatalog knows both. */
  documentKind: string;
  lines: LearnableLine[];
}): Promise<void> {
  const { db, ownerId, documentKind, lines } = args;
  try {
    if (!documentTeachesCatalog(documentKind)) return;

    // [NO-SILENT-EMPTY] The error is read, and this is the one failure here that damages data
    // rather than merely skipping a nicety. supabase-js does not throw: `const { data }` on a
    // failed read gives null, `?? []` reads as "the catalog is empty", and then EVERY line looks
    // new — inserting a duplicate of the owner's ENTIRE catalog on one bad connection.
    const { data: catalog, error: catalogErr } = await db
      .from("articles")
      .select("id, description, usage_count, active")
      .eq("user_id", ownerId);
    if (catalogErr) {
      console.error("[ARTIKEL-LEREN] catalogus niet gelezen — niets geleerd van dit document", catalogErr);
      return;
    }

    const plan = planCatalogLearning(lines, catalog ?? []);
    if (plan.dropped > 0) {
      // A cap the owner cannot see reads as "everything was remembered". It should never fire on a
      // document a human typed; if it does, that is worth knowing rather than absorbing.
      console.warn("[ARTIKEL-LEREN] regels buiten de limiet gevallen", { dropped: plan.dropped, ownerId });
    }

    if (plan.toInsert.length > 0) {
      const { error: insErr } = await db
        .from("articles")
        .insert(plan.toInsert.map((a) => ({ user_id: ownerId, ...a })));
      if (insErr) console.error("[ARTIKEL-LEREN] nieuwe artikelen niet opgeslagen", insErr);
    }

    // The bump is what makes "meest gebruikt eerst" mean anything. There is no atomic increment
    // available here, and a lost race only misorders a suggestion list — so a read-modify-write is
    // the right trade, exactly as PATCH /api/articles/[id] already does it.
    await Promise.allSettled(
      plan.toBump.map((b) =>
        db.from("articles")
          .update({ usage_count: (b.usage_count ?? 0) + 1 })
          .eq("id", b.id).eq("user_id", ownerId),
      ),
    );
  } catch (e) {
    console.error("[ARTIKEL-LEREN] onverwacht — het document zelf staat er gewoon", e);
  }
}
