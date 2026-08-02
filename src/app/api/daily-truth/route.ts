// src/app/api/daily-truth/route.ts
// [HONEST-HOME] Certainty-only snapshot for the owner's home screen.
//
// Two layers, one round-trip:
//   A. Totals ("waar sta ik?") — facts the system can PROVE:
//      - toPay      : confirmed incoming invoices still unpaid — sum of STORED totals
//      - toReceive  : your sent invoices still unpaid — sum of STORED totals
//      - undocumented: bank debits still pending with no document — a COUNT of tasks
//      - lastBankDate: how current the bank picture is (statements are uploaded)
//   B. Attention ("wat nu?") — the top few items that need action now, so the home
//      previews the same to-do the "Vandaag" page lists (overdue or due ≤ 3 days).
//
// We deliberately DO NOT compute income / expense / net / BTW — the previous version
// derived those from the bank statement, which mixed transfers/tax/private with real
// revenue and was wrong for normal banking (which is why it was disabled). Locked
// principle: a wrong number breaks trust; a wrong task is just ignored. Sums here are
// exact stored invoice totals; the undocumented figure is a task count.
//
// Read-only. service_role, every query pinned to the authenticated user.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { needsDocument } from "@/lib/bank-identity";
import { computeDrawerBalance } from "@/lib/cash";
// [PAGINATION] PostgREST silently caps a single .select() at ~1000 rows. The
// home totals promise EXACT stored sums ("a wrong number breaks trust"), and a
// busy account's bank_transactions easily exceed 1000 — lastBankDate and the
// undocumented count were computed over an arbitrary subset. Page everything.
import { fetchAllRows } from "@/lib/supabase-paginate";
// [CREDITNOTA-NO-CHASE] the shared "is this still owed to me" rule — both sides of a credited
// pair must leave the receivable list together (see src/lib/credited-invoices.ts)
import { creditedIdsFrom, filterOpenReceivables } from "@/lib/credited-invoices";
// [OPEN-TOTAL] One definition of openstaand, shared with every other surface.
import { openAmountSigned } from "@/lib/partial-payment";
// [BETALINGSVERSCHIL] Het restje dat geen vordering is — meldend, nooit boekend.
import { detectPaymentDifferences, paymentDifferenceNote } from "@/lib/payment-difference";

// Days-until-due window that counts as "needs attention now" (mirrors the Vandaag
// page). Overdue (negative) always qualifies; so does anything due within 3 days.
const ATTENTION_WINDOW_DAYS = 3;

// Whole-day number from an ISO date prefix, via UTC noon (DST/offset-proof).
function dayNumberFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / 86_400_000);
}

interface InvoiceRow {
  id: string;
  client_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_inc_btw: number | null;
  amount_paid?: number | null;
  due_date: string | null;
  status: string | null;
  payment_date?: string | null;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const todayIso = new Date().toISOString().split("T")[0];
  const todayNum = dayNumberFromIso(todayIso);

  // [BETALINGSVERSCHIL] payment_date rides along: it is the date of the money STILL on the
  // invoice (recompute_invoice_amount_paid re-derives it), which is what tells a five-euro
  // remainder that has stood still for two months from the first term of a live payment plan.
  const SELECT = "id, client_name, invoice_number, invoice_date, total_inc_btw, amount_paid, due_date, status, payment_date";

  // [PARTIAL-PAY] The openstaand (still-owed) amount: a fully-paid invoice is 0 (it also drops out
  // of these lists), a deelbetaling shows only the REMAINING balance, a fully-open invoice its total.
  // Sign preserved (a creditnota total is negative; amount_paid is a magnitude). This is the same
  // reconciled truth the bank matcher books — Te betalen / Te ontvangen must never overstate by a
  // settled instalment.
  // [OPEN-TOTAL] This used to be re-implemented here, line for line, and that is exactly how the
  // rule drifts: a fourth surface computing openstaand its own way, inside a route where no test
  // can reach it. openAmountSigned is the same rule — status decides completion, the sign comes
  // from the invoice — and it additionally rounds to cents, so float noise cannot reach the screen.
  const openstaandOf = openAmountSigned;

  // 1. Te betalen — confirmed incoming invoices, not yet paid. 'processing'/'draft'
  //    are not yet confirmed by the owner, so excluded. Sum of stored totals = exact.
  const payRows = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select(SELECT)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .in("status", ["received", "sent", "overdue"])
    .order("id", { ascending: true })
    .range(from, to)
  ).catch(() => null);

  // [NO-FALSE-CLEAR] Zie de bewaking onder de tweede lezing: een mislukte lezing mag hier nooit
  // een lege lijst worden. Het antwoord wordt daar afgebroken, niet stilzwijgend nul.
  const pay = (payRows ?? []) as InvoiceRow[];
  const toPay = {
    count: pay.length,
    total: pay.reduce((s, r) => s + openstaandOf(r), 0),
    overdue: pay.filter((r) => r.due_date && r.due_date < todayIso).length,
  };

  // 2. Te ontvangen — your OWN sent invoices still unpaid (money owed TO you).
  //    Sum of stored totals = exact. A POS-only shop simply has none of these.
  const recvRows = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("status", ["sent", "overdue"])
    .order("id", { ascending: true })
    .range(from, to)
  ).catch(() => null);

  // [CREDITNOTA-NO-CHASE] A credited invoice always comes as a PAIR in this query: the original
  // (positive, still 'sent' because its +omzet must stay to be netted) AND the creditnota itself,
  // which is also outgoing + 'sent' but NEGATIVE. Both must go, or neither — dropping only the
  // original leaves the −X alone and drives "Te ontvangen" negative, which is worse than the
  // inflated count we started with. filterOpenReceivables enforces that pairing; see
  // src/lib/credited-invoices.ts and its tests.
  // [PAGINATION] fetchAllRows like every other read here: an unpaginated select silently caps at
  // ~1000 rows, and a truncated credited set would let a withdrawn invoice back into the total.
  // [NO-FALSE-CLEAR] DE GRENS VAN DIT ANTWOORD.
  //
  // Beide lezingen hierboven eindigen op `.catch(() => null)`. Werd dat een lege lijst, dan
  // rekende de rest van deze functie er gewoon mee door: toPay.count = 0, toReceive.count = 0.
  // En DailyTruth.tsx leidt daar rechtstreeks `allClear` uit af en schildert het groene vlak
  // "Alles is bij — niets openstaand". Eén databasehapering was dus genoeg om een ondernemer met
  // EUR 12.000 aan onbetaalde inkoopfacturen te vertellen dat hij bij was. Geen foutmelding, geen
  // logregel, geen enkel spoor — precies de stille onwaarheid waar dit product tegen bestaat.
  //
  // Het scherm KAN de waarheid al zeggen: DailyTruth.tsx rendert bij ok=false een eerlijk paneel
  // ("Dit is geen 'alles is bij'") met een opnieuw-knop. Dat paneel werd alleen nooit bereikt.
  //
  // Alleen deze twee lezingen breken het antwoord af — zij dragen de bewering. De bank- en
  // kaslezingen hieronder mogen wél degraderen (zie daar): die voeden een bijschrift en een tegel
  // die zichzelf verbergen, en daarvoor een correct overzicht blanco maken zou een stil verkeerd
  // antwoord inruilen voor een luid kapot scherm.
  if (payRows == null || recvRows == null) {
    console.error("[DAILY-TRUTH] invoice read failed — refusing to answer", {
      userId: user.id,
      payFailed: payRows == null,
      recvFailed: recvRows == null,
    });
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 503 });
  }

  const recvAll = (recvRows ?? []) as InvoiceRow[];
  const creditRows = recvAll.length > 0
    ? await fetchAllRows<{ original_invoice_id: string | null }>((from, to) => pipeline
        .from("invoices")
        // Keyed on the owner rather than on the candidate ids — an .in() over every open invoice
        // would grow the URL without bound, and one owner's creditnotas are few.
        .select("original_invoice_id")
        .eq("sender_id", user.id)
        .eq("invoice_type", "creditnota")
        .not("original_invoice_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to)
      ).catch(() => null)
    : [];
  // On a failed lookup, degrade to the OLD behaviour completely — both sides of the pair stay in
  // the list, where they cancel each other out as they always did. Half-degrading (dropping the
  // creditnota while still counting the original) would invent a number that was never shown.
  const recv = creditRows == null
    ? recvAll
    : filterOpenReceivables(recvAll, creditedIdsFrom(creditRows));
  const toReceive = {
    count: recv.length,
    total: recv.reduce((s, r) => s + openstaandOf(r), 0),
    overdue: recv.filter((r) => r.due_date && r.due_date < todayIso).length,
  };

  // [BETALINGSVERSCHIL] Hoeveel van dat bedrag gaat niet meer komen?
  //
  // Een klant maakt EUR 995 over op een factuur van EUR 1.000 omdat zijn bank er EUR 5 afhaalt.
  // De EUR 5 blijft openstaan, voor altijd — niemand maakt hem alsnog over. Hij staat in de
  // debiteurenlijst, de herinneringscron jaagt erop, en "Te ontvangen" hierboven is te hoog met
  // geld dat geen vordering is. Dat is fout in de enige richting die een ondernemer nooit
  // controleert.
  //
  // Dit MELDT het en boekt niets af — dezelfde grens die bad-debt.ts trekt bij artikel 29, en om
  // dezelfde reden: of een tekort bankkosten is, een betwiste korting, of een klant in nood, is
  // een oordeel over een relatie die de app niet ziet. Zie payment-difference.ts.
  const differences = detectPaymentDifferences({
    invoices: recv.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      status: r.status,
      total_inc_btw: r.total_inc_btw,
      amount_paid: r.amount_paid,
      last_payment_date: r.payment_date ?? null,
    })),
    today: todayIso,
  });

  // 3. Nog te documenteren — bank debits still pending with no linked document that
  //    we can't otherwise explain. [BANK-IDENTITY] needsDocument() excludes income,
  //    transfers (savings/cash/own account/ATM), tax, private withdrawals and bank
  //    fees — none of those need a purchase document. What remains is an unexplained
  //    outgoing payment, i.e. probably a real cost still missing its bon. This is a
  //    COUNT of open tasks, never a money figure. (It also fixes the old heuristic,
  //    which wrongly treated a "betaalautomaat" card PURCHASE as takings and skipped
  //    it — a purchase does need a receipt.)
  const txRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("date, amount, status, invoice_id, counterpart_name, description, category")
    .eq("user_id", user.id)
    .order("id", { ascending: true })
    .range(from, to)
  ).catch(() => null);

  // [NO-FALSE-CLEAR] Deze lezing MAG degraderen, en dat is een bewuste keuze: txRows voedt alleen
  // `lastBankDate` (een bijschrift dat zichzelf verbergt als het null is) en `undocumented` (sinds
  // [NO-CODEER] nergens meer gerenderd). Hiervoor een correct facturenoverzicht blanco maken zou
  // een stil verkeerd antwoord inruilen voor een luid kapot scherm.
  if (txRows == null) {
    console.error("[DAILY-TRUTH] bank read failed — caption degrades, totals unaffected", { userId: user.id });
  }
  const txs = txRows ?? [];

  let lastBankDate: string | null = null;
  let undocumented = 0;
  for (const t of txs) {
    const date = t.date ?? null;
    if (date && (!lastBankDate || date > lastBankDate)) lastBankDate = date;
    if (t.status === "pending" && !t.invoice_id) {
      // Once the owner has given a line an identity, only a confirmed business cost
      // ('kosten') still awaits its bon — prive/transfer/tax/fee/omzet don't. While a
      // line is still uncategorized, fall back to the classifier's best guess.
      const stillOpen =
        t.category == null
          ? needsDocument(t.counterpart_name, t.description, t.amount ?? 0)
          : t.category === "kosten";
      if (stillOpen) undocumented++;
    }
  }

  // B. Attention — the items that need action now, mirroring the Vandaag page:
  //    incoming 'received' (te betalen) + outgoing 'sent'/'overdue' (te ontvangen),
  //    with a due date, that are overdue or due within the window. Sorted soonest/
  //    most-overdue first. We preview the top 3; attentionCount is the full total so
  //    the home can say "Alle N bekijken →".
  const toItem = (r: InvoiceRow, direction: "incoming" | "outgoing") => ({
    id: r.id,
    party: r.client_name,
    invoiceNumber: r.invoice_number,
    dueDate: r.due_date,
    total: openstaandOf(r), // [PARTIAL-PAY] the remaining balance, not the full invoice
    direction,
  });

  const attentionAll = [
    ...pay.filter((r) => r.status === "received").map((r) => toItem(r, "incoming")),
    ...recv.map((r) => toItem(r, "outgoing")),
  ]
    .filter((it) => it.dueDate && dayNumberFromIso(it.dueDate) - todayNum <= ATTENTION_WINDOW_DAYS)
    .sort((a, b) => dayNumberFromIso(a.dueDate as string) - dayNumberFromIso(b.dueDate as string));

  // [CASH-LEDGER] Kas — opt-in by use. Only surfaced when the owner handles cash. The drawer balance
  // MUST be the SAME figure the Kas page shows (computeDrawerBalance): opening float + cash_entries
  // net + the till's daily CASH takings. The old version summed cash_entries ONLY — so a till shop's
  // home showed a wrong, often NEGATIVE saldo (a false "meer uitgaven dan ontvangsten" alarm) that
  // disagreed with the Kas page by exactly the till-cash + opening amount.
  // [PAGINATION] cash_entries / daily_turnover also page past the ~1000-row cap
  // (a cash-heavy shop exceeds it) — a truncated sum here showed a wrong drawer
  // saldo that disagreed with the Kas page.
  const [cashRows, tillRows, { data: kasProf, error: kasProfErr }] = await Promise.all([
    fetchAllRows((from, to) => pipeline
      .from("cash_entries").select("direction, amount").eq("user_id", user.id)
      .order("id", { ascending: true }).range(from, to)
    ).catch(() => null),
    fetchAllRows((from, to) => pipeline
      .from("daily_turnover").select("cash_amount").eq("user_id", user.id)
      .order("id", { ascending: true }).range(from, to)
    ).catch(() => null),
    pipeline.from("profiles").select("kas_opening_balance").eq("id", user.id).maybeSingle(),
  ]);
  // [NO-FALSE-CLEAR] Een half gelezen la is erger dan geen la. Faalt één van beide bronnen, dan
  // zou het saldo kloppen noch met de Kas-pagina noch met de werkelijkheid — en het staat er als
  // een hard bedrag. Dan liever de tegel helemaal niet tonen (kasUsed=false verderop).
  // Het beginsaldo hoort bij diezelfde la: een gemiste leesbeurt daarvan wordt stil €0 en
  // verlaagt het saldo met precies het geld waarmee de kassa ooit begon — even hard gepresenteerd
  // als de rest. Dezelfde vlag, dezelfde uitkomst: dan tonen we de tegel niet.
  const kasReadFailed = cashRows == null || tillRows == null || kasProfErr != null;
  if (kasReadFailed) {
    console.error("[DAILY-TRUTH] kas read failed — suppressing the drawer tile", {
      userId: user.id,
      cashFailed: cashRows == null,
      tillFailed: tillRows == null,
      openingFailed: kasProfErr != null,
    });
  }
  const cash = cashRows ?? [];
  const till = (tillRows ?? []) as { cash_amount: number | null }[];
  const kasOpening = Number((kasProf as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;
  const tillCashTotal = till.reduce((s, t) => s + (Number(t.cash_amount) || 0), 0);
  const kasBalance = computeDrawerBalance({
    openingBalance: kasOpening,
    entries: cash.map((e) => ({ direction: e.direction === "in" ? "in" : "out", amount: e.amount })),
    tillCashAmounts: till.map((t) => t.cash_amount),
  });
  // A shop with till-cash takings (or an opening float) handles cash even without manual entries, so
  // the home surfaces the drawer whenever ANY of the three sources is present — matching the Kas page.
  const kasUsed = !kasReadFailed && (cash.length > 0 || tillCashTotal !== 0 || kasOpening !== 0);

  return NextResponse.json({
    ok: true,
    toPay,
    toReceive,
    // [BETALINGSVERSCHIL] Wat er van toReceive.total waarschijnlijk niet meer binnenkomt.
    // Een suggestie met een bedrag, geen boeking: note is null zodra er niets te zeggen valt.
    paymentDifferences: {
      count: differences.differences.length,
      total: differences.total,
      note: paymentDifferenceNote(differences),
    },
    bank: { lastDate: lastBankDate, undocumented },
    kas: { used: kasUsed, balance: kasBalance },
    attention: attentionAll.slice(0, 3),
    attentionCount: attentionAll.length,
  });
}
