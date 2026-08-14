// src/app/api/cash/route.ts
// [CASH-LEDGER] The cash book (kasadministratie). User-scoped via the RLS server client.
//
// GET    → all cash entries (newest first) + the running kas balance.
// POST   → add one entry (a cash sale, a cash expense, a deposit/withdrawal, …).
// DELETE → remove one entry (?id=).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [KAS-VOCABULAIRE] isCashCategory says the word exists; closedCashCategoryReason says whether it is
// the OWNER's to write, and why not — see the block above OWNER_CASH_CATEGORIES in cash.ts.
import { computeDrawerBalance, isCashCategory, closedCashCategoryReason } from "@/lib/cash";
// [PAY-DATE-SANE] one tested window for every date that lands in the kasboek — see payment-date.ts
import { paymentDateOutOfWindow } from "@/lib/payment-date";
import { amsterdamToday } from "@/lib/format-nl";
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { round2 } from "@/lib/invoice-totals";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "@/lib/cash-live";
// [KAS-SPOOR] The drawer's three write doors were the only money writes in the app that left no
// audit row — see the block above 'cash.entry_added' in audit.ts for why that is the worst ledger
// to leave untraced.
import { logAuditAction, getClientIP } from "@/lib/audit";

// [KAS-SALDO] Never a cached drawer. Every sibling money route declares this (/api/kasboek,
// /api/readiness, /api/aangifte …) and this one did not. Reading cookies already forces the route
// dynamic today, so this changes nothing at runtime — it removes the possibility that a later
// refactor (a read moved off the session client, a framework default that flips) turns the balance
// in someone's till into a figure served from a cache, which on this endpoint is a wrong number
// presented as a counted one.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [CASH-SETTLE] Before reading, make the kasboek reflect every invoice paid in cash — no
  // matter which pay path booked it. Self-healing + best-effort (never blocks the read).
  //
  // The summary is checked rather than discarded. `ok: false` means the pass BAILED — it read
  // nothing it could trust, so it created, healed and reversed nothing — and the drawer below is
  // then whatever the last successful pass left. One bad run is harmless (the next read heals
  // it), but a run that keeps bailing is a kasboek that silently stops following its invoices,
  // and nothing anywhere said so. It stays non-blocking: the entries and the saldo are still
  // real rows, and refusing to show them would be worse than showing them slightly stale.
  const settleSync = await reconcileCashSettlements(supabase, user.id);
  if (!settleSync.ok) {
    console.error("[CASH-SETTLE] reconcile bailed before the kasboek read — settlements may be stale", { userId: user.id });
  }

  // [SEARCH-FULL-LEDGER] Return the WHOLE cash book, not the newest 500. The in-page zoekbalk filters
  // this array client-side (op omschrijving / categorie / bedrag), so a 500-row slice made every entry
  // older than the newest 500 UNFINDABLE — a silent "geen resultaten" that reads as "bestaat niet".
  // Page past the ~1000-row PostgREST cap with a stable id order, then sort newest-first for display.
  // This same full read also feeds the saldo below, so it replaces the separate movements fetch (one
  // scan instead of two).
  // [KAS-ZACHT] The ledger the owner sees and the saldo above it: live movements only. A removed
  // line is out of the books — it is disclosed per quarter in the kasboek panel, not counted here.
  const liveCash = await liveCashEntries(supabase);
  const allEntries = await fetchAllRows<{
    id: string; entry_date: string; created_at: string | null; direction: string;
    amount: number | null; category: string; description: string | null; document_id: string | null; btw_rate: number | null;
  }>((from, to) =>
    liveCash.only(supabase
      .from("cash_entries")
      .select("id, entry_date, created_at, direction, amount, category, description, document_id, btw_rate")
      .eq("user_id", user.id))
      .order("id", { ascending: true })
      .range(from, to),
  );
  const entries = [...allEntries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1; // newest date first
    const ac = a.created_at ?? "", bc = b.created_at ?? "";
    return ac < bc ? 1 : ac > bc ? -1 : 0; // then newest created_at first
  });

  // [KAS-SALDO] The headline "SALDO IN KASSA" must match the Kasboek panel's definition on the same
  // screen: the till's daily CASH takings (daily_turnover.cash_amount) are cash that entered the
  // drawer and are counted as ontvangsten in buildKasboek — but they live in daily_turnover, NOT in
  // cash_entries, so summing cash_entries alone understates the drawer (and shows a false negative
  // "meer uitgaven dan ontvangsten" alarm for every till shop). Sum BOTH sources over the FULL
  // history (allEntries above) — a truncated balance is itself a wrong number.
  const allMoves = allEntries;
  const tillRows = await fetchAllRows((from, to) =>
    // [KAS-DUBBELTELLING] turnover_date hoort erbij: zonder de datum kan het saldo niet zien welke
    // dag de kassa al heeft geteld, en telt het diezelfde omzet nog een keer uit cash_entries.
    supabase.from("daily_turnover").select("turnover_date, cash_amount").eq("user_id", user.id).order("turnover_date", { ascending: true }).range(from, to),
  );
  // [KAS-OPENING] Add the drawer's starting float (beginsaldo) so the saldo matches reality from
  // day one — a shop that began with cash in the till isn't understated by that amount.
  // [COHERENCE-ERRSTATE] The error is read. A swallowed one becomes a €0 float, which understates
  // the headline "SALDO IN KASSA" by exactly the money the shop started its till with — and the
  // screen shows that figure with full confidence. Failing the read is the honest answer: the
  // client already distinguishes a failed load from an empty drawer and shows '—'.
  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("kas_opening_balance")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) {
    return NextResponse.json({ error: "opening_balance_lookup_failed", detail: profErr.message }, { status: 500 });
  }
  const opening = Number((prof as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;

  // [KAS-SALDO] One shared definition (computeDrawerBalance) so this page and the home snapshot
  // can never diverge: opening float + cash_entries net + till daily-cash takings.
  const balance = computeDrawerBalance({
    openingBalance: opening,
    entries: (allMoves as { direction: string; amount: number | null; entry_date?: string | null; category?: string | null }[])
      .map((e) => ({ direction: e.direction === "in" ? "in" : "out", amount: e.amount, date: e.entry_date ?? null, category: e.category ?? null })),
    tillDays: (tillRows as { turnover_date: string | null; cash_amount: number | null }[])
      .map((t) => ({ date: t.turnover_date, cash_amount: t.cash_amount })),
  });

  return NextResponse.json({ ok: true, entries, balance, openingBalance: opening, count: entries.length });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    entry_date?: string; direction?: string; amount?: number; category?: string; description?: string; btw_rate?: number; document_id?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }

  const direction = body.direction;
  const rawAmount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const category = body.category;

  if (direction !== "in" && direction !== "out") {
    return NextResponse.json({ error: "direction moet 'in' of 'out' zijn" }, { status: 400 });
  }
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return NextResponse.json({ error: "amount moet groter dan 0 zijn" }, { status: 400 });
  }
  // [KAS-CENTEN] A drawer is counted in coins. cash_entries.amount is an unconstrained `numeric`,
  // so whatever arrives is stored verbatim — and 12.3456789 then rides the RUNNING balance through
  // every following day, into the Kasboek sheet the accountant receives and into the eindsaldo the
  // filing gate compares against zero. The opening balance is already rounded at this door (PATCH
  // below); a movement is the same kind of money and gets the same treatment. Rounded AFTER the
  // >0 test so a sub-cent amount is refused rather than silently becoming €0.
  const amount = round2(rawAmount);
  if (!isCashCategory(category)) {
    return NextResponse.json({ error: "ongeldige categorie" }, { status: 400 });
  }
  // [KAS-VOCABULAIRE] Three of the eight categories are not the owner's to write, for three
  // different reasons — all of them argued at OWNER_CASH_CATEGORIES in cash.ts, which is the single
  // list this door asserts against. The reasons decide the sentence; the list decides the refusal, so
  // the two cannot drift apart the way an inline string check eventually does.
  const closed = closedCashCategoryReason(category);
  if (closed) {
    return NextResponse.json(
      closed === "system_managed"
        ? {
            // [CASH-SETTLE-NO-MANUAL-DELETE] A hand-written 'betaling' has no invoice_id: no
            // reconcile can see it, so nothing recreates it and nothing removes it, and the DELETE
            // guard below refuses it on its label. An unremovable line in a cash administration.
            error: "settlement_category",
            detail:
              "Een 'betaling' hoort bij een factuur die contant is betaald en wordt automatisch geboekt. " +
              "Markeer de factuur als contant betaald; dan verschijnt deze regel zelf in je kasboek.",
          }
        : {
            // 'tax' / 'fee': the cash side of the result engine does not count them, so a row like
            // this would sit in the drawer and in NO cost total — a silent hole rather than a
            // booking. Say what it is and where it does belong today.
            error: "category_not_counted",
            detail:
              "Belasting en bankkosten kun je (nog) niet als kasboeking vastleggen: ze zouden wel in " +
              "je kassaldo staan maar in geen enkel kostentotaal, en dan klopt je resultaat niet. " +
              "Boek een contante uitgave als 'Kost'; bankkosten komen automatisch mee via je bankregels.",
          },
      { status: 400 },
    );
  }

  // entry_date: accept a valid YYYY-MM-DD, else let the DB default to today.
  //
  // [CASH-DATE-SANE] The shape test alone let "2062-03-01" (a slipped digit in a date field)
  // through, and a cash entry carries a running balance: one impossible date drags the drawer's
  // eindsaldo along with it into a quarter that does not exist yet, and shows up in the kasboek
  // an inspector reads. The window is deliberately generous — anything a person could plausibly
  // mean is accepted, only the physically impossible is refused. Tomorrow is allowed because a
  // device clock or a timezone edge can legitimately be a day ahead.
  //
  // [PAY-DATE-SANE] The window itself now lives in one tested place (payment-date.ts), because
  // this is not the only door into this drawer: marking an inkoopfactuur "Contant betaald" writes
  // a dated cash entry through /api/invoice/pay-toggle, which had no ceiling at all. Two doors,
  // one kasboek — so one rule. Amsterdam's day, not UTC's: the client fills this field from an
  // Amsterdam-pinned today (KasClient.todayIso), so a UTC ceiling would be a different day for
  // part of the evening — and the one it would refuse is the owner's actual today.
  // An ABSENT or empty field still means "no date given" — the DB default (today) then applies,
  // exactly as before. Only a date the caller actually filled in is judged.
  const rawDate = typeof body.entry_date === "string" && body.entry_date.trim() !== ""
    ? body.entry_date.trim()
    : undefined;
  if (rawDate && paymentDateOutOfWindow(rawDate, amsterdamToday())) {
    return NextResponse.json(
      { error: "Controleer de datum — een kasboeking kan niet in de toekomst liggen." },
      { status: 400 },
    );
  }
  const entryDate = rawDate;

  // [CASH-COST-VAT] Verify the linked bon is a document THIS user owns before trusting it — an
  // unowned/forged document_id must never unlock a voorbelasting deduction (a real, wrong number
  // on the aangifte). Null it (and, below, the rate) when it isn't the owner's.
  let documentId: string | null = null;
  if (typeof body.document_id === "string" && body.document_id.length > 0) {
    const { data: doc } = await supabase
      .from("documents").select("id").eq("id", body.document_id).eq("user_id", user.id).maybeSingle();
    if (doc) documentId = body.document_id;
  }

  // [CASH-COST-VAT] A BTW rate is accepted on a cash SALE (omzet), OR on a cash COST (kosten) ONLY
  // when it carries an owned bon — the universal "no voorbelasting without a document" rule. On any
  // other category (salaris, prive, transfer, tax, fee) the rate is forced null (wages/transfers
  // carry no reclaimable BTW). Without a document a cost's rate is dropped → it books at full gross.
  const rateAllowed = category === "omzet" || (category === "kosten" && documentId !== null);
  const btwRate = rateAllowed && [0, 9, 21].includes(Number(body.btw_rate))
    ? Number(body.btw_rate)
    : null;

  const { data, error } = await supabase
    .from("cash_entries")
    .insert({
      user_id: user.id,
      direction,
      amount,
      category,
      description: body.description?.trim() || null,
      btw_rate: btwRate,
      ...(documentId ? { document_id: documentId } : {}),
      ...(entryDate ? { entry_date: entryDate } : {}),
    })
    .select("id, entry_date, direction, amount, category, description, document_id")
    .single();

  if (error) {
    return NextResponse.json({ error: "kon kasboeking niet opslaan" }, { status: 500 });
  }

  // [KAS-SPOOR] A cash movement is the only money row in this administration with nothing behind
  // it — no bank line, no supplier document, no Z-report. What it says is what the owner typed. The
  // date is recorded as well as the amount because a backdated entry is what moves money between
  // quarters, and the drawer decides whether a quarter may be filed at all.
  const created = data as { id?: string; entry_date?: string | null } | null;
  await logAuditAction({
    userId: user.id,
    action: "cash.entry_added",
    entityType: "cash_entry",
    entityId: created?.id,
    newValue: {
      entry_date: created?.entry_date ?? entryDate ?? null,
      direction, amount, category,
      btw_rate: btwRate,
      document_id: documentId,
      // The owner's own words, kept: on a hard-deleted ledger the trail has to be able to say WHAT
      // the line was, not merely that there was one. The invoice routes log their whole payload for
      // the same reason, and sanitizeForAudit already strips anything secret and caps the size.
      description: body.description?.trim() || null,
    },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, entry: data });
}

// [KAS-OPENING] Set the drawer's opening balance (beginsaldo). A config value, not a movement —
// it is added to the saldo, never counted as omzet/BTW. Audited via the standard invoice/status
// trail is overkill for a config; a simple owner-scoped update on their own profile suffices (RLS).
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { kas_opening_balance?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const val = typeof body.kas_opening_balance === "number" ? body.kas_opening_balance : Number(body.kas_opening_balance);
  if (!Number.isFinite(val) || val < 0) {
    return NextResponse.json({ error: "beginsaldo moet 0 of hoger zijn" }, { status: 400 });
  }
  const opening = round2(val);

  // [KAS-SPOOR] Read what it WAS before overwriting it. An audit row saying "set to €2.000" answers
  // nothing on its own — the whole question about a starting float is what it used to be, because
  // this single number shifts every eindsaldo in the owner's entire history, including quarters
  // already filed, and it is the seed lowestDrawerPoint compares against zero. A failed read must
  // not block the owner from correcting their float, but it must not be recorded as "it was €0"
  // either: that would be an audit row asserting a change that never happened.
  const { data: before, error: beforeErr } = await supabase
    .from("profiles")
    .select("kas_opening_balance")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ kas_opening_balance: opening } as never)
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: "kon beginsaldo niet opslaan" }, { status: 500 });

  await logAuditAction({
    userId: user.id,
    action: "cash.opening_balance_set",
    entityType: "cash_drawer",
    entityId: user.id,
    oldValue: beforeErr
      ? { kas_opening_balance: null, previous_value_unknown: true, read_error: beforeErr.message }
      : { kas_opening_balance: Number((before as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0 },
    newValue: { kas_opening_balance: opening },
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, openingBalance: opening });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // [CASH-SETTLE-NO-MANUAL-DELETE] A 'betaling' row is not an entry the owner wrote — it is the
  // DERIVED drawer movement of an invoice paid in cash, maintained by reconcileCashSettlements.
  // Deleting it used to succeed, and then the very next GET recreated it (that reconcile runs
  // before every read, and computeCashSettlementSync books any wanted settlement it cannot find).
  // So the row vanished and came straight back within one interaction, with nothing said — the
  // owner's reasonable conclusion being that the page is broken.
  //
  // Refusing is the honest answer, because the entry genuinely follows the invoice: the way to
  // remove it is to undo that invoice's cash payment, and then the reconciler removes this row
  // itself. RLS already scopes the read to the owner.
  //
  // The error is READ, not ignored. It used to be dropped (`const { data: existing }`), so a
  // failed lookup left `existing` null, the guard below never matched, and the delete went
  // through — landing on exactly the behaviour this guard exists to prevent: the row disappears,
  // the next GET's reconcile puts it straight back, and nothing explains it.
  //
  // The guard reads the INVOICE LINK, not just the label. Refusing on `category === 'betaling'`
  // alone also refused a 'betaling' row with no invoice_id — a row no reconcile can see (it reads
  // `.not("invoice_id", "is", null)`), so nothing recreates it and nothing removes it either. The
  // sentence below then told the owner to undo a payment on a factuur that does not exist, about a
  // line they could not get out of their cash book by any route. The label is what it LOOKS like;
  // the link is what actually makes it derived.
  //
  // [KAS-SPOOR] The whole row is read, not just the two fields the guard needs. This is a HARD
  // delete — cash_entries keeps no reversal row — so the audit entry below is the only place that
  // will ever say this movement existed, and a trail that records "a cash entry was removed"
  // without its date, amount and description cannot answer the question anyone would actually ask.
  // [KAS-ZACHT] Live rows only: removing an already-removed movement is not an error to explain,
  // it is a row that is no longer in the books — the same 404 as an id that never existed.
  const liveForDelete = await liveCashEntries(supabase);
  const { data: existing, error: readErr } = await liveForDelete.only(supabase
    .from("cash_entries")
    .select("category, invoice_id, entry_date, direction, amount, description, btw_rate, document_id")
    .eq("id", id)
    .eq("user_id", user.id))
    .maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { error: "lookup_failed", detail: "We konden deze boeking nu niet opzoeken. Probeer het zo meteen opnieuw." },
      { status: 500 },
    );
  }
  const row = existing as {
    category?: string | null; invoice_id?: string | null; entry_date?: string | null;
    direction?: string | null; amount?: number | null; description?: string | null;
    btw_rate?: number | null; document_id?: string | null;
  } | null;
  if (row?.category === "betaling" && row.invoice_id) {
    return NextResponse.json(
      {
        error: "settlement_entry",
        detail:
          "Deze regel hoort bij een factuur die contant is betaald en volgt die factuur automatisch. " +
          "Draai de betaling van de factuur terug; dan verdwijnt deze regel vanzelf uit je kasboek.",
      },
      { status: 409 },
    );
  }

  // ── [KAS-ZACHT] Removed from the books, not destroyed ────────────────────────────────────────
  //
  // A real bookkeeping system reverses; it does not delete. Every other ledger here already works
  // that way — an archived invoice is still a row with a status, a bank line is never destroyed, a
  // removed turnover day can be re-imported from its Z-report. The cash book was the exception, and
  // it is the one ledger with no source document to re-read (the owner typed it) AND the one the app
  // refuses a BTW-aangifte on. A running balance that can lose a line without trace, used as grounds
  // to block a filing, is not a book anyone can check.
  //
  // deleted_at set → the movement counts NOWHERE (cash-live.ts filters all eighteen readers) and
  // stays readable: the kasboek panel and the accountant's .xlsx disclose it per quarter, and the
  // owner's export ships it verbatim. Reversible, which is what a correction means.
  //
  // [DEPLOY-SAFE] Until the migration lands the column does not exist, and an UPDATE naming it would
  // fail — leaving the owner unable to remove anything at all. So the capability decides: with the
  // column, soft delete; without it, exactly the hard delete of the day before this shipped. The same
  // probe the readers use, so a request can never filter on a column its own write does not have.
  const { error } = liveForDelete.supported
    ? await supabase
        .from("cash_entries")
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", id)
        .eq("user_id", user.id)
        // Only a live row: two concurrent removals must not overwrite the first one's timestamp,
        // which is the moment the trail below is about.
        .is("deleted_at", null)
    : await supabase
        .from("cash_entries")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "kon boeking niet verwijderen" }, { status: 500 });

  // [KAS-SPOOR] Logged AFTER the removal succeeded, so the trail never claims one that was refused —
  // and only when there was something to remove (a row already gone writes nothing). The trail stays
  // exactly as valuable with soft delete: it is what records WHO removed it and WHEN, which the row's
  // own deleted_at cannot say.
  if (row) {
    await logAuditAction({
      userId: user.id,
      action: "cash.entry_removed",
      entityType: "cash_entry",
      entityId: id,
      oldValue: {
        entry_date: row.entry_date ?? null,
        direction: row.direction ?? null,
        amount: row.amount ?? null,
        category: row.category ?? null,
        description: row.description ?? null,
        btw_rate: row.btw_rate ?? null,
        document_id: row.document_id ?? null,
      },
      ipAddress: getClientIP(req),
    });
  }
  return NextResponse.json({ ok: true });
}
