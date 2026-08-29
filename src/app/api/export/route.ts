// app/api/export/route.ts
// [BOEK-013] Quarterly CSV export — May 2026
// [BOEK-014] Year / status / accountant mode — May 2026
// [BOEK-014] Minor fix: exclude archived, add invoice_type to SELECT — May 2026
// [BOEK-014] TS fix: GenericStringError resolved — separate SELECT constants — May 2026
//
// GET /api/export?year=2026&quarter=1           ← quarter export (existing)
// GET /api/export?year=2026                     ← full year export
// GET /api/export?year=2026&status=paid         ← filter by status
// GET /api/export?year=2026&accountant=true     ← all clients (accountant only)

import { NextRequest, NextResponse } from "next/server";
import { amsterdamYear } from "@/lib/format-nl";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { quarterStartDate, quarterEndDate } from "@/lib/quarterly";
// [PAGINATION] PostgREST silently caps a single .select() at ~1000 rows — a
// full-year or all-clients export beyond that was truncated with NO warning,
// so the accountant's CSV understated omzet/voorbelasting while the on-screen
// figures (paginated) were right. Same fix class as kluis/closing-package.
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  type InvRow,
  type InvoiceExportRowFull,
  type InvoiceExportRowAccountant,
  toExportRowFull,
  invoicesToCsv,
  invoicesToCsvAccountant,
} from "@/lib/export";
import type { Database } from "@/types/database.types";
import { logAuditAction } from "@/lib/audit";

// [BOEK-FOUNDATION-TYPES] Valid invoice statuses from DB CHECK constraint
type InvoiceStatus = NonNullable<Database["public"]["Tables"]["invoices"]["Row"]["status"]>;

const VALID_STATUSES: readonly InvoiceStatus[] = [
  'draft', 'sent', 'paid', 'overdue', 'received',
  'processing', 'processed', 'unclear', 'archived'
] as const;

function isValidStatus(s: string | null): s is InvoiceStatus {
  return s !== null && (VALID_STATUSES as readonly string[]).includes(s);
}

// [BOEK-014] Separate SELECT constants — concatenation causes GenericStringError
const INVOICE_SELECT =
  "invoice_number, client_name, client_email, client_address, client_postal_code, client_city, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, created_at, invoice_type" as const;

// [F2] Both owner sides — an invoice is attributed to the client that is either
// its sender (a sale) or its receiver (a purchase).
const INVOICE_SELECT_WITH_OWNERS =
  "invoice_number, client_name, client_email, client_address, client_postal_code, client_city, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, created_at, invoice_type, sender_id, receiver_id" as const;

// Local type for accountant query rows — includes both owner ids
type InvRowWithOwners = InvRow & { sender_id: string | null; receiver_id: string | null };

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Niet ingelogd", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const now = new Date();
  // [TZ] The owner's year, not the server's: on a UTC server the first hour of 1 January
  // still reads as December, and this default decides which year gets exported.
  const year = Number(req.nextUrl.searchParams.get("year") ?? amsterdamYear(now));
  const rawQuarter = req.nextUrl.searchParams.get("quarter");
  const clientId = req.nextUrl.searchParams.get("clientId");
  const statusFilter = req.nextUrl.searchParams.get("status");
  const accountantMode = req.nextUrl.searchParams.get("accountant") === "true";

  if (isNaN(year)) {
    return new NextResponse("Ongeldig jaar", { status: 400 });
  }

  // ─── Date range ───────────────────────────────────────────────────────────
  let start: string;
  let end: string;
  let periodLabel: string;

  if (rawQuarter) {
    const quarter = Number(rawQuarter) as 1 | 2 | 3 | 4;
    if (quarter < 1 || quarter > 4) {
      return new NextResponse("Ongeldig kwartaal", { status: 400 });
    }
    start = quarterStartDate(year, quarter);
    end = quarterEndDate(year, quarter);
    periodLabel = `Q${quarter} ${year}`;
  } else {
    start = `${year}-01-01`;
    end = `${year}-12-31`;
    periodLabel = `${year}`;
  }

  // ─── Accountant all-clients mode ──────────────────────────────────────────
  if (accountantMode) {
    if (profile?.role !== "accountant") {
      return new NextResponse("Geen toegang", { status: 403 });
    }

    const { data: clientLinks } = await supabase
      .from("accountant_clients")
.select("zzper_id, profiles!accountant_clients_zzper_id_fkey(id, full_name, company_name)")      .eq("accountant_id", user.id);

    if (!clientLinks || clientLinks.length === 0) {
      return new NextResponse("Geen klanten gekoppeld", { status: 404 });
    }

    // [BEWIJS] Ook deze export vastleggen — zie de toelichting in
    // /api/closing-package. Best effort en na de autorisatie.
    // [NIET-LOSGELATEN] Afgewacht. De toelichting hierboven zegt zelf waarom: het verschil met
    // een gedeelde map bestaat pas als de download AANTOONBAAR is. Serverless mag een losgelaten
    // belofte afkappen zodra het bestand is verstuurd, dus `void` maakte juist dat bewijs
    // optioneel. logAuditAction vangt zijn eigen fouten af en gooit niet, dus afwachten kost een
    // insert en kan de download nooit tegenhouden.
    await logAuditAction({
      userId: user.id,
      action: 'accountant.export_downloaded',
      entityType: 'quarter',
      entityId: `alle-klanten:${periodLabel}`,
    });

    const clientNames: Record<string, string> = {};
    const clientIds: string[] = [];

for (const link of clientLinks) {
  // [BOEK-FOUNDATION-TYPES] FK hint returns single object, not array
  const p = link.profiles as { id: string; full_name: string | null; company_name: string | null } | null;
  if (!p) continue;
  clientIds.push(p.id);
  clientNames[p.id] = p.company_name ?? p.full_name ?? "Onbekend";
}

    if (clientIds.length === 0) {
      return new NextResponse("Geen klanten gevonden", { status: 404 });
    }

    // [F2] Both directions + verified. The old query fetched outgoing PAID only,
    // so every client's PURCHASES and unpaid SALES were missing and the bulk CSV
    // disagreed with the on-screen accountant quarter. Fetch invoices where a
    // linked client is EITHER the sender (sales) or the receiver (purchases),
    // restricted to the VERIFIED set, then attribute each row to its owning client
    // by direction.
    const idList = clientIds.join(",");
    // [PAGINATION] fetchAllRows pages past the ~1000-row cap; stable id
    // tiebreak keeps pages disjoint when many invoices share a date.
    let rawData: unknown[];
    try {
      rawData = await fetchAllRows((from, to) => supabase
        .from("invoices")
        .select(INVOICE_SELECT_WITH_OWNERS)
        .or(`sender_id.in.(${idList}),receiver_id.in.(${idList})`)
        .in("status", ["sent", "paid", "overdue", "received"])
        .gte("invoice_date", start)
        .lte("invoice_date", end)
        .order("invoice_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "export_failed" }, { status: 500 });
    }

    // Safe cast via unknown — select constant guarantees the shape
    const data = (rawData as unknown) as InvRowWithOwners[];

    const clientIdSet = new Set(clientIds);
    const rows = data
      .map((inv) => {
        // Owning client: outgoing → sender (seller), incoming → receiver (buyer).
        // Infer direction from ownership when the column is null.
        const dir =
          inv.direction ??
          (inv.receiver_id && clientIdSet.has(inv.receiver_id) ? "incoming" : "outgoing");
        const klantId = dir === "incoming" ? inv.receiver_id : inv.sender_id;
        return { inv, klantId };
      })
      .filter((x): x is { inv: InvRowWithOwners; klantId: string } =>
        !!x.klantId && clientIdSet.has(x.klantId)
      )
      .map(({ inv, klantId }) => {
        const base = toExportRowFull(inv, periodLabel);
        return { ...base, klant_id: klantId } as InvoiceExportRowAccountant;
      });

    const csv = invoicesToCsvAccountant(rows as InvoiceExportRowFull[], clientNames);
    const filename = rawQuarter
      ? `boekbrug-klanten-Q${rawQuarter}-${year}.csv`
      : `boekbrug-klanten-${year}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // ─── Single user / single client mode ────────────────────────────────────
  if (profile?.role === "accountant" && clientId) {
    const { data: rel } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!rel) return new NextResponse("Geen toegang", { status: 403 });
  }

  const targetId =
    profile?.role === "accountant" && clientId ? clientId : user.id;

  // [FIN-1] Both directions: a quarter includes INCOMING purchases (receiver_id)
  // as well as OUTGOING sales (sender_id). The old `.eq("sender_id", targetId)`
  // fetched sales only, so every expense was absent from the CSV even though it
  // appears in the quarterly screen and the closing package.
  // [FIN-1] Status: honour an explicit filter for either role; otherwise default
  // to the VERIFIED set used by the quarterly screen + closing package
  // ({sent,paid,overdue,received}), so the CSV never leaks draft/processing/unclear
  // and matches the numbers the user was just looking at. (Before: the ZZP path
  // had NO status filter — leaking unverified rows — and the accountant path
  // defaulted to paid-only, disagreeing with the on-screen quarter.)
  //
  // [PAGINATION] Built as a per-page factory (a builder is single-use once
  // awaited): fetchAllRows pages past the ~1000-row cap with a stable
  // invoice_date+id order, so a full-year export can never silently truncate.
  const makeQuery = (from: number, to: number) => {
    let q = supabase
      .from("invoices")
      .select(INVOICE_SELECT)
      .or(`sender_id.eq.${targetId},receiver_id.eq.${targetId}`)
      .neq("status", "archived")
      .gte("invoice_date", start)
      .lte("invoice_date", end);
    if (isValidStatus(statusFilter)) {
      q = q.eq("status", statusFilter);
    } else {
      q = q.in("status", ["sent", "paid", "overdue", "received"]);
    }
    return q
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  };

  let rawData: unknown[];
  try {
    rawData = await fetchAllRows(makeQuery);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "export_failed" }, { status: 500 });
  }

  // Safe cast via unknown — select constant guarantees the shape
  const data = (rawData as unknown) as InvRow[];

  const rows = data.map((inv) => toExportRowFull(inv, periodLabel));
  const csv = invoicesToCsv(rows);

  const filename = rawQuarter
    ? `boekbrug-Q${rawQuarter}-${year}.csv`
    : `boekbrug-${year}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}