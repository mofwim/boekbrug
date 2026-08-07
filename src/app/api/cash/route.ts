// src/app/api/cash/route.ts
// [CASH-LEDGER] The cash book (kasadministratie). User-scoped via the RLS server client.
//
// GET    → all cash entries (newest first) + the running kas balance.
// POST   → add one entry (a cash sale, a cash expense, a deposit/withdrawal, …).
// DELETE → remove one entry (?id=).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeDrawerBalance, isCashCategory } from "@/lib/cash";
// [PAY-DATE-SANE] one tested window for every date that lands in the kasboek — see payment-date.ts
import { paymentDateOutOfWindow } from "@/lib/payment-date";
import { amsterdamToday } from "@/lib/format-nl";
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { fetchAllRows } from "@/lib/supabase-paginate";

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
  const allEntries = await fetchAllRows<{
    id: string; entry_date: string; created_at: string | null; direction: string;
    amount: number | null; category: string; description: string | null; document_id: string | null; btw_rate: number | null;
  }>((from, to) =>
    supabase
      .from("cash_entries")
      .select("id, entry_date, created_at, direction, amount, category, description, document_id, btw_rate")
      .eq("user_id", user.id)
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
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const category = body.category;

  if (direction !== "in" && direction !== "out") {
    return NextResponse.json({ error: "direction moet 'in' of 'out' zijn" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount moet groter dan 0 zijn" }, { status: 400 });
  }
  if (!isCashCategory(category)) {
    return NextResponse.json({ error: "ongeldige categorie" }, { status: 400 });
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
  const opening = Math.round(val * 100) / 100;

  const { error } = await supabase
    .from("profiles")
    .update({ kas_opening_balance: opening } as never)
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: "kon beginsaldo niet opslaan" }, { status: 500 });
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
  const { data: existing, error: readErr } = await supabase
    .from("cash_entries")
    .select("category")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { error: "lookup_failed", detail: "We konden deze boeking nu niet opzoeken. Probeer het zo meteen opnieuw." },
      { status: 500 },
    );
  }
  if ((existing as { category?: string | null } | null)?.category === "betaling") {
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

  const { error } = await supabase
    .from("cash_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "kon boeking niet verwijderen" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
