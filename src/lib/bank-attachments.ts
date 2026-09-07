// src/lib/bank-attachments.ts
// [BIJLAGE-BIJ-REGEL] A file kept WITH a bank line — a receipt, a customer's remittance, the letter
// behind a storno — without turning it into an invoice. Read helper shared by the screens that list
// bank lines, so every card shows the same attachments the same way.
//
// Deploy-safe like every hand-applied migration here: a missing table is "no attachments", which is
// the true answer before the table exists; any other read failure is logged and answered empty,
// because a card that cannot list its attachments is still a card the owner must be able to act on.

import { fetchAllRowsForIds } from "./supabase-paginate";
import { isMissingRelation } from "./pg-missing";

export interface BankAttachment {
  id: string;
  documentId: string;
  fileName: string;
  fileType: string | null;
  createdAt: string;
}

/** Files the owner may attach to a line. Same list the upload screen accepts, minus spreadsheets. */
export const ATTACHMENT_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "text/plain",
]);
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

export function attachmentTypeAllowed(mime: string | null | undefined, name: string): boolean {
  if (mime && ATTACHMENT_TYPES.has(mime)) return true;
  return /\.(pdf|jpe?g|png|webp|heic|txt)$/i.test(name);
}

/** The attachments of many lines at once, keyed by transaction id. Never throws. */
export async function attachmentsByTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  userId: string,
  transactionIds: readonly string[],
): Promise<Map<string, BankAttachment[]>> {
  const out = new Map<string, BankAttachment[]>();
  const ids = [...new Set(transactionIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const rows = await fetchAllRowsForIds<{
      id: string; transaction_id: string; document_id: string; created_at: string;
      documents: { file_name: string; file_type: string | null } | null;
    }, string>(ids, (chunk, from, to) =>
      client
        .from("bank_tx_attachments")
        .select("id, transaction_id, document_id, created_at, documents(file_name, file_type)")
        .eq("user_id", userId)
        .in("transaction_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const list = out.get(r.transaction_id) ?? [];
      list.push({
        id: r.id, documentId: r.document_id, createdAt: r.created_at,
        fileName: r.documents?.file_name ?? "bestand", fileType: r.documents?.file_type ?? null,
      });
      out.set(r.transaction_id, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isMissingRelation(msg)) console.error("[BIJLAGE-BIJ-REGEL] attachments read failed — cards show none", { userId, error: msg });
  }
  return out;
}
