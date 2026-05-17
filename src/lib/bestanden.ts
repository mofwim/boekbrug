// lib/bestanden.ts
// [BOEK-033] Mijn bestanden — Drive experience
// Business logic: folder tree, contents, search, move, create, year structure
// Server-only — nooit importeren in Client Components

import { createServerSupabaseClient } from "./supabase-server";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type FolderType =
  | "year" | "quarter" | "month"
  | "bank" | "facturen" | "kosten"
  | "shared" | "custom";

export interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
  starred?: boolean;
  is_system: boolean;
  folder_type: FolderType | null;
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
  starred?: boolean;
  trashed?: boolean;
  trashed_at?: string | null;
}

export interface FolderContents {
  folders: FolderRow[];
  documents: BestandRow[];
}

export interface SearchResult extends BestandRow {
  folder_name: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

export const SHARED_FOLDER_NAME = "Gedeeld met boekhouder";

const NL_MONTHS: Record<number, string> = {
  1: "januari", 2: "februari", 3: "maart",
  4: "april",   5: "mei",      6: "juni",
  7: "juli",    8: "augustus", 9: "september",
  10: "oktober", 11: "november", 12: "december",
};

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

const QUARTER_LABELS: Record<number, string> = {
  1: "Q1 (jan–mrt)", 2: "Q2 (apr–jun)",
  3: "Q3 (jul–sep)", 4: "Q4 (okt–dec)",
};

// ─── Select fields ───────────────────────────────────────────────────────────────

const FOLDER_SELECT = "id, user_id, name, parent_id, color, created_at, starred, is_system, folder_type";

// ─── Folder Tree ────────────────────────────────────────────────────────────────

export function buildTree(rows: FolderRow[], parentId: string | null): FolderNode[] {
  return rows
    .filter(r => r.parent_id === parentId)
    .sort((a, b) => {
      // System folders first, then alphabetical
      if (a.is_system && !b.is_system) return -1;
      if (!a.is_system && b.is_system) return 1;
      return a.name.localeCompare(b.name, "nl");
    })
    .map(r => ({ ...r, children: buildTree(rows, r.id) }));
}

export async function getFolderTree(userId: string): Promise<FolderNode[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("folders")
    .select(FOLDER_SELECT)
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return buildTree((data ?? []) as FolderRow[], null);
}

// ─── Folder Contents ────────────────────────────────────────────────────────────

export async function getFolderContents(
  userId: string,
  folderId: string | null
): Promise<FolderContents> {
  const supabase = await createServerSupabaseClient();

  let folderQ = supabase
    .from("folders")
    .select(FOLDER_SELECT)
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (folderId === null) folderQ = folderQ.is("parent_id", null);
  else folderQ = folderQ.eq("parent_id", folderId);
  const { data: folderData, error: folderError } = await folderQ;
  if (folderError) throw new Error(folderError.message);

  let docQ = supabase
    .from("documents")
    .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, ai_suggested_folder, source, starred, trashed")
    .eq("user_id", userId)
    .eq("trashed", false)
    .order("created_at", { ascending: false });
  if (folderId === null) docQ = docQ.is("folder_id", null);
  else docQ = docQ.eq("folder_id", folderId);
  const { data: docData, error: docError } = await docQ;
  if (docError) throw new Error(docError.message);

  return {
    folders: (folderData ?? []) as FolderRow[],
    documents: (docData ?? []) as BestandRow[],
  };
}

// ─── ensureYearStructure ─────────────────────────────────────────────────────────

/**
 * Idempotent — creates the full year folder structure if not present.
 * Called on every page load (safe to call multiple times).
 *
 * Structure:
 * {year}/
 *   Q1 (jan–mrt)/ Bank/ januari/ {Facturen/ Kosten/} ...
 *   Q2 (apr–jun)/ Bank/ april/   {Facturen/ Kosten/} ...
 *   Q3 (jul–sep)/ Bank/ juli/    {Facturen/ Kosten/} ...
 *   Q4 (okt–dec)/ Bank/ oktober/ {Facturen/ Kosten/} ...
 */
export async function ensureYearStructure(userId: string, year: number): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // Helper: find or create a folder
  async function findOrCreate(
    name: string,
    parentId: string | null,
    folderType: FolderType,
    color?: string
  ): Promise<string> {
    // Check if exists
    let q = supabase
      .from("folders")
      .select("id")
      .eq("user_id", userId)
      .eq("name", name)
      .eq("is_system", true);
    if (parentId === null) q = q.is("parent_id", null);
    else q = q.eq("parent_id", parentId);
    const { data: existing } = await q.single();
    if (existing) return existing.id;

    // Create
    const { data, error } = await supabase
      .from("folders")
      .insert({
        user_id: userId,
        name,
        parent_id: parentId,
        is_system: true,
        folder_type: folderType,
        color: color ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  // 1. Year folder
  const yearId = await findOrCreate(String(year), null, "year", "#1A73E8");

  // 2. Quarters
  for (const [q, months] of Object.entries(QUARTER_MONTHS)) {
    const quarterNum = Number(q);
    const quarterId = await findOrCreate(QUARTER_LABELS[quarterNum], yearId, "quarter", "#1A73E8");

    // 2a. Bank folder per quarter
    await findOrCreate("Bank", quarterId, "bank", "#00897B");

    // 2b. Month folders
    for (const month of months) {
      const monthName = NL_MONTHS[month];
      const monthId = await findOrCreate(monthName, quarterId, "month", "#1A73E8");

      // 2c. Facturen + Kosten per month
      await findOrCreate("Facturen", monthId, "facturen", "#34A853");
      await findOrCreate("Kosten", monthId, "kosten", "#E37400");
    }
  }

  // 3. Shared folder (always at root)
  await ensureSharedFolder(userId);
}

// ─── ensureSharedFolder ──────────────────────────────────────────────────────────

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
      is_system: true,
      folder_type: "shared",
      color: "#1A73E8",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ─── Create Folder (user-created) ────────────────────────────────────────────────

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
      is_system: false,
      folder_type: "custom",
      color: color ?? null,
    })
    .select(FOLDER_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as FolderRow;
}

// ─── Rename Folder ───────────────────────────────────────────────────────────────

export async function renameFolder(folderId: string, userId: string, newName: string): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // Guard: never rename system folders
  const { data: folder } = await supabase
    .from("folders").select("is_system").eq("id", folderId).eq("user_id", userId).single();
  if (folder?.is_system) throw new Error("Systeemmappen kunnen niet worden hernoemd");

  const { error } = await supabase
    .from("folders").update({ name: newName.trim() })
    .eq("id", folderId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Delete Folder ───────────────────────────────────────────────────────────────

export async function deleteFolder(folderId: string, userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();

  const { data: folder } = await supabase
    .from("folders").select("id, name, is_system")
    .eq("id", folderId).eq("user_id", userId).single();

  if (!folder) throw new Error("Map niet gevonden");
  if (folder.is_system) throw new Error("Systeemmappen kunnen niet worden verwijderd");

  // Move documents to root
  await supabase.from("documents").update({ folder_id: null })
    .eq("folder_id", folderId).eq("user_id", userId);

  // Move sub-folders to root
  await supabase.from("folders").update({ parent_id: null })
    .eq("parent_id", folderId).eq("user_id", userId);

  await supabase.from("folders").delete().eq("id", folderId).eq("user_id", userId);
}

// ─── Move Document ────────────────────────────────────────────────────────────────

export async function moveDocument(documentId: string, folderId: string | null, userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("documents").update({ folder_id: folderId })
    .eq("id", documentId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Move Folder ─────────────────────────────────────────────────────────────────

export async function moveFolder(folderId: string, newParentId: string | null, userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (folderId === newParentId) throw new Error("Kan map niet in zichzelf verplaatsen");
  const { error } = await supabase
    .from("folders").update({ parent_id: newParentId })
    .eq("id", folderId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Rename Document ──────────────────────────────────────────────────────────────

export async function renameDocument(documentId: string, userId: string, newName: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("documents").update({ file_name: newName.trim() })
    .eq("id", documentId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Search ───────────────────────────────────────────────────────────────────────

export async function searchBestanden(userId: string, query: string): Promise<SearchResult[]> {
  const supabase = await createServerSupabaseClient();
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, ai_suggested_folder, source, starred, trashed")
    .eq("user_id", userId)
    .eq("trashed", false)
    .or(`file_name.ilike.%${q}%,notes.ilike.%${q}%,ai_doc_type.ilike.%${q}%,doc_type.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  const docs = (data ?? []) as BestandRow[];

  const folderIds = [...new Set(docs.map(d => d.folder_id).filter(Boolean))] as string[];
  let folderMap: Record<string, string> = {};
  if (folderIds.length > 0) {
    const { data: folders } = await supabase
      .from("folders").select("id, name").in("id", folderIds);
    folderMap = Object.fromEntries((folders ?? []).map(f => [f.id, f.name]));
  }

  return docs.map(d => ({ ...d, folder_name: d.folder_id ? (folderMap[d.folder_id] ?? null) : null }));
}

// ─── Find folder by path ──────────────────────────────────────────────────────────

/**
 * Find a folder id by its path in the year structure.
 * Used by AI classification to suggest the right folder.
 * path example: { year: 2026, quarter: 2, month: 5, type: 'facturen' }
 */
export interface FolderPath {
  year: number;
  quarter?: number;
  month?: number;
  type?: "facturen" | "kosten" | "bank";
}

export async function findFolderByPath(userId: string, path: FolderPath): Promise<string | null> {
  const supabase = await createServerSupabaseClient();

  // Get all system folders for this user
  const { data } = await supabase
    .from("folders")
    .select(FOLDER_SELECT)
    .eq("user_id", userId)
    .eq("is_system", true);

  const folders = (data ?? []) as FolderRow[];
  const byId = Object.fromEntries(folders.map(f => [f.id, f]));

  // Find year folder
  const yearFolder = folders.find(f => f.name === String(path.year) && f.parent_id === null && f.folder_type === "year");
  if (!yearFolder) return null;
  if (!path.quarter) return yearFolder.id;

  // Find quarter folder
  const quarterFolder = folders.find(f =>
    f.parent_id === yearFolder.id &&
    f.folder_type === "quarter" &&
    f.name.startsWith(`Q${path.quarter}`)
  );
  if (!quarterFolder) return yearFolder.id;

  // Bank — goes directly under quarter
  if (path.type === "bank") {
    const bankFolder = folders.find(f => f.parent_id === quarterFolder.id && f.folder_type === "bank");
    return bankFolder?.id ?? quarterFolder.id;
  }

  if (!path.month) return quarterFolder.id;

  // Find month folder
  const NL = NL_MONTHS[path.month];
  const monthFolder = folders.find(f => f.parent_id === quarterFolder.id && f.name === NL);
  if (!monthFolder) return quarterFolder.id;

  if (!path.type) return monthFolder.id;

  // Find type folder (facturen/kosten)
  const typeFolder = folders.find(f =>
    f.parent_id === monthFolder.id &&
    f.name.toLowerCase() === path.type
  );
  return typeFolder?.id ?? monthFolder.id;
}