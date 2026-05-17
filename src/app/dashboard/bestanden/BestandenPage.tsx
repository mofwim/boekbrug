"use client";
// app/dashboard/bestanden/BestandenPage.tsx
// [BOEK-033] Mijn bestanden — Drive experience
// Design: Material You (ZZP) — BoekBrug Design System v1.0
// Primary: #1A73E8 | Surface: #FFFBFE | Radius: 16-24px | Font: Google Sans

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  DragEvent,
} from "react";

// ─── Design tokens (BoekBrug Design System v1.0 — ZZP / Material You) ──────────
const T = {
  primary:            "#1A73E8",
  primaryContainer:   "#D3E3FD",
  onPrimary:          "#FFFFFF",
  onPrimaryContainer: "#041E49",
  secondary:          "#00897B",
  surface:            "#FFFBFE",
  surfaceVariant:     "#E7E0EC",
  onSurface:          "#1C1B1F",
  outline:            "#79747E",
  error:              "#B3261E",
  errorContainer:     "#F9DEDC",
  success:            "#34A853",
  successContainer:   "#CEEAD6",
  warning:            "#E37400",
  warningContainer:   "#FEE8C4",
  elev1: "0 1px 2px rgba(0,0,0,0.08)",
  elev2: "0 2px 6px rgba(0,0,0,0.12)",
  elev3: "0 4px 12px rgba(0,0,0,0.16)",
  sm:   "8px",
  md:   "12px",
  lg:   "16px",
  xl:   "24px",
  full: "9999px",
};

// ─── Types ───────────────────────────────────────────────────────────────────────

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
}
interface FolderNode extends FolderRow { children: FolderNode[]; }
interface BestandRow {
  id: string; file_name: string; file_url: string;
  file_size: number; file_type: string; doc_type: string | null;
  period: string | null; year: number | null; notes: string | null;
  invoice_id: string | null; created_at: string; folder_id: string | null;
  ai_processed: boolean | null; ai_doc_type: string | null;
  ai_suggested_folder: string | null; source: string | null;
}
interface SearchResult extends BestandRow { folder_name: string | null; }
type ViewMode = "grid" | "list";

// ─── Helpers ─────────────────────────────────────────────────────────────────────

const NL_DATE_SHORT = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const formatDate = (iso: string) => NL_DATE_SHORT.format(new Date(iso));
const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1_048_576 ? `${(b/1024).toFixed(0)} KB` : `${(b/1_048_576).toFixed(1)} MB`;
const folderColor = (c: string | null) => c ?? T.warning;
const fileEmoji = (t: string) =>
  t.startsWith("image/") ? "🖼️" : t === "application/pdf" ? "📄" :
  t.includes("excel") || t.includes("spreadsheet") ? "📊" :
  t.includes("word") || t.includes("document") ? "📝" :
  t === "message/rfc822" ? "📧" : t === "application/zip" ? "🗜️" :
  t === "text/csv" ? "📋" : t.includes("xml") ? "🗂️" : "📁";

function buildTree(rows: FolderRow[], parentId: string | null): FolderNode[] {
  return rows.filter((r) => r.parent_id === parentId).map((r) => ({ ...r, children: buildTree(rows, r.id) }));
}

// ─── Material Icons ───────────────────────────────────────────────────────────────
// Requires in layout.tsx <head>:
// <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&family=Google+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

function Icon({ name, size = 20, color, style }: { name: string; size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <span className="material-symbols-outlined"
      style={{ fontSize: size, lineHeight: 1, userSelect: "none", color, ...style }}>
      {name}
    </span>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────────

function Spinner({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: "m3spin 0.8s linear infinite" }}>
      <style>{`@keyframes m3spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="12" cy="12" r="10" stroke={T.primaryContainer} strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={T.primary} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ─── Checkmark SVG ───────────────────────────────────────────────────────────────

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────────

function PreviewModal({ doc, onClose }: { doc: BestandRow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canPreview = doc.file_type.startsWith("image/") || doc.file_type === "application/pdf";

  useEffect(() => {
    fetch(`/api/files/${doc.id}/url`)
      .then(r => r.json()).then(({ url: u }: { url: string }) => setUrl(u))
      .catch(() => {}).finally(() => setLoading(false));
  }, [doc.id]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn); return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const btnBase: React.CSSProperties = {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, padding: "10px 20px", border: "none",
    borderRadius: T.full, fontSize: 14, fontWeight: 500, cursor: "pointer",
    textDecoration: "none", transition: "all 0.1s",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, margin: "0 auto",
        background: T.surface, borderRadius: `${T.xl} ${T.xl} 0 0`,
        boxShadow: T.elev3, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "92dvh",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${T.surfaceVariant}` }}>
          <span style={{ fontSize: 24, flexShrink: 0 }}>{fileEmoji(doc.file_type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: T.onSurface, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.file_name}</p>
            <p style={{ fontSize: 12, color: T.outline, margin: "2px 0 0" }}>{formatSize(doc.file_size)} · {formatDate(doc.created_at)}</p>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, border: "none", background: T.surfaceVariant, borderRadius: T.full, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            <Icon name="close" size={18} color={T.outline} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "#F8F9FA", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, minHeight: 220 }}>
          {loading ? <Spinner size={36} /> :
           !canPreview || !url ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>{fileEmoji(doc.file_type)}</div>
              <p style={{ fontSize: 14, color: T.outline, marginBottom: 16 }}>Preview niet beschikbaar</p>
              {url && <a href={url} download={doc.file_name} style={{ ...btnBase, background: T.primary, color: T.onPrimary }}><Icon name="download" size={18} color={T.onPrimary} /> Downloaden</a>}
            </div>
           ) : doc.file_type.startsWith("image/") ? (
            <img src={url} alt={doc.file_name} style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: T.md, boxShadow: T.elev2 }} />
           ) : (
            <iframe src={url} title={doc.file_name} style={{ width: "100%", height: "60vh", border: "none", borderRadius: T.md }} />
          )}
        </div>
        {url && (
          <div style={{ padding: "12px 20px", display: "flex", gap: 10, borderTop: `1px solid ${T.surfaceVariant}` }}>
            <a href={url} download={doc.file_name} style={{ ...btnBase, background: T.primary, color: T.onPrimary }}><Icon name="download" size={18} color={T.onPrimary} /> Downloaden</a>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...btnBase, background: T.primaryContainer, color: T.onPrimaryContainer }}><Icon name="open_in_new" size={18} color={T.onPrimaryContainer} /> Openen</a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Share Popup ──────────────────────────────────────────────────────────────────

function SharePopup({ fileName, accountantName, onShare, onKeepPrivate }: {
  fileName: string; accountantName: string; onShare: () => void; onKeepPrivate: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", background: T.surface, borderRadius: `${T.xl} ${T.xl} 0 0`, boxShadow: T.elev3, padding: "12px 24px 32px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant }} />
        </div>
        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: T.lg, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="share" size={24} color={T.primary} />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 4px" }}>Delen met boekhouder?</p>
            <p style={{ fontSize: 13, color: T.outline, margin: 0, lineHeight: 1.5 }}>
              &quot;{fileName}&quot; is geüpload. Wil je dit delen met <strong style={{ color: T.onSurface }}>{accountantName}</strong>?
            </p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={onShare} style={{ padding: "12px", background: T.primary, color: T.onPrimary, border: "none", borderRadius: T.full, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Ja, delen
          </button>
          <button onClick={onKeepPrivate} style={{ padding: "12px", background: T.primaryContainer, color: T.onPrimaryContainer, border: "none", borderRadius: T.full, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Nee, privé houden
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AI Suggestion Bar ────────────────────────────────────────────────────────────

function AISuggestionBar({ suggestion, onAccept, onDismiss }: { suggestion: string; onAccept: () => void; onDismiss: () => void; }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: T.primaryContainer, borderRadius: T.lg, padding: "12px 16px" }}>
      <Icon name="star" size={20} color={T.primary} style={{ flexShrink: 0 }} />
      <p style={{ flex: 1, fontSize: 13, color: T.onPrimaryContainer, margin: 0 }}>
        <span style={{ fontWeight: 600, color: T.primary }}>AI stelt voor: </span>{suggestion}
      </p>
      <button onClick={onAccept} style={{ padding: "6px 16px", background: T.primary, color: T.onPrimary, border: "none", borderRadius: T.full, fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0 }}>
        Plaatsen
      </button>
      <button onClick={onDismiss} style={{ padding: "6px 16px", background: "transparent", color: T.primary, border: `1px solid ${T.primary}`, borderRadius: T.full, fontSize: 13, fontWeight: 500, cursor: "pointer", flexShrink: 0 }}>
        Negeren
      </button>
    </div>
  );
}

// ─── Move Modal ───────────────────────────────────────────────────────────────────

function MoveModal({ folders, onMove, onClose }: { folders: FolderRow[]; onMove: (id: string | null) => void; onClose: () => void; }) {
  const rowStyle: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", background: "none", border: "none", fontSize: 14, color: T.onSurface, cursor: "pointer", textAlign: "left" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, margin: "0 auto", background: T.surface, borderRadius: `${T.xl} ${T.xl} 0 0`, boxShadow: T.elev3, overflow: "hidden", maxHeight: "70dvh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 20px 8px" }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant, margin: "0 auto 16px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: 0 }}>Verplaatsen naar</p>
            <button onClick={onClose} style={{ width: 36, height: 36, border: "none", background: T.surfaceVariant, borderRadius: T.full, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Icon name="close" size={18} color={T.outline} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
          <button onClick={() => onMove(null)} style={rowStyle} onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
            <Icon name="home" size={20} color={T.outline} /> Root (geen map)
          </button>
          {folders.map(f => (
            <button key={f.id} onClick={() => onMove(f.id)} style={rowStyle} onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
              <Icon name="folder" size={20} color={folderColor(f.color)} /> {f.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────────

function ContextMenu({ x, y, onClose, items }: {
  x: number; y: number; onClose: () => void;
  items: { label: string; icon: string; onClick: () => void; danger?: boolean }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", fn);
    document.addEventListener("touchstart", fn);
    return () => { document.removeEventListener("mousedown", fn); document.removeEventListener("touchstart", fn); };
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: "fixed", top: y, left: x, zIndex: 999, background: T.surface, borderRadius: T.md, boxShadow: T.elev3, border: `1px solid ${T.surfaceVariant}`, minWidth: 200, padding: "4px 0" }}>
      {items.map((item, i) => (
        <button key={i} onClick={() => { item.onClick(); onClose(); }}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "none", border: "none", fontSize: 14, color: item.danger ? T.error : T.onSurface, cursor: "pointer", textAlign: "left", transition: "background 0.1s" }}
          onMouseEnter={e => (e.currentTarget.style.background = item.danger ? T.errorContainer : T.surfaceVariant)}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}
        >
          <Icon name={item.icon} size={18} color={item.danger ? T.error : T.outline} /> {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Upload Area ──────────────────────────────────────────────────────────────────

function UploadArea({ currentFolderId, onUploaded }: { currentFolderId: string | null; onUploaded: (doc: BestandRow, suggestion: string | null) => void; }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setUploading(true); setProgress(20);
    const now = new Date();
    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(now.getFullYear()));
    fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
    if (currentFolderId) fd.append("folder_id", currentFolderId);
    setProgress(50);
    try {
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const json = await res.json() as { id?: string; error?: string };
      setProgress(85);
      if (!json.id) throw new Error(json.error ?? "Upload mislukt");
      const dr = await fetch(`/api/files/${json.id}`);
      const dj = await dr.json() as { document?: BestandRow };
      setProgress(100);
      setTimeout(() => {
        setUploading(false); setProgress(0);
        onUploaded(dj.document ?? { id: json.id!, file_name: file.name, file_url: "", file_size: file.size, file_type: file.type, doc_type: null, period: null, year: now.getFullYear(), notes: null, invoice_id: null, created_at: now.toISOString(), folder_id: currentFolderId, ai_processed: false, ai_doc_type: null, ai_suggested_folder: null, source: "upload" }, null);
      }, 350);
    } catch { setUploading(false); setProgress(0); alert("Upload mislukt."); }
  }, [currentFolderId, onUploaded]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);

  if (uploading) return (
    <div style={{ border: `2px dashed ${T.primary}`, borderRadius: T.lg, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, background: T.primaryContainer }}>
      <Spinner size={32} />
      <p style={{ fontSize: 14, color: T.primary, margin: 0, fontWeight: 500 }}>Uploaden...</p>
      <div style={{ width: "100%", height: 4, background: T.surfaceVariant, borderRadius: T.full, overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: T.primary, borderRadius: T.full, transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
    </div>
  );

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? T.primary : T.outline}`,
        borderRadius: T.lg, padding: "24px 16px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        cursor: "pointer", background: dragging ? T.primaryContainer : "transparent",
        transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      <div style={{ width: 48, height: 48, borderRadius: T.lg, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="upload" size={24} color={T.primary} />
      </div>
      <p style={{ fontSize: 14, fontWeight: 500, color: T.onSurface, margin: 0 }}>{dragging ? "Loslaten om te uploaden" : "Sleep een bestand of tik om te uploaden"}</p>
      <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>PDF, afbeelding, Excel, Word — max 25MB</p>
      <input ref={inputRef} type="file" style={{ display: "none" }}
        onChange={e => handleFiles(e.target.files)}
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.doc,.docx,.xls,.xlsx,.csv,.xml,.zip,.eml"
      />
    </div>
  );
}

// ─── Folder Tree Item ─────────────────────────────────────────────────────────────

function FolderTreeItem({ node, depth, activeFolderId, onSelect, onRename, onDelete }: {
  node: FolderNode; depth: number; activeFolderId: string | null;
  onSelect: (id: string | null) => void; onRename: (id: string, cur: string) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isActive = activeFolderId === node.id;
  const isShared = node.name === "Gedeeld met boekhouder";

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onClick={() => { onSelect(node.id); setOpen(true); }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: `8px 10px 8px ${10 + depth * 16}px`,
          borderRadius: T.md, cursor: "pointer", userSelect: "none",
          background: isActive ? T.primaryContainer : hovered ? T.surfaceVariant : "transparent",
          color: isActive ? T.primary : T.onSurface,
          transition: "background 0.1s",
        }}
      >
        <button
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          style={{
            width: 20, height: 20, border: "none", background: "none", cursor: node.children.length ? "pointer" : "default",
            opacity: node.children.length ? 0.6 : 0, display: "flex", alignItems: "center", justifyContent: "center",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0,
          }}
        >
          <Icon name="expand_more" size={16} />
        </button>
        <Icon name="folder" size={18} color={folderColor(node.color)} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
        {isShared && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: T.primaryContainer, color: T.primary, borderRadius: T.full, flexShrink: 0 }}>Gedeeld</span>}
        {!isShared && hovered && (
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            <button onClick={e => { e.stopPropagation(); onRename(node.id, node.name); }} style={{ width: 24, height: 24, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.sm }}>
              <Icon name="edit" size={14} color={T.outline} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(node.id); }} style={{ width: 24, height: 24, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.sm }}>
              <Icon name="delete" size={14} color={T.error} />
            </button>
          </div>
        )}
      </div>
      {open && node.children.map(child => (
        <FolderTreeItem key={child.id} node={child} depth={depth + 1} activeFolderId={activeFolderId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} />
      ))}
    </div>
  );
}

// ─── Checkbox circle ─────────────────────────────────────────────────────────────

function SelectCircle({ selected, hovered, onClick }: { selected: boolean; hovered: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} style={{
      width: 20, height: 20, borderRadius: T.full, flexShrink: 0,
      background: selected ? T.primary : "rgba(255,255,255,0.92)",
      border: `2px solid ${selected ? T.primary : "#BDBDBD"}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      opacity: selected || hovered ? 1 : 0,
      transition: "all 0.15s cubic-bezier(0.4,0,0.2,1)",
      cursor: "pointer", boxShadow: T.elev1,
    }}>
      {selected && <Check />}
    </div>
  );
}

// ─── Doc Card (Grid) ──────────────────────────────────────────────────────────────

function DocCard({ doc, selected, onPreview, onContextMenu, onDragStart, onToggle, cardRef }: {
  doc: BestandRow; selected: boolean;
  onPreview: (d: BestandRow) => void; onContextMenu: (e: React.MouseEvent, d: BestandRow) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, d: BestandRow) => void; onToggle: (id: string) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      ref={cardRef} data-doc-card
      draggable={!selected}
      onDragStart={e => onDragStart(e, doc)}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={e => { if (e.metaKey || e.ctrlKey || selected) { e.preventDefault(); onToggle(doc.id); } else onPreview(doc); }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, doc); }}
      style={{
        background: "white", borderRadius: T.lg, overflow: "hidden", cursor: "pointer", userSelect: "none",
        boxShadow: selected ? `0 0 0 2px ${T.primary}, ${T.elev2}` : hovered ? T.elev2 : T.elev1,
        transform: selected ? "scale(0.97)" : hovered ? "translateY(-1px)" : "none",
        transition: "all 0.15s cubic-bezier(0.4,0,0.2,1)",
        border: `2px solid ${selected ? T.primary : "transparent"}`,
        position: "relative",
      }}
    >
      {/* Checkbox */}
      <div style={{ position: "absolute", top: 8, left: 8, zIndex: 2 }}>
        <SelectCircle selected={selected} hovered={hovered} onClick={e => { e.stopPropagation(); onToggle(doc.id); }} />
      </div>
      {/* Thumbnail */}
      <div style={{ height: 100, background: selected ? T.primaryContainer : "#F8F9FA", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", transition: "background 0.15s" }}>
        <span style={{ fontSize: 32 }}>{fileEmoji(doc.file_type)}</span>
        {!selected && hovered && (
          <button onClick={e => { e.stopPropagation(); onContextMenu(e, doc); }}
            style={{ position: "absolute", top: 6, right: 6, width: 28, height: 28, border: "none", background: "rgba(255,255,255,0.92)", borderRadius: T.full, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: T.elev1 }}>
            <Icon name="more_vert" size={16} color={T.outline} />
          </button>
        )}
        {doc.ai_processed && (
          <div style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: T.sm, background: T.successContainer, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="star" size={13} color={T.success} />
          </div>
        )}
      </div>
      {/* Info */}
      <div style={{ padding: "10px 12px 12px" }}>
        <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? T.primary : T.onSurface }}>{doc.file_name}</p>
        <p style={{ fontSize: 11, color: T.outline, margin: 0 }}>{formatDate(doc.created_at)}</p>
      </div>
    </div>
  );
}

// ─── Doc Row (List) ───────────────────────────────────────────────────────────────

function DocRow({ doc, selected, onPreview, onContextMenu, onDragStart, onToggle }: {
  doc: BestandRow; selected: boolean;
  onPreview: (d: BestandRow) => void; onContextMenu: (e: React.MouseEvent, d: BestandRow) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, d: BestandRow) => void; onToggle: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      draggable={!selected}
      onDragStart={e => onDragStart(e, doc)}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={e => { if (e.metaKey || e.ctrlKey || selected) { e.preventDefault(); onToggle(doc.id); } else onPreview(doc); }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, doc); }}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", userSelect: "none", background: selected ? T.primaryContainer : hovered ? T.surfaceVariant : "transparent", transition: "background 0.1s" }}
    >
      <SelectCircle selected={selected} hovered={hovered} onClick={e => { e.stopPropagation(); onToggle(doc.id); }} />
      <span style={{ fontSize: 20, flexShrink: 0 }}>{fileEmoji(doc.file_type)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? T.primary : T.onSurface }}>{doc.file_name}</p>
        <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>{formatDate(doc.created_at)} · {formatSize(doc.file_size)}</p>
      </div>
      {doc.ai_processed && <span style={{ fontSize: 11, fontWeight: 600, color: T.success, flexShrink: 0 }}>AI ✓</span>}
      {!selected && hovered && (
        <button onClick={e => { e.stopPropagation(); onContextMenu(e, doc); }}
          style={{ width: 32, height: 32, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.full, flexShrink: 0 }}>
          <Icon name="more_vert" size={18} color={T.outline} />
        </button>
      )}
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────────

function Breadcrumb({ folders, currentFolderId, onNavigate }: { folders: FolderRow[]; currentFolderId: string | null; onNavigate: (id: string | null) => void; }) {
  const buildPath = (id: string | null): FolderRow[] => {
    if (!id) return [];
    const f = folders.find(x => x.id === id);
    if (!f) return [];
    return [...buildPath(f.parent_id), f];
  };
  const path = buildPath(currentFolderId);
  const btnStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? T.onSurface : T.outline,
    background: "none", border: "none", cursor: "pointer", padding: "4px 2px",
    transition: "color 0.1s",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, overflow: "hidden" }}>
      <button onClick={() => onNavigate(null)} style={btnStyle(currentFolderId === null)}>Mijn bestanden</button>
      {path.map(f => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <Icon name="chevron_right" size={16} color={T.outline} />
          <button onClick={() => onNavigate(f.id)} style={btnStyle(currentFolderId === f.id)}>{f.name}</button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────────

export function BestandenPage() {
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [allFolders, setAllFolders] = useState<FolderRow[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [subFolders, setSubFolders] = useState<FolderRow[]>([]);
  const [docs, setDocs] = useState<BestandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [preview, setPreview] = useState<BestandRow | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [newFolderInline, setNewFolderInline] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; doc: BestandRow } | null>(null);
  const [moveModal, setMoveModal] = useState<{ doc: BestandRow } | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [sharePopup, setSharePopup] = useState<{ doc: BestandRow; fileName: string } | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{ doc: BestandRow; suggestion: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedIds(new Set()); };
    window.addEventListener("keydown", fn); return () => window.removeEventListener("keydown", fn);
  }, []);

  // Drag-to-select
  const dragSelectRef = useRef({ startX: 0, startY: 0, active: false });
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Bulk
  const handleBulkDelete = async () => {
    if (!confirm(`${selectedIds.size} bestand(en) verwijderen?`)) return;
    await Promise.all([...selectedIds].map(id => fetch(`/api/files/${id}`, { method: "DELETE" })));
    setDocs(p => p.filter(d => !selectedIds.has(d.id))); setSelectedIds(new Set());
  };
  const handleBulkMove = async (folderId: string | null) => {
    await Promise.all([...selectedIds].map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folderId }) })));
    setDocs(p => p.filter(d => !selectedIds.has(d.id))); setSelectedIds(new Set());
  };
  const handleBulkShare = async () => {
    const sf = allFolders.find(f => f.name === "Gedeeld met boekhouder"); if (!sf) return;
    await Promise.all([...selectedIds].map(id => fetch(`/api/bestanden?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: sf.id }) })));
    setDocs(p => p.filter(d => !selectedIds.has(d.id))); setSelectedIds(new Set());
  };

  // Data loading
  const loadContents = useCallback(async (folderId: string | null) => {
    setLoading(true);
    const res = await fetch(`/api/bestanden?folder_id=${folderId ?? "root"}`);
    const json = await res.json() as { folders?: FolderRow[]; documents?: BestandRow[] };
    setSubFolders(json.folders ?? []); setDocs(json.documents ?? []); setLoading(false);
  }, []);

  const loadAllFolders = useCallback(async () => {
    const res = await fetch("/api/bestanden/folders-tree").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as FolderRow[];
    setAllFolders(data); setFolderTree(buildTree(data, null));
  }, []);

  useEffect(() => { loadContents(currentFolderId); loadAllFolders(); }, [currentFolderId]); // eslint-disable-line

  // Search
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const res = await fetch(`/api/bestanden?search=${encodeURIComponent(search)}`);
      const json = await res.json() as { results?: SearchResult[] };
      setSearchResults(json.results ?? []); setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { if (newFolderInline) setTimeout(() => newFolderRef.current?.focus(), 50); }, [newFolderInline]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) { setNewFolderInline(false); return; }
    const res = await fetch("/api/bestanden/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newFolderName.trim(), parent_id: currentFolderId }) });
    const json = await res.json() as FolderRow;
    if (json.id) { setSubFolders(p => [...p, json]); setAllFolders(p => [...p, json]); }
    setNewFolderName(""); setNewFolderInline(false);
  };

  const handleUploaded = useCallback((doc: BestandRow, _: string | null) => {
    setDocs(p => [doc, ...p]); setSharePopup({ doc, fileName: doc.file_name });
  }, []);

  const handleShare = async (doc: BestandRow) => {
    const sf = allFolders.find(f => f.name === "Gedeeld met boekhouder");
    if (sf) await fetch(`/api/bestanden?id=${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: sf.id }) });
    setSharePopup(null);
  };

  const handleDelete = async (doc: BestandRow) => {
    if (!confirm(`"${doc.file_name}" verwijderen?`)) return;
    await fetch(`/api/files/${doc.id}`, { method: "DELETE" });
    setDocs(p => p.filter(d => d.id !== doc.id));
  };

  const handleMove = async (doc: BestandRow, folderId: string | null) => {
    await fetch(`/api/bestanden?id=${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folderId }) });
    setDocs(p => p.filter(d => d.id !== doc.id)); setMoveModal(null);
  };

  const handleRenameFolder = async (id: string, cur: string) => {
    const n = prompt("Naam wijzigen:", cur); if (!n?.trim() || n === cur) return;
    await fetch(`/api/bestanden/folders?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.trim() }) });
    setSubFolders(p => p.map(f => f.id === id ? { ...f, name: n.trim() } : f));
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Map verwijderen? Bestanden worden naar root verplaatst.")) return;
    await fetch(`/api/bestanden/folders?id=${id}`, { method: "DELETE" });
    setSubFolders(p => p.filter(f => f.id !== id)); loadContents(currentFolderId);
  };

  const handleDocDragStart = (e: DragEvent<HTMLDivElement>, doc: BestandRow) => { setDraggedDocId(doc.id); e.dataTransfer.effectAllowed = "move"; };

  const handleFolderDrop = async (e: DragEvent<HTMLDivElement>, folderId: string) => {
    e.preventDefault(); setDragOverFolder(null); if (!draggedDocId) return;
    await fetch(`/api/bestanden?id=${draggedDocId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folderId }) });
    setDocs(p => p.filter(d => d.id !== draggedDocId)); setDraggedDocId(null);
  };

  const isEmpty = subFolders.length === 0 && docs.length === 0 && !loading;

  // Folder card hover helper
  const folderCardStyle = (id: string): React.CSSProperties => ({
    display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 16,
    borderRadius: T.lg, cursor: "pointer", userSelect: "none",
    background: dragOverFolder === id ? T.primaryContainer : "white",
    boxShadow: dragOverFolder === id ? `0 0 0 2px ${T.primary}, ${T.elev1}` : T.elev1,
    transform: dragOverFolder === id ? "scale(0.97)" : "none",
    transition: "all 0.15s cubic-bezier(0.4,0,0.2,1)",
  });

  return (
    <div style={{ minHeight: "100dvh", background: "#F8F9FA", display: "flex", flexDirection: "column", fontFamily: "'Google Sans','Roboto',-apple-system,sans-serif" }}>

      {/* Global animation */}
      <style>{`
        @keyframes m3fadeUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      `}</style>

      {/* Modals */}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {sharePopup && <SharePopup fileName={sharePopup.fileName} accountantName="uw boekhouder" onShare={() => handleShare(sharePopup.doc)} onKeepPrivate={() => setSharePopup(null)} />}
      {moveModal && <MoveModal folders={allFolders} onMove={fid => handleMove(moveModal.doc, fid)} onClose={() => setMoveModal(null)} />}
      {bulkMoveOpen && <MoveModal folders={allFolders} onMove={fid => { handleBulkMove(fid); setBulkMoveOpen(false); }} onClose={() => setBulkMoveOpen(false)} />}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}
          items={[
            { label: "Bekijken", icon: "visibility", onClick: () => setPreview(contextMenu.doc) },
            { label: "Downloaden", icon: "download", onClick: async () => {
              const r = await fetch(`/api/files/${contextMenu.doc.id}/url`);
              const { url } = await r.json() as { url: string };
              if (url) { const a = document.createElement("a"); a.href = url; a.download = contextMenu.doc.file_name; a.click(); }
            }},
            { label: "Verplaatsen", icon: "drive_file_move", onClick: () => setMoveModal({ doc: contextMenu.doc }) },
            { label: "Delen met boekhouder", icon: "share", onClick: () => setSharePopup({ doc: contextMenu.doc, fileName: contextMenu.doc.file_name }) },
            { label: "Verwijderen", icon: "delete", onClick: () => handleDelete(contextMenu.doc), danger: true },
          ]}
        />
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 50, display: "flex", alignItems: "center", gap: 6, background: T.onSurface, borderRadius: T.xl, boxShadow: T.elev3, padding: "10px 16px", animation: "m3fadeUp 0.2s cubic-bezier(0.4,0,0.2,1)" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "white", marginRight: 4 }}>{selectedIds.size} geselecteerd</span>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
          {[
            { label: "Delen", icon: "share", onClick: handleBulkShare },
            { label: "Verplaatsen", icon: "drive_file_move", onClick: () => setBulkMoveOpen(true) },
          ].map(btn => (
            <button key={btn.label} onClick={btn.onClick} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "none", border: "none", color: "white", fontSize: 14, cursor: "pointer", borderRadius: T.md, transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}>
              <Icon name={btn.icon} size={16} color="white" /> {btn.label}
            </button>
          ))}
          <button onClick={handleBulkDelete} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "none", border: "none", color: "#F28B82", fontSize: 14, cursor: "pointer", borderRadius: T.md }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(242,139,130,0.1)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}>
            <Icon name="delete" size={16} color="#F28B82" /> Verwijderen
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
          <button onClick={() => setSelectedIds(new Set())} style={{ width: 28, height: 28, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.full, color: "white" }}>
            <Icon name="close" size={16} color="white" />
          </button>
        </div>
      )}

      {/* Top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 56, maxWidth: 1200, margin: "0 auto", width: "100%" }}>

          {/* Sidebar toggle mobile */}
          <button onClick={() => setSidebarOpen(v => !v)} className="lg:hidden"
            style={{ width: 36, height: 36, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: T.full }}>
            <Icon name="folder_open" size={22} color={T.warning} />
          </button>

          {/* Search */}
          <div style={{ flex: 1, position: "relative" }}>
            <Icon name="search" size={18} color={T.outline} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Zoeken in bestanden..."
              style={{ width: "100%", paddingLeft: 40, paddingRight: search ? 36 : 12, paddingTop: 9, paddingBottom: 9, fontSize: 14, background: "#F1F3F4", border: "none", borderRadius: T.full, color: T.onSurface, outline: "none", boxSizing: "border-box", transition: "box-shadow 0.15s" }}
              onFocus={e => (e.currentTarget.style.boxShadow = `0 0 0 2px ${T.primary}40`)}
              onBlur={e => (e.currentTarget.style.boxShadow = "none")}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 18, height: 18, border: "none", background: T.outline, borderRadius: T.full, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Icon name="close" size={12} color="white" />
              </button>
            )}
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", background: "#F1F3F4", borderRadius: T.md, padding: 3, flexShrink: 0 }}>
            {(["grid", "list"] as ViewMode[]).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{ width: 32, height: 32, border: "none", cursor: "pointer", borderRadius: T.sm, display: "flex", alignItems: "center", justifyContent: "center", background: viewMode === mode ? "white" : "transparent", boxShadow: viewMode === mode ? T.elev1 : "none", color: viewMode === mode ? T.primary : T.outline, transition: "all 0.15s" }}>
                <Icon name={mode === "grid" ? "grid_view" : "view_list"} size={18} />
              </button>
            ))}
          </div>

          {/* + Nieuw */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={() => setShowNewMenu(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: T.primary, color: T.onPrimary, border: "none", borderRadius: T.full, fontSize: 14, fontWeight: 500, cursor: "pointer", boxShadow: T.elev1, transition: "all 0.1s" }}
              onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={e => (e.currentTarget.style.transform = "none")}
            >
              <Icon name="add" size={18} color={T.onPrimary} /> Nieuw
            </button>
            {showNewMenu && (
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: T.surface, borderRadius: T.md, boxShadow: T.elev3, border: `1px solid ${T.surfaceVariant}`, minWidth: 188, zIndex: 50, padding: "4px 0" }}>
                <button onClick={() => { setShowNewMenu(false); setNewFolderInline(true); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "none", border: "none", fontSize: 14, color: T.onSurface, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.surfaceVariant)}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                  <Icon name="create_new_folder" size={18} color={T.outline} /> Nieuwe map
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", fontSize: 14, color: T.onSurface, cursor: "pointer" }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = T.surfaceVariant)}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "none")}>
                  <Icon name="upload" size={18} color={T.outline} /> Bestand uploaden
                  <input type="file" style={{ display: "none" }}
                    onChange={async e => {
                      setShowNewMenu(false);
                      const file = e.target.files?.[0]; if (!file) return;
                      const now = new Date(); const fd = new FormData();
                      fd.append("file", file); fd.append("year", String(now.getFullYear())); fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
                      if (currentFolderId) fd.append("folder_id", currentFolderId);
                      const r = await fetch("/api/files", { method: "POST", body: fd });
                      const j = await r.json() as { id?: string };
                      if (j.id) handleUploaded({ id: j.id, file_name: file.name, file_url: "", file_size: file.size, file_type: file.type, doc_type: null, period: null, year: now.getFullYear(), notes: null, invoice_id: null, created_at: now.toISOString(), folder_id: currentFolderId, ai_processed: false, ai_doc_type: null, ai_suggested_folder: null, source: "upload" }, null);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", maxWidth: 1200, margin: "0 auto", width: "100%" }}>

        {/* Mobile sidebar overlay */}
        {sidebarOpen && <div onClick={() => setSidebarOpen(false)} className="lg:hidden" style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.3)" }} />}

        {/* Sidebar */}
        <aside style={{
          width: 256, background: "white", borderRight: "1px solid #E0E0E0",
          overflowY: "auto", flexShrink: 0,
          position: "sticky", top: 56, height: "calc(100dvh - 56px)",
        }} className="hidden lg:block">
          <div style={{ padding: "12px 8px" }}>
            <button onClick={() => setCurrentFolderId(null)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
              border: "none", cursor: "pointer", borderRadius: T.md, textAlign: "left", fontSize: 14,
              background: currentFolderId === null ? T.primaryContainer : "transparent",
              color: currentFolderId === null ? T.primary : T.onSurface,
              fontWeight: currentFolderId === null ? 600 : 400, transition: "background 0.1s",
            }}>
              <Icon name="home" size={18} color={currentFolderId === null ? T.primary : T.outline} /> Mijn bestanden
            </button>

            {folderTree.map(node => (
              <FolderTreeItem key={node.id} node={node} depth={0} activeFolderId={currentFolderId}
                onSelect={setCurrentFolderId} onRename={handleRenameFolder} onDelete={handleDeleteFolder}
              />
            ))}

            {newFolderInline && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px" }}>
                <Icon name="folder" size={18} color={T.warning} />
                <input ref={newFolderRef} value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setNewFolderInline(false); setNewFolderName(""); } }}
                  onBlur={handleCreateFolder} placeholder="Mapnaam..."
                  style={{ flex: 1, fontSize: 14, padding: "4px 8px", border: `2px solid ${T.primary}`, borderRadius: T.sm, outline: "none", color: T.onSurface }}
                />
              </div>
            )}
          </div>
        </aside>

        {/* Main */}
        <main
          style={{ flex: 1, overflowY: "auto", position: "relative" }}
          onMouseDown={e => {
            const t = e.target as HTMLElement;
            if (t.closest("[data-doc-card]") || t.closest("button") || t.closest("a") || t.closest("label")) return;
            if (e.button !== 0) return;
            dragSelectRef.current = { startX: e.clientX, startY: e.clientY, active: true };
          }}
          onMouseMove={e => {
            if (!dragSelectRef.current.active) return;
            const { startX, startY } = dragSelectRef.current;
            const x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
            const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
            if (w < 5 && h < 5) return;
            setSelectionBox({ x, y, w, h });
            const next = new Set<string>();
            cardRefs.current.forEach((el, id) => { const r = el.getBoundingClientRect(); if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) next.add(id); });
            if (next.size > 0) setSelectedIds(next);
          }}
          onMouseUp={() => { dragSelectRef.current.active = false; setSelectionBox(null); }}
          onMouseLeave={() => { dragSelectRef.current.active = false; setSelectionBox(null); }}
        >
          {selectionBox && (
            <div style={{ position: "fixed", pointerEvents: "none", zIndex: 40, border: `2px solid ${T.primary}`, background: `${T.primary}18`, borderRadius: T.sm, left: selectionBox.x, top: selectionBox.y, width: selectionBox.w, height: selectionBox.h }} />
          )}

          <div style={{ padding: "20px 16px", maxWidth: 900, margin: "0 auto" }}>

            <Breadcrumb folders={allFolders} currentFolderId={currentFolderId} onNavigate={setCurrentFolderId} />

            {aiSuggestion && (
              <div style={{ marginTop: 16 }}>
                <AISuggestionBar suggestion={aiSuggestion.suggestion}
                  onAccept={async () => { const f = allFolders.find(x => x.name === aiSuggestion.suggestion); if (f) await handleMove(aiSuggestion.doc, f.id); setAiSuggestion(null); }}
                  onDismiss={() => setAiSuggestion(null)}
                />
              </div>
            )}

            {/* Search results */}
            {search.trim() ? (
              <div style={{ marginTop: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>
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
                      <div key={doc.id} style={{ position: "relative", borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none" }}>
                        <DocRow doc={doc} selected={selectedIds.has(doc.id)} onPreview={setPreview}
                          onContextMenu={(e, d) => setContextMenu({ x: e.clientX, y: e.clientY, doc: d })}
                          onDragStart={handleDocDragStart} onToggle={toggleSelect}
                        />
                        {doc.folder_name && <span style={{ position: "absolute", right: 48, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: T.outline }}>{doc.folder_name}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 20 }}>
                <UploadArea currentFolderId={currentFolderId} onUploaded={handleUploaded} />

                {loading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 48 }}><Spinner size={32} /></div>
                ) : isEmpty ? (
                  <div style={{ textAlign: "center", padding: "48px 24px" }}>
                    <div style={{ width: 80, height: 80, borderRadius: T.xl, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                      <Icon name="folder_open" size={40} color={T.primary} />
                    </div>
                    <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 6px" }}>Deze map is leeg</p>
                    <p style={{ fontSize: 14, color: T.outline, margin: 0 }}>Upload een bestand of maak een nieuwe map aan</p>
                  </div>
                ) : (
                  <div style={{ marginTop: 24 }}>
                    {subFolders.length > 0 && (
                      <div style={{ marginBottom: 28 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>Mappen</p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))", gap: 12 }}>
                          {subFolders.map(folder => (
                            <div key={folder.id}
                              onDragOver={e => { e.preventDefault(); setDragOverFolder(folder.id); }}
                              onDragLeave={() => setDragOverFolder(null)}
                              onDrop={e => handleFolderDrop(e, folder.id)}
                              onClick={() => setCurrentFolderId(folder.id)}
                              style={folderCardStyle(folder.id)}
                              onMouseEnter={e => { if (dragOverFolder !== folder.id) e.currentTarget.style.boxShadow = T.elev2; }}
                              onMouseLeave={e => { if (dragOverFolder !== folder.id) e.currentTarget.style.boxShadow = T.elev1; }}
                            >
                              <Icon name="folder" size={40} color={folderColor(folder.color)} />
                              <p style={{ fontSize: 12, fontWeight: 500, color: T.onSurface, margin: 0, textAlign: "center", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{folder.name}</p>
                              {folder.name === "Gedeeld met boekhouder" && (
                                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", background: T.primaryContainer, color: T.primary, borderRadius: T.full }}>Gedeeld</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {docs.length > 0 && (
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 600, color: T.outline, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px" }}>Bestanden — {docs.length}</p>
                        {viewMode === "grid" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))", gap: 12 }}>
                            {docs.map(doc => (
                              <DocCard key={doc.id} doc={doc} selected={selectedIds.has(doc.id)}
                                onPreview={setPreview}
                                onContextMenu={(e, d) => setContextMenu({ x: e.clientX, y: e.clientY, doc: d })}
                                onDragStart={handleDocDragStart} onToggle={toggleSelect}
                                cardRef={el => { if (el) cardRefs.current.set(doc.id, el); else cardRefs.current.delete(doc.id); }}
                              />
                            ))}
                          </div>
                        ) : (
                          <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden" }}>
                            {docs.map((doc, i) => (
                              <div key={doc.id} style={{ borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none" }}>
                                <DocRow doc={doc} selected={selectedIds.has(doc.id)}
                                  onPreview={setPreview}
                                  onContextMenu={(e, d) => setContextMenu({ x: e.clientX, y: e.clientY, doc: d })}
                                  onDragStart={handleDocDragStart} onToggle={toggleSelect}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}