// src/app/api/bestanden/route.ts
// [BOEK-033] Bestanden API — folder contents, search, PATCH
// [BOEK-033] Smart structure: is_system + folder_type in select

import { NextRequest, NextResponse } from "next/server";
// [VOL-GELEZEN] PostgREST kapt stil af op ~1000 rijen — zie supabase-paginate.ts.
import { fetchAllRows } from "@/lib/supabase-paginate";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [TZ-SERVER] De klok van de eigenaar, niet die van de server — zie format-nl.ts.
import { amsterdamYear, amsterdamMonth } from "@/lib/format-nl";
import { searchBestanden, searchFolders, ensureSharedFolder } from "@/lib/bestanden";
import type { Database } from "@/types/database.types";

type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];
const FOLDER_SELECT = "id, user_id, name, parent_id, color, created_at, starred, is_system, folder_type";
const DOC_SELECT    = "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, starred, trashed, trashed_at, source, shared";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // The owner's own live files — the one filter every list below starts from, and the shape the
  // pager carries. Deriving the row type from the builder rather than restating DOC_SELECT keeps
  // the two from drifting: add a column to the select and this type follows it.
  const eigenBestanden = () =>
    supabase.from("documents").select(DOC_SELECT).eq("user_id", user.id).eq("trashed", false);
  type Bestand = NonNullable<Awaited<ReturnType<typeof eigenBestanden>>["data"]>[number];

  const p = req.nextUrl.searchParams;
  const search        = p.get("search") ?? "";
  const starred       = p.get("starred") === "true";
  // [BESTANDEN-SMART] Drive/OneDrive-style smart views. One flat, cross-folder
  // list of the owner's own documents, filtered by a virtual axis instead of a
  // folder. 'recent' = latest first (capped), 'starred' = favourites, 'shared'
  // = everything the accountant can see. All read-only over the same RLS-bound
  // documents table (own rows, trashed=false). No new tables, no writes.
  const view          = p.get("view"); // 'recent' | 'starred' | 'shared'
  const stats         = p.get("stats") === "true";
  const folderIdParam = p.get("folder_id");

  // ── Storage usage (count + total bytes of the owner's live files) ──
  // [BESTANDEN-SMART] Powers the sidebar storage meter. Sums file_size over the
  // owner's non-trashed documents — a single indexed scan (documents_user_created).
  if (stats) {
    // [VOL-GELEZEN] Gepagineerd. PostgREST kapt elk antwoord stil af op ~1000 rijen, en hier
    // vielen BEIDE getallen daarin: een eigenaar met 3.000 bestanden zag "1.000 bestanden" en de
    // opgetelde omvang van alleen die eerste duizend. Geen foutmelding, geen vlag — de meter
    // stond gewoon te laag, en te laag stelt gerust. De index waar de opmerking hieronder het
    // over had bestond wel; de rijlimiet was een andere grens.
    try {
      const rows = await fetchAllRows<{ file_size: number | null }>((from, to) =>
        supabase
          .from("documents").select("id, file_size")
          .eq("user_id", user.id).eq("trashed", false)
          .order("id", { ascending: true }).range(from, to),
      );
      const bytes = rows.reduce((sum, d) => sum + (d.file_size ?? 0), 0);
      return NextResponse.json({ count: rows.length, bytes });
    } catch (e) {
      // [NO-SILENT-EMPTY] fetchAllRows THROWS on a failed page — a half-read total is worse than
      // none, because nothing on the meter says it is half.
      return NextResponse.json({ error: e instanceof Error ? e.message : "stats_failed" }, { status: 500 });
    }
  }

  // ── Smart views: recent / starred / shared ──
  // [BESTANDEN-SMART] `starred=true` is the pre-existing param and stays working;
  // `view=starred` is its named alias. All three return the same { documents } shape
  // the client already renders for the starred/search lists.
  if (view === "recent" || view === "starred" || view === "shared" || starred) {
    try {
      // 'recent' is a CAPPED view by design — the latest 50, not everything — so it keeps its own
      // single-shot read. (.limit and .range are the same PostgREST knob; paging a cap is a
      // contradiction.) The other two are full lists and must be paged.
      if (view === "recent") {
        const { data, error } = await eigenBestanden()
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .limit(50);
        if (error) throw new Error(error.message);
        return NextResponse.json({ documents: data ?? [] });
      }
      // [VOL-GELEZEN] Gepagineerd, om dezelfde reden als de meter hierboven: PostgREST kapt stil
      // af op ~1000 rijen. Een eigenaar die drie jaar bonnen met de boekhouder deelt, opende
      // "Gedeeld" en zag er duizend — zonder foutmelding en zonder enige aanwijzing dat er meer
      // waren. Precies het bestand dat ontbreekt is dan het bestand dat hij zoekt.
      const documents = await fetchAllRows<Bestand>((from, to) => {
        const eigen = eigenBestanden();
        // Explicit `view` wins over the legacy `starred=true` alias, so ?view=shared
        // is never shadowed into the starred list.
        const gefilterd = view === "shared" ? eigen.eq("shared", true) : eigen.eq("starred", true);
        return gefilterd
          // created_at alone is not unique — two files uploaded in the same second could straddle
          // a page boundary, repeating one and dropping the other. id makes the order total.
          .order("created_at", { ascending: false }).order("id", { ascending: true })
          .range(from, to);
      });
      return NextResponse.json({ documents });
    } catch (e) {
      // [NO-SILENT-EMPTY] fetchAllRows THROWS on a failed page. A half-read list is worse than an
      // error, because a list of files carries no sign of being half.
      return NextResponse.json({ error: e instanceof Error ? e.message : "Fout" }, { status: 500 });
    }
  }

  // ── Search ── (documents + folders)
  if (search.trim()) {
    try {
      const [results, folders] = await Promise.all([
        searchBestanden(user.id, search),
        searchFolders(user.id, search),
      ]);
      return NextResponse.json({ results, folders });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Fout" }, { status: 500 });
    }
  }

  // ── Normal folder contents ──
  const folderId = folderIdParam === "root" || !folderIdParam ? null : folderIdParam;

  try {
    await ensureSharedFolder(user.id);

    // Folders — include is_system + folder_type
    let folderQ = supabase
      .from("folders").select(FOLDER_SELECT)
      .eq("user_id", user.id).order("name", { ascending: true });
    if (folderId === null) folderQ = folderQ.is("parent_id", null);
    else folderQ = folderQ.eq("parent_id", folderId);
    const { data: folders, error: fErr } = await folderQ;
    if (fErr) throw new Error(fErr.message);

    // Documents — exclude trashed
    // [VOL-GELEZEN] Gepagineerd. Dit is de gewone mapinhoud: het scherm dat de eigenaar opent om
    // te kijken of iets er is. De stille rijlimiet van PostgREST maakte daar "bestaat niet" van
    // zodra één map over de duizend ging — en de map die daaroverheen gaat is altijd de map
    // waar alles in staat, want dat is waarom hij er zoveel in heeft.
    const documents = await fetchAllRows<Bestand>((from, to) => {
      const eigen = eigenBestanden();
      const inMap = folderId === null ? eigen.is("folder_id", null) : eigen.eq("folder_id", folderId);
      // Zie de smart views hierboven: created_at alleen is niet uniek, id maakt de volgorde totaal.
      return inMap
        .order("created_at", { ascending: false }).order("id", { ascending: true })
        .range(from, to);
    });

    return NextResponse.json({ folders: folders ?? [], documents });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fout" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const docId = req.nextUrl.searchParams.get("id");
  if (!docId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as {
    folder_id?: string | null;
    file_name?: string;
    starred?: boolean;
    trashed?: boolean;
    // [BRUG-FILES-SHARED] Explicit share toggle (the "Delen met boekhouder" button).
    // shared=true makes the file visible to the accountant WITHOUT moving it — the
    // file stays in its original folder. shared=false un-shares it. period/year are
    // set automatically when sharing so the closing-package ZIP can place it.
    shared?: boolean;
    // [FIN-9] Optional quarter the owner is sharing FOR ('YYYY-Qn'). When present
    // it overrides the current-quarter default so a receipt shared after its
    // quarter closes still lands in the right closing package.
    period?: string;
  };

  const patch: DocumentUpdate = {};
  // [L7] Ignore blank/whitespace renames — a file must keep a non-empty name.
  if (typeof body.file_name === "string" && body.file_name.trim()) patch.file_name = body.file_name.trim();
  if (typeof body.starred === "boolean")   patch.starred   = body.starred;
  if (typeof body.trashed === "boolean") {
    patch.trashed    = body.trashed;
    patch.trashed_at = body.trashed ? new Date().toISOString() : null;
  }

  // [FIN-9 / FIN-QUARTER] Resolve which quarter to stamp when a file BECOMES shared.
  // The closing-package ZIP selects shared docs by documents.period ('YYYY-Qn').
  // documents.period is best-effort: it is set at UPLOAD time (upload-quarter), not
  // from the receipt's own date — no classification step re-derives it. So this is NOT
  // guaranteed to be the receipt's economic quarter; it is simply the best signal we
  // have, and the point of this helper is to STOP a share from overwriting it with
  // "today" (which silently moved a Q1-uploaded receipt into the current quarter's
  // package). Priority, most trustworthy first:
  //   1. explicit body.period the owner chose (FIN-9 quarter picker, if wired),
  //   2. the document's OWN existing period (preserve — never clobber with today),
  //   3. current quarter, only when the document has no valid period yet.
  // Returns null → "do not touch period" (e.g. bank statements own their own axis).
  // Memoised so both share paths (explicit toggle + magic folder) share one lookup.
  let sharePeriodResolved = false;
  let sharePeriodCache: { period: string; year: number } | null = null;
  const resolveSharePeriod = async (): Promise<{ period: string; year: number } | null> => {
    if (sharePeriodResolved) return sharePeriodCache;
    sharePeriodResolved = true;
    const QRE = /^\d{4}-Q[1-4]$/;
    if (typeof body.period === "string" && QRE.test(body.period)) {
      sharePeriodCache = { period: body.period, year: Number(body.period.slice(0, 4)) };
      return sharePeriodCache;
    }
    const { data: doc } = await supabase
      .from("documents").select("period, year, doc_type")
      .eq("id", docId).eq("user_id", user.id).maybeSingle();
    // [FIN-QUARTER] Bank statements are keyed by their transaction-date period (set at
    // ingest); the closing package matches them on that axis (or a period-NULL legacy
    // fallback). Re-stamping here would knock a statement out of its correct quarter,
    // so leave a bankafschrift's period untouched entirely.
    if (doc?.doc_type === "bankafschrift") { sharePeriodCache = null; return null; }
    if (doc?.period && QRE.test(doc.period)) {
      sharePeriodCache = { period: doc.period, year: doc.year ?? Number(doc.period.slice(0, 4)) };
      return sharePeriodCache;
    }
    // [TZ-SERVER] Het kwartaal van de EIGENAAR. Deze periode is niet cosmetisch: het
    // kwartaalpakket plaatst een gedeeld bestand op precies dit veld. Met de serverklok belandde
    // een bon die in het eerste uur van een nieuw kwartaal wordt gedeeld in het VORIGE kwartaal —
    // dus in het pakket dat de boekhouder al kan hebben afgesloten, en niet in het pakket waar hij
    // hoort. Bewijs in het verkeerde kwartaal is precies wat dit veld moet voorkomen.
    const y = amsterdamYear();
    sharePeriodCache = { period: `${y}-Q${Math.ceil(amsterdamMonth() / 3)}`, year: y };
    return sharePeriodCache;
  };

  // [BRUG-FILES-SHARED] Explicit share toggle. A file can be shared (or un-shared)
  // in place via the "Delen met boekhouder" / "Niet meer delen" button — no move.
  // When sharing, stamp its best-known quarter (see resolveSharePeriod) so the ZIP places it.
  if (typeof body.shared === "boolean") {
    patch.shared = body.shared;
    if (body.shared) {
      const sp = await resolveSharePeriod();
      if (sp) { patch.period = sp.period; patch.year = sp.year; }
    }
  }

  // [BRUG-FILES-SHARED] Magic shared folder. Moving a file INTO the "Gedeeld met
  // boekhouder" folder (folder_type='shared') auto-shares it (shared=true + current
  // quarter). Moving it elsewhere does NOT un-share — un-sharing is an explicit
  // action (the toggle above), so an ordinary reorganizing move never silently
  // removes the accountant's access.
  if ("folder_id" in body) {
    const newFolderId = body.folder_id ?? null;
    patch.folder_id = newFolderId;

    let isSharedTarget = false;
    if (newFolderId) {
      const { data: folder } = await supabase
        .from("folders")
        .select("folder_type")
        .eq("id", newFolderId)
        .eq("user_id", user.id)
        .maybeSingle();
      isSharedTarget = folder?.folder_type === "shared";
    }

    // [FIN-QUARTER/M4] Auto-share on a move INTO the shared folder — but never override
    // an explicit un-share in the SAME request. If the body said shared:false, that wins
    // (a contradictory move does not silently re-grant the accountant access).
    if (isSharedTarget && body.shared !== false) {
      // Preserve the file's best-known quarter (see resolveSharePeriod) instead of
      // stamping "today"; null → leave period untouched (e.g. bank statements).
      const sp = await resolveSharePeriod();
      patch.shared = true;
      if (sp) { patch.period = sp.period; patch.year = sp.year; }
    }
    // else: plain move (or explicit un-share) — leave shared as set above.
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("documents")
    .update(patch).eq("id", docId).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}