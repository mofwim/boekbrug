"use client";
// src/app/dashboard/bestanden/BestandenPage.tsx
// [BOEK-033] Mijn bestanden — Drive experience
// Design: Material You (ZZP) — BoekBrug Design System v1.0

import { useState, useEffect, useRef, useCallback, DragEvent } from "react";
import { useRouter } from "next/navigation";

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
import { SharePopup } from "./components/modals/SharePopup";

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
              style={{ width: 22, height: 22, border: "none", background: "none", cursor: "pointer", borderRadius: T.sm, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="edit" size={13} color={T.outline} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(node.id); }}
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

export function BestandenPage() {
  const router = useRouter();

  // ── Data ──
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [allFolders, setAllFolders] = useState<FolderRow[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [subFolders, setSubFolders] = useState<FolderRow[]>([]);
  const [docs, setDocs] = useState<BestandRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ──
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showTrash, setShowTrash] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // ── Modals ──
  const [preview, setPreview] = useState<BestandRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: "file" | "folder" } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; type: "file" | "folder"; excludeId?: string } | null>(null);
  const [sharePopup, setSharePopup] = useState<{ doc: BestandRow } | null>(null);
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
  type NavState = { folderId: string | null; showTrash: boolean };
  const navHistoryRef = useRef<NavState[]>([]);

  const navigateTo = useCallback((folderId: string | null, opts?: { trash?: boolean }) => {
    // Push current state to history
    navHistoryRef.current.push({ folderId: currentFolderId, showTrash });
    setCurrentFolderId(folderId);
    setShowTrash(opts?.trash ?? false);
    setSelectedIds(new Set());
    setSearch("");
  }, [currentFolderId, showTrash]); // eslint-disable-line

  const navigateBack = useCallback(() => {
    const prev = navHistoryRef.current.pop();
    if (!prev) return;
    setCurrentFolderId(prev.folderId);
    setShowTrash(prev.showTrash);
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

  // ── Escape = clear selection / close menu ──
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedIds(new Set()); setShowNewMenu(false); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // ── Load data ──
  const loadContents = useCallback(async (folderId: string | null) => {
    setLoading(true);
    const res = await fetch(`/api/bestanden?folder_id=${folderId ?? "root"}`);
    const json = await res.json() as { folders?: FolderRow[]; documents?: BestandRow[] };
    // [BOEK-033] Gedeeld met boekhouder always first
    const folders = (json.folders ?? []).sort((a, b) => {
      if (a.name === "Gedeeld met boekhouder") return -1;
      if (b.name === "Gedeeld met boekhouder") return 1;
      return a.name.localeCompare(b.name, "nl");
    });
    setSubFolders(folders);
    setDocs(json.documents ?? []);
    setLoading(false);
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

  useEffect(() => {
    loadContents(currentFolderId);
    loadAllFolders();
  }, [currentFolderId]); // eslint-disable-line

  // ── Search ──
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      const res = await fetch(`/api/bestanden?search=${encodeURIComponent(search)}`);
      const json = await res.json() as { results?: SearchResult[] };
      setSearchResults(json.results ?? []);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(t);
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

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelectedIds(new Set([...subFolders.map(f => `f:${f.id}`), ...docs.map(d => `d:${d.id}`)]));
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
          setSelectedIds(new Set());
        });
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [selectedIds, currentFolderId, subFolders, docs]); // eslint-disable-line

  // ── Selection helpers ──
  const allItems = [...subFolders.map(f => `f:${f.id}`), ...docs.map(d => `d:${d.id}`)];

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

  // ── Folder CRUD ──
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) { setNewFolderInline(false); return; }
    const res = await fetch("/api/bestanden/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim(), parent_id: currentFolderId }),
    });
    const json = await res.json() as FolderRow;
    if (json.id) { setSubFolders(p => [...p, json]); setAllFolders(p => [...p, json]); }
    setNewFolderName(""); setNewFolderInline(false);
  };

  const handleRenameConfirm = async (newName: string) => {
    if (!renameTarget) return;
    if (renameTarget.type === "folder") {
      await fetch(`/api/bestanden/folders?id=${renameTarget.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      setSubFolders(p => p.map(f => f.id === renameTarget.id ? { ...f, name: newName } : f));
      setAllFolders(p => p.map(f => f.id === renameTarget.id ? { ...f, name: newName } : f));
    } else {
      await fetch(`/api/bestanden?id=${renameTarget.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: newName }),
      });
      setDocs(p => p.map(d => d.id === renameTarget.id ? { ...d, file_name: newName } : d));
    }
    setRenameTarget(null);
  };

  const handleDeleteFolder = async (id: string) => {
    // [BOEK-033] Guard: never delete system folders
    const folder = subFolders.find(f => f.id === id) ?? allFolders.find(f => f.id === id);
    if (folder?.is_system) return;
    if (!confirm("Map verwijderen? Bestanden worden naar hoofdmap verplaatst.")) return;
    // Optimistic update
    setSubFolders(p => p.filter(f => f.id !== id));
    setAllFolders(p => p.filter(f => f.id !== id));
    setFolderTree(p => p.filter(n => n.id !== id));
    setDocs(p => p.map(d => d.folder_id === id ? { ...d, folder_id: null } : d));
    await fetch(`/api/bestanden/folders?id=${id}`, { method: "DELETE" });
  };

  // ── File actions ──
  const handleDelete = async (id: string) => {
    // Soft delete — move to trash
    await fetch(`/api/bestanden?id=${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    setDocs(p => p.filter(d => d.id !== id));
  };

  const handleMove = async (id: string, type: "file" | "folder", folderId: string | null) => {
    if (type === "folder") {
      await fetch(`/api/bestanden/folders?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: folderId }),
      });
      setSubFolders(p => p.filter(f => f.id !== id));
      loadAllFolders();
    } else {
      await fetch(`/api/bestanden?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      setDocs(p => p.filter(d => d.id !== id));
    }
    setMoveTarget(null);
  };

  const handleStar = async (id: string, type: "file" | "folder", current: boolean) => {
    if (type === "file") {
      await fetch(`/api/bestanden?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !current }),
      });
      setDocs(p => p.map(d => d.id === id ? { ...d, starred: !current } : d));
    } else {
      await fetch(`/api/bestanden/folders?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !current }),
      });
      setSubFolders(p => p.map(f => f.id === id ? { ...f, starred: !current } : f));
    }
  };

  const handleShare = async (doc: BestandRow) => {
    const sf = allFolders.find(f => f.name === "Gedeeld met boekhouder");
    if (sf) {
      await fetch(`/api/bestanden?id=${doc.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: sf.id }),
      });
    }
    setSharePopup(null);
  };

  // [BOEK-033] Upload complete — just add to list, AI + placement already done in UploadArea
  const handleUploaded = useCallback((doc: BestandRow) => {
    setDocs(p => [doc, ...p]);
    // No share popup — sharing is manual via right-click → "Delen"
    // No AI suggestion popup — AI places silently in UploadArea
  }, []);

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
    await Promise.all([
      ...selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) })),
      ...selectedFolderIds.map(id => fetch(`/api/bestanden/folders?id=${id}`, { method: "DELETE" })),
    ]);
    setDocs(p => p.filter(d => !selectedFileIds.includes(d.id)));
    setSubFolders(p => p.filter(f => !selectedFolderIds.includes(f.id)));
    setSelectedIds(new Set());
  };

  const handleBulkMove = async (folderId: string | null) => {
    await Promise.all([
      ...selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folderId }) })),
      ...selectedFolderIds.map(id => fetch(`/api/bestanden/folders?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent_id: folderId }) })),
    ]);
    setDocs(p => p.filter(d => !selectedFileIds.includes(d.id)));
    setSubFolders(p => p.filter(f => !selectedFolderIds.includes(f.id)));
    setSelectedIds(new Set()); setBulkMoveOpen(false);
    loadAllFolders();
  };

  const handleBulkShare = async () => {
    const sf = allFolders.find(f => f.name === "Gedeeld met boekhouder");
    if (!sf) return;
    await Promise.all(selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: sf.id }) })));
    setDocs(p => p.filter(d => !selectedFileIds.includes(d.id)));
    setSelectedIds(new Set());
  };

  const handleBulkStar = async () => {
    await Promise.all([
      ...selectedFileIds.map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starred: true }) })),
      ...selectedFolderIds.map(id => fetch(`/api/bestanden/folders?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starred: true }) })),
    ]);
    setDocs(p => p.map(d => selectedFileIds.includes(d.id) ? { ...d, starred: true } : d));
    setSubFolders(p => p.map(f => selectedFolderIds.includes(f.id) ? { ...f, starred: true } : f));
    setSelectedIds(new Set());
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
        { label: "Delen met boekhouder", icon: "share", onClick: () => setSharePopup({ doc }) },
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
      fontFamily: "'Google Sans','Roboto',-apple-system,sans-serif",
      overflow: "hidden", // [BOEK-033] nothing escapes
    }}>

      {/* ── Modals ── */}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {renameTarget && <RenameModal currentName={renameTarget.name} type={renameTarget.type} onConfirm={handleRenameConfirm} onClose={() => setRenameTarget(null)} />}
      {moveTarget && <MoveModal folders={allFolders} excludeId={moveTarget.excludeId} onMove={fid => handleMove(moveTarget.id, moveTarget.type, fid)} onClose={() => setMoveTarget(null)} />}
      {bulkMoveOpen && <MoveModal folders={allFolders} onMove={handleBulkMove} onClose={() => setBulkMoveOpen(false)} />}
      {sharePopup && <SharePopup fileName={sharePopup.doc.file_name} accountantName="uw boekhouder" onShare={() => handleShare(sharePopup.doc)} onKeepPrivate={() => setSharePopup(null)} />}
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
          {/* Back — internal if history exists, external otherwise */}
          <button
            onClick={() => {
              if (navHistoryRef.current.length > 0) navigateBack();
              else router.back();
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
              <button onClick={() => setSearch("")} style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                width: 18, height: 18, border: "none", background: T.outline,
                borderRadius: T.full, display: "flex", alignItems: "center",
                justifyContent: "center", cursor: "pointer",
              }}>
                <Icon name="close" size={12} color="white" />
              </button>
            )}
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", background: "#F1F3F4", borderRadius: T.md, padding: 3, flexShrink: 0 }}>
            {(["grid", "list"] as ViewMode[]).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
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
                for (const file of Array.from(files)) {
                  const now = new Date(); const fd = new FormData();
                  fd.append("file", file);
                  fd.append("year", String(now.getFullYear()));
                  fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
                  if (currentFolderId) fd.append("folder_id", currentFolderId);
                  const r = await fetch("/api/files", { method: "POST", body: fd });
                  const j = await r.json() as { id?: string };
                  if (j.id) {
                    // Silent AI classification
                    try {
                      const cr = await fetch("/api/bestanden/classify", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ documentId: j.id, fileName: file.name }),
                      });
                      if (cr.ok) {
                        const result = await cr.json() as { folderId: string | null; confidence?: number; type: string };
                        if (result.folderId && result.type !== "unknown" && (result.confidence ?? 1) >= 0.7) {
                          await fetch(`/api/bestanden?id=${j.id}`, {
                            method: "PATCH", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ folder_id: result.folderId }),
                          });
                        }
                      }
                    } catch { /* silent */ }
                    handleUploaded({
                      id: j.id, file_name: file.name, file_url: "", file_size: file.size,
                      file_type: file.type, doc_type: null, period: null, year: now.getFullYear(),
                      notes: null, invoice_id: null, created_at: now.toISOString(),
                      folder_id: currentFolderId, ai_processed: false,
                      ai_doc_type: null, ai_suggested_folder: null, source: "upload",
                    });
                  }
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
            {/* Root */}
            <button onClick={() => navigateTo(null)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", border: "none", cursor: "pointer",
              borderRadius: T.md, textAlign: "left", fontSize: 14,
              background: currentFolderId === null && !showTrash ? T.primaryContainer : "transparent",
              color: currentFolderId === null && !showTrash ? T.primary : T.onSurface,
              fontWeight: currentFolderId === null && !showTrash ? 600 : 400,
              transition: "background 0.1s",
            }}>
              <Icon name="home" size={18} color={currentFolderId === null && !showTrash ? T.primary : T.outline} />
              Mijn bestanden
            </button>

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
                  setSelectedIds(new Set());
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
              <Trash onBack={() => setShowTrash(false)} />
            ) : search.trim() ? (
              /* ── Search results ── */
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 16px" }}>
                  {searchLoading ? "Zoeken..." : `${searchResults?.length ?? 0} resultaten voor "${search}"`}
                </p>
                {searchLoading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner size={32} /></div>
                ) : !(searchResults?.length) ? (
                  <div style={{ textAlign: "center", padding: "48px 24px" }}>
                    <Icon name="search_off" size={48} color={T.outline} style={{ display: "block", margin: "0 auto 12px" }} />
                    <p style={{ fontSize: 14, color: T.outline }}>Geen bestanden gevonden</p>
                  </div>
                ) : (
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
                        />
                        {doc.folder_name && (
                          <span style={{ position: "absolute", right: 48, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: T.outline }}>
                            {doc.folder_name}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
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
                            {docs.map(doc => (
                              <DocCard
                                key={doc.id} doc={doc}
                                selected={selectedIds.has(`d:${doc.id}`)}
                                onPreview={() => setPreview(doc)}
                                onSelect={e => handleSelect(e, `d:${doc.id}`)}
                                onContextMenu={e => openFileContextMenu(e, doc)}
                                onDragStart={e => handleDocDragStart(e, doc.id)}
                                cardRef={el => { if (el) cardRefs.current.set(doc.id, el); else cardRefs.current.delete(doc.id); }}
                              />
                            ))}
                          </div>
                        ) : (
                          <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden" }}>
                            {docs.map((doc, i) => (
                              <div
                                key={doc.id}
                                data-doc-row
                                ref={el => { if (el) rowRefs.current.set(doc.id, el); else rowRefs.current.delete(doc.id); }}
                                style={{ borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none" }}
                              >
                                <DocRow
                                  doc={doc}
                                  selected={selectedIds.has(`d:${doc.id}`)}
                                  onPreview={() => setPreview(doc)}
                                  onSelect={e => handleSelect(e, `d:${doc.id}`)}
                                  onContextMenu={e => openFileContextMenu(e, doc)}
                                  onDragStart={e => handleDocDragStart(e, doc.id)}
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