// lib/documents.ts
// Document management helpers (BOEK-010)
// Upload → Supabase Storage, metadata → documents table

import { createServerSupabaseClient } from "./supabase-server";

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
  "message/rfc822",        // .eml
  "application/zip",
]);

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/** Derive a doc_type from MIME type */
export function inferDocType(mimeType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "spreadsheet";
  if (mimeType.includes("word") || mimeType.includes("document")) return "document";
  if (mimeType === "text/csv") return "csv";
  if (mimeType.includes("xml")) return "xml";
  if (mimeType === "message/rfc822") return "email";
  if (mimeType === "application/zip") return "archive";
  return "other";
}

/** Build Supabase Storage path: userId/2026/Q1/pdf/filename */
export function buildStoragePath(
  userId: string,
  fileName: string,
  year: number,
  quarter: number
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${year}/Q${quarter}/${safe}`;
}

/** Upload a file and insert its metadata record. Returns the document id. */
export async function uploadDocument(
  userId: string,
  file: File,
  opts: { invoiceId?: string; notes?: string; year: number; quarter: number }
): Promise<{ id: string; error?: string }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { id: "", error: "Bestandstype niet ondersteund" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { id: "", error: "Bestand te groot (max 25MB)" };
  }

  const supabase = await createServerSupabaseClient();
  const path = buildStoragePath(userId, file.name, opts.year, opts.quarter);

  // Upload to storage
  const { error: storageError } = await supabase.storage
    .from("documents")
    .upload(path, file, { upsert: false });

  if (storageError) {
    return { id: "", error: storageError.message };
  }

  // Get public URL (private bucket — use signed URL on read)
  const fileUrl = path;

  // Insert metadata
  const { data, error: dbError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      file_name: file.name,
      file_url: fileUrl,
      file_size: file.size,
      file_type: file.type,
      doc_type: inferDocType(file.type),
      period: `${opts.year}-Q${opts.quarter}`,
      year: opts.year,
      invoice_id: opts.invoiceId ?? null,
      notes: opts.notes ?? null,
    })
    .select("id")
    .single();

  if (dbError) {
    return { id: "", error: dbError.message };
  }

  return { id: data.id };
}

/** Get a signed URL for a private document (1 hour expiry) */
export async function getDocumentUrl(filePath: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.storage
    .from("documents")
    .createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}

/** Delete a document from storage + DB */
export async function deleteDocument(
  documentId: string,
  userId: string
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient();

  // Fetch file_url first
  const { data: doc } = await supabase
    .from("documents")
    .select("file_url")
    .eq("id", documentId)
    .eq("user_id", userId)
    .single();

  if (!doc) return { error: "Niet gevonden" };

  // Delete from storage
  await supabase.storage.from("documents").remove([doc.file_url]);

  // Delete from DB
  await supabase.from("documents").delete().eq("id", documentId);

  return {};
}