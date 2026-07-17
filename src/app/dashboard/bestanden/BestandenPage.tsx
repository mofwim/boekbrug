"use client";
// src/app/dashboard/bestanden/BestandenPage.tsx
// [BOEK-033] Mijn bestanden — Drive experience
// Design: Material You (ZZP) — BoekBrug Design System v1.0

import { useState, useEffect, useRef, useCallback, DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { useHomePath } from "@/lib/navigation-hooks";

import { T } from "./tokens";
import { BestandRow, FolderRow, FolderNode, SearchResult, ViewMode } from "./types";
import { buildTree, folderColor, fileEmoji, formatDate, formatSize } from "./helpers";

import { Icon } from "./components/ui/Icon";
import { Spinner } from "./components/ui/Spinner";
import { ContextMenu } from "./components/ui/ContextMenu";
import { BulkBar } from "./components/ui/BulkBar";

import { DocCard } from "./components/DocCard";
import { DocRow } from "./components/DocRow";
import { FolderCard } from "./components/FolderCard";
import { FolderTreeItem } from "./components/FolderTreeItem";
import { UploadArea } from "./components/UploadArea";
import { Trash } from "./components/Trash";

import { PreviewModal } from "./components/modals/PreviewModal";
import { RenameModal } from "./components/modals/RenameModal";
import { MoveModal } from "./components/modals/MoveModal";
import { AiSuggestionModal } from "./components/modals/AiSuggestionModal";

// [BESTANDEN-SMART] Virtual, cross-folder listings — the Drive/OneDrive left-nav.
// These replace the folder view with a flat file list filtered by a virtual axis.
type SmartView = "recent" | "starred" | "shared";

// [BESTANDEN-SMART] Metadata for each smart view: sidebar label, icon, and the
// empty-state copy. Kept in one place so the sidebar and the content header agree.
const SMART_VIEWS: Record<SmartView, { label: string; icon: string; empty: string }> = {
  recent:  { label: "Recent",     icon: "schedule",     empty: "Recent geopende of toegevoegde bestanden verschijnen hier" },
  starred: { label: "Favorieten", icon: "star",         empty: "Markeer bestanden met een ster om ze hier terug te vinden" },
  shared:  { label: "Gedeeld",    icon: "group",        empty: "Bestanden die je met je boekhouder deelt verschijnen hier" },
};

// [BESTANDEN-SORT] Client-side sort axes for file listings.
type SortField = "name" | "date" | "size";
const SORT_LABELS: Record<SortField, string> = { name: "Naam", date: "Datum", size: "Grootte" };

// [BESTANDEN-SORT] Pure sorter — never mutates the input. Folders and smart views
// both run their document arrays through this before rendering.
function sortDocs(docs: BestandRow[], field: SortField, dir: "asc" | "desc"): BestandRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...docs].sort((a, b) => {
    let cmp = 0;
    if (field === "name")      cmp = a.file_name.localeCompare(b.file_name, "nl");
    else if (field === "size") cmp = (a.file_size ?? 0) - (b.file_size ?? 0);
    else                       cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return cmp * factor;
  });
}

// ─── Breadcrumb ────────────────────────────────────────────────────────────────

function Breadcrumb({ folders, currentFolderId, onNavigate }: {
  folders: FolderRow[];
  currentFolderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const buildPath = (id: string | null): FolderRow[] => {
    if (!id) return [];
    const f = folders.find(x => x.id === id);
    if (!f) return [];
    return [...buildPath(f.parent_id), f];
  };
  const path = buildPath(currentFolderId);

  const btn = (active: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? T.onSurface : T.outline,
    background: "none", border: "none", cursor: "pointer", padding: "4px 2px",
    flexShrink: 0, whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, overflow: "hidden" }}>
      <button onClick={() => onNavigate(null)} style={btn(currentFolderId === null)}>
        Mijn bestanden
      </button>
      {path.map(f => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <Icon name="chevron_right" size={16} color={T.outline} />
          <button onClick={() => onNavigate(f.id)} style={btn(currentFolderId === f.id)}>
            {f.name}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── SidebarDraggableFolder — sidebar tree item with drag-drop ─────────────────

function SidebarDraggableFolder({ node, depth, activeFolderId, onSelect, onRename, onDelete, onDrop }: {
  node: FolderNode; depth: number; activeFolderId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, targetFolderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const isActive = activeFolderId === node.id;
  const isShared = node.name === "Gedeeld met boekhouder";
  // [BOEK-033] System folders: blue icon, no edit/delete
  const isSystem = node.is_system;
  const iconColor = isSystem ? T.primary : folderColor(node.color);

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={e => { setDragOver(false); onDrop(e, node.id); }}
        onClick={() => { onSelect(node.id); setOpen(true); }}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: `8px 10px 8px ${10 + depth * 16}px`,
          borderRadius: T.md, cursor: "pointer", userSelect: "none",
          background: dragOver ? T.primaryContainer : isActive ? T.primaryContainer : hovered ? T.surfaceVariant : "transparent",
          color: isActive || dragOver ? T.primary : T.onSurface,
          outline: dragOver ? `2px dashed ${T.primary}` : "none",
          transition: "background 0.1s",
        }}
      >
        <button onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          aria-label="Uitklappen"
          style={{ width: 20, height: 20, border: "none", background: "none", cursor: node.children.length ? "pointer" : "default", opacity: node.children.length ? 0.6 : 0, display: "flex", alignItems: "center", justifyContent: "center", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0 }}>
          <Icon name="expand_more" size={16} />
        </button>

        {/* [BOEK-033] System folders use folder_open icon in blue */}
        <Icon
          name={isSystem ? "folder_special" : "folder"}
          size={18}
          color={iconColor}
          style={{ flexShrink: 0 }}
        />

        <span style={{ flex: 1, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>

        {isShared && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 5px", background: T.primaryContainer, color: T.primary, borderRadius: T.full, flexShrink: 0 }}>
            Gedeeld
          </span>
        )}

        {/* [BOEK-033] Only show edit/delete for non-system folders */}
        {!isSystem && hovered && (
          <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); onRename(node.id, node.name); }}
              aria-label="Naam wijzigen"
              style={{ width: 22, height: 22, border: "none", background: "none", cursor: "pointer", borderRadius: T.sm, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="edit" size={13} color={T.outline} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(node.id); }}
              aria-label="Verwijderen"
              style={{ width: 22, height: 22, border: "none", background: "none", cursor: "pointer", borderRadius: T.sm, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="delete" size={13} color={T.error} />
            </button>
          </div>
        )}
      </div>
      {open && node.children.map(child => (
        <SidebarDraggableFolder key={child.id} node={child} depth={depth + 1}
          activeFolderId={activeFolderId} onSelect={onSelect}
          onRename={onRename} onDelete={onDelete} onDrop={onDrop}
        />
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

// [BOEK-033] role prop drives the logo's destination — accountant goes to their hub,
// zzper (and anyone else) to /dashboard. Passed in from page.tsx (server component).
interface BestandenPageProps {
  role?: "zzper" | "accountant" | "client" | null;
}

export function BestandenPage({ role }: BestandenPageProps = {}) {
  // [BOEK-033] Normalise to navigation.ts Role union — only 'accountant' is special;
  // every other value (zzper, client, null) maps to the ZZP home.
  const navRole: "zzper" | "accountant" = role === "accountant" ? "accountant" : "zzper";
  const logoHref = useHomePath(navRole);

  const router = useRouter();

  // ── Data ──
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [allFolders, setAllFolders] = useState<FolderRow[]>([]);
  // [BOEK-011 — edit by BOEK-011, file owned by BOEK-033]
  // Read ?folder={id} from URL on first render so the page loads the right
  // folder immediately. Replaces a previous useEffect-based version that had
  // a race condition with loadContents — the root content was loaded first,
  // then setCurrentFolderId fired after, sometimes too late.
  // Initializing useState from URL avoids that entire ordering problem.
  // [BESTANDEN-FOCUS] Initial ?folder=/?focus= are read on mount here, and the
  // effect below also re-reads them after client-side navigation (router.push does
  // NOT re-run these initializers, which is why deep-links used to need a manual
  // refresh). Cleanup of the URL is owned by that effect, not here.
  const searchParams = useSearchParams();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("folder");
  });
  const [focusId, setFocusId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("focus");
  });
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [subFolders, setSubFolders] = useState<FolderRow[]>([]);
  const [docs, setDocs] = useState<BestandRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ──
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showTrash, setShowTrash] = useState(false);
  // [BESTANDEN-SMART] Drive/OneDrive smart views (Recent / Favorieten / Gedeeld).
  // Null = normal folder browsing. When set, a flat cross-folder list replaces the
  // folder view (same content slot as the trash view). Mutually exclusive with trash.
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const [smartDocs, setSmartDocs] = useState<BestandRow[]>([]);
  const [smartLoading, setSmartLoading] = useState(false);
  // [BESTANDEN-SMART] Bumped after a mutation (star/share/move/delete) so the
  // active smart view re-fetches and never shows a stale row. No-op when browsing
  // a normal folder (the load effect returns early unless a smart view is active).
  const [smartRefreshKey, setSmartRefreshKey] = useState(0);
  // [BESTANDEN-SMART] Storage usage for the sidebar meter (total bytes + file count).
  const [storage, setStorage] = useState<{ count: number; bytes: number } | null>(null);
  // [BESTANDEN-SORT] Sort axis applied to the current listing (folder + smart views).
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  // [SEARCH] Matching folders (by name) shown above file results.
  const [folderResults, setFolderResults] = useState<{ id: string; name: string; parent_id: string | null }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // ── Modals ──
  const [preview, setPreview] = useState<BestandRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: "file" | "folder" } | null>(null);
  // [BRUG-FILES-SHARED] Lightweight toast for share confirmation (no library).
  const [toast, setToast] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; type: "file" | "folder"; excludeId?: string } | null>(null);
  // [BRUG-FILES-SHARED / AI-SUGGEST] Pending AI placement suggestion for a file
  // uploaded at the root. We SUGGEST, the owner confirms — never a silent move.
  const [aiSuggest, setAiSuggest] = useState<{ docId: string; fileName: string; folderId: string; path: string } | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: import("./types").ContextMenuItem[] } | null>(null);

  // ── New folder ──
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [newFolderInline, setNewFolderInline] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderRef = useRef<HTMLInputElement>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map()); // grid view
  const rowRefs  = useRef<Map<string, HTMLDivElement>>(new Map()); // list view

  // ── Drag ──
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [draggedType, setDraggedType] = useState<"file" | "folder" | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dragSelectRef = useRef({ startX: 0, startY: 0, active: false });
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // [BOEK-033] Internal navigation history — back button between folders/views
  // [BESTANDEN-SMART] NavState carries smartView too, so Back restores a smart
  // view (Recent/Favorieten/Gedeeld) exactly as it restores a folder or the trash.
  type NavState = { folderId: string | null; showTrash: boolean; smartView: SmartView | null };
  const navHistoryRef = useRef<NavState[]>([]);

  const navigateTo = useCallback((folderId: string | null, opts?: { trash?: boolean }) => {
    // Push current state to history
    navHistoryRef.current.push({ folderId: currentFolderId, showTrash, smartView });
    setCurrentFolderId(folderId);
    setShowTrash(opts?.trash ?? false);
    setSmartView(null); // [BESTANDEN-SMART] leaving a smart view for a real folder
    setSelectedIds(new Set());
    setSearch("");
  }, [currentFolderId, showTrash, smartView]); // eslint-disable-line

  // [BESTANDEN-SMART] Enter a smart view. Parallels navigateTo: pushes history,
  // clears folder/trash/selection so the flat cross-folder list takes over.
  const navigateToSmart = useCallback((view: SmartView) => {
    navHistoryRef.current.push({ folderId: currentFolderId, showTrash, smartView });
    setSmartView(view);
    setShowTrash(false);
    setSelectedIds(new Set());
    setSearch("");
  }, [currentFolderId, showTrash, smartView]); // eslint-disable-line

  const navigateBack = useCallback(() => {
    const prev = navHistoryRef.current.pop();
    if (!prev) return;
    setCurrentFolderId(prev.folderId);
    setShowTrash(prev.showTrash);
    setSmartView(prev.smartView);
    setSelectedIds(new Set());
    setSearch("");
  }, []);

  const canGoBack = navHistoryRef.current.length > 0;

  // ── Close dropdown outside click ──
  useEffect(() => {
    if (!showNewMenu) return;
    const fn = (e: MouseEvent) => { if (!newMenuRef.current?.contains(e.target as Node)) setShowNewMenu(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [showNewMenu]);

  // [BESTANDEN-FOCUS] React to deep-links AFTER client-side navigation. router.push
  // to /dashboard/bestanden?folder=..&focus=.. does not re-run the useState
  // initializers above, so without this the folder/focus were ignored until a manual
  // refresh. We read the params on every change, apply them, then clean the URL.
  useEffect(() => {
    const folder = searchParams.get("folder");
    const focus = searchParams.get("focus");
    if (folder === null && focus === null) return;
    if (folder !== null) setCurrentFolderId(folder);
    if (focus !== null) setFocusId(focus);
    setShowTrash(false);
    setSmartView(null); // [BESTANDEN-SMART] a deep-link targets a real folder, leave any smart view
    setSearch("");
    setSearchResults(null);
    setFolderResults([]);
    // Clean the URL so refresh/back don't re-trigger the deep-link.
    window.history.replaceState({}, "", "/dashboard/bestanden");
  }, [searchParams]);

  // ── Escape = clear selection / close menu ──
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedIds(new Set()); setShowNewMenu(false); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // ── Load data ──
  // [race] Sequence guard: quickly navigating A→B fires two loadContents; without
  // this, if A resolves last it overwrites B's contents while the breadcrumb/URL say
  // B. Only the most recent call may write state (and clear `loading`).
  const loadSeqRef = useRef(0);
  const loadContents = useCallback(async (folderId: string | null) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/bestanden?folder_id=${folderId ?? "root"}`);
      const json = await res.json() as { folders?: FolderRow[]; documents?: BestandRow[] };
      if (seq !== loadSeqRef.current) return; // a newer load started — drop this stale result
      // [BOEK-033] Gedeeld met boekhouder always first
      const folders = (json.folders ?? []).sort((a, b) => {
        if (a.name === "Gedeeld met boekhouder") return -1;
        if (b.name === "Gedeeld met boekhouder") return 1;
        return a.name.localeCompare(b.name, "nl");
      });
      setSubFolders(folders);
      setDocs(json.documents ?? []);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  const loadAllFolders = useCallback(async () => {
    const res = await fetch("/api/bestanden/folders-tree").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as FolderRow[];
    setAllFolders(data);
    // [BOEK-033] Gedeeld met boekhouder always first in sidebar tree
    const sorted = [...data].sort((a, b) => {
      if (a.name === "Gedeeld met boekhouder") return -1;
      if (b.name === "Gedeeld met boekhouder") return 1;
      return 0;
    });
    setFolderTree(buildTree(sorted, null));
  }, []);

  // [BESTANDEN-SMART] Storage meter — cheap count+bytes aggregate over own files.
  const refreshStorage = useCallback(async () => {
    const res = await fetch("/api/bestanden?stats=true").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as { count: number; bytes: number };
    setStorage(data);
  }, []);

  useEffect(() => {
    loadContents(currentFolderId);
    loadAllFolders();
    refreshStorage(); // [BESTANDEN-SMART] keep the sidebar meter fresh on load/nav
  }, [currentFolderId]); // eslint-disable-line

  // [BESTANDEN-SMART] Re-fetch the active smart view after a mutation. Cheap: only
  // fires the network call while a smart view is open (guarded in the effect).
  const bumpSmart = useCallback(() => setSmartRefreshKey(k => k + 1), []);

  // [BESTANDEN-SMART] Load the flat list for the active smart view. Re-fetches on
  // entry AND on smartRefreshKey so Recent/Favorieten/Gedeeld stay fresh (e.g.
  // after starring or un-sharing a file from within the view itself).
  useEffect(() => {
    if (!smartView) return;
    let cancelled = false;
    setSmartLoading(true);
    fetch(`/api/bestanden?view=${smartView}`)
      .then(r => r.json())
      .then((j: { documents?: BestandRow[] }) => { if (!cancelled) setSmartDocs(j.documents ?? []); })
      .catch(() => { if (!cancelled) setSmartDocs([]); })
      .finally(() => { if (!cancelled) setSmartLoading(false); });
    return () => { cancelled = true; };
  }, [smartView, smartRefreshKey]);

  // [BESTANDEN-SORT] Close the sort menu on outside click (same pattern as + Nieuw).
  useEffect(() => {
    if (!showSortMenu) return;
    const fn = (e: MouseEvent) => { if (!sortMenuRef.current?.contains(e.target as Node)) setShowSortMenu(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [showSortMenu]);

  // [BESTANDEN-FOCUS] Once the docs of the target folder are loaded, scroll to
  // and highlight the focused file, then clear the highlight after a moment.
  useEffect(() => {
    if (!focusId || docs.length === 0) return;
    if (!docs.some(d => d.id === focusId)) return;
    const el = cardRefs.current.get(focusId) ?? rowRefs.current.get(focusId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(focusId);
      const t = setTimeout(() => { setHighlightId(null); setFocusId(null); }, 2600);
      return () => clearTimeout(t);
    }
  }, [docs, focusId]); // eslint-disable-line

  // [BOEK-011 — removed by BOEK-011, file owned by BOEK-033]
  // The previous useEffect that read ?folder={id} from the URL was removed
  // here. It caused a race: loadContents fired with null before this effect
  // updated currentFolderId, so the root was shown while breadcrumbs said
  // otherwise. The URL is now read inline in useState above — single source
  // of truth, no ordering issues.

  // ── Search ── (documents + folders)
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); setFolderResults([]); return; }
    // [SEARCH] `active` guards against out-of-order responses: a superseded query's
    // in-flight fetch must not overwrite the newer query's results.
    let active = true;
    const t = setTimeout(async () => {
      setSearchLoading(true);
      const res = await fetch(`/api/bestanden?search=${encodeURIComponent(search)}`);
      const json = await res.json() as { results?: SearchResult[]; folders?: { id: string; name: string; parent_id: string | null }[] };
      if (!active) return;
      setSearchResults(json.results ?? []);
      setFolderResults(json.folders ?? []);
      setSearchLoading(false);
    }, 300);
    return () => { active = false; clearTimeout(t); };
  }, [search]);

  useEffect(() => { if (newFolderInline) setTimeout(() => newFolderRef.current?.focus(), 50); }, [newFolderInline]);

  // [BOEK-033] Keyboard shortcuts — Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Delete
  const clipboardRef = useRef<{ ids: string[]; op: "cut" | "copy" } | null>(null);
  const [clipboardDisplay, setClipboardDisplay] = useState<{ count: number; op: "cut" | "copy" } | null>(null);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;

      const fileIds = [...selectedIds].filter(k => k.startsWith("d:")).map(k => k.slice(2));
      const allIds  = [...selectedIds].map(k => k.slice(2));

      // [BESTANDEN-SMART] Keyboard ops must target the VISIBLE list. In a smart view
      // that is smartDocs (flat, no folders); in a normal folder it is docs + subFolders.
      const viewDocs = smartView ? smartDocs : docs;
      const viewFolders = smartView ? [] : subFolders;

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectedIds(new Set([...viewFolders.map(f => `f:${f.id}`), ...viewDocs.map(d => `d:${d.id}`)]));
        return;
      }
      if (selectedIds.size === 0) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        clipboardRef.current = { ids: fileIds, op: "copy" };
        setClipboardDisplay({ count: fileIds.length, op: "copy" });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        e.preventDefault();
        clipboardRef.current = { ids: fileIds, op: "cut" };
        setClipboardDisplay({ count: fileIds.length, op: "cut" });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        const cb = clipboardRef.current;
        if (!cb || cb.op !== "cut" || cb.ids.length === 0) return;
        Promise.all(cb.ids.map(id =>
          fetch(`/api/bestanden?id=${id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_id: currentFolderId }),
          })
        )).then(() => {
          clipboardRef.current = null; setClipboardDisplay(null);
          loadContents(currentFolderId);
        });
      }
      if (e.key === "Delete") {
        e.preventDefault();
        if (fileIds.length === 0) return;
        if (!confirm(`${fileIds.length} bestand(en) naar prullenbak?`)) return;
        Promise.all(fileIds.map(id =>
          fetch(`/api/bestanden?id=${id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trashed: true }),
          })
        )).then(() => {
          setDocs(p => p.filter(d => !fileIds.includes(d.id)));
          setSmartDocs(p => p.filter(d => !fileIds.includes(d.id))); // [BESTANDEN-SMART] keep smart view in sync
          setSelectedIds(new Set());
          refreshStorage(); // [BESTANDEN-SMART] meter reflects the trashed files
        });
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [selectedIds, currentFolderId, subFolders, docs, smartView, smartDocs, refreshStorage]); // eslint-disable-line

  // ── Selection helpers ──
  // [BESTANDEN-SORT/SMART] Sorted copy of the ACTIVE list (smart view or folder),
  // used for BOTH rendering and range-selection order — so Shift-click ranges follow
  // exactly what the user sees in whichever view is active (folder, Recent, …).
  const displayDocs = sortDocs(smartView ? smartDocs : docs, sortField, sortDir);
  const allItems = [...(smartView ? [] : subFolders).map(f => `f:${f.id}`), ...displayDocs.map(d => `d:${d.id}`)];

  const handleSelect = (e: React.MouseEvent, itemKey: string) => {
    const id = itemKey.slice(2);

    if (e.shiftKey && lastClickedRef.current) {
      // Range select
      const from = allItems.indexOf(lastClickedRef.current);
      const to = allItems.indexOf(itemKey);
      if (from >= 0 && to >= 0) {
        const range = allItems.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelectedIds(new Set(range));
        return;
      }
    }

    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(itemKey)) n.delete(itemKey); else n.add(itemKey);
      return n;
    });
    lastClickedRef.current = itemKey;
  };

  // [mutation-safety] Shared helpers so a failed write never leaves the UI asserting
  // success. flashToast shows a transient message; reloadTruth re-syncs the view with
  // the server (used when an optimistic-ish action fails, so nothing silently lies).
  const flashToast = (msg: string, ms = 2600) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  };
  const reloadTruth = () => {
    loadContents(currentFolderId);
    loadAllFolders();
    bumpSmart();
    refreshStorage();
  };
  const creatingFolderRef = useRef(false); // [double-fire] Enter + onBlur guard
  const bulkBusyRef = useRef(false);       // [double-submit] one batch at a time
  const fabUploadingRef = useRef(false);   // [double-submit] serialize FAB uploads

  // ── Folder CRUD ──
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) { setNewFolderInline(false); return; }
    if (creatingFolderRef.current) return; // [double-fire] Enter then onBlur → one folder
    creatingFolderRef.current = true;
    const name = newFolderName.trim();
    setNewFolderName(""); setNewFolderInline(false); // clear now so a second fire no-ops
    try {
      const res = await fetch("/api/bestanden/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: currentFolderId }),
      });
      if (!res.ok) { flashToast("Map aanmaken mislukt"); return; }
      const json = await res.json() as FolderRow;
      if (json.id) { setSubFolders(p => [...p, json]); setAllFolders(p => [...p, json]); }
    } finally {
      creatingFolderRef.current = false;
    }
  };

  const handleRenameConfirm = async (newName: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setRenameTarget(null);
    const url = target.type === "folder"
      ? `/api/bestanden/folders?id=${target.id}`
      : `/api/bestanden?id=${target.id}`;
    const body = target.type === "folder" ? { name: newName } : { file_name: newName };
    const res = await fetch(url, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { flashToast("Hernoemen mislukt"); return; } // don't show a name that didn't save
    if (target.type === "folder") {
      setSubFolders(p => p.map(f => f.id === target.id ? { ...f, name: newName } : f));
      setAllFolders(p => p.map(f => f.id === target.id ? { ...f, name: newName } : f));
    } else {
      setDocs(p => p.map(d => d.id === target.id ? { ...d, file_name: newName } : d));
    }
  };

  const handleDeleteFolder = async (id: string) => {
    // [BOEK-033] Guard: never delete system folders
    const folder = subFolders.find(f => f.id === id) ?? allFolders.find(f => f.id === id);
    if (folder?.is_system) return;
    if (!confirm("Map verwijderen? Bestanden worden naar hoofdmap verplaatst.")) return;
    const res = await fetch(`/api/bestanden/folders?id=${id}`, { method: "DELETE" });
    if (!res.ok) { flashToast("Map verwijderen mislukt"); return; } // no optimistic removal on failure
    setSubFolders(p => p.filter(f => f.id !== id));
    setAllFolders(p => p.filter(f => f.id !== id));
    setFolderTree(p => p.filter(n => n.id !== id));
    setDocs(p => p.map(d => d.folder_id === id ? { ...d, folder_id: null } : d));
    refreshStorage();
  };

  // ── File actions ──
  const handleDelete = async (id: string) => {
    // Soft delete — move to trash
    const res = await fetch(`/api/bestanden?id=${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) { flashToast("Verwijderen mislukt"); return; }
    setDocs(p => p.filter(d => d.id !== id));
    setSmartDocs(p => p.filter(d => d.id !== id)); // [BESTANDEN-SMART] drop from smart view
    refreshStorage();
  };

  const handleMove = async (id: string, type: "file" | "folder", folderId: string | null) => {
    const url = type === "folder" ? `/api/bestanden/folders?id=${id}` : `/api/bestanden?id=${id}`;
    const body = type === "folder" ? { parent_id: folderId } : { folder_id: folderId };
    const res = await fetch(url, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMoveTarget(null);
    if (!res.ok) { flashToast("Verplaatsen mislukt"); return; } // don't remove a row that didn't move
    if (type === "folder") {
      setSubFolders(p => p.filter(f => f.id !== id));
      loadAllFolders();
    } else {
      setDocs(p => p.filter(d => d.id !== id));
    }
    bumpSmart(); // [BESTANDEN-SMART] a move may change what Gedeeld/Recent shows
  };

  const handleStar = async (id: string, type: "file" | "folder", current: boolean) => {
    const url = type === "file" ? `/api/bestanden?id=${id}` : `/api/bestanden/folders?id=${id}`;
    const res = await fetch(url, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: !current }),
    });
    if (!res.ok) { flashToast("Actie mislukt"); return; }
    if (type === "file") {
      setDocs(p => p.map(d => d.id === id ? { ...d, starred: !current } : d));
      setSmartDocs(p =>
        smartView === "starred"
          ? p.filter(d => d.id !== id)                                   // un/re-star leaves Favorieten
          : p.map(d => d.id === id ? { ...d, starred: !current } : d),  // reflect elsewhere
      );
    } else {
      setSubFolders(p => p.map(f => f.id === id ? { ...f, starred: !current } : f));
    }
  };

  // [BRUG-FILES-SHARED] Sharing = set shared=true (the field the accountant RLS
  // documents_accountant_read actually reads) + period/year so the closing-package
  // ZIP places the file in the right quarter. We ALSO move it into the "Gedeeld met
  // boekhouder" folder for the owner's own visual organization — but shared=true is
  // what makes the accountant see it. (Previously only folder_id was written, so the
  // accountant never saw shared files — that bug is fixed here.)
  // [BRUG-FILES-SHARED] Sharing = moving the file into the magic "Gedeeld met
  // boekhouder" folder. The bestanden PATCH route detects the shared folder and
  // automatically sets shared=true + the current quarter, so the accountant sees
  // it and it lands in the closing-package ZIP. No popup, no quarter picker —
  // dropping it in the accountant folder IS the explicit share action.
  // [BRUG-FILES-SHARED] Share toggle — share or un-share IN PLACE. The file stays in
  // its original folder; only the shared flag changes (the accountant RLS reads it).
  // Sharing also stamps the current quarter server-side so the file lands in the ZIP.
  const handleToggleShare = async (docId: string, currentlyShared: boolean) => {
    const next = !currentlyShared;
    const res = await fetch(`/api/bestanden?id=${docId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: next }),
    });
    // [share-truth] If the write failed we must NOT flip the badge or claim success —
    // otherwise the owner believes the accountant can see a doc that never got shared.
    if (!res.ok) {
      flashToast(next ? "Delen mislukt — probeer opnieuw" : "Stoppen met delen mislukt");
      return;
    }
    setDocs(p => p.map(d => d.id === docId ? { ...d, shared: next } : d));
    // [BESTANDEN-SMART] In Gedeeld, un-sharing removes the row; elsewhere reflect it.
    setSmartDocs(p =>
      smartView === "shared" && !next
        ? p.filter(d => d.id !== docId)
        : p.map(d => d.id === docId ? { ...d, shared: next } : d),
    );
    flashToast(next ? "Gedeeld met je boekhouder" : "Delen gestopt");
  };

  // [BOEK-033] Upload complete — just add to list, AI + placement already done in UploadArea
  const handleUploaded = useCallback((doc: BestandRow) => {
    setDocs(p => [doc, ...p]);
    refreshStorage(); // [BESTANDEN-SMART] keep the sidebar meter accurate
    // No share popup — sharing is manual via right-click → "Delen"
    // No AI suggestion popup — AI places silently in UploadArea
  }, [refreshStorage]);

  // ── Download ──
  const downloadFile = async (docId: string, fileName: string) => {
    const r = await fetch(`/api/files/${docId}/url`);
    const { url } = await r.json() as { url: string };
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
  };

  // ── Bulk actions ──
  const selectedFileIds = [...selectedIds].filter(k => k.startsWith("d:")).map(k => k.slice(2));
  const selectedFolderIds = [...selectedIds].filter(k => k.startsWith("f:")).map(k => k.slice(2));

  const handleBulkDelete = async () => {
    if (!confirm(`${selectedIds.size} item(s) verwijderen?`)) return;
    if (bulkBusyRef.current) return; // [double-submit] one batch at a time
    bulkBusyRef.current = true;
    try {
      const results = await Promise.all([
        ...selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) })),
        ...selectedFolderIds.map(id => fetch(`/api/bestanden/folders?id=${id}`, { method: "DELETE" })),
      ]);
      setSelectedIds(new Set());
      if (results.some(r => !r.ok)) { flashToast("Sommige items niet verwijderd — opnieuw geladen"); reloadTruth(); return; }
      setDocs(p => p.filter(d => !selectedFileIds.includes(d.id)));
      setSmartDocs(p => p.filter(d => !selectedFileIds.includes(d.id))); // [BESTANDEN-SMART]
      setSubFolders(p => p.filter(f => !selectedFolderIds.includes(f.id)));
      refreshStorage();
    } finally {
      bulkBusyRef.current = false;
    }
  };

  const handleBulkMove = async (folderId: string | null) => {
    if (bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    try {
      const results = await Promise.all([
        ...selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folderId }) })),
        ...selectedFolderIds.map(id => fetch(`/api/bestanden/folders?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent_id: folderId }) })),
      ]);
      setSelectedIds(new Set()); setBulkMoveOpen(false);
      if (results.some(r => !r.ok)) { flashToast("Sommige items niet verplaatst — opnieuw geladen"); reloadTruth(); return; }
      setDocs(p => p.filter(d => !selectedFileIds.includes(d.id)));
      setSubFolders(p => p.filter(f => !selectedFolderIds.includes(f.id)));
      loadAllFolders();
      bumpSmart(); // [BESTANDEN-SMART] moved files may enter/leave Gedeeld
    } finally {
      bulkBusyRef.current = false;
    }
  };

  // [BRUG-FILES-SHARED] Bulk share has no quarter picker, so it defaults to the
  // current quarter. Writes shared=true (+ period/year) so the accountant sees the
  // files; also moves them into "Gedeeld met boekhouder" for visual organization.
  // [BRUG-FILES-SHARED] Bulk share = move selected files into the shared folder;
  // the PATCH route auto-shares them (shared=true + current quarter).
  // [BRUG-FILES-SHARED] Bulk share IN PLACE — set shared=true on the selected files
  // without moving them; the route stamps the current quarter. Files stay where they
  // are and simply become visible to the accountant.
  const handleBulkShare = async () => {
    if (bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    try {
      const results = await Promise.all(selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: true }),
      })));
      setSelectedIds(new Set());
      // [share-truth] Never claim a bulk share succeeded if any write failed.
      if (results.some(r => !r.ok)) { flashToast("Sommige bestanden niet gedeeld — opnieuw geladen"); reloadTruth(); return; }
      setDocs(p => p.map(d => selectedFileIds.includes(d.id) ? { ...d, shared: true } : d));
      setSmartDocs(p => p.map(d => selectedFileIds.includes(d.id) ? { ...d, shared: true } : d)); // [BESTANDEN-SMART]
      bumpSmart();
    } finally {
      bulkBusyRef.current = false;
    }
  };

  const handleBulkStar = async () => {
    if (bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    try {
      const results = await Promise.all([
        ...selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starred: true }) })),
        ...selectedFolderIds.map(id => fetch(`/api/bestanden/folders?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starred: true }) })),
      ]);
      setSelectedIds(new Set());
      if (results.some(r => !r.ok)) { flashToast("Sommige items niet aangepast — opnieuw geladen"); reloadTruth(); return; }
      setDocs(p => p.map(d => selectedFileIds.includes(d.id) ? { ...d, starred: true } : d));
      setSmartDocs(p => p.map(d => selectedFileIds.includes(d.id) ? { ...d, starred: true } : d)); // [BESTANDEN-SMART]
      setSubFolders(p => p.map(f => selectedFolderIds.includes(f.id) ? { ...f, starred: true } : f));
      bumpSmart();
    } finally {
      bulkBusyRef.current = false;
    }
  };

  // ── Context menus ──
  const openFileContextMenu = (e: React.MouseEvent, doc: BestandRow) => {
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "Bekijken", icon: "visibility", onClick: () => setPreview(doc) },
        { label: "Downloaden", icon: "download", onClick: () => downloadFile(doc.id, doc.file_name) },
        { label: "Naam wijzigen", icon: "edit", onClick: () => setRenameTarget({ id: doc.id, name: doc.file_name, type: "file" }) },
        { label: "Verplaatsen", icon: "drive_file_move", onClick: () => setMoveTarget({ id: doc.id, type: "file" }) },
        { label: doc.starred ? "Ster verwijderen" : "Markeren met ster", icon: "star", onClick: () => handleStar(doc.id, "file", !!doc.starred) },
        { label: doc.shared ? "Niet meer delen" : "Delen met boekhouder", icon: "share", onClick: () => handleToggleShare(doc.id, !!doc.shared) },
        { label: "Naar prullenbak", icon: "delete", onClick: () => handleDelete(doc.id), danger: true, divider: true },
      ],
    });
  };

  const openFolderContextMenu = (e: React.MouseEvent, folder: FolderRow) => {
    const isShared = folder.name === "Gedeeld met boekhouder";
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "Openen", icon: "folder_open", onClick: () => navigateTo(folder.id) },
        { label: folder.starred ? "Ster verwijderen" : "Markeren met ster", icon: "star", onClick: () => handleStar(folder.id, "folder", !!folder.starred) },
        ...(!isShared ? [
          { label: "Naam wijzigen", icon: "edit", onClick: () => setRenameTarget({ id: folder.id, name: folder.name, type: "folder" as const }) },
          { label: "Verplaatsen", icon: "drive_file_move", onClick: () => setMoveTarget({ id: folder.id, type: "folder" as const, excludeId: folder.id }) },
          { label: "Verwijderen", icon: "delete", onClick: () => handleDeleteFolder(folder.id), danger: true, divider: true },
        ] : []),
      ],
    });
  };

  // ── Drag handlers ──
  const handleDocDragStart = (e: DragEvent<HTMLDivElement>, docId: string) => {
    setDraggedId(docId); setDraggedType("file");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `file:${docId}`);
  };

  const handleFolderDragStart = (e: DragEvent<HTMLDivElement>, folder: FolderRow) => {
    setDraggedId(folder.id); setDraggedType("folder");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `folder:${folder.id}`);
  };

  const handleFolderDrop = async (e: DragEvent<HTMLDivElement>, targetFolderId: string) => {
    e.preventDefault();
    setDragOverFolder(null);

    const raw = e.dataTransfer.getData("text/plain");
    const [type, id] = raw.split(":");

    if (!id) return;

    // If dragging a selected group
    if (selectedIds.size > 0) {
      const key = type === "folder" ? `f:${id}` : `d:${id}`;
      if (selectedIds.has(key)) {
        await handleBulkMove(targetFolderId);
        return;
      }
    }

    // Single item
    if (type === "folder") {
      if (id === targetFolderId) return; // can't drop on itself
      await fetch(`/api/bestanden/folders?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: targetFolderId }),
      });
      setSubFolders(p => p.filter(f => f.id !== id));
      loadAllFolders();
    } else {
      await fetch(`/api/bestanden?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: targetFolderId }),
      });
      setDocs(p => p.filter(d => d.id !== id));
    }

    setDraggedId(null); setDraggedType(null);
  };

  const isEmpty = subFolders.length === 0 && docs.length === 0 && !loading;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      height: "100dvh", background: "#F8F9FA",
      display: "flex", flexDirection: "column",
      fontFamily: "'Roboto',-apple-system,sans-serif",
      overflow: "hidden", // [BOEK-033] nothing escapes
    }}>

      {/* ── Modals ── */}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {renameTarget && <RenameModal currentName={renameTarget.name} type={renameTarget.type} onConfirm={handleRenameConfirm} onClose={() => setRenameTarget(null)} />}
      {/* [BRUG-FILES-SHARED] Share confirmation toast — auto-dismisses. */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)",
          zIndex: 500, background: "#323232", color: "#fff",
          padding: "12px 20px", borderRadius: 24, fontSize: 14, fontWeight: 500,
          boxShadow: "0 4px 16px rgba(0,0,0,0.28)", display: "flex", alignItems: "center", gap: 8,
          fontFamily: "'Roboto',sans-serif", whiteSpace: "nowrap",
          pointerEvents: "none",
        }}>
          <Icon name="share" size={16} color="#fff" />
          {toast}
        </div>
      )}
      {moveTarget && <MoveModal folders={allFolders} excludeId={moveTarget.excludeId} onMove={fid => handleMove(moveTarget.id, moveTarget.type, fid)} onClose={() => setMoveTarget(null)} />}
      {bulkMoveOpen && <MoveModal folders={allFolders} onMove={handleBulkMove} onClose={() => setBulkMoveOpen(false)} />}
      {/* [AI-SUGGEST] Root upload → AI suggests a folder; the owner confirms or picks. */}
      {aiSuggest && (
        <AiSuggestionModal
          fileName={aiSuggest.fileName}
          suggestedPath={aiSuggest.path}
          onAccept={async () => {
            const { docId, folderId } = aiSuggest;
            setAiSuggest(null);
            await fetch(`/api/bestanden?id=${docId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ folder_id: folderId }),
            });
            setDocs(p => p.filter(d => d.id !== docId));
          }}
          onChooseManually={() => {
            const { docId } = aiSuggest;
            setAiSuggest(null);
            setMoveTarget({ id: docId, type: "file" });
          }}
        />
      )}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}

      {/* ── Clipboard indicator ── */}
      {clipboardDisplay && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          zIndex: 50, display: "flex", alignItems: "center", gap: 8,
          background: T.onSurface, color: "white",
          padding: "8px 16px", borderRadius: T.xl, boxShadow: T.elev2,
          fontSize: 13, whiteSpace: "nowrap",
        }}>
          <Icon name={clipboardDisplay.op === "cut" ? "content_cut" : "content_copy"} size={16} color="white" />
          {clipboardDisplay.count} item{clipboardDisplay.count > 1 ? "s" : ""} {clipboardDisplay.op === "cut" ? "geknipt" : "gekopieerd"} — Ctrl+V om te plakken
          <button onClick={() => { clipboardRef.current = null; setClipboardDisplay(null); }}
            aria-label="Sluiten"
            style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 0 }}>
            <Icon name="close" size={14} color="rgba(255,255,255,0.7)" />
          </button>
        </div>
      )}

      {/* ── Bulk bar ── */}
      <BulkBar
        selectedCount={selectedIds.size}
        onShare={handleBulkShare}
        onMove={() => setBulkMoveOpen(true)}
        onDelete={handleBulkDelete}
        onStar={handleBulkStar}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* ── Top bar ── */}
      <div style={{
        flexShrink: 0, zIndex: 30,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        overflow: "visible",
      }}>
        <div style={{
          display: "flex", alignItems: "center",
          gap: 8, padding: "0 12px", height: 56,
          width: "100%", boxSizing: "border-box",
          maxWidth: "100%", overflow: "hidden",
        }}>
          {/* Back — internal folder history if it exists, else the page's
              canonical parent (role home). Never router.back() — that could
              loop back onto a dead entry. */}
          <button
            onClick={() => {
              if (navHistoryRef.current.length > 0) navigateBack();
              else router.push(logoHref);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "6px 10px", background: "none", border: "none",
              borderRadius: T.full, fontSize: 14, fontWeight: 500,
              color: T.outline, cursor: "pointer", flexShrink: 0,
              transition: "background 0.1s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <Icon name="arrow_back" size={18} color={T.outline} />
            <span className="hidden sm:inline">Terug</span>
          </button>

          {/* Sidebar toggle mobile */}
          <button onClick={() => setSidebarOpen(v => !v)} className="flex lg:hidden"
            aria-label="Mappen tonen"
            style={{ width: 36, height: 36, border: "none", background: "none", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: T.full, flexShrink: 0 }}>
            <Icon name="folder_open" size={22} color={T.warning} />
          </button>

          {/* Search */}
          <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
            <Icon name="search" size={18} color={T.outline} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Zoeken..."
              style={{
                width: "100%", paddingLeft: 38, paddingRight: search ? 32 : 10,
                paddingTop: 8, paddingBottom: 8,
                fontSize: 14, background: "#F1F3F4", border: "none", borderRadius: T.full,
                color: T.onSurface, outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => (e.currentTarget.style.boxShadow = `0 0 0 2px ${T.primary}40`)}
              onBlur={e => (e.currentTarget.style.boxShadow = "none")}
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Zoekopdracht wissen" style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                width: 18, height: 18, border: "none", background: T.outline,
                borderRadius: T.full, display: "flex", alignItems: "center",
                justifyContent: "center", cursor: "pointer",
              }}>
                <Icon name="close" size={12} color="white" />
              </button>
            )}
          </div>

          {/* [BESTANDEN-SORT] Sort control — Naam / Datum / Grootte + direction. */}
          <div ref={sortMenuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setShowSortMenu(v => !v)}
              title="Sorteren"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                height: 38, padding: "0 10px", background: "#F1F3F4",
                border: "none", borderRadius: T.md, cursor: "pointer",
                color: T.onSurface,
              }}
            >
              <Icon name="sort" size={18} color={T.outline} />
              <span className="hidden sm:inline" style={{ fontSize: 13 }}>{SORT_LABELS[sortField]}</span>
              <Icon name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"} size={14} color={T.outline} />
            </button>
            {showSortMenu && (() => {
              const rect = sortMenuRef.current?.getBoundingClientRect();
              return (
                <div style={{
                  position: "fixed",
                  top: rect ? rect.bottom + 6 : 62,
                  right: rect ? window.innerWidth - rect.right : 12,
                  background: "white", borderRadius: 12,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.15)", border: "1px solid #E0E0E0",
                  minWidth: 180, zIndex: 9999, padding: "4px 0",
                }}>
                  {(Object.keys(SORT_LABELS) as SortField[]).map(field => (
                    <button key={field}
                      onClick={() => { setSortField(field); setShowSortMenu(false); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 16px", background: "none", border: "none",
                        fontSize: 14, color: sortField === field ? T.primary : T.onSurface,
                        fontWeight: sortField === field ? 600 : 400, cursor: "pointer", textAlign: "left",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {sortField === field
                        ? <Icon name="check" size={16} color={T.primary} />
                        : <span style={{ width: 16, display: "inline-block", flexShrink: 0 }} />}
                      {SORT_LABELS[field]}
                    </button>
                  ))}
                  <div style={{ height: 1, background: T.surfaceVariant, margin: "4px 0" }} />
                  <button
                    onClick={() => setSortDir(d => (d === "asc" ? "desc" : "asc"))}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 16px", background: "none", border: "none",
                      fontSize: 14, color: T.onSurface, cursor: "pointer", textAlign: "left",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <Icon name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"} size={16} color={T.outline} />
                    {sortDir === "asc" ? "Oplopend" : "Aflopend"}
                  </button>
                </div>
              );
            })()}
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", background: "#F1F3F4", borderRadius: T.md, padding: 3, flexShrink: 0 }}>
            {(["grid", "list"] as ViewMode[]).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} aria-label={mode === "grid" ? "Rasterweergave" : "Lijstweergave"} style={{
                width: 32, height: 32, border: "none", cursor: "pointer",
                borderRadius: T.sm, display: "flex", alignItems: "center", justifyContent: "center",
                background: viewMode === mode ? "white" : "transparent",
                boxShadow: viewMode === mode ? T.elev1 : "none",
                color: viewMode === mode ? T.primary : T.outline, transition: "all 0.15s",
              }}>
                <Icon name={mode === "grid" ? "grid_view" : "view_list"} size={18} />
              </button>
            ))}
          </div>

          {/* + Nieuw */}
          <div ref={newMenuRef} style={{ position: "relative", flexShrink: 0 }}>
            <input ref={fileInputRef} type="file" style={{ display: "none" }}
              onChange={async e => {
                setShowNewMenu(false);
                // [BOEK-033] Delegate to UploadArea's handleFiles by triggering it
                // The FAB input now supports multiple files
                const files = e.target.files;
                if (!files?.length) return;
                // [double-submit] Serialize FAB uploads — a second tap mid-upload would
                // otherwise run a concurrent loop racing on handleUploaded / classify.
                if (fabUploadingRef.current) { e.target.value = ""; return; }
                fabUploadingRef.current = true;
                try {
                for (const file of Array.from(files)) {
                  const now = new Date(); const fd = new FormData();
                  fd.append("file", file);
                  fd.append("year", String(now.getFullYear()));
                  fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
                  if (currentFolderId) fd.append("folder_id", currentFolderId);
                  const r = await fetch("/api/files", { method: "POST", body: fd });
                  const j = await r.json() as { id?: string };
                  if (j.id) {
                    // [BRUG-FILES-SHARED] Did the owner upload INTO the shared folder?
                    // If so, that IS the share action: PATCH folder_id=shared so the
                    // route auto-shares (shared=true + current quarter). Skip AI
                    // re-placement, which would otherwise move it out of the folder.
                    const sharedFolder = allFolders.find(f => f.name === "Gedeeld met boekhouder");
                    const uploadedIntoShared = !!sharedFolder && currentFolderId === sharedFolder.id;

                    if (uploadedIntoShared) {
                      // Uploaded into the shared folder → auto-share (route handles it).
                      await fetch(`/api/bestanden?id=${j.id}`, {
                        method: "PATCH", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ folder_id: sharedFolder!.id }),
                      });
                    } else if (currentFolderId) {
                      // [AI-SUGGEST] Uploaded INTO a specific folder → the owner already
                      // chose where it goes. Respect that: leave it here, AI does not
                      // re-place it. The file was uploaded with folder_id=currentFolderId.
                    } else {
                      // [AI-SUGGEST] Uploaded at the root (no folder chosen). Ask AI for a
                      // suggestion and SHOW it — never move silently. The owner confirms
                      // ("Ja, hier plaatsen") or picks a folder themselves.
                      try {
                        const cr = await fetch("/api/bestanden/classify", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ documentId: j.id, fileName: file.name }),
                        });
                        if (cr.ok) {
                          // The classify route returns a ready folderPath label
                          // (e.g. "2026 / Q2 / Bank") and the resolved folderId.
                          const result = await cr.json() as { folderId: string | null; folderPath?: string; type: string };
                          if (result.folderId && result.type !== "unknown") {
                            setAiSuggest({
                              docId: j.id,
                              fileName: file.name,
                              folderId: result.folderId,
                              path: result.folderPath || "Aanbevolen map",
                            });
                          }
                        }
                      } catch { /* silent — file simply stays at the root */ }
                    }
                    handleUploaded({
                      id: j.id, file_name: file.name, file_url: "", file_size: file.size,
                      file_type: file.type, doc_type: null, period: null, year: now.getFullYear(),
                      notes: null, invoice_id: null, created_at: now.toISOString(),
                      folder_id: currentFolderId, ai_processed: false,
                      ai_doc_type: null, ai_suggested_folder: null, source: "upload",
                    });
                  }
                }
                } finally {
                  fabUploadingRef.current = false;
                }
                e.target.value = "";
              }}
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.doc,.docx,.xls,.xlsx,.csv,.xml,.zip,.eml"
            />
            <button
              onClick={() => setShowNewMenu(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", background: T.primary, color: T.onPrimary,
                border: "none", borderRadius: T.full, fontSize: 14, fontWeight: 500,
                cursor: "pointer", boxShadow: T.elev1, flexShrink: 0,
              }}
              onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={e => (e.currentTarget.style.transform = "none")}
            >
              <Icon name="add" size={18} color={T.onPrimary} />
              <span className="hidden sm:inline">Nieuw</span>
            </button>

            {/* [BOEK-033] FINAL FIX — position:fixed bypasses ALL overflow:hidden parents */}
            {showNewMenu && (() => {
              const rect = newMenuRef.current?.getBoundingClientRect();
              return (
                <div style={{
                  position: "fixed",
                  top: rect ? rect.bottom + 6 : 62,
                  right: rect ? window.innerWidth - rect.right : 12,
                  background: "white",
                  borderRadius: 12,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                  border: "1px solid #E0E0E0",
                  minWidth: 188, zIndex: 9999, padding: "4px 0",
                }}>
                  {[
                    { label: "Nieuwe map", icon: "create_new_folder", onClick: () => { setShowNewMenu(false); setNewFolderInline(true); } },
                    { label: "Bestand uploaden", icon: "upload", onClick: () => { setShowNewMenu(false); fileInputRef.current?.click(); } },
                  ].map(item => (
                    <button key={item.label} onClick={item.onClick} style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 16px", background: "none", border: "none",
                      fontSize: 14, color: T.onSurface, cursor: "pointer", textAlign: "left",
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <Icon name={item.icon} size={18} color={T.outline} /> {item.label}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minWidth: 0 }}>

        {/* Sidebar overlay mobile */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(0,0,0,0.3)" }}
          />
        )}

        {/* Sidebar — desktop: static, mobile: slide-in */}
        <style>{`
          .bb-sidebar { position: relative; }
          @media (max-width: 1023px) {
            .bb-sidebar {
              position: fixed !important;
              top: 56px; left: 0; bottom: 0; z-index: 40;
              transform: translateX(-100%);
              transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
            }
            .bb-sidebar.open { transform: translateX(0); }
          }
        `}</style>
        <aside
          className={`bb-sidebar${sidebarOpen ? " open" : ""}`}
          style={{
            width: 240, background: "white", borderRight: "1px solid #E0E0E0",
            overflowY: "auto", flexShrink: 0, height: "100%",
          }}
        >
          <div style={{ padding: "12px 8px" }}>
            {/* [BOEK-033] BoekBrug logo — universal click target, returns to role home.
                Drive-style: top-left of sidebar, above Mijn bestanden. */}
            <Link
              href={logoHref}
              style={{
                display: "flex", alignItems: "center",
                padding: "6px 12px 14px",
                textDecoration: "none",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <span style={{
                fontSize: 22, fontWeight: 700, color: T.primary,
                letterSpacing: "-0.02em", cursor: "pointer",
                fontFamily: "'Roboto',sans-serif",
              }}>
                BoekBrug
              </span>
            </Link>

            {/* Root */}
            {(() => {
              const rootActive = currentFolderId === null && !showTrash && !smartView;
              return (
                <button onClick={() => navigateTo(null)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", border: "none", cursor: "pointer",
                  borderRadius: T.md, textAlign: "left", fontSize: 14,
                  background: rootActive ? T.primaryContainer : "transparent",
                  color: rootActive ? T.primary : T.onSurface,
                  fontWeight: rootActive ? 600 : 400,
                  transition: "background 0.1s",
                }}>
                  <Icon name="home" size={18} color={rootActive ? T.primary : T.outline} />
                  Mijn bestanden
                </button>
              );
            })()}

            {/* [BESTANDEN-SMART] Smart views — the Drive/OneDrive left-nav. Recent,
                Favorieten, Gedeeld: flat cross-folder lists, one tap away. */}
            {(Object.keys(SMART_VIEWS) as SmartView[]).map(view => {
              const meta = SMART_VIEWS[view];
              const active = smartView === view;
              return (
                <button key={view} onClick={() => navigateToSmart(view)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", border: "none", cursor: "pointer",
                  borderRadius: T.md, textAlign: "left", fontSize: 14,
                  background: active ? T.primaryContainer : "transparent",
                  color: active ? T.primary : T.onSurface,
                  fontWeight: active ? 600 : 400,
                  transition: "background 0.1s",
                }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surfaceVariant; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon name={meta.icon} size={18} color={active ? T.primary : T.outline} />
                  {meta.label}
                </button>
              );
            })}

            {/* [BESTANDEN-SMART] Divider before the real folder tree. */}
            <div style={{ height: 1, background: T.surfaceVariant, margin: "8px 4px" }} />

            {/* Folder tree — with drag-drop on each item */}
            {folderTree.map(node => (
              <SidebarDraggableFolder
                key={node.id}
                node={node}
                depth={0}
                activeFolderId={currentFolderId}
                onSelect={id => { navigateTo(id); }}
                onRename={(id, name) => setRenameTarget({ id, name, type: "folder" })}
                onDelete={handleDeleteFolder}
                onDrop={handleFolderDrop}
              />
            ))}

            {/* Inline new folder */}
            {newFolderInline && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px" }}>
                <Icon name="folder" size={18} color={T.warning} />
                <input ref={newFolderRef} value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") { setNewFolderInline(false); setNewFolderName(""); }
                  }}
                  onBlur={handleCreateFolder}
                  placeholder="Mapnaam..."
                  style={{ flex: 1, fontSize: 14, padding: "4px 8px", border: `2px solid ${T.primary}`, borderRadius: T.sm, outline: "none", color: T.onSurface }}
                />
              </div>
            )}

            {/* Trash — accepts drag */}
            <div style={{ marginTop: 8, borderTop: `1px solid ${T.surfaceVariant}`, paddingTop: 8 }}>
              <div
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverFolder("__trash__"); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null); }}
                onDrop={async e => {
                  e.preventDefault();
                  setDragOverFolder(null);
                  const raw = e.dataTransfer.getData("text/plain");
                  const [type, id] = raw.split(":");
                  if (type !== "file" || !id) return;
                  const idsToTrash = selectedIds.size > 0 && selectedIds.has(`d:${id}`)
                    ? [...selectedIds].filter(k => k.startsWith("d:")).map(k => k.slice(2))
                    : [id];
                  await Promise.all(idsToTrash.map(fid =>
                    fetch(`/api/bestanden?id=${fid}`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ trashed: true }),
                    })
                  ));
                  setDocs(p => p.filter(d => !idsToTrash.includes(d.id)));
                  setSmartDocs(p => p.filter(d => !idsToTrash.includes(d.id))); // [BESTANDEN-SMART]
                  setSelectedIds(new Set());
                  refreshStorage(); // [BESTANDEN-SMART] meter reflects the trashed files
                }}
              >
                <button onClick={() => navigateTo(null, { trash: true })} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", border: "none", cursor: "pointer",
                  borderRadius: T.md, textAlign: "left", fontSize: 14,
                  background: dragOverFolder === "__trash__" ? T.errorContainer : showTrash ? T.errorContainer : "transparent",
                  color: showTrash || dragOverFolder === "__trash__" ? T.error : T.outline,
                  transition: "background 0.1s",
                  outline: dragOverFolder === "__trash__" ? `2px dashed ${T.error}` : "none",
                }}>
                  <Icon name="delete" size={18} color={showTrash || dragOverFolder === "__trash__" ? T.error : T.outline} />
                  Prullenbak
                </button>
              </div>
            </div>

            {/* [BESTANDEN-SMART] Storage meter — Drive/OneDrive-style usage footer.
                Honest usage (no invented quota): total size + file count. */}
            <div style={{ marginTop: 12, borderTop: `1px solid ${T.surfaceVariant}`, paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px" }}>
                <Icon name="cloud" size={18} color={T.outline} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: T.onSurface, margin: 0 }}>
                    {storage ? formatSize(storage.bytes) : "—"} gebruikt
                  </p>
                  <p style={{ fontSize: 11, color: T.outline, margin: "1px 0 0" }}>
                    {storage ? `${storage.count} bestand${storage.count === 1 ? "" : "en"}` : "Berekenen…"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main
          style={{
            flex: 1, overflowY: "auto", overflowX: "hidden",
            position: "relative", minWidth: 0,
          }}
          onMouseDown={e => {
            const t = e.target as HTMLElement;
            const onItem = t.closest("[data-doc-card]") || t.closest("[data-folder-card]") || t.closest("[data-doc-row]") || t.closest("button") || t.closest("a") || t.closest("label") || t.closest("input");
            if (onItem) return;
            // Click on empty → clear selection
            if (selectedIds.size > 0) { setSelectedIds(new Set()); return; }
            if (e.button !== 0) return;
            e.preventDefault();
            dragSelectRef.current = { startX: e.clientX, startY: e.clientY, active: true };
          }}
          onMouseMove={e => {
            if (!dragSelectRef.current.active) return;
            const { startX, startY } = dragSelectRef.current;
            const x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
            const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
            if (w < 6 && h < 6) return;
            setSelectionBox({ x, y, w, h });
            const next = new Set<string>();
            // [BOEK-033] hit-test grid cards (grid view) + rows (list view)
            const allRefs = new Map([...cardRefs.current, ...rowRefs.current]);
            allRefs.forEach((el, id) => {
              const r = el.getBoundingClientRect();
              if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) next.add(`d:${id}`);
            });
            if (next.size > 0) setSelectedIds(next);
          }}
          onMouseUp={() => { dragSelectRef.current.active = false; setSelectionBox(null); }}
          onMouseLeave={() => { dragSelectRef.current.active = false; setSelectionBox(null); }}
        >
          {/* Selection box overlay */}
          {selectionBox && (
            <div style={{
              position: "fixed", pointerEvents: "none", zIndex: 40,
              border: `2px solid ${T.primary}`, background: `${T.primary}14`,
              borderRadius: T.sm,
              left: selectionBox.x, top: selectionBox.y,
              width: selectionBox.w, height: selectionBox.h,
            }} />
          )}

          <div style={{
            padding: "20px 16px", maxWidth: 960,
            margin: "0 auto", width: "100%", boxSizing: "border-box",
          }}>

            {showTrash ? (
              <Trash onBack={() => { setShowTrash(false); refreshStorage(); }} />
            ) : smartView ? (
              /* ── Smart view: Recent / Favorieten / Gedeeld ── */
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <Icon name={SMART_VIEWS[smartView].icon} size={22} color={T.primary} />
                  <h2 style={{ fontSize: 18, fontWeight: 600, color: T.onSurface, margin: 0 }}>
                    {SMART_VIEWS[smartView].label}
                  </h2>
                  {!smartLoading && smartDocs.length > 0 && (
                    <span style={{ fontSize: 13, color: T.outline }}>
                      {smartDocs.length} bestand{smartDocs.length === 1 ? "" : "en"}
                    </span>
                  )}
                </div>

                {smartLoading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner size={32} /></div>
                ) : smartDocs.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 24px" }}>
                    <div style={{ width: 80, height: 80, borderRadius: T.xl, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                      <Icon name={SMART_VIEWS[smartView].icon} size={40} color={T.primary} />
                    </div>
                    <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 6px" }}>Nog niets hier</p>
                    <p style={{ fontSize: 14, color: T.outline, margin: 0 }}>{SMART_VIEWS[smartView].empty}</p>
                  </div>
                ) : viewMode === "grid" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(136px,100%), 1fr))", gap: 12 }}>
                    {displayDocs.map(doc => (
                      <div key={doc.id} style={{ borderRadius: T.lg }}>
                        <DocCard
                          doc={doc}
                          selected={selectedIds.has(`d:${doc.id}`)}
                          onPreview={() => setPreview(doc)}
                          onSelect={e => handleSelect(e, `d:${doc.id}`)}
                          onContextMenu={e => openFileContextMenu(e, doc)}
                          onDragStart={e => handleDocDragStart(e, doc.id)}
                          cardRef={() => {}}
                          onToggleShare={handleToggleShare}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden" }}>
                    {displayDocs.map((doc, i) => {
                      const folderName = doc.folder_id
                        ? (allFolders.find(f => f.id === doc.folder_id)?.name ?? null)
                        : null;
                      return (
                        <div key={doc.id} style={{ borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none" }}>
                          <DocRow
                            doc={doc}
                            selected={selectedIds.has(`d:${doc.id}`)}
                            onPreview={() => setPreview(doc)}
                            onSelect={e => handleSelect(e, `d:${doc.id}`)}
                            onContextMenu={e => openFileContextMenu(e, doc)}
                            onDragStart={e => handleDocDragStart(e, doc.id)}
                            onToggleShare={handleToggleShare}
                            folderLabel={folderName ?? "Mijn bestanden"}
                            onOpenLocation={() => navigateTo(doc.folder_id ?? null)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : search.trim() ? (
              /* ── Search results ── */
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 16px" }}>
                  {searchLoading ? "Zoeken..." : `${(searchResults?.length ?? 0) + folderResults.length} resultaten voor "${search}"`}
                </p>
                {searchLoading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner size={32} /></div>
                ) : !(searchResults?.length) && folderResults.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 24px" }}>
                    <Icon name="search_off" size={48} color={T.outline} style={{ display: "block", margin: "0 auto 12px" }} />
                    <p style={{ fontSize: 14, color: T.outline }}>Niets gevonden</p>
                  </div>
                ) : (
                  <>
                  {/* [SEARCH] Matching folders — click to open. */}
                  {folderResults.length > 0 && (
                    <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden", marginBottom: 16 }}>
                      {folderResults.map((f, i) => (
                        <button
                          key={f.id}
                          onClick={() => { setSearch(""); setSearchResults(null); setFolderResults([]); navigateTo(f.id); }}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 12,
                            padding: "12px 16px", textAlign: "left", cursor: "pointer",
                            background: "transparent", border: "none",
                            borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none",
                          }}
                        >
                          <Icon name="folder" size={22} color={T.primary} />
                          <span style={{ fontSize: 14, color: T.onSurface, fontWeight: 500 }}>{f.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults && searchResults.length > 0 && (
                  <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden" }}>
                    {searchResults!.map((doc, i) => (
                      <div
                        key={doc.id}
                        ref={el => { if (el) rowRefs.current.set(doc.id, el); else rowRefs.current.delete(doc.id); }}
                        style={{ borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none", position: "relative" }}
                      >
                        <DocRow
                          doc={doc}
                          selected={selectedIds.has(`d:${doc.id}`)}
                          onPreview={() => setPreview(doc)}
                          onSelect={e => handleSelect(e, `d:${doc.id}`)}
                          onContextMenu={e => openFileContextMenu(e, doc)}
                          onDragStart={e => handleDocDragStart(e, doc.id)}
                          onToggleShare={handleToggleShare}
                          folderLabel={doc.folder_name ?? undefined}
                          onOpenLocation={() => {
                            // [BESTANDEN-SEARCH] Open the file's folder AND highlight the
                            // file once it loads (reuses the existing focus/highlight
                            // effect: scrollIntoView + outline, auto-clears after ~2.6s).
                            setSearch("");
                            setSearchResults(null);
                            navigateTo(doc.folder_id ?? null);
                            setFocusId(doc.id);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  )}
                  </>
                )}
              </div>
            ) : (
              /* ── Normal folder view ── */
              <>
                <Breadcrumb folders={allFolders} currentFolderId={currentFolderId} onNavigate={id => navigateTo(id)} />

                <div style={{ marginTop: 20 }}>
                  <UploadArea currentFolderId={currentFolderId} onUploaded={handleUploaded} />
                </div>

                {loading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
                    <Spinner size={32} />
                  </div>
                ) : isEmpty && !newFolderInline ? (
                  <div style={{ textAlign: "center", padding: "48px 24px" }}>
                    <div style={{ width: 80, height: 80, borderRadius: T.xl, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                      <Icon name="folder_open" size={40} color={T.primary} />
                    </div>
                    <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 6px" }}>Deze map is leeg</p>
                    <p style={{ fontSize: 14, color: T.outline, margin: 0 }}>Upload een bestand of maak een nieuwe map aan</p>
                  </div>
                ) : (
                  <div style={{ marginTop: 24 }}>

                    {/* Folders grid */}
                    {(subFolders.length > 0 || newFolderInline) && (
                      <div style={{ marginBottom: 28 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>
                          Mappen
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(136px,100%), 1fr))", gap: 12 }}>
                          {subFolders.map(folder => (
                            <FolderCard
                              key={folder.id}
                              folder={folder}
                              selected={selectedIds.has(`f:${folder.id}`)}
                              isDragOver={dragOverFolder === folder.id}
                              onOpen={() => navigateTo(folder.id)}
                              onSelect={e => handleSelect(e, `f:${folder.id}`)}
                              onContextMenu={(e, f) => openFolderContextMenu(e, f)}
                              onDragStart={(e, f) => handleFolderDragStart(e, f)}
                              onDragEnter={() => setDragOverFolder(folder.id)}
                              onDragLeave={e => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null);
                              }}
                              onDrop={e => handleFolderDrop(e, folder.id)}
                            />
                          ))}

                          {/* Inline new folder card */}
                          {newFolderInline && (
                            <div style={{
                              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                              padding: 16, borderRadius: T.lg, background: T.primaryContainer,
                              border: `2px solid ${T.primary}`, boxShadow: T.elev1,
                            }}>
                              <Icon name="folder" size={44} color={T.primary} />
                              <input
                                ref={newFolderRef}
                                value={newFolderName}
                                onChange={e => setNewFolderName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter") handleCreateFolder();
                                  if (e.key === "Escape") { setNewFolderInline(false); setNewFolderName(""); }
                                }}
                                onBlur={handleCreateFolder}
                                placeholder="Mapnaam..."
                                autoFocus
                                style={{
                                  width: "100%", fontSize: 12, padding: "4px 8px", textAlign: "center",
                                  border: `1px solid ${T.primary}`, borderRadius: T.sm,
                                  outline: "none", color: T.onSurface, background: "white",
                                  boxSizing: "border-box",
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Documents */}
                    {docs.length > 0 && (
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>
                          Bestanden — {docs.length}
                        </p>
                        {viewMode === "grid" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(136px,100%), 1fr))", gap: 12 }}>
                            {displayDocs.map(doc => (
                              <div
                                key={doc.id}
                                style={{
                                  borderRadius: T.lg,
                                  outline: highlightId === doc.id ? `2px solid ${T.primary}` : "2px solid transparent",
                                  outlineOffset: 2,
                                  transition: "outline-color 0.3s ease",
                                }}
                              >
                                <DocCard
                                  doc={doc}
                                  selected={selectedIds.has(`d:${doc.id}`)}
                                  onPreview={() => setPreview(doc)}
                                  onSelect={e => handleSelect(e, `d:${doc.id}`)}
                                  onContextMenu={e => openFileContextMenu(e, doc)}
                                  onDragStart={e => handleDocDragStart(e, doc.id)}
                                  cardRef={el => { if (el) cardRefs.current.set(doc.id, el); else cardRefs.current.delete(doc.id); }}
                                  onToggleShare={handleToggleShare}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden" }}>
                            {displayDocs.map((doc, i) => (
                              <div
                                key={doc.id}
                                data-doc-row
                                ref={el => { if (el) rowRefs.current.set(doc.id, el); else rowRefs.current.delete(doc.id); }}
                                style={{
                                  borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none",
                                  // [BESTANDEN-FOCUS] highlight the focused row (list view).
                                  outline: highlightId === doc.id ? `2px solid ${T.primary}` : "2px solid transparent",
                                  outlineOffset: -2,
                                  borderRadius: highlightId === doc.id ? T.sm : 0,
                                  transition: "outline 0.2s",
                                }}
                              >
                                <DocRow
                                  doc={doc}
                                  selected={selectedIds.has(`d:${doc.id}`)}
                                  onPreview={() => setPreview(doc)}
                                  onSelect={e => handleSelect(e, `d:${doc.id}`)}
                                  onContextMenu={e => openFileContextMenu(e, doc)}
                                  onDragStart={e => handleDocDragStart(e, doc.id)}
                                  onToggleShare={handleToggleShare}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* ── FAB upload ── */}
      <button
        onClick={() => fileInputRef.current?.click()}
        title="Bestand uploaden (of sleep een bestand hierheen)"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 40,
          width: 56, height: 56, borderRadius: T.full,
          background: T.primary, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: T.elev3, transition: "transform 0.15s cubic-bezier(0.4,0,0.2,1)",
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "none")}
        onMouseDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
        onMouseUp={e => (e.currentTarget.style.transform = "scale(1.08)")}
      >
        <Icon name="upload" size={26} color={T.onPrimary} />
      </button>
    </div>
  );
}