// src/app/dashboard/bestanden/types.ts
// [BOEK-033] Shared types for Bestanden feature
// [BOEK-033] Added is_system, folder_type for smart folder structure

export type FolderType =
  | "year" | "quarter" | "month"
  | "bank" | "facturen" | "kosten"
  | "shared" | "custom";

export interface FolderRow {
  id: string;
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
  // [BRUG-FILES-SHARED] true = visible to the linked accountant (bridge + ZIP).
  // The accountant RLS reads this flag; it is independent of folder_id, so a file
  // can be shared while staying in its original folder.
  shared?: boolean;
}

export interface SearchResult extends BestandRow {
  folder_name: string | null;
}

export type ViewMode = "grid" | "list";

export interface ContextMenuItem {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}