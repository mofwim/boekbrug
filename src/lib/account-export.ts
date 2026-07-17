// src/lib/account-export.ts
// [BOEK-032] Account data export (GDPR) — builds a ZIP of the user's own data.
//
// Server-only. Bundles:
//   facturen.csv   → all invoices (user as sender or receiver), via export.ts
//   bestanden/...  → the user's actual Storage files (bucket "documents")
//   profiel.json   → the user's profile record (verbatim)
//   manifest.json  → summary + any skipped files (transparency pillar)
//
// Ownership: this file is owned by [BOEK-032]. export.ts is owned by B.14/B.20 —
// we CALL its helpers (toExportRowFull, invoicesToCsv); we never modify it.
//
// Security: the caller (api/account/delete) MUST pass a userId taken from a
// VERIFIED session. The pipeline (service_role) client bypasses RLS, so every
// query here is explicitly scoped to that userId (handoff lesson 3).

import JSZip from "jszip";
import type { PipelineClient } from "./supabase-pipeline";
import { toExportRowFull, invoicesToCsv, type InvRow } from "./export";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountExportSummary {
  invoiceCount: number;
  fileCount: number; // files successfully included
  bankCount: number;
  cashCount: number;
  turnoverCount: number;
  messageCount: number;
  skipped: { name: string; reason: string }[];
  generatedAt: string; // ISO
}

export interface AccountExportResult {
  zipBytes: Buffer;
  summary: AccountExportSummary;
}

/** A file already downloaded from Storage, ready to drop into the ZIP. */
export interface ExportFile {
  path: string; // documents.file_url (raw path, e.g. "<userId>/2026/Q1/...pdf")
  name: string; // documents.file_name (display name, used as fallback)
  bytes: Uint8Array;
}

interface AssembleInput {
  userId: string;
  profile: unknown; // profile row, dumped verbatim as JSON
  invoices: InvRow[];
  files: ExportFile[];
  // [EXPORT-COMPLETE] The rest of the user's own data, dumped verbatim as JSON so the
  // GDPR export actually contains "al je gegevens" — not just invoices/docs/profile.
  bankTransactions?: unknown[];
  cashEntries?: unknown[];
  dailyTurnover?: unknown[];
  messages?: unknown[];
  skipped?: { name: string; reason: string }[];
}

// ─── Helpers (pure) ─────────────────────────────────────────────────────────────

/** "2026-Q2" from an ISO date; "" when missing/invalid. UTC for determinism. */
export function periodFromDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

/** In-ZIP path for a storage file: strip "<userId>/" prefix, keep structure. */
export function zipPathForFile(userId: string, file: ExportFile): string {
  const prefix = `${userId}/`;
  const rel = file.path.startsWith(prefix)
    ? file.path.slice(prefix.length)
    : file.name;
  return `bestanden/${rel}`;
}

// ─── Assembly (no network — fully node-testable) ────────────────────────────────

/**
 * Build the export ZIP from already-fetched data. Deterministic & testable.
 */
export async function assembleAccountExportZip(
  input: AssembleInput,
): Promise<AccountExportResult> {
  const { userId, profile, invoices, files } = input;
  const bankTransactions = input.bankTransactions ?? [];
  const cashEntries = input.cashEntries ?? [];
  const dailyTurnover = input.dailyTurnover ?? [];
  const messages = input.messages ?? [];
  const skipped = [...(input.skipped ?? [])];
  const zip = new JSZip();

  // 1. facturen.csv — built via export.ts (called, not modified).
  //    BOM prepended so Excel NL reads UTF-8 correctly (downloadCsv does this
  //    in the browser; here we are server-side so we add it ourselves).
  const rows = invoices.map((inv) =>
    toExportRowFull(inv, periodFromDate(inv.invoice_date)),
  );
  zip.file("facturen.csv", "\uFEFF" + invoicesToCsv(rows));

  // 2. profiel.json — the user's profile record, verbatim.
  zip.file("profiel.json", JSON.stringify(profile ?? null, null, 2));

  // 3. bestanden/ — the user's actual Storage files.
  let fileCount = 0;
  for (const f of files) {
    zip.file(zipPathForFile(userId, f), f.bytes);
    fileCount++;
  }

  // 4. The rest of the user's own ledgers/data, verbatim JSON, so the export is
  //    genuinely "al je gegevens" (not just invoices/docs/profile).
  zip.file("bank.json", JSON.stringify(bankTransactions, null, 2));
  zip.file("kas.json", JSON.stringify(cashEntries, null, 2));
  zip.file("dagomzet.json", JSON.stringify(dailyTurnover, null, 2));
  zip.file("berichten.json", JSON.stringify(messages, null, 2));

  // 5. manifest.json — transparency: what's inside + what was skipped.
  const summary: AccountExportSummary = {
    invoiceCount: invoices.length,
    fileCount,
    bankCount: bankTransactions.length,
    cashCount: cashEntries.length,
    turnoverCount: dailyTurnover.length,
    messageCount: messages.length,
    skipped,
    generatedAt: new Date().toISOString(),
  };
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        beschrijving:
          "Export van je BoekBrug-account: facturen, documenten, profiel, bank, kas, dagomzet en berichten.",
        gegenereerd_op: summary.generatedAt,
        aantal_facturen: summary.invoiceCount,
        aantal_bestanden: summary.fileCount,
        aantal_banktransacties: summary.bankCount,
        aantal_kasboekingen: summary.cashCount,
        aantal_dagomzetdagen: summary.turnoverCount,
        aantal_berichten: summary.messageCount,
        overgeslagen_bestanden: summary.skipped,
      },
      null,
      2,
    ),
  );

  const zipBytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return { zipBytes, summary };
}

// ─── Orchestrator (fetch + parallel download, then assemble) ────────────────────

const INVOICE_FIELDS =
  "invoice_number, client_name, client_email, client_address, " +
  "client_postal_code, client_city, status, direction, total_ex_btw, " +
  "btw_amount, total_inc_btw, invoice_date, due_date, created_at, " +
  "invoice_type";

/**
 * Build the full account export ZIP for a VERIFIED userId.
 * `supabase` must be a service_role pipeline client; every query is explicitly
 * scoped to `userId` (service_role bypasses RLS — handoff lesson 3).
 */
export async function buildAccountExportZip(args: {
  userId: string;
  supabase: PipelineClient;
}): Promise<AccountExportResult> {
  const { userId, supabase } = args;

  // Profile (the user's own record).
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  // Invoices where the user is sender OR receiver.
  const { data: invoiceData, error: invErr } = await supabase
    .from("invoices")
    .select(INVOICE_FIELDS)
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (invErr) {
    throw new Error(`[BOEK-032] invoices query failed: ${invErr.message}`);
  }
  const invoices = (invoiceData ?? []) as unknown as InvRow[];

  // Document metadata.
  const { data: docData, error: docErr } = await supabase
    .from("documents")
    .select("file_name, file_url")
    .eq("user_id", userId);
  if (docErr) {
    throw new Error(`[BOEK-032] documents query failed: ${docErr.message}`);
  }
  const docs = docData ?? [];

  // Download files IN PARALLEL (perf — Tech Lead note). A single failed file is
  // recorded as "skipped" rather than failing the whole GDPR export.
  //
  // NOTE (deferred, measurement-first): this holds every file + the ZIP in
  // memory at once. If profiling shows large accounts struggle, switch to
  // chunked/streamed downloads. Not optimizing before measurement.
  const downloaded = await Promise.all(
    docs.map(async (d) => {
      try {
        const { data, error } = await supabase.storage
          .from("documents")
          .download(d.file_url);
        if (error || !data) {
          return {
            ok: false as const,
            name: d.file_name,
            reason: error?.message ?? "leeg bestand",
          };
        }
        const bytes = new Uint8Array(await data.arrayBuffer());
        return {
          ok: true as const,
          file: { path: d.file_url, name: d.file_name, bytes },
        };
      } catch (e) {
        return {
          ok: false as const,
          name: d.file_name,
          reason: e instanceof Error ? e.message : "downloadfout",
        };
      }
    }),
  );

  const files: ExportFile[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const r of downloaded) {
    if (r.ok) files.push(r.file);
    else skipped.push({ name: r.name, reason: r.reason });
  }

  // [EXPORT-COMPLETE] The remaining owner-scoped data, so the ZIP is genuinely complete.
  // Each scoped to this userId (service_role bypasses RLS). A query error must not silently
  // drop a whole ledger from a GDPR export → throw (the caller surfaces it), never []-swallow.
  const [bankRes, cashRes, turnoverRes, msgRes] = await Promise.all([
    supabase.from("bank_transactions").select("*").eq("user_id", userId),
    supabase.from("cash_entries").select("*").eq("user_id", userId),
    supabase.from("daily_turnover").select("*").eq("user_id", userId),
    supabase.from("messages").select("*").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`),
  ]);
  for (const [label, res] of [
    ["bank_transactions", bankRes], ["cash_entries", cashRes],
    ["daily_turnover", turnoverRes], ["messages", msgRes],
  ] as const) {
    if (res.error) throw new Error(`[BOEK-032] ${label} query failed: ${res.error.message}`);
  }

  return assembleAccountExportZip({
    userId, profile, invoices, files, skipped,
    bankTransactions: bankRes.data ?? [],
    cashEntries: cashRes.data ?? [],
    dailyTurnover: turnoverRes.data ?? [],
    messages: msgRes.data ?? [],
  });
}