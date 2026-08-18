// src/app/api/aangifte/route.ts
// [AANGIFTE] Read-only CONCEPT BTW-aangifte for a quarter. Fetches the same sources as
// /api/result, runs the one reconciliation engine (computeResult), and maps it to the
// Belastingdienst rubrieken (buildAangifte). Every figure is derived from the owner's
// own imported data; the response carries honest completeness notes. User-scoped (RLS).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { buildAangifte, privegebruikNote, type AangifteCompleteness } from "@/lib/aangifte";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
import { fetchAllRows } from "@/lib/supabase-paginate";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "@/lib/cash-live";
// [DEPLOY-SAFE] "that table isn't there yet" vs "the read failed" — see pg-missing.ts
import { isMissingRelation } from "@/lib/pg-missing";
import { collectRegimeFlags, type RegimeInvoiceRef } from "@/lib/regime-collect";
import { regimeFlagNote } from "@/lib/regime-flags";
import { resolveSchemeSettlements, mergeSchemeOpts } from "@/lib/kas-payment-events-fetch";
import { collectBadDebt, collectVatClawback } from "@/lib/bad-debt-collect";
import { badDebtNote, vatClawbackNote, BAD_DEBT_MIN_EUR } from "@/lib/bad-debt";
// [KAS-DUBBELE-KOST] The same purchase, written down twice — see cash-cost-overlap.ts.
import { collectCashCostOverlaps } from "@/lib/cash-cost-overlap-collect";
import { doubleCostNote } from "@/lib/cash-cost-overlap";
// [ICP] Rubriek 3b + the separate ICP-opgaaf, read from the customers' EU VAT numbers.
import { buildIcp, icpNote, buildForeignPurchases, foreignPurchaseNote, type IcpInvoice } from "@/lib/icp";
// [RUBRIEK-SPLIT] Omzet per BTW rate from the invoice's own lines — one helper, two surfaces.
import { fetchRateShares } from "@/lib/btw-rate-split-fetch";
// [VRIJGESTELD] The exempt regime + cost attributions, from the one shared collector.
import { collectVatExemption } from "@/lib/vat-exemption-collect";
import { exemptShareOf } from "@/lib/vat-exemption";

function pad(n: number): string { return String(n).padStart(2, "0"); }
// EU VAT prefixes (excl. NL) — a cheap, honest signal that a purchase may be intra-EU
// (rubriek 4b), which this concept does NOT auto-compute.
const EU_VAT = /^(AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GR|EL|HR|HU|IE|IT|LT|LU|LV|MT|PL|PT|RO|SE|SI|SK)/i;

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  // [QUARTER] Honour ?year&quarter (bounded), else default to the LAST COMPLETED quarter —
  // the app-wide default (quarter.ts). A bare hit no longer returns the open quarter.
  const { year, quarter } = quarterFromParams((k) => sp.get(k));

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;
  const quarterDays = Math.round((endD.getTime() - Date.UTC(year, startMonth, 1)) / 86400000) + 1;

  // [ACCOUNTANT-TRUTH] Dual-path: own concept, OR a linked client's concept for an
  // accountant (same authorization as /api/closing-package). The data queries below use
  // the service-role pipeline scoped to ownerId — an accountant cannot read a client's
  // rows through RLS, so this route's reads move from the session client to the pipeline.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const ownerId = owner.ownerId;
  const pipeline = createPipelineClient();

  // Invoices (both directions) in the quarter. [PAGINATION] paged past the 1000-row cap.
  const invRaw = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("id, invoice_number, client_name, direction, status, total_ex_btw, btw_amount, client_btw_number, sender_id, receiver_id")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));
  // [FIN-4] Never drop a verified row with a NULL direction: infer it from ownership
  // (owner is the receiver of an incoming invoice) — the SAME rule effectiveDirection
  // applies in the closing package. Without this, a null-direction sale is silently
  // omitted here while the ZIP counts it → the two concept figures diverge.
  const effDir = (i: { direction: string | null; receiver_id: string | null }): "incoming" | "outgoing" =>
    i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction
      : i.receiver_id === ownerId ? "incoming" : "outgoing";
  // [RUBRIEK-SPLIT] A sales invoice that mixes rates (21% materials next to 9% labour, food next
  // to drinks) cannot say so in its header: the rate is derived as btw ÷ ex, so €1.000 @ 21% +
  // €1.000 @ 9% blends to 15%, snaps to 21%, and the whole €2.000 is declared in rubriek 1a while
  // half of it belongs in 1b. The invoice's own lines know the rates; this reads them, and uses
  // them only when they add up to the header — so the split can move omzet BETWEEN rubrieken and
  // never change a total. Same helper computeResultForRange uses, so screen and aangifte agree.
  // [VRIJGESTELD] Resolve the exempt regime BEFORE reading the lines: it decides whether the
  // line read asks for vat_treatment at all, and whether exempt turnover is withheld from the
  // rubrieken. The shared collector is what keeps this route, readiness, the closing package and
  // the result screen from each answering "is this owner exempt?" their own way.
  const exemption = await collectVatExemption({
    client: pipeline,
    ownerId,
    periodStart: start,
    incomingInvoiceIds: invRaw.filter((i) => effDir(i) === "incoming").map((i) => i.id).filter((id): id is string => !!id),
  });
  const { rateShares: rateSharesByInvoice, exemptExByInvoice } = await fetchRateShares(
    pipeline,
    invRaw.filter((i) => effDir(i) === "outgoing"),
    { exemptRegime: exemption.active },
  );
  const invoices: ResultInvoice[] = invRaw.map((i) => ({
    direction: effDir(i),
    status: i.status, total_ex_btw: i.total_ex_btw, btw_amount: i.btw_amount,
    rate_lines: i.id ? rateSharesByInvoice.get(i.id) ?? null : null,
    exempt_ex: i.id ? exemptExByInvoice.get(i.id) ?? null : null,
    vat_deduction: i.id ? exemption.deductionByInvoice.get(i.id) ?? null : null,
  }));

  // Bank + cash (same de-dup inputs as /api/result).
  const bankRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId).gte("date", start).lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  // [SETTLE] The card-settlement de-dup is derived by the shared toResultBankTx mapper, so
  // /api/result, /api/readiness AND the closing package all agree on the same quarter and the
  // same covered-day witness rule (incl. an acquirer payout the owner mis-tapped as 'omzet').
  const bankTx: ResultBankTx[] = bankRows.map(toResultBankTx);

  // [KAS-ZACHT] A removed movement is not turnover, not a cost and not voorbelasting.
  const cash = await liveCashEntries(pipeline);
  const cashRows = await fetchAllRows((from, to) => cash.only(pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date, document_id")
    .eq("user_id", ownerId).gte("entry_date", start).lte("entry_date", end))
    .order("id", { ascending: true }).range(from, to));
  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate, date: c.entry_date,
    document_id: (c as { document_id?: string | null }).document_id ?? null, // [CASH-COST-VAT]
  }));

  // Turnover (widened covered set for the cross-quarter settlement lag).
  const bufD = new Date(Date.UTC(year, startMonth, 1));
  bufD.setUTCDate(bufD.getUTCDate() - 5);
  const startBuffer = `${bufD.getUTCFullYear()}-${pad(bufD.getUTCMonth() + 1)}-${pad(bufD.getUTCDate())}`;
  // [AANGIFTE-TURNOVER-ERROR] Read it the way every other source in this route is read. This was
  // the one plain `const { data } = await …` here, and it DISCARDED the error: a failed read left
  // turnoverRows null, allTurnover empty, and the concept aangifte then declared a till shop's
  // quarter with zero kassa-omzet — a real, understated BTW figure produced by a database hiccup,
  // with a 200 and no warning anywhere. Every other read uses fetchAllRows, which throws, so the
  // request fails and the screen says "Kon de concept-aangifte niet laden" instead of quietly
  // showing a number that is wrong. Missing data must never render as a smaller tax bill.
  // (The pagination is incidental here — one row per day, so a quarter cannot approach the cap.)
  const turnoverRows = await fetchAllRows<{
    turnover_date: string; base_0: number | null; base_9: number | null; base_21: number | null;
    btw_9: number | null; btw_21: number | null; total_incl: number | null;
    pin_amount: number | null; cash_amount: number | null; other_amount: number | null;
  }>((from, to) => pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId).gte("turnover_date", startBuffer).lte("turnover_date", end)
    .order("turnover_date", { ascending: true }).range(from, to));
  const allTurnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));
  const turnover = allTurnover.filter((t) => t.turnover_date >= start);
  const coveredDates = new Set(
    allTurnover.filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0).map((t) => t.turnover_date),
  );

  const coveredBudget = new Map(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );
  // [KASSTELSEL] Resolve the VAT basis for THIS quarter (per-quarter, so a pre-switch quarter
  // stays factuur) and, under kas, gather the settlement inputs. Default factuur → accrual path
  // byte-identical. The concept aangifte then declares BTW on the PAID date, not the invoice date.
  // [VRIJGESTELD] The regime travels in: under kas the settled invoices are a different set
  // from the dated ones, so their exempt parts have to be read there too.
  const sr = await resolveSchemeSettlements(pipeline, ownerId, start, start, end, exemption.active);
  // [RUBRIEK-SPLIT · SCHEME-MERGE] MERGE, never overwrite. These maps cover the invoices DATED in
  // this quarter (what the accrual path needs); sr.opts carries the ones its SETTLEMENTS point at,
  // which under kas includes invoices from earlier quarters that were paid in this one — the
  // normal case, since payment lags the invoice date and regularly crosses a quarter.
  //
  // rateSharesByInvoice was merged here by hand and exemptShareByInvoice on the very next line was
  // not, so a sale invoiced last quarter and paid in this one lost its exempt share entirely and
  // was declared as fully TAXED omzet — BTW paid on vrijgestelde omzet, on the aangifte itself.
  // Both now go through one function that cannot be half-applied. See mergeSchemeOpts.
  //
  // [VRIJGESTELD · KASSTELSEL] The accrual path reads exempt_ex off each invoice above; the
  // cash-basis path books SETTLEMENTS, which carry only an invoice id, so it needs the exempt part
  // as a fraction of that invoice's ex-BTW total. Same numbers, expressed the way each branch can
  // use them.
  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates, 0, coveredBudget, {
    ...mergeSchemeOpts(sr.opts, {
      rateSharesByInvoice,
      exemptShareByInvoice: exemptShareOf(invRaw, exemptExByInvoice),
      // [VRIJGESTELD · KASSTELSEL] Through the merge too, never after it. Under kas the costs
      // that count are the ones SETTLED in the quarter, and sr.opts carries the attributions for
      // exactly those; this map covers the ones DATED in it. Assigning after the merge drops the
      // settled half, and a cost with no attribution falls to the pro-rata bucket — the owner
      // attributed their costs and the deduction comes out as if they had not.
      deductionByInvoice: exemption.deductionByInvoice,
    }),
    exemptRegime: exemption.active,
  });

  // Honest completeness — counts of the ACTUAL data behind each figure.
  const OUT_OK = new Set(["paid", "sent", "overdue"]);
  const IN_OK = new Set(["paid", "received"]);

  // [DATELESS] A verified invoice with NO invoice_date is silently dropped by the date-range
  // fetch above, so it is NOT in the figures — count those separately so the concept can warn
  // instead of quietly understating omzet/voorbelasting. (Matches the ZIP's dateless warning.)
  // Under KAS the invoice_date is irrelevant (invoices enter by payment date); the analogous
  // "money we can't place" signal is sr.undatedPaidCount, surfaced as a hard note below.
  let datelessVerifiedCount = 0;
  if (sr.scheme !== "kas") {
    const datelessRaw = await fetchAllRows((from, to) => pipeline
      .from("invoices")
      .select("status, receiver_id, direction")
      .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
      .is("invoice_date", null)
      .order("id", { ascending: true }).range(from, to));
    datelessVerifiedCount = datelessRaw.filter((i) => {
      const dir = i.direction === "incoming" || i.direction === "outgoing"
        ? i.direction : (i.receiver_id === ownerId ? "incoming" : "outgoing");
      return dir === "incoming" ? IN_OK.has(i.status ?? "") : OUT_OK.has(i.status ?? "");
    }).length;
  }

  // [COUNT-BASIS] Count the set the figures were actually built from. Under factuurstelsel that is
  // the invoices DATED in this quarter; under kasstelsel it is the invoices SETTLED in it — a
  // different set on purpose (kas-payment-events-fetch applies no invoice_date filter, "a
  // prior-year invoice paid this quarter must be reachable"). Counting the dated set under kas
  // printed a number with no relation to 5a/5b in the block this page calls its trust layer: a
  // shop that paid ten old supplier invoices in March could read "5b telt alleen 2 inkoopfacturen".
  // The route already draws this exact distinction three blocks down, where datelessVerifiedCount
  // is skipped under kas "because the invoice_date is irrelevant" — these two counts were simply
  // left behind.
  const settledInvoiceCount = (dir: "incoming" | "outgoing"): number =>
    new Set((sr.opts.settlements ?? []).filter((e) => e.direction === dir).map((e) => e.invoiceId)).size;
  const onCash = sr.scheme === "kas";

  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays,
    scheme: sr.scheme,
    incomingInvoiceCount: onCash
      ? settledInvoiceCount("incoming")
      : invRaw.filter((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "")).length,
    outgoingInvoiceCount: onCash
      ? settledInvoiceCount("outgoing")
      : invRaw.filter((i) => effDir(i) === "outgoing" && OUT_OK.has(i.status ?? "")).length,
    hasEuPurchase: invRaw.some((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "") && typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim())),
    datelessVerifiedCount,
  };

  // [REGIME-FLAGS] Special regimes the concept can't auto-compute (KOR active, BTW verlegd,
  // margeregeling) become honest notes on the concept, so the owner and the accountant see the
  // same handoff the ZIP and readiness show. KOR is owner-declared; verlegd/marge are
  // phrase-gated on the owner's own invoice-line texts (tenant-safe fetch by invoice_id).
  // [KOR-READ-HONEST] This read's error was dropped, and korActive then defaulted to false — which
  // for an owner who IS on the KOR quietly rewrites three things at once:
  //   · the note "KOR is actief — bereken geen BTW" disappears (regime-flags.ts), and that note is
  //     the only thing on this page telling them the full BTW table below does not apply to them;
  //   · the art. 29 lid 7 warning appears, demanding repayment of voorbelasting a KOR entrepreneur
  //     never deducted (bad-debt-collect.ts short-circuits on exactly this flag);
  //   · an ICP-opgaaf and a rubriek 3b get built for supplies that carry none (icp.ts).
  // A tax basis is not a detail to guess at, so this joins the turnover read below the same rule
  // ([AANGIFTE-TURNOVER-ERROR]): the request fails and the screen says it could not load, rather
  // than rendering a confident declaration for a regime the owner is not in.
  const { data: regimeProf, error: regimeProfErr } = await pipeline
    .from("profiles").select("kor_active").eq("id", ownerId).maybeSingle();
  if (regimeProfErr) {
    console.error("[KOR-READ-HONEST] kor_active read failed — refusing to build a concept", { ownerId, year, quarter, error: regimeProfErr.message });
    return NextResponse.json(
      { error: "regime_read_failed", detail: "We konden je BTW-regeling nu niet lezen. Zonder die kan dit concept er totaal anders uitzien, dus we tonen het liever niet. Probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  const korActive = !!(regimeProf as { kor_active?: boolean | null } | null)?.kor_active;
  const regimeInvoices: RegimeInvoiceRef[] = invRaw.map((i) => ({
    id: String(i.id),
    direction: effDir(i),
    label: (i.invoice_number as string | null) ?? null,
  }));
  // [VRIJGESTELD] Exempt turnover is added back for this yardstick, so the KOR check sees exactly
  // the total it always saw. It is no longer in salesByRate (it belongs in no rubriek), and
  // dropping it here would silently make the KOR-limit flag fire LATER for an exempt owner —
  // a change to an unrelated regime, caused by a feature that has no business touching it.
  // Whether art. 11 turnover counts toward the EUR 20.000 limit is a legal question this app does
  // not decide; the flag only ever says "let your accountant check".
  const omzetForKorCheck =
    result.salesByRate.reduce((sum, r) => sum + (r.omzet ?? 0), 0)
    + (result.cashOmzetZonderBtw ?? 0)
    + (result.vrijgesteldeOmzet ?? 0);
  // The blanket `.catch(() => [])` that stood here swallowed the one thing it could not fix: the
  // collector already handles its own line-read failure internally (best-effort by contract, and
  // now logged), so anything reaching this point is a genuine fault in a KOR/verlegd/marge flag —
  // and a concept aangifte that silently loses those is a handover the accountant cannot trust.
  const regimeFlags = await collectRegimeFlags({
    client: pipeline, korActive, omzetForKorCheck, invoices: regimeInvoices,
  });
  const regimeNotes = regimeFlags.map(regimeFlagNote);

  // [KASSTELSEL] Honest notes for the cash-basis concept. The BTW is on the paid date, and any
  // paid-but-undated money is a HARD gap — surfaced so the concept is never quietly too low.
  if (sr.scheme === "kas") {
    regimeNotes.push("Kasstelsel actief — de BTW is berekend op de BETAALdatum van je facturen (niet de factuurdatum). Een onbetaalde factuur telt pas mee zodra hij betaald is.");
    if (sr.undatedPaidCount > 0) {
      regimeNotes.push(
        `LET OP: ${sr.undatedPaidCount} betaalde factu(u)r(en) ${sr.undatedPaidCount === 1 ? "heeft" : "hebben"} geen betaaldatum, ` +
        "dus de betaalde BTW kan (nog) niet in het juiste kwartaal worden geplaatst — dit concept is daardoor mogelijk te laag. " +
        "Koppel de bankbetaling of vul de betaaldatum in voordat je indient.",
      );
    }
    if (sr.estimatedPortionCount > 0) {
      regimeNotes.push(`${sr.estimatedPortionCount} betaaldatum(s) ${sr.estimatedPortionCount === 1 ? "is" : "zijn"} een schatting (handmatig 'betaald' gemarkeerd) — controleer of het kwartaal klopt.`);
    }
  }

  // [BAD-DEBT] Reclaimable BTW on sales invoices > 1 year past due and still unpaid (factuur only).
  // An honest note — never auto-verrekend (the owner/accountant decides the period).
  const badDebt = await collectBadDebt(pipeline, ownerId, sr.scheme, end);
  const bdNote = badDebtNote(badDebt);
  if (bdNote) regimeNotes.push(bdNote);
  // [PRIVEGEBRUIK] Same note on the owner's own screen — see aangifte.ts for why it is a note.
  regimeNotes.push(privegebruikNote(quarter));
  // [ART29-UNKNOWN] A failed read is not "niets terug te vragen" — say which of the two it is.
  if (badDebt.readFailed) {
    regimeNotes.push(
      "We konden nu niet controleren of je BTW kunt terugvragen op facturen die je klanten nooit " +
      "betaald hebben (art. 29 Wet OB). Dat betekent niet dat er niets is — probeer deze pagina zo " +
      "meteen opnieuw voordat je indient.",
    );
  }
  // Report the count/euro TOGETHER, gated on the same materiality as the note, so the API can never
  // say "1 factuur / €0 terugvraagbaar" (an immaterial sub-euro reclaim rounds to 0 and isn't flagged).
  const bdMaterial = badDebt.totalReclaimableBtw >= BAD_DEBT_MIN_EUR;

  // [BAD-DEBT] Art. 29 lid 7 — the other direction: voorbelasting on purchase invoices >1 year
  // unpaid becomes payable again. The sales note above is money to GET; this one is money to
  // GIVE, which is why it goes first in the list — it is the only art. 29 side that turns into a
  // naheffing when it is ignored. KOR-active owners deduct nothing, so they are never told this.
  const clawback = await collectVatClawback(pipeline, ownerId, sr.scheme, end, korActive);
  const cbNote = vatClawbackNote(clawback);
  if (cbNote) regimeNotes.unshift(cbNote);
  const cbMaterial = clawback.totalRepayableBtw >= BAD_DEBT_MIN_EUR;
  // [ART29-UNKNOWN] This is the side that becomes a naheffing when it goes unnoticed, and the red
  // banner on this page is usually the only place the owner ever meets it. A failed read used to
  // render exactly like a clean quarter: no banner, no note, nothing. It goes FIRST, for the same
  // reason the clawback note itself does.
  if (clawback.readFailed) {
    regimeNotes.unshift(
      "LET OP: we konden niet controleren of er voorbelasting terugbetaald moet worden op " +
      "inkoopfacturen die al meer dan een jaar openstaan (art. 29 lid 7 Wet OB). Dat is niet " +
      "hetzelfde als 'er is niets' — ververs deze pagina voordat je indient, want deze post wordt " +
      "een naheffing als hij wordt overgeslagen.",
    );
  }

  // [KAS-DUBBELE-KOST] One purchase written down twice — a hand-typed cash 'kosten' line beside
  // the invoice it duplicates. The cost is then deducted twice and, when the cash line carries a
  // bon and a rate, the BTW is reclaimed twice. It lands in THIS declaration, which is why it is
  // named here and not only on the Kas screen where the owner can act on it.
  //
  // A note, never a block and never a correction. The drawer gate refuses a filing because a
  // negative till is arithmetic; this is a PAIRING — cent-exact within a month is strong evidence,
  // not proof — and stopping an owner from filing on a probable duplicate would be worse than the
  // duplicate. It goes after the art. 29 pair: those are money that must move, this is a question.
  const dupRange = { from: start, to: end };
  const doubleCosts = await collectCashCostOverlaps(pipeline, ownerId, dupRange);
  const dcNote = doubleCostNote(doubleCosts.overlaps);
  if (dcNote) regimeNotes.push(dcNote);
  // [NO-SILENT-EMPTY] A read that failed is not a clean quarter, and on this page the ABSENCE of a
  // note is the only thing that says so.
  if (doubleCosts.readFailed) {
    regimeNotes.push(
      "We konden niet controleren of er kosten dubbel in je boeken staan — een kasregel die " +
      "dezelfde aankoop is als een inkoopfactuur. Dat is niet hetzelfde als 'er is niets'; ververs " +
      "deze pagina voordat je indient.",
    );
  }

  // [ICP] Sales to businesses in other EU member states belong in rubriek 3b, not in 1e — and
  // they carry a SECOND declaration (the ICP-opgaaf) that no rubriek can hint at. Built from the
  // same quarter rows the rubrieken are built from, so 3b can never contain a euro 1e did not.
  const icp = buildIcp({
    korActive,
    invoices: invRaw.map((i): IcpInvoice => ({
      invoiceNumber: (i.invoice_number as string | null) ?? null,
      clientName: (i.client_name as string | null) ?? null,
      clientVatNumber: (i.client_btw_number as string | null) ?? null,
      direction: effDir(i),
      status: (i.status as string | null) ?? null,
      totalExBtw: i.total_ex_btw as number | null,
      btwAmount: i.btw_amount as number | null,
    })),
  });
  const icNote = icpNote(icp);
  if (icNote) regimeNotes.push(icNote);

  // [ICP] The purchase mirror (4a/4b). Not computed — see buildForeignPurchases for why — but
  // NAMED, so the accountant does not have to page through the quarter to find which invoices
  // carry verlegde BTW.
  const euPurchases = buildForeignPurchases({
    invoices: invRaw.map((i): IcpInvoice => ({
      invoiceNumber: (i.invoice_number as string | null) ?? null,
      clientName: (i.client_name as string | null) ?? null,
      clientVatNumber: (i.client_btw_number as string | null) ?? null,
      direction: effDir(i),
      status: (i.status as string | null) ?? null,
      totalExBtw: i.total_ex_btw as number | null,
      btwAmount: i.btw_amount as number | null,
    })),
  });

  const aangifte = buildAangifte(
    { ...result, intraEuOmzet: icp.totalExBtw },
    { ...completeness, euPurchaseNote: foreignPurchaseNote(euPurchases) },
    `Q${quarter} ${year}`, regimeNotes,
  );

  // [FILED-QUARTER] Was this quarter already handed in? The page did not ask, and everything it
  // shows is recomputed LIVE — so an owner who opens Q1 after filing it reads a fresh set of
  // figures with nothing saying they are no longer the ones the Belastingdienst has. The app
  // itself treats a filing as a frozen snapshot (btw_filings) whose later drift is a suppletie,
  // and it already computes that difference — on /dashboard/waarheid, not here. Worse, the notice
  // this app sends when a removed invoice changes a filed quarter says "bekijk het verschil op de
  // BTW-pagina" and links HERE. So the concept now carries what it needs to say so, and to send
  // the owner to the screen that owns the correction.
  //
  // A failed read is reported as UNKNOWN, never as "not filed": telling someone their quarter is
  // still open when it is not is the one wrong answer this block could give.
  // btw_filings is not in the generated types (btw_filings.sql) → same relaxed client /api/truth uses.
  let filed: { filedAt: string; verschuldigd: number; voorbelasting: number; saldo: number } | null = null;
  let filedUnknown = false;
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fRow, error: fErr } = await (pipeline as any)
      .from("btw_filings")
      .select("filed_at, btw_verschuldigd, btw_voorbelasting, btw_saldo")
      .eq("user_id", ownerId)
      .eq("year", year)
      .eq("quarter", quarter)
      .maybeSingle();
    if (fErr) {
      // [DEPLOY-SAFE] btw_filings arrives with its own hand-applied migration. Where it has not
      // landed, nobody can have filed anything — that is a complete answer, not an unknown, and
      // treating it as one would put a "we konden het niet controleren" banner on every load
      // forever. Any OTHER error stays unknown (see pg-missing.ts for why the two differ).
      if (isMissingRelation(fErr.message)) {
        filed = null;
      } else {
        filedUnknown = true;
        console.error("[FILED-QUARTER] btw_filings read failed — reporting unknown, not 'not filed'", { ownerId, year, quarter, error: fErr.message });
      }
    } else if (fRow) {
      const r = fRow as { filed_at: string; btw_verschuldigd: number | null; btw_voorbelasting: number | null; btw_saldo: number | null };
      filed = {
        filedAt: r.filed_at,
        verschuldigd: Math.round(Number(r.btw_verschuldigd) || 0),
        voorbelasting: Math.round(Number(r.btw_voorbelasting) || 0),
        saldo: Math.round(Number(r.btw_saldo) || 0),
      };
    }
  }

  return NextResponse.json({
    ok: true, year, quarter, aangifte, scheme: sr.scheme, undatedPaidCount: sr.undatedPaidCount,
    filed, filedUnknown,
    badDebtReclaimableBtw: bdMaterial ? Math.round(badDebt.totalReclaimableBtw) : 0,
    badDebtCount: bdMaterial ? badDebt.eligible.length : 0,
    vatClawbackBtw: cbMaterial ? Math.round(clawback.totalRepayableBtw) : 0,
    vatClawbackCount: cbMaterial ? clawback.eligible.length : 0,
    // [ICP] The opgaaf travels BESIDE the aangifte, never inside it — it is a separate
    // declaration, and presenting it as a rubriek would be the one thing that makes an owner
    // think it was filed with the rest.
    icp: { lines: icp.lines, totalExBtw: Math.round(icp.totalExBtw), problems: icp.problems },
    euPurchases: { count: euPurchases.purchases.length, totalExBtw: Math.round(euPurchases.totalExBtw) },
  });
}
