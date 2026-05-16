// lib/documents.ts
// [BOEK-010] Document management helpers — upload, list, delete, signed URL
// [BOEK-033] Added folder_id support in upload

import { createServerSupabaseClient } from "./supabase-server";
import { inferDocType } from "./documents-utils";

export { inferDocType } from "./documents-utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

export const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/xml",
  "application/xml",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/tiff",
  "message/rfc822",
  "application/zip",
]);

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build storage path.
 * Private: userId/2026/Q1/20260514_filename.pdf
 * Shared:  userId/shared/2026/Q1/20260514_filename.pdf
 */
export function buildStoragePath(
  userId: string,
  fileName: string,
  year: number,
  quarter: number,
  shared = false
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const today = new Date();
  const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const namedFile = `${datePrefix}_${safe}`;

  if (shared) {
    return `${userId}/shared/${year}/Q${quarter}/${namedFile}`;
  }
  return `${userId}/${year}/Q${quarter}/${namedFile}`;
}

// ─── Upload ────────────────────────────────────────────────────────────────────

export async function uploadDocument(
  userId: string,
  file: File,
  opts: {
    invoiceId?: string;
    notes?: string;
    year: number;
    quarter: number;
    shared?: boolean;
    folderId?: string | null; // [BOEK-033] destination folder
  }
): Promise<{ id: string; error?: string }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { id: "", error: "Bestandstype niet ondersteund" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { id: "", error: "Bestand te groot (max 25MB)" };
  }

  const supabase = await createServerSupabaseClient();
  const shared = opts.shared ?? false;
  const path = buildStoragePath(userId, file.name, opts.year, opts.quarter, shared);

  // 1. Upload to Storage
  const { error: storageError } = await supabase.storage
    .from("documents")
    .upload(path, file, { upsert: false });

  if (storageError) {
    return { id: "", error: storageError.message };
  }

  // 2. Insert metadata
  const { data, error: dbError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      file_name: file.name,
      file_url: path,
      file_size: file.size,
      file_type: file.type,
      doc_type: inferDocType(file.type),
      period: `${opts.year}-Q${opts.quarter}`,
      year: opts.year,
      invoice_id: opts.invoiceId ?? null,
      notes: opts.notes ?? null,
      folder_id: opts.folderId ?? null, // [BOEK-033]
      source: "upload",
    })
    .select("id")
    .single();

  if (dbError) {
    await supabase.storage.from("documents").remove([path]);
    return { id: "", error: dbError.message };
  }

  // 3. Notify accountant if shared
  if (shared) {
    await notifyAccountant(supabase, userId, file.name, data.id);
  }

  return { id: data.id };
}

async function notifyAccountant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  zzperId: string,
  fileName: string,
  documentId: string
): Promise<void> {
  const { data: link } = await supabase
    .from("accountant_clients")
    .select("accountant_id")
    .eq("zzper_id", zzperId)
    .single();

  if (!link?.accountant_id) return;

  const { data: zzper } = await supabase
    .from("profiles")
    .select("full_name, company_name")
    .eq("id", zzperId)
    .single();

  const senderName = zzper?.company_name || zzper?.full_name || "Een klant";

  await supabase.from("notifications").insert({
    user_id: link.accountant_id,
    title: "Nieuw document geüpload",
    body: `${senderName} heeft "${fileName}" gedeeld`,
    type: "invoice",
    read: false,
    link: `/dashboard/bestanden`,
  });
}

// ─── List ──────────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  doc_type: string | null;
  period: string | null;
  year: number | null;
  notes: string | null;
  invoice_id: string | null;
  created_at: string;
  folder_id?: string | null;
}

export async function listDocuments(
  userId: string,
  opts: {
    year?: number;
    quarter?: number;
    docType?: string;
    limit?: number;
    cursor?: string;
    sharedOnly?: boolean;
  }
): Promise<{ documents: DocumentRow[]; hasMore: boolean }> {
  const supabase = await createServerSupabaseClient();
  const limit = opts.limit ?? 30;

  let q = supabase
    .from("documents")
    .select(
      "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.year) q = q.eq("year", opts.year);
  if (opts.year && opts.quarter) q = q.eq("period", `${opts.year}-Q${opts.quarter}`);
  if (opts.docType) q = q.eq("doc_type", opts.docType);
  if (opts.cursor) q = q.lt("created_at", opts.cursor);
  if (opts.sharedOnly) q = q.like("file_url", `${userId}/shared/%`);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return {
    documents: (data ?? []) as DocumentRow[],
    hasMore: (data ?? []).length === limit,
  };
}

// ─── Signed URL ────────────────────────────────────────────────────────────────

export async function getDocumentUrl(filePath: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.storage
    .from("documents")
    .createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export async function deleteDocument(
  documentId: string,
  userId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("file_url")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();

  if (!doc) return { error: "Niet gevonden" };

  await supabase.storage.from("documents").remove([doc.file_url]);
  await supabase.from("documents").delete().eq("id", documentId);

  return {};
}