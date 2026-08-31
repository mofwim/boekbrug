// src/app/api/bank/categorize/route.ts
// [BANK-IDENTITY] Give bank lines a financial identity, and learn from it.
//
// GET  → the transactions still needing a category (pending, not tied to an invoice,
//        not yet categorized), each with a suggestion (exact memory wins → pattern
//        classifier → a LOOK-ALIKE counterpart's category as a review-only pre-select →
//        sign fallback), plus the TRUE remaining total so the UI never claims "done"
//        while lines remain. The look-alike ('similar') suggestion is confident:false,
//        so the one-click bulk sweep never auto-applies it — only the owner's tap does.
// POST → confirm a category for one transaction and TRAIN the per-counterpart memory,
//        OR (mode:"bulk") auto-apply ONLY the confident suggestions — memory matches and
//        specific pattern matches (tax/prive/transfer/pos_income/fee). The bare
//        kosten/omzet fallback (a guess by sign alone) is NEVER auto-applied, so a
//        transfer, tax payment or private withdrawal can't be silently booked as a
//        deductible cost. لا اختراعات: the machine only fills what it actually knows.
//
// User-scoped via the RLS server client (auth.uid()). No amount arithmetic here — a
// category is a task/identity, not a money claim.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { counterpartKey, suggestIdentity, bestSimilarMemory, type MemoryEntry } from "@/lib/bank-identity";
// [ZELFDE-TEGENPARTIJ] Which other pending lines the owner just answered for without knowing it.
import { linesForCounterpart } from "@/lib/counterpart-spread";
import { ALLOWED_CATEGORIES, EXCLUDED_CATEGORIES, type BankCategory } from "@/lib/bank-categories";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { round2 } from "@/lib/invoice-totals";

// How many rows one GET page returns (the review list). The true remaining total is
// reported separately via an exact head-count, so a capped page never reads as "done".
const PAGE_SIZE = 200;
// Safety cap for the bulk sweep so a runaway account can't spin forever.
const BULK_MAX = 5000;

// ─── GET: the to-categorize list with suggestions + the honest remaining total ───
// ?scope=review → instead returns lines that ALREADY have a category, so the owner can
// CORRECT a wrong one (a false-positive 'fee'/'transfer' silently drops a real cost from
// the P&L, and nothing else in the app lets you change a set category). The write path
// (POST) already re-categorises any line, so review reuses it.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (req.nextUrl.searchParams.get("scope") === "review") {
    // Already-categorised, still-pending lines (auto-applied or confirmed). Show the
    // STORED category so the owner can see + change it. Unconfirmed (machine-applied)
    // first, so the guesses that most deserve a look sit at the top.
    //
    // [AUTO-EXCLUDE-REVIEW] Optional ?year&quarter scopes the list to one quarter so the
    // readiness "Controleer" deep-link lands on EXACTLY the lines it counted (the count is
    // quarter-scoped). Without this, an older quarter's flagged lines could fall off the
    // 200-row all-time page → the risk could never be cleared. Absent params → all-time
    // (the plain "review wrong categories" entry point) — unchanged behaviour.
    const sp = req.nextUrl.searchParams;
    const y = Number(sp.get("year"));
    const q = Number(sp.get("quarter"));
    const quarterScoped = Number.isInteger(y) && q >= 1 && q <= 4;
    // [AUTO-EXCLUDE-REVIEW] ?only=excluded shows ONLY the auto-excluded lines (privé/overboeking/
    // belasting) the readiness risk flagged — not every categorised line. This makes the deep-link
    // land on exactly the counted set (so the owner isn't hunting the flagged rows among omzet/kosten
    // ones), and keeps that set small enough that the 200-row page never truncates the oldest ones.
    const onlyExcluded = sp.get("only") === "excluded";
    // Quarter date range computed ONCE so the page query and the head-count below
    // filter identically (no drift between the shown rows and the reported total).
    let qStart: string | null = null;
    let qEnd: string | null = null;
    if (quarterScoped) {
      const sm = (q - 1) * 3;
      qStart = `${y}-${String(sm + 1).padStart(2, "0")}-01`;
      const endD = new Date(Date.UTC(y, sm + 3, 0));
      qEnd = `${endD.getUTCFullYear()}-${String(endD.getUTCMonth() + 1).padStart(2, "0")}-${String(endD.getUTCDate()).padStart(2, "0")}`;
    }

    let query = supabase
      .from("bank_transactions")
      .select("id, date, amount, counterpart_name, description, category, category_source, category_confirmed")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .is("invoice_id", null)
      .not("category", "is", null);
    if (onlyExcluded) query = query.in("category", [...EXCLUDED_CATEGORIES]);
    if (qStart && qEnd) query = query.gte("date", qStart).lte("date", qEnd);
    const { data: rows } = await query
      .order("category_confirmed", { ascending: true })
      .order("date", { ascending: false })
      .limit(PAGE_SIZE);

    // [HONEST-TRUNCATION] Exact head-count of the SAME set, so a >200 page never
    // reads as complete — mirrors the todo branch's honesty. The client shows a
    // "we tonen de eerste N" banner + wachtrij note when total > page.
    let countQuery = supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending")
      .is("invoice_id", null)
      .not("category", "is", null);
    if (onlyExcluded) countQuery = countQuery.in("category", [...EXCLUDED_CATEGORIES]);
    if (qStart && qEnd) countQuery = countQuery.gte("date", qStart).lte("date", qEnd);
    const { count: reviewTotal } = await countQuery;

    const items = (rows ?? []).map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterpart_name: t.counterpart_name,
      description: t.description,
      // In review mode `suggested` = the CURRENT stored category (what to pre-select).
      suggested: t.category,
      suggested_source: t.category_source ?? "ai",
      suggested_confident: t.category_confirmed === true,
      confirmed: t.category_confirmed === true,
    }));
    const total = reviewTotal ?? items.length;
    return NextResponse.json({
      ok: true,
      review: true,
      items,
      count: items.length,
      total_remaining: total,
      has_more: total > items.length,
    });
  }

  // The TRUE remaining count — an exact head-count, independent of the page size.
  // This is what governs "alles gecategoriseerd": only 0 here means truly done.
  // [NO-SILENT-EMPTY] Dit getal beslist "alles gecategoriseerd": alleen 0 is klaar. Een mislukte
  // telling werd via `?? 0` diezelfde nul, dus een hapering meldde een schone bankpagina terwijl
  // er regels lagen te wachten — de enige conclusie die dit scherm nooit ten onrechte mag trekken.
  const { count: totalRemaining, error: totalRemainingErr } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null);

  // Uncategorized, still-pending lines that aren't an invoice payment (one page).
  const { data: rows } = await supabase
    .from("bank_transactions")
    .select("id, date, amount, counterpart_name, description")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null)
    .order("date", { ascending: false })
    .limit(PAGE_SIZE);

  const txs = rows ?? [];

  // One read of the memory, turned into a key → category map for O(1) suggestions.
  //
  // [MEMORY-PAGINATE] Paged past PostgREST's silent ~1000-row cap. This table holds ONE row per
  // counterpart the owner has ever answered for, so it only grows — a shop reaches a thousand
  // distinct suppliers, customers and one-offs over a few years, and every row past the cap was
  // simply forgotten. The failure is quiet and self-repeating: the counterpart's memorized answer
  // is missing, so the line falls back to a "lijkt op" guess or a bare sign guess, comes back as
  // NOT confident, and is therefore excluded from the one-tap sweep AND from the automatic
  // coding. The owner answers the same counterpart again, which writes the row that already
  // existed. Paged with a stable id order (counterpart_key is unique per user but text-ordered
  // paging is fragile); the map is order-independent.
  //
  // Read best-effort, as before: a memory that cannot be read means no suggestions, never a
  // broken screen — the categorisation page must still list the lines that need an answer.
  let mem: { counterpart_key: string; category: string }[] = [];
  try {
    mem = await fetchAllRows((from, to) =>
      supabase
        .from("counterpart_memory")
        .select("counterpart_key, category")
        .eq("user_id", user.id)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error("[MEMORY-PAGINATE] counterpart memory read failed — suggestions fall back to patterns", e);
  }

  const memMap = new Map<string, string>();
  const memEntries: MemoryEntry[] = [];
  for (const m of mem ?? []) {
    memMap.set(m.counterpart_key, m.category);
    memEntries.push({ key: m.counterpart_key, category: m.category });
  }

  // [LEVERANCIER-BEWIJS] Which counterparts the owner already holds invoices from.
  const supplierKeys = await knownSupplierKeys(supabase, user.id);

  let confidentAvailable = 0;
  const items = txs.map((t) => {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    // No EXACT memory? Borrow from a similar counterpart the owner categorized before — a
    // review-only pre-select (confident:false), never auto-applied by the bulk sweep.
    const similar = !memoryCategory ? bestSimilarMemory(key, memEntries) : null;
    const suggestion = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory, similar, key ? supplierKeys.has(key) : false);
    if (suggestion.confident) confidentAvailable++;
    return {
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterpart_name: t.counterpart_name,
      description: t.description,
      suggested: suggestion.category,
      suggested_source: suggestion.source,
      // Only confident suggestions are eligible for the one-click bulk apply.
      suggested_confident: suggestion.confident,
      // On a 'similar' suggestion: the memorized counterpart it resembles (for a "lijkt op …" hint).
      suggested_similar_to: suggestion.similarTo ?? null,
    };
  });

  // [BANK-GELD-NIET-GEBOEKT] Hoevéél geld er nog buiten de boeken staat, niet alleen hoeveel
  // regels. Voor een winkelier is "299 banktransacties" een klus; "€ 266.834 aan uitgaven staat
  // nog niet in je winst & verlies" is zijn geld. Gemeten in de productiedatabase toen dit werd
  // geschreven: precies die twee getallen, bij één eigenaar.
  //
  // UIT en IN apart, en dat is geen opmaakkeuze. financial-result.ts houdt deze twee om dezelfde
  // reden gescheiden: "€ 10.000 in en € 10.000 uit netten tot nul en zouden lezen als 'niets mist'
  // terwijl het twee onverklaarde feiten zijn."
  //
  // Een onvolledige som is erger dan geen som — dan staat er een bedrag op het scherm dat kleiner
  // is dan de werkelijkheid, over precies het geld dat nog niet meetelt. fetchAllRows gooit bij een
  // mislukte pagina, en dan blijft dit null en toont het scherm alleen het aantal.
  let remainingOut: number | null = null;
  let remainingIn: number | null = null;
  try {
    const bedragen = await fetchAllRows<{ amount: number | null }>((from, to) =>
      supabase
        .from("bank_transactions")
        .select("amount")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .is("invoice_id", null)
        .is("category", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    let uit = 0;
    let inn = 0;
    for (const r of bedragen) {
      const a = Number(r.amount) || 0;
      if (a < 0) uit += -a;
      else inn += a;
    }
    remainingOut = round2(uit);
    remainingIn = round2(inn);
  } catch (e) {
    console.warn("[BANK-GELD-NIET-GEBOEKT] som van ongecategoriseerde regels mislukt", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({
    ok: true,
    items,
    // items.length is only this page; totalRemaining is the honest DB-wide count.
    count: items.length,
    // [BANK-GELD-NIET-GEBOEKT] null = we konden het niet optellen. Nooit 0: dat zou "er staat geen
    // geld buiten je boeken" beweren over een som die niet gelukt is.
    remaining_out: remainingOut,
    remaining_in: remainingIn,
    // Onleesbaar → items.length, en dat is precies wat de zin eronder nodig heeft: dan zegt
    // has_more niet "je bent klaar" maar "we weten het niet zeker", en de UI blijft doorvragen.
    total_remaining: totalRemainingErr ? items.length : totalRemaining ?? items.length,
    // How many on THIS page could be auto-applied (a hint for the bulk button).
    confident_available: confidentAvailable,
    // [NO-SILENT-EMPTY] Een mislukte telling mag geen "alles gecategoriseerd" worden. Zolang
    // deze pagina vol is, is er waarschijnlijk meer — dat is de veilige kant: verder kijken.
    has_more: totalRemainingErr ? items.length >= PAGE_SIZE : (totalRemaining ?? 0) > items.length,
  });
}

// ─── POST: confirm one category (+train memory)  OR  bulk-apply confident ones ───
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transaction_id?: string; category?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (body.mode === "bulk") return bulkApply(supabase, user.id);

  const transactionId = body.transaction_id;
  const category = body.category as BankCategory | undefined;
  if (!transactionId || !category || !ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "transaction_id and a valid category are required" }, { status: 400 });
  }

  // Load the transaction (RLS pins it to this user) to get its counterpart for memory.
  const { data: tx, error: txErr } = await supabase
    .from("bank_transactions")
    .select("id, counterpart_name")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (txErr || !tx) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  // 1) Set the identity on the transaction.
  const { error: updErr } = await supabase
    .from("bank_transactions")
    .update({ category, category_source: "user", category_confirmed: true })
    .eq("id", transactionId)
    .eq("user_id", user.id);

  if (updErr) {
    return NextResponse.json({ error: "kon categorie niet opslaan" }, { status: 500 });
  }

  // 2) Train the memory for this counterpart (so it auto-applies next time).
  await trainMemory(supabase, user.id, tx.counterpart_name, category);

  // 3) [ZELFDE-TEGENPARTIJ] …and apply it NOW to the other pending lines of the same party.
  //
  // The memory alone only pays off on the next import, the nightly cron, or the bulk button. Until
  // one of those runs, the other lines of the party just answered stay on this very screen and get
  // asked again. Measured live: 272 of 305 unresolved lines are repeat appearances of a party that
  // is also elsewhere in the same list, and one party was asked about 28 separate times.
  //
  // Written as a SUGGESTION (category_source 'memory', category_confirmed false), exactly like
  // every other learned application: the owner confirmed one line and this infers the rest, so it
  // must not wear their confirmation. Best-effort — a failed spread must never cost the owner the
  // answer they did give, which is already committed above.
  let alsoApplied = 0;
  try {
    const pending = await fetchAllRows<{ id: string; counterpart_name: string | null; category: string | null }>((from, to) =>
      supabase
        .from("bank_transactions")
        .select("id, counterpart_name, category")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .is("invoice_id", null)
        .is("category", null)
        .order("id", { ascending: true })
        .range(from, to));
    const ids = linesForCounterpart(pending, tx.counterpart_name, transactionId);
    for (const id of ids) {
      const { error } = await supabase
        .from("bank_transactions")
        .update({ category, category_source: "memory", category_confirmed: false })
        .eq("id", id)
        .eq("user_id", user.id)
        .is("category", null); // guard: never clobber a category set meanwhile
      if (!error) alsoApplied++;
    }
  } catch (e) {
    console.error("[ZELFDE-TEGENPARTIJ] spreading the answer failed — the answer itself stands", e);
  }

  return NextResponse.json({ ok: true, alsoApplied });
}

// ─── Bulk apply: fill ONLY the confident suggestions, leave the rest for the owner ──
// Confident = memory match or a specific pattern (tax/prive/transfer/pos_income/fee).
// The kosten/omzet fallback is deliberately skipped: guessing "cost" for an unlabeled
// transfer/tax/private line would put money into the P&L that doesn't belong there.
async function bulkApply(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  // Memory map once.
  // [MEMORY-PAGINATE] Paged, same as the GET above. Here the truncation is the more expensive
  // one: a memory hit is what makes a suggestion CONFIDENT, and only confident suggestions are
  // applied by this sweep. A forgotten row therefore does not merely lose a pre-select — it
  // silently removes that line from the one-tap "N zekere invullen" entirely, so the sweep
  // reports fewer than it could do and the owner keeps answering counterparts they already
  // taught. The read stays best-effort: no memory means no confident lines and the sweep does
  // nothing, which is exactly what it should do rather than guess.
  let mem: { counterpart_key: string; category: string }[] = [];
  try {
    mem = await fetchAllRows((from, to) =>
      supabase
        .from("counterpart_memory")
        .select("counterpart_key, category")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error("[MEMORY-PAGINATE] counterpart memory read failed — bulk applies nothing this run", e);
  }
  const memMap = new Map<string, string>();
  for (const m of mem) memMap.set(m.counterpart_key, m.category);
  // [LEVERANCIER-BEWIJS] The sweep applies only CONFIDENT suggestions, and a supplier the owner
  // holds invoices from makes an outgoing line confident — so the sweep now reaches them too.
  const supplierKeys = await knownSupplierKeys(supabase, userId);

  // Pull the uncategorized lines (capped) and decide per line.
  // [BULK-PAGINATE] `.limit(BULK_MAX)` did NOT deliver BULK_MAX rows. PostgREST caps a response at
  // ~1000 (Supabase default) and truncates SILENTLY, so a limit above that was a request, not a
  // promise: the sweep read the first 1000 lines and reported "klaar" while the rest stayed
  // uncoded — money absent from the W&V/BTW with the one screen that surfaces it saying there was
  // nothing left to do. Page past the cap the way every other bulk read in the app does, then
  // apply BULK_MAX ourselves so the runaway-account guard still means what it says. `remaining`
  // below is an exact head-count either way, so a capped sweep stays honest about the tail.
  const rows = (await fetchAllRows<{ id: string; amount: number | null; counterpart_name: string | null; description: string | null }>(
    (from, to) =>
      supabase
        .from("bank_transactions")
        .select("id, amount, counterpart_name, description")
        .eq("user_id", userId)
        .eq("status", "pending")
        .is("invoice_id", null)
        .is("category", null)
        .order("id", { ascending: true })
        .range(from, to),
  )).slice(0, BULK_MAX);

  const txs = rows ?? [];
  let applied = 0;
  let skipped = 0;

  for (const t of txs) {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    const s = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory, null, key ? supplierKeys.has(key) : false);
    if (!s.confident) { skipped++; continue; }

    // Auto-applied, NOT individually confirmed by the owner → category_confirmed:false
    // so it stays reviewable. category_source records who suggested it (memory/ai).
    const { error } = await supabase
      .from("bank_transactions")
      .update({ category: s.category, category_source: s.source, category_confirmed: false })
      .eq("id", t.id)
      .eq("user_id", userId)
      .is("category", null); // guard: don't clobber a category set meanwhile

    if (error) { skipped++; continue; }
    applied++;
  }

  // The honest remaining total after the sweep.
  const { count: remaining, error: remainingErr } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null);

  return NextResponse.json({
    ok: true,
    applied,
    skipped,          // left untouched because the suggestion was only a sign-guess
    // null = niet geteld. Nul zou "klaar" betekenen, en dat weet deze lezing niet.
    remaining: remainingErr ? null : remaining ?? 0,
  });
}

/**
 * [LEVERANCIER-BEWIJS] The counterpart keys of every supplier this owner already holds invoices
 * from — the evidence behind a "proven cost" suggestion.
 *
 * A suppliers row exists only because an invoice from that party was read, matched and kept, so
 * the set is a statement the administration can back up rather than a guess about a name. Keyed
 * through counterpartKey, the same normaliser the bank lines go through, so "GROOTHANDEL M.H.
 * BAL V.O.F." on an invoice and "GROOTHANDEL M.H. BAL" on a statement are one party.
 *
 * Best-effort: a set that cannot be read means no proof and therefore no confident suggestion —
 * the screen still lists every line that needs an answer, which is the behaviour without it.
 */
async function knownSupplierKeys(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const rows = await fetchAllRows<{ name: string | null }>((from, to) =>
      supabase.from("suppliers").select("name").eq("user_id", userId)
        .order("id", { ascending: true }).range(from, to));
    for (const r of rows) {
      const k = counterpartKey(r.name);
      if (k) keys.add(k);
    }
  } catch (e) {
    console.error("[LEVERANCIER-BEWIJS] supplier read failed — no proven-cost suggestions this run", e);
  }
  return keys;
}

// Train per-counterpart memory from an explicit user confirmation.
async function trainMemory(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  counterpartName: string | null,
  category: BankCategory,
) {
  const key = counterpartKey(counterpartName);
  if (!key) return;
  const { data: existing } = await supabase
    .from("counterpart_memory")
    .select("id, times_seen")
    .eq("user_id", userId)
    .eq("counterpart_key", key)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("counterpart_memory")
      .update({ category, times_seen: (existing.times_seen ?? 1) + 1, last_used_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("counterpart_memory")
      .insert({ user_id: userId, counterpart_key: key, category });
  }
}
