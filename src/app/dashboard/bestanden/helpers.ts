// src/app/dashboard/bestanden/helpers.ts
// [BOEK-033] Shared helper functions for Bestanden feature

import { FolderRow, FolderNode } from "./types";
import { T } from "./tokens";

const NL_DATE = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

export const formatDate = (iso: string) => NL_DATE.format(new Date(iso));

export const formatSize = (b: number) =>
  b < 1024 ? `${b} B`
  : b < 1_048_576 ? `${(b / 1024).toFixed(0)} KB`
  : `${(b / 1_048_576).toFixed(1)} MB`;

export const folderColor = (c: string | null) => c ?? T.warning;

export const fileEmoji = (t: string): string => {
  if (t.startsWith("image/")) return "🖼️";
  if (t === "application/pdf") return "📄";
  if (t.includes("excel") || t.includes("spreadsheet")) return "📊";
  if (t.includes("word") || t.includes("document")) return "📝";
  if (t === "message/rfc822") return "📧";
  if (t === "application/zip") return "🗜️";
  if (t === "text/csv") return "📋";
  if (t.includes("xml")) return "🗂️";
  return "📁";
};

export const buildTree = (rows: FolderRow[], parentId: string | null): FolderNode[] =>
  rows
    .filter((r) => r.parent_id === parentId)
    .map((r) => ({ ...r, children: buildTree(rows, r.id) }));