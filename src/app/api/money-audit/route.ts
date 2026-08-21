// src/app/api/money-audit/route.ts
// [GELD-INVARIANT] Kloppen de boeken met zichzelf?
//
// De regel staat in src/lib/money-invariants.ts en is daar getest; deze route haalt alleen op.
//
// ── WAAROM DEZE ROUTE ER PAS NU IS ──
//
// money-invariants.ts is compleet, doordacht en getest — en niets riep het aan. Geen enkel scherm,
// geen enkele cron, geen enkele route. Een geldaudit die nergens draait is precies het soort
// gebrek waar dit hele bestand vol commentaar over staat: iets wat is uitgerekend en aan niemand
// verteld. Een sweep over de exports van src/lib vond het, samen met een handvol andere.
//
// ── DE TWEE ASSEN, EN WAAROM ZE APART FALEN ──
//
//   1. FACTUREN ↔ BETALINGEN. Staat er 'betaald' zonder dat er geld tegenover staat, is er méér
//      toegepast dan de factuur groot is, is een banklijn over meerdere facturen overbesteed,
//      klopt de btw-optelling van de kop, heeft een creditnota het verkeerde teken.
//   2. DE KASLADE. Zegt een factuur dat er contant is betaald terwijl de lade niet bewoog (saldo
//      staat te hoog), of andersom (te laag), en zakt de lade ergens onder nul — fysiek onmogelijk
//      en het eerste waar de Belastingdienst een kasadministratie op afwijst.
//
// Elke as leest zijn eigen bronnen en mag alleen falen. Een mislukte kaslezing zegt
// `ladeGecontroleerd: false` en NOOIT "de lade klopt" — een controle die niet draaide is iets
// anders dan een controle die niets vond, en dat verschil is het halve product.
//
// ── EN HIJ REPAREERT NIETS ──
//
// Zelfde regel als books-audit.ts: een verschil betekent dat twee bronnen het oneens zijn, en
// automatisch herstellen moet er één kiezen. Fout kiezen schrijft een onwaar getal over een waar
// getal heen en wist het bewijs dat ze ooit verschilden. Dit stelt vast. Beslissen is mensenwerk.

import { NextResponse } from "next/server";

// [ACTING-FOR] Owner only — dezelfde reden als /api/invoice/continuity: een medewerker is de
// sender_id van geen enkele factuur, dus hij zou een LEGE set lezen. En een lege set heeft geen
// enkel verschil, dus dit scherm zou hem melden dat de boeken kloppen over een administratie die
// hij niet kan zien. Een vals groen op precies de controle die nooit vals groen mag zijn.
import { requireOwner } from "@/lib/owner-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  findMoneyViolations,
  findDrawerViolations,
  moneyAuditHeadline,
  type InvoiceRow,
  type LinkRow,
  type TransactionRow,
} from "@/lib/money-invariants";
import { loadCashSettlementState } from "@/lib/cash-settle";
import { computeCashSettlementSync } from "@/lib/cash";
import { loadDrawerWitness } from "@/lib/drawer-witness";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOwner("Deze controle");
  if (guard.response) return guard.response;
  const ownerId = guard.acting!.ownerId;

  const supabase = await createServerSupabaseClient();

  // ── As 1: facturen ↔ betalingen ──
  //
  // [PAGINATION] Alle drie pagineren. Een afgekapte factuurlezing meldt niets verkeerds — de
  // facturen die eruit vielen worden simpelweg niet gecontroleerd — maar een afgekapte LINK-lezing
  // is erger dan stil: dan mist een factuur zijn betalingen en meldt deze controle "betaald zonder
  // dat er geld tegenover staat" over een factuur die keurig is voldaan. Een vals alarm over geld
  // is precies waarom niemand een controle nog leest.
  let invoices: InvoiceRow[];
  let links: LinkRow[];
  let transactions: TransactionRow[];
  try {
    const [invRows, linkRows, txRows] = await Promise.all([
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from("invoices")
          .select("id, invoice_number, direction, status, invoice_type, total_ex_btw, btw_amount, total_inc_btw, amount_paid, sender_id, receiver_id")
          .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
          .neq("status", "archived")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from("bank_tx_invoices")
          .select("transaction_id, invoice_id, amount_applied")
          .eq("user_id", ownerId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from("bank_transactions")
          .select("id, amount")
          .eq("user_id", ownerId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

    invoices = invRows.map((r) => ({
      id: String(r.id),
      invoiceNumber: (r.invoice_number as string | null) ?? null,
      direction: (r.direction as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      invoiceType: (r.invoice_type as string | null) ?? null,
      totalExBtw: (r.total_ex_btw as number | null) ?? null,
      btwAmount: (r.btw_amount as number | null) ?? null,
      totalIncBtw: (r.total_inc_btw as number | null) ?? null,
      amountPaid: (r.amount_paid as number | null) ?? null,
    }));
    links = linkRows
      .filter((r) => !!r.invoice_id)
      .map((r) => ({
        // Een kaslink heeft geen transactie. Hij telt WEL mee als betaling op de factuur — dat is
        // precies wat hij is — maar hoort bij geen banklijn, dus de lege string zorgt dat hij niet
        // in de over-besteding van een echte lijn belandt.
        transactionId: (r.transaction_id as string | null) ?? "",
        invoiceId: String(r.invoice_id),
        amountApplied: (r.amount_applied as number | null) ?? null,
      }));
    transactions = txRows.map((r) => ({ id: String(r.id), amount: (r.amount as number | null) ?? null }));
  } catch (e) {
    // De enige lezing waar deze controle niet buiten kan. Zonder de facturen valt er niets te
    // vergelijken, en "geen verschillen gevonden" over een mislukte lezing is de valse
    // geruststelling die dit eindpunt juist moet wegnemen.
    console.error("[GELD-INVARIANT] could not read the books — refusing to judge them", {
      ownerId,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "books_unreadable" }, { status: 503 });
  }

  const violations = findMoneyViolations({ invoices, links, transactions });

  // ── As 2: de kaslade ──
  //
  // Eigen leesbeurt, eigen mislukking. Over het HUIDIGE kwartaal, want dat is de lade waar de
  // eigenaar vandaag iets aan kan doen; een lade die in Q1 onder nul dook is een correctie, geen
  // waarschuwing.
  let drawer: ReturnType<typeof findDrawerViolations> = [];
  let drawerChecked = false;
  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const state = await loadCashSettlementState(supabase, ownerId);
    if (state.ok) {
      const sync = computeCashSettlementSync(state.paid, state.existing);
      const witness = await loadDrawerWitness({ client: supabase, ownerId, year, quarter });
      drawer = findDrawerViolations({
        settlementEntries: state.existing,
        sync,
        lowestPoint: witness.lowestPoint,
      });
      drawerChecked = true;
    }
  } catch (e) {
    console.error("[GELD-INVARIANT] the drawer axis could not run — it is reported as unchecked", {
      ownerId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({
    ok: true,
    headline: moneyAuditHeadline(violations),
    violations,
    drawer,
    // Zodat het scherm kan zeggen WELKE helft niet gedraaid heeft, in plaats van een vage
    // waarschuwing of — erger — stilte die als "in orde" leest.
    drawerChecked,
    counted: { invoices: invoices.length, links: links.length, transactions: transactions.length },
  });
}
