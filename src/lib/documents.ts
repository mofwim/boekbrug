// lib/documents.ts
// Document management helpers (BOEK-010)
// Upload → Supabase Storage, metadata → documents table
// Server-only — nooit importeren in Client Components

import { createServerSupabaseClient } from "./supabase-server";
import { inferDocType } from "./documents-utils";
// [BRIDGE-EXTRACT] byte-hash dedup — één bestand → één hash → één record
import { computeContentHashFromFile } from "./content-hash";
import { logAuditAction } from "./audit";

export { inferDocType } from "./documents-utils";

// ─── [BRIDGE-EXTRACT] Folder breadcrumb ──────────────────────────────────────

/**
 * Build the full folder path for a folder, walking parent_id up to the root.
 * Used to tell the user EXACTLY where a duplicate file already lives, e.g.
 * "2026 / Q1 / Facturen" instead of just the leaf name.
 *
 * Returns the path segments root→leaf. Empty array when folderId is null
 * (file sits at the root with no folder). Capped at 10 hops as a cycle guard.
 *
 * eslint-disable: supabase client type is inferred; depth-bounded loop.
 */
export async function buildFolderBreadcrumb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  folderId: string | null
): Promise<string[]> {
  if (!folderId) return [];

  const segments: string[] = [];
  let currentId: string | null = folderId;
  let guard = 0;

  while (currentId && guard < 10) {
    const { data: folder } = await supabase
      .from("folders")
      .select("name, parent_id")
      .eq("id", currentId)
      .eq("user_id", userId)
      .maybeSingle() as { data: { name: string; parent_id: string | null } | null };

    if (!folder) break;
    segments.unshift(folder.name);          // prepend → root ends up first
    currentId = folder.parent_id ?? null;
    guard++;
  }

  return segments;
}


// ─── Types ─────────────────────────────────────────────────────────────────────

// [BOEK-033] All file types allowed — ZZP uploads any business document
// Only restriction: file size max 50MB
export const ALLOWED_TYPES = new Set<string>([]); // empty = allow all

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build storage path.
 * Private (ZZP only):  userId/2026/Q1/20260514_filename.pdf
 * Shared (ZZP+accountant): userId/shared/2026/Q1/20260514_filename.pdf
 */
export function buildStoragePath(
  userId: string,
  fileName: string,
  year: number,
  quarter: number,
  shared = false
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Prefix filename with today's date: YYYYMMDD_filename
  const today = new Date();
  const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const namedFile = `${datePrefix}_${safe}`;

  if (shared) {
    return `${userId}/shared/${year}/Q${quarter}/${namedFile}`;
  }
  return `${userId}/${year}/Q${quarter}/${namedFile}`;
}

// ─── Upload ────────────────────────────────────────────────────────────────────

/** Upload a file and insert its metadata record. Returns the document id. */
export async function uploadDocument(
  userId: string,
  file: File,
  opts: {
    invoiceId?: string;
    notes?: string;
    year: number;
    quarter: number;
    shared?: boolean; // true = visible to linked accountant too
    // [BESTANDEN-DUP] When true, skip the byte-hash duplicate gate and upload
    // anyway. The personal file manager (Mijn bestanden) is the user's own
    // space — after an explicit "upload again" confirmation, they may keep a
    // second copy (e.g. archiving a file that also exists as an invoice).
    allowDuplicate?: boolean;
  }
): Promise<{
  id: string;
  error?: string;
  duplicate?: boolean;
  // [BRIDGE-EXTRACT] When duplicate=true, tells the UI WHERE the file already lives
  existing?: {
    id: string;
    file_name: string;
    folder_id: string | null;       // [BESTANDEN-DUP] target for "open de map" (?folder={id})
    folder_name: string | null;
    folder_path: string[];          // root→leaf breadcrumb, e.g. ["2026","Q1","Facturen"]
  };
}> {
  // [BOEK-033] All file types allowed — only size limit enforced
  if (file.size > MAX_FILE_SIZE) {
    return { id: "", error: "Bestand te groot (max 50MB)" };
  }

  const supabase = await createServerSupabaseClient();
  const shared = opts.shared ?? false;

  // [BRIDGE-EXTRACT] Byte-hash dedup gate — BEFORE Storage upload and DB insert.
  // Hash the raw file bytes (deterministic: identical bytes → identical hash).
  // Cross-path: documents from email / manual invoice / Mijn bestanden all carry
  // content_hash, so we catch the same file regardless of how it arrived.
  // Reject (Layer 1: stop the bleeding) — references are Layer 2.
  const contentHash = await computeContentHashFromFile(file);

  // [BESTANDEN-DUP] Skip the gate entirely when the user explicitly confirmed
  // "upload again". We still store content_hash below so future dedup works.
  if (!opts.allowDuplicate) {
    // [BRIDGE-EXTRACT] Fetch enough to tell the user WHERE the file already is.
    const { data: existingDoc } = await supabase
      .from("documents")
      .select("id, file_name, folder_id")
      .eq("user_id", userId)
      .eq("content_hash", contentHash)
      .limit(1)
      .maybeSingle();

    if (existingDoc) {
      // [BRIDGE-EXTRACT] Full folder path (root→leaf) — folders nest, so the leaf
      // name alone ("Facturen") is ambiguous. Walk parent_id up the chain.
      const folderPath = await buildFolderBreadcrumb(
        supabase,
        userId,
        existingDoc.folder_id ?? null
      );
      const folderName = folderPath.length ? folderPath[folderPath.length - 1] : null;

      // Non-fatal audit — never blocks the response
      await logAuditAction({
        userId,
        action: "document.duplicate_blocked",
        entityType: "document",
        entityId: existingDoc.id,
        newValue: { file_name: file.name, content_hash: contentHash, path: "mijn_bestanden" },
      });

      // Build a Dutch message that points the user to the existing file.
      const where = folderPath.length
        ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
        : "Dit bestand is al toegevoegd";

      return {
        id: "",
        error: where,
        duplicate: true,
        existing: {
          id: existingDoc.id,
          file_name: existingDoc.file_name,
          folder_id: existingDoc.folder_id ?? null,
          folder_name: folderName,
          folder_path: folderPath,
        },
      };
    }
  }

  const path = buildStoragePath(userId, file.name, opts.year, opts.quarter, shared);

  // 1. Upload to Storage
  const { error: storageError } = await supabase.storage
    .from("documents")
    .upload(path, file, { upsert: false });

  if (storageError) {
    return { id: "", error: storageError.message };
  }

  // [BOEK-015] P4 fix: ensure profile exists before insert to prevent FK constraint error
  // This handles the case where user deleted their profile but kept their auth session
  const { data: profileExists } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();

  if (!profileExists) {
    // Get user data from auth to create profile
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      // Silent insert — ignore errors (race condition or already exists)
      try {
        await supabase.from("profiles").insert({
          id: userId,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name ?? null,
          onboarding_step: 1,
          onboarding_done: false,
          role: "zzper",
        });
      } catch {
        // silent — profile may already exist
      }
    }
  }

  // 2. Insert metadata — file_url stores the storage path (signed URL on read)
  const { data, error: dbError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      file_name: file.name,
      file_url: path,                            // raw path — signed on read
      file_size: file.size,
      file_type: file.type,
      doc_type: inferDocType(file.type),
      period: `${opts.year}-Q${opts.quarter}`,
      year: opts.year,
      invoice_id: opts.invoiceId ?? null,
      notes: opts.notes ?? null,
      content_hash: contentHash,                 // [BRIDGE-EXTRACT] byte-hash for cross-path dedup
    })
    .select("id")
    .single();

  if (dbError) {
    // Rollback storage upload
    await supabase.storage.from("documents").remove([path]);
    return { id: "", error: dbError.message };
  }

  // 3. If shared → notify linked accountant
  if (shared) {
    await notifyAccountant(supabase, userId, file.name, data.id);
  }

  return { id: data.id };
}


/** Send notification to the accountant linked to this ZZP'er */
async function notifyAccountant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  zzperId: string,
  fileName: string,
  documentId: string
): Promise<void> {
  // Find the linked accountant
  const { data: link } = await supabase
    .from("accountant_clients")
    .select("accountant_id")
    .eq("zzper_id", zzperId)
    .single();

  if (!link?.accountant_id) return;

  // Get ZZP'er name for the notification body
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
    type: "invoice",                              // 'invoice' is closest allowed type
    read: false,
    link: `/dashboard/documents`,
  });
}

// ─── List ──────────────────────────────────────────────────────────────────────

/**
 * List documents for a user.
 * sharedOnly = true → only files in the shared/ path (for accountant view)
 */
export async function listDocuments(
  userId: string,
  opts: {
    year?: number;
    quarter?: number;
    docType?: string;
    limit?: number;
    cursor?: string;        // created_at for pagination
    sharedOnly?: boolean;
  }
): Promise<{ documents: DocumentRow[]; hasMore: boolean }> {
  const supabase = await createServerSupabaseClient();
  const limit = opts.limit ?? 30;

  let q = supabase
    .from("documents")
    .select(
      "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.year) q = q.eq("year", opts.year);
  if (opts.year && opts.quarter) q = q.eq("period", `${opts.year}-Q${opts.quarter}`);
  if (opts.docType) q = q.eq("doc_type", opts.docType);
  if (opts.cursor) q = q.lt("created_at", opts.cursor);

  // Shared-only: filter by storage path prefix
  if (opts.sharedOnly) {
    q = q.like("file_url", `${userId}/shared/%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return {
    documents: (data ?? []) as DocumentRow[],
    hasMore: (data ?? []).length === limit,
  };
}

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
}

// ─── Signed URL ────────────────────────────────────────────────────────────────

/** Get a signed URL for a private document (1 hour expiry) */
export async function getDocumentUrl(filePath: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.storage
    .from("documents")
    .createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

/** Delete a document from storage + DB */
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

  // Delete from storage (file_url is the raw path)
  await supabase.storage.from("documents").remove([doc.file_url]);

  // Delete from DB
  await supabase.from("documents").delete().eq("id", documentId);

  return {};
}