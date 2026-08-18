// src/app/api/logboek/route.ts
// [LOGBOEK] The audit trail, read at last by the person it is about.
//
// audit_logs is written from 60 files across 89 distinct actions, and until now NO screen has ever
// rendered a single row of it. This route is the read side: the owner's own history, newest first,
// in pages, mapped through the one shared rule in src/lib/logboek.ts.
//
// ── WHY THE SESSION CLIENT, AND NOT service_role ──────────────────────────────────────────────
//
// Every other owner-facing read route in this app reaches for createPipelineClient() and pins each
// query to user.id by hand. This one deliberately does not, and the difference is the entire point
// of the feature.
//
// audit_logs.user_id is the ACTOR, not the subject. When a mandated bookkeeper issues an invoice in
// his client's name, reminds that client's debtors, or confirms an incoming invoice, every one of
// those rows carries the BOOKKEEPER's id. A hand-written `.eq("user_id", user.id)` would therefore
// hide from the owner exactly the half of the trail he cannot see anywhere else — the half he stays
// legally answerable for (art. 35a Wet OB, art. 52 AWR).
//
// What may be read is decided by the two RLS policies on the table instead: "Users see own logs"
// (his own actions) plus audit_logs_about_me (actions by SOMEONE ELSE on HIS administration,
// resolved per entity_type by audit_row_is_about_me() — an explicit list that answers false for
// anything it does not know, so a new entity_type starts closed). That rule is written down,
// reviewed and verifiable in SQL. A WHERE clause typed here would be a second, private copy of it
// that no migration review would ever see, and the two would drift.
//
// So: session client, no user filter, RLS decides. Running this on service_role would not add one
// useful row — it would only remove the wall that keeps another entrepreneur's trail out of the
// answer.
//
// That wall is the precondition for the query below having no WHERE clause at all, so it is worth
// naming: row level security is ENABLED on audit_logs (deployment check 1 in docs/DEPLOYMENT_v2.md
// asserts rls_enabled = TRUE for exactly this table). Turn it off and this route stops being a
// logbook and becomes a leak — which is the same sentence in reverse: the filter is not missing
// here, it lives in the database on purpose.
//
// ── [NO-SILENT-EMPTY] ─────────────────────────────────────────────────────────────────────────
//
// A failed read answers 503, never []. The screen has two different sentences for the two cases and
// they must never be swapped: log.leeg says "Er is nog niets gebeurd om te tonen", log.mislukt says
// "We konden je logboek niet lezen. Dit is geen 'er is niets gebeurd'". An empty `entries` array
// leaving this file is a CLAIM — that nothing happened in this administration — and a database
// hiccup is not allowed to make that claim on our behalf. This is the rule the whole feature exists
// to honour; a logbook that goes quiet when it breaks is worse than no logbook, because a quiet
// logbook is believed.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session-user";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { toLogboekEntry, type LogboekEntry } from "@/lib/logboek";

export const dynamic = "force-dynamic";

/** Rows per page. The screen loads more with log.meer; the cursor below is how it asks. */
const PAGE_SIZE = 50;

/**
 * The shape a `before` cursor must have, checked BEFORE it reaches PostgREST.
 *
 * The value is a timestamp string that came out of this same route (`nextCursor`), so it is checked
 * for shape and then passed through UNCHANGED — deliberately not through `new Date(...)`. Postgres
 * keeps microseconds; `toISOString()` keeps milliseconds. Normalising a cursor of
 * `…:00.123456+00:00` down to `…:00.123Z` would move the page boundary BACKWARDS in time, and every
 * row written in that sliver would be skipped over — silently, invisibly, one gap per page.
 */
const CURSOR_SHAPE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;

/** What the screen receives. `spoorOnvolledig` is OMITTED unless we actually established it. */
interface LogboekResponse {
  entries: LogboekEntry[];
  nextCursor: string | null;
  // Dutch field name, on purpose: it is the name of the sentence the screen renders for it
  // (message key log.spoorOnvolledig), and one name for one thing is worth more here than a
  // translated field that has to be looked up twice.
  spoorOnvolledig?: true;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // A cursor we cannot parse is a BAD REQUEST, not an unreadable log and not an empty page. Passing
  // it on would make PostgREST fail and this route answer 503 "log_unreadable", which would tell the
  // owner his trail is broken when only the link he clicked was.
  const before = req.nextUrl.searchParams.get("before");
  if (before !== null && !CURSOR_SHAPE.test(before)) {
    return NextResponse.json({ error: "bad_cursor" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Only the six columns the entry is built from. ip_address, old_value and new_value stay where
  // they are: nothing in LogboekEntry carries them, and a page of 50 audit payloads is a large
  // answer to send to a browser for fields it will not render.
  const base = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, created_at, user_id");

  const logQuery = (before === null ? base : base.lt("created_at", before))
    // created_at DESC with id DESC behind it: the tiebreak makes the order TOTAL, so two rows from
    // the same instant cannot swap places between two requests and appear twice, or not at all.
    // nullsFirst:false keeps a row with no timestamp (nothing writes one — created_at defaults in
    // the database — but the column is nullable) out of the front of the newest page, where it
    // would also produce a cursor of `null` and end paging on the first click.
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    // One more than a page: the extra row is how we know whether a next page exists, without a
    // second count query and without ever claiming "that was everything" on a guess.
    .limit(PAGE_SIZE + 1);

  // ── THE HONESTY PROBE ─────────────────────────────────────────────────────────────────────────
  //
  // audit_logs_about_me is a migration that has to be RUN. If it was never applied to this database
  // — or was dropped, or the SECURITY DEFINER function lost its search_path — then the old policy
  // ("Users see own logs", user_id = auth.uid()) is all that is left, and this route still answers
  // 200 with a perfectly normal-looking list. The owner sees his own actions, in the right order,
  // with the right timestamps, under a heading that says "Alles wat er in jouw administratie is
  // gebeurd — ook wat je boekhouder deed."
  //
  // That is the failure this feature must not be able to have. It is not an error, it is not empty,
  // it is not visibly wrong: it is a HALF trail presented as a whole one, and it is at its most
  // convincing exactly where it is most dangerous — for the owner whose bookkeeper acts in his name
  // and who opens this screen precisely to check what was done. A half truth about an audit trail is
  // worse than no trail, because a trail is only worth anything if its silence means something.
  //
  // So we ask one cheap question the owner may ask himself (accountant_clients_select: "the client
  // and the accountant can each still read the link"): is a bookkeeper linked to me at all? If yes,
  // and this page contains not one row authored by anyone else, then either the bookkeeper genuinely
  // has not touched anything yet, or that policy is not in place — and we cannot tell which from
  // here. The screen then says so (log.spoorOnvolledig) instead of implying completeness.
  //
  // Two boundaries on the claim, because the sentence it raises asserts something concrete ("Er
  // ontbreekt een instelling in de database") and must not be raised on a hunch:
  //
  //   · Only on the FIRST page. On page four, "no row by someone else here" says nothing at all —
  //     the bookkeeper's actions were most likely on page one, already read, already seen. Raising a
  //     misconfiguration warning there would be a false statement about a database we just watched
  //     work correctly.
  //   · Only when the link read SUCCEEDED. On an error we omit the flag entirely and never a
  //     `false`: we did not establish that things are fine, we established nothing. Asserting a
  //     misconfiguration you could not check is the same sin as hiding one you could.
  const linkProbe =
    before === null
      ? supabase.from("accountant_clients").select("id").eq("zzper_id", user.id).limit(1)
      : null;

  // Independent reads, so they go together — see [WATERVAL]. Neither needs the other's answer.
  const [{ data, error }, link] = await Promise.all([logQuery, linkProbe]);

  // [NO-SILENT-EMPTY] The one branch this whole file is built around.
  if (error) {
    console.error("[LOGBOEK] audit_logs read failed — refusing to answer with an empty log", {
      userId: user.id,
      before,
      error: error.message,
    });
    return NextResponse.json({ error: "log_unreadable" }, { status: 503 });
  }

  const fetched = data ?? [];
  let page = fetched.slice(0, PAGE_SIZE);
  let nextCursor: string | null = null;

  if (fetched.length > PAGE_SIZE) {
    // The first row we are NOT returning. Its timestamp is where the next page has to start.
    const firstUnseen = fetched[PAGE_SIZE];

    // A cursor that carries only a timestamp cannot split a group of rows that share one. The next
    // request asks for `created_at < cursor`, so any row of that group still sitting on this side of
    // the boundary would be asked for as "older than itself" and never come back — gone from the
    // trail, with nothing to show it was ever there.
    //
    // Rows are ordered DESC, so equal timestamps are contiguous at the tail of the page: dropping
    // every row that shares the boundary timestamp moves the cursor back to a value the group lies
    // entirely BELOW, and the next request returns all of them. A shorter page, and a complete one.
    const withoutBoundaryTies = page.filter((r) => r.created_at !== firstUnseen.created_at);

    if (withoutBoundaryTies.length > 0) {
      page = withoutBoundaryTies;
      nextCursor = page[page.length - 1].created_at;
    } else {
      // Every row of this page shares one timestamp — more than PAGE_SIZE audit rows written in the
      // same instant. logAuditAction() inserts one row per statement, so each gets its own now();
      // reaching this needs a bulk insert that does not exist today. Trimming here would hand back
      // an empty page, which under this route's own rule reads as "nothing happened" — so the full
      // page goes out, and the loss (the rest of that group) is loud in the server log rather than
      // silent on the screen. The fix if this ever fires is a keyset cursor of (created_at, id),
      // not a bigger page.
      console.error("[LOGBOEK] a whole page shares one created_at — cursor cannot split it", {
        userId: user.id,
        createdAt: firstUnseen.created_at,
      });
      nextCursor = firstUnseen.created_at;
    }

    if (nextCursor === null) {
      // The boundary row has no timestamp, so no cursor can point past it and paging stops here.
      // Say it out loud; a trail that quietly ends early is the same lie in a smaller size.
      console.error("[LOGBOEK] boundary row has no created_at — paging stops short", {
        userId: user.id,
      });
    }
  }

  // One shared rule for what a row MEANS — message key, kind, link, and whether someone else did it
  // (see src/lib/logboek.ts). Re-deriving any of that here would give the screen a second opinion.
  const entries: LogboekEntry[] = page.map((row) => toLogboekEntry(row, user.id));

  let hasBookkeeper: boolean | null = null;
  if (link !== null) {
    if (link.error) {
      console.error("[LOGBOEK] accountant link read failed — omitting the completeness flag", {
        userId: user.id,
        error: link.error.message,
      });
    } else {
      hasBookkeeper = (link.data ?? []).length > 0;
    }
  }

  const response: LogboekResponse = { entries, nextCursor };
  // byOther comes from toLogboekEntry, not from a second comparison written here — one definition of
  // "someone else did this", used by the screen and by this check alike.
  if (hasBookkeeper === true && !entries.some((e) => e.byOther)) {
    response.spoorOnvolledig = true;
  }

  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
