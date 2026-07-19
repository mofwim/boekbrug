// src/lib/regime-collect.ts
// [REGIME-FLAGS] The ONE I/O collector shared by /api/readiness, /api/aangifte and the closing
// package, so all three detect the same regimes from the same evidence and never disagree. It
// fetches the owner's invoice line texts (phrase source) and hands them to the pure
// detectRegimeFlags. Kept out of regime-flags.ts so that module stays pure + node-testable.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import { detectRegimeFlags, type RegimeFlag, type RegimeLineSignal } from "./regime-flags";

export interface RegimeInvoiceRef {
  id: string;
  direction: "incoming" | "outgoing";
  label: string | null; // invoice_number, for the flag's evidence
}

/**
 * Gather the regime flags for one owner/quarter. Tenant-safe: invoice lines are fetched ONLY
 * by invoice_id IN the caller's own quarter invoice ids (never a broad scan), so an accountant
 * path scoped to a client sees only that client's lines. Best-effort on the line fetch (a query
 * hiccup yields no phrase flags, never a crash) — the KOR flags don't depend on lines anyway.
 */
export async function collectRegimeFlags(args: {
  client: PipelineClient;
  korActive: boolean;
  omzetForKorCheck: number;
  invoices: RegimeInvoiceRef[];
}): Promise<RegimeFlag[]> {
  const refById = new Map<string, RegimeInvoiceRef>();
  for (const inv of args.invoices) if (inv.id) refById.set(inv.id, inv);
  const ids = [...refById.keys()];

  const lines: RegimeLineSignal[] = [];
  if (ids.length > 0) {
    const rows = await fetchAllRows<{ invoice_id: string | null; description: string | null }>((from, to) =>
      args.client
        .from("invoice_lines")
        .select("invoice_id, description")
        .in("invoice_id", ids)
        .order("invoice_id", { ascending: true })
        .range(from, to),
    ).catch(() => [] as Array<{ invoice_id: string | null; description: string | null }>);
    for (const r of rows) {
      if (!r.invoice_id || !r.description) continue;
      const ref = refById.get(r.invoice_id);
      if (!ref) continue;
      lines.push({ direction: ref.direction, text: r.description, invoiceLabel: ref.label ?? undefined });
    }
  }

  return detectRegimeFlags({
    korActive: args.korActive,
    omzetForKorCheck: args.omzetForKorCheck,
    lines,
  });
}
