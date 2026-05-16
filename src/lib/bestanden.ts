// lib/bestanden.ts
// [BOEK-033] Mijn bestanden — Drive experience
// Business logic: folder tree, contents, search, move, create
// Server-only — nooit importeren in Client Components

import { createServerSupabaseClient } from "./supabase-server";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
}

export interface FolderNode extends FolderRow {
  children: FolderNode[];
}

export interface BestandRow {
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
  folder_id: string | null;
  ai_processed: boolean | null;
  ai_doc_type: string | null;
  ai_suggested_folder: string | null;
  source: string | null;
}

export interface FolderContents {
  folders: FolderRow[];
  documents: BestandRow[];
}

// ─── Constants ──────────────────────────────────────────────────────────────────

// The "Gedeeld met boekhouder" folder is always auto-created and never deleted
export const SHARED_FOLDER_NAME = "Gedeeld met boekhouder";

// ─── Folder Tree ────────────────────────────────────────────────────────────────

/**
 * Fetch ALL folders for a user and return them as a tree.
 * Root folders have parent_id = null.
 */
export async function getFolderTree(userId: string): Promise<FolderNode[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("folders")
    .select("id, user_id, name, parent_id, color, created_at")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FolderRow[];

  return buildTree(rows, null);
}

function buildTree(rows: FolderRow[], parentId: string | null): FolderNode[] {
  return rows
    .filter((r) => r.parent_id === parentId)
    .map((r) => ({
      ...r,
      children: buildTree(rows, r.id),
    }));
}

// ─── Folder Contents ────────────────────────────────────────────────────────────

/**
 * Get direct children of a folder (sub-folders + documents).
 * folderId = null → root level (no folder assigned).
 */
export async function getFolderContents(
  userId: string,
  folderId: string | null
): Promise<FolderContents> {
  const supabase = await createServerSupabaseClient();

  // Sub-folders
  let folderQuery = supabase
    .from("folders")
    .select("id, user_id, name, parent_id, color, created_at")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (folderId === null) {
    folderQuery = folderQuery.is("parent_id", null);
  } else {
    folderQuery = folderQuery.eq("parent_id", folderId);
  }

  const { data: folderData, error: folderError } = await folderQuery;
  if (folderError) throw new Error(folderError.message);

  // Documents in this folder
  let docQuery = supabase
    .from("documents")
    .select(
      "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, ai_suggested_folder, source"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (folderId === null) {
    docQuery = docQuery.is("folder_id", null);
  } else {
    docQuery = docQuery.eq("folder_id", folderId);
  }

  const { data: docData, error: docError } = await docQuery;
  if (docError) throw new Error(docError.message);

  return {
    folders: (folderData ?? []) as FolderRow[],
    documents: (docData ?? []) as BestandRow[],
  };
}

// ─── Create Folder ───────────────────────────────────────────────────────────────

export async function createFolder(
  userId: string,
  name: string,
  parentId?: string | null,
  color?: string
): Promise<FolderRow> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("folders")
    .insert({
      user_id: userId,
      name: name.trim(),
      parent_id: parentId ?? null,
      color: color ?? null,
    })
    .select("id, user_id, name, parent_id, color, created_at")
    .single();

  if (error) throw new Error(error.message);
  return data as FolderRow;
}

// ─── Rename Folder ───────────────────────────────────────────────────────────────

export async function renameFolder(
  folderId: string,
  userId: string,
  newName: string
): Promise<void> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("folders")
    .update({ name: newName.trim() })
    .eq("id", folderId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

// ─── Delete Folder ───────────────────────────────────────────────────────────────

/**
 * Delete a folder.
 * Documents inside it are moved to root (folder_id = null) — never deleted.
 * Sub-folders are also moved to root.
 */
export async function deleteFolder(folderId: string, userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // Verify ownership
  const { data: folder } = await supabase
    .from("folders")
    .select("id, name")
    .eq("id", folderId)
    .eq("user_id", userId)
    .single();

  if (!folder) throw new Error("Map niet gevonden");
  if (folder.name === SHARED_FOLDER_NAME) throw new Error("Deze map kan niet worden verwijderd");

  // Move documents to root
  await supabase
    .from("documents")
    .update({ folder_id: null })
    .eq("folder_id", folderId)
    .eq("user_id", userId);

  // Move sub-folders to root
  await supabase
    .from("folders")
    .update({ parent_id: null })
    .eq("parent_id", folderId)
    .eq("user_id", userId);

  // Delete the folder
  await supabase.from("folders").delete().eq("id", folderId).eq("user_id", userId);
}

// ─── Move Document ────────────────────────────────────────────────────────────────

export async function moveDocument(
  documentId: string,
  folderId: string | null,
  userId: string
): Promise<void> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("documents")
    .update({ folder_id: folderId })
    .eq("id", documentId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

// ─── Move Folder ─────────────────────────────────────────────────────────────────

export async function moveFolder(
  folderId: string,
  newParentId: string | null,
  userId: string
): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // Prevent moving into itself
  if (folderId === newParentId) throw new Error("Kan map niet in zichzelf verplaatsen");

  const { error } = await supabase
    .from("folders")
    .update({ parent_id: newParentId })
    .eq("id", folderId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

// ─── Rename Document ──────────────────────────────────────────────────────────────

export async function renameDocument(
  documentId: string,
  userId: string,
  newName: string
): Promise<void> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("documents")
    .update({ file_name: newName.trim() })
    .eq("id", documentId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

// ─── Search ───────────────────────────────────────────────────────────────────────

export interface SearchResult extends BestandRow {
  folder_name: string | null;
}

export async function searchBestanden(
  userId: string,
  query: string
): Promise<SearchResult[]> {
  const supabase = await createServerSupabaseClient();
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, ai_suggested_folder, source"
    )
    .eq("user_id", userId)
    .or(
      `file_name.ilike.%${q}%,notes.ilike.%${q}%,ai_doc_type.ilike.%${q}%,doc_type.ilike.%${q}%`
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  const docs = (data ?? []) as BestandRow[];

  // Enrich with folder names
  const folderIds = [...new Set(docs.map((d) => d.folder_id).filter(Boolean))] as string[];
  let folderMap: Record<string, string> = {};

  if (folderIds.length > 0) {
    const { data: folders } = await supabase
      .from("folders")
      .select("id, name")
      .in("id", folderIds);

    folderMap = Object.fromEntries((folders ?? []).map((f) => [f.id, f.name]));
  }

  return docs.map((d) => ({
    ...d,
    folder_name: d.folder_id ? (folderMap[d.folder_id] ?? null) : null,
  }));
}

// ─── Ensure Shared Folder Exists ──────────────────────────────────────────────────

/**
 * Ensure the "Gedeeld met boekhouder" folder exists for this user.
 * Called on first load — idempotent.
 * Returns the folder id.
 */
export async function ensureSharedFolder(userId: string): Promise<string> {
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("folders")
    .select("id")
    .eq("user_id", userId)
    .eq("name", SHARED_FOLDER_NAME)
    .single();

  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("folders")
    .insert({
      user_id: userId,
      name: SHARED_FOLDER_NAME,
      parent_id: null,
      color: "#007aff",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}