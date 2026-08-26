// src/lib/ubl-for-email.ts
// [E-FACTUUR-MEE] The UBL e-invoice as a best-effort e-mail attachment.
//
// A Dutch business customer books an invoice by importing it — their package reads UBL, and a
// mail that carries only a PDF forces them to retype what the sender's app already knows to the
// cent. So the send route attaches the e-factuur XML next to the PDF whenever it CAN be built.
//
// "Whenever it can" is the whole design. The PDF is the legal document and its delivery may
// never wait on the XML: a profile missing its KVK, an invoice the generator refuses, a database
// where a lines-migration is still open — every one of those returns null here (logged once) and
// the mail goes out exactly as before. That is also why this module exists instead of the send
// route calling five selects itself: the fetch-and-map sequence below mirrors
// /api/export/ubl/route.ts, and both go through the ONE row→generator mapping in ubl-inputs.ts
// ([E-FACTUUR]: a second hand-written mapping is how a selected column silently stops reaching
// the file). The refusal SEMANTICS differ on purpose — the export route answers a person and
// explains in Dutch; this path answers a mail pipeline and steps aside.

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildInvoiceUbl, UblValidationError, type UblSupplier } from "./ubl-export";
import {
  UBL_INVOICE_SELECT,
  UBL_LINES_SELECT,
  UBL_LINES_SELECT_MINIMAL,
  UBL_PROFILE_SELECT,
  ublHeaderFrom,
  ublLinesFrom,
  originalInvoiceRef,
  type UblInvoiceRow,
  type UblLineRow,
} from "./ubl-inputs";
import { isUnknownColumn } from "./created-by";
import { CLIENT_EXTRA_LINE_COLUMNS } from "./client-extra-lines";

export interface UblEmailAttachment {
  filename: string;
  content: Buffer;
}

/**
 * Build the e-factuur XML for one OUTGOING invoice, as an attachment — or null when it cannot be
 * built, for any reason at all. Callers treat null as "attach nothing", never as an error.
 */
export async function ublAttachmentForInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<UblEmailAttachment | null> {
  try {
    const { data: invoiceRow, error: invErr } = await supabase
      .from("invoices")
      .select(UBL_INVOICE_SELECT)
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoiceRow) return null;
    const inv = invoiceRow as unknown as UblInvoiceRow & { sender_id: string | null; direction: string | null; invoice_number: string | null };
    if (inv.direction === "incoming" || !inv.sender_id) return null;

    // [UNIT]/[E-FACTUUR] Same two-column fallback as the export route: one 42703 on `unit` or
    // `vat_treatment` must not cost the attachment on a database where the migration is open.
    const eersteLezing = await supabase
      .from("invoice_lines")
      .select(UBL_LINES_SELECT)
      .eq("invoice_id", invoiceId)
      .order("id", { ascending: true });
    const { data: lineRows, error: linesErr } =
      isUnknownColumn(eersteLezing.error, "unit") || isUnknownColumn(eersteLezing.error, "vat_treatment")
        ? await supabase
            .from("invoice_lines")
            .select(UBL_LINES_SELECT_MINIMAL)
            .eq("invoice_id", invoiceId)
            .order("id", { ascending: true })
        : eersteLezing;
    if (linesErr) return null;

    const { data: profileRow, error: profErr } = await supabase
      .from("profiles")
      .select(UBL_PROFILE_SELECT)
      .eq("id", inv.sender_id)
      .single();
    if (profErr || !profileRow) return null;

    // [KLANT-EXTRA] Separately and failably read, like the export route: an open migration
    // costs the three client lines, not the attachment. But ONLY that error is benign — any
    // other failure here means the invoice may carry client lines we did not read, and a valid
    // XML missing content it should have is worse than no XML: the customer's package would
    // book it as complete. So a real read error withdraws the attachment.
    const { data: extraRow, error: extraErr } = await supabase
      .from("invoices")
      .select(CLIENT_EXTRA_LINE_COLUMNS.join(", "))
      .eq("id", invoiceId)
      .maybeSingle();
    if (extraErr && !CLIENT_EXTRA_LINE_COLUMNS.some((c) => isUnknownColumn(extraErr, c))) return null;

    // [CREDIT-REF] BG-3 for a creditnota mail — best-effort, a failed read costs the reference.
    const origRef = await originalInvoiceRef(supabase, inv);
    const header = ublHeaderFrom(inv, (extraRow ?? null) as Record<string, string | null> | null, origRef);
    const lines = ublLinesFrom((lineRows ?? []) as unknown as UblLineRow[]);
    const { xml } = buildInvoiceUbl(header, lines, profileRow as unknown as UblSupplier, {
      korActive: !!(profileRow as { kor_active?: boolean | null }).kor_active,
    });
    const nr = (inv.invoice_number ?? invoiceId).replace(/[^a-zA-Z0-9._-]/g, "_");
    return { filename: `boekbrug-factuur-${nr}-ubl.xml`, content: Buffer.from(xml, "utf8") };
  } catch (err) {
    // A refused invoice (missing KVK/BTW, arithmetic the generator will not sign) is normal
    // here — the profile screen is where that gets fixed, not the send path.
    if (!(err instanceof UblValidationError)) {
      console.warn("[E-FACTUUR-MEE] UBL attachment skipped", { invoiceId, error: err instanceof Error ? err.message : String(err) });
    }
    return null;
  }
}
