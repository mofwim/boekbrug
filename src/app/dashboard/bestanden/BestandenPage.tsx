"use client";
// app/dashboard/bestanden/BestandenPage.tsx
// [BOEK-033] Mijn bestanden — Drive experience
// iOS mobile-first — folder tree + grid/list + upload + AI classify + share

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  DragEvent,
} from "react";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
}

interface FolderNode extends FolderRow {
  children: FolderNode[];
}

interface BestandRow {
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

interface SearchResult extends BestandRow {
  folder_name: string | null;
}

type ViewMode = "grid" | "list";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fileIcon(type: string, size: "sm" | "lg" = "sm"): string {
  const s = size === "lg" ? "text-4xl" : "text-xl";
  if (type.startsWith("image/")) return "🖼️";
  if (type === "application/pdf") return "📄";
  if (type.includes("excel") || type.includes("spreadsheet")) return "📊";
  if (type.includes("word") || type.includes("document")) return "📝";
  if (type === "message/rfc822") return "📧";
  if (type === "application/zip") return "🗜️";
  if (type === "text/csv") return "📋";
  if (type.includes("xml")) return "🗂️";
  return "📁";
}
void fileIcon; // suppress lint

function folderColor(color: string | null): string {
  return color ?? "#f59e0b";
}

// ─── Build tree from flat list ───────────────────────────────────────────────────

function buildTree(rows: FolderRow[], parentId: string | null): FolderNode[] {
  return rows
    .filter((r) => r.parent_id === parentId)
    .map((r) => ({ ...r, children: buildTree(rows, r.id) }));
}

// ─── Icons (inline SVG) ──────────────────────────────────────────────────────────

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function IconFolder({ color, className }: { color?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={color ?? "#f59e0b"}>
      <path d="M2 6a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconMore({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function IconDownload({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M12 3v12m0 0l-4-4m4 4l4-4M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
    </svg>
  );
}

function IconShare({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

function IconMove({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function IconEdit({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path strokeLinecap="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function IconBack({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ─── File type icon component ─────────────────────────────────────────────────

function FileTypeIcon({ fileType, className }: { fileType: string; className?: string }) {
  const emoji = fileType.startsWith("image/") ? "🖼️"
    : fileType === "application/pdf" ? "📄"
    : fileType.includes("excel") || fileType.includes("spreadsheet") ? "📊"
    : fileType.includes("word") || fileType.includes("document") ? "📝"
    : fileType === "message/rfc822" ? "📧"
    : fileType === "application/zip" ? "🗜️"
    : fileType === "text/csv" ? "📋"
    : fileType.includes("xml") ? "🗂️"
    : "📁";

  return <span className={className} role="img">{emoji}</span>;
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ doc, onClose }: { doc: BestandRow; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canPreview = doc.file_type.startsWith("image/") || doc.file_type === "application/pdf";

  useEffect(() => {
    fetch(`/api/files/${doc.id}/url`)
      .then((r) => r.json())
      .then(({ url }) => setSignedUrl(url))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [doc.id]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 w-full sm:max-w-2xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <FileTypeIcon fileType={doc.file_type} className="text-2xl mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-all line-clamp-2">{doc.file_name}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{formatSize(doc.file_size)} · {formatDate(doc.created_at)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 transition-colors shrink-0">
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4 min-h-[220px]">
          {loading ? (
            <IconSpinner className="w-7 h-7 text-blue-500" />
          ) : !canPreview || !signedUrl ? (
            <div className="text-center space-y-4 py-6">
              <FileTypeIcon fileType={doc.file_type} className="text-6xl" />
              <p className="text-sm text-zinc-400">Preview niet beschikbaar</p>
              {signedUrl && (
                <a href={signedUrl} download={doc.file_name}
                  className="inline-flex items-center gap-2 text-sm px-5 py-2.5 bg-[#007aff] text-white rounded-xl font-medium active:scale-95 transition-transform">
                  <IconDownload className="w-4 h-4" /> Downloaden
                </a>
              )}
            </div>
          ) : doc.file_type.startsWith("image/") ? (
            <img src={signedUrl} alt={doc.file_name} className="max-w-full max-h-[58vh] object-contain rounded-xl shadow" />
          ) : (
            <iframe src={signedUrl} className="w-full h-[58vh] rounded-xl border-0" title={doc.file_name} />
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex gap-3">
          {signedUrl && (
            <a href={signedUrl} download={doc.file_name}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-3 bg-[#007aff] text-white rounded-2xl active:scale-[0.98] transition-transform">
              <IconDownload className="w-4 h-4" /> Downloaden
            </a>
          )}
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-2xl active:scale-[0.98] transition-transform">
              Openen ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Share Popup ──────────────────────────────────────────────────────────────

function SharePopup({
  fileName,
  accountantName,
  onShare,
  onKeepPrivate,
}: {
  fileName: string;
  accountantName: string;
  onShare: () => void;
  onKeepPrivate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
        <div className="px-6 pt-5 pb-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#007aff]/10 flex items-center justify-center shrink-0">
              <IconShare className="w-6 h-6 text-[#007aff]" />
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">Delen met boekhouder?</p>
              <p className="text-xs text-zinc-400 mt-0.5 leading-snug">
                &quot;{fileName}&quot; is geüpload. Wil je dit delen met <strong className="text-zinc-600 dark:text-zinc-300">{accountantName}</strong>?
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={onShare}
              className="w-full py-3 rounded-2xl bg-[#007aff] text-white text-sm font-semibold active:scale-[0.98] transition-transform">
              Ja, delen
            </button>
            <button onClick={onKeepPrivate}
              className="w-full py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-sm font-semibold active:scale-[0.98] transition-transform">
              Nee, privé houden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Suggestion Bar ────────────────────────────────────────────────────────

function AISuggestionBar({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-[#007aff]/8 dark:bg-[#007aff]/15 border border-[#007aff]/20 rounded-2xl px-4 py-3 text-sm">
      <span className="text-lg shrink-0">✨</span>
      <div className="flex-1 min-w-0">
        <p className="text-zinc-700 dark:text-zinc-300 leading-snug">
          <span className="font-medium text-[#007aff]">AI stelt voor:</span> {suggestion}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={onAccept}
          className="text-xs font-semibold px-3 py-1.5 bg-[#007aff] text-white rounded-xl active:scale-95 transition-transform">
          Plaatsen
        </button>
        <button onClick={onDismiss}
          className="text-xs font-semibold px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-xl active:scale-95 transition-transform">
          Negeren
        </button>
      </div>
    </div>
  );
}

// ─── Move Modal ───────────────────────────────────────────────────────────────

function MoveModal({
  folders,
  onMove,
  onClose,
  title,
}: {
  folders: FolderRow[];
  onMove: (folderId: string | null) => void;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[70dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Verplaatsen naar</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <IconX className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        <div className="flex-1 overflow-auto py-2">
          <button onClick={() => onMove(null)}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left">
            <span className="text-xl">🏠</span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">Root (geen map)</span>
          </button>
          {folders.map((f) => (
            <button key={f.id} onClick={() => onMove(f.id)}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left">
              <IconFolder color={folderColor(f.color)} className="w-5 h-5 shrink-0" />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">{f.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function ContextMenu({
  x, y, onClose, items,
}: {
  x: number; y: number; onClose: () => void;
  items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", fn);
    document.addEventListener("touchstart", fn);
    return () => {
      document.removeEventListener("mousedown", fn);
      document.removeEventListener("touchstart", fn);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: y, left: x, zIndex: 999 }}
      className="bg-white dark:bg-zinc-800 rounded-2xl shadow-2xl border border-zinc-100 dark:border-zinc-700 overflow-hidden min-w-[200px] py-1"
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left
            ${item.danger
              ? "text-[#ff3b30] hover:bg-red-50 dark:hover:bg-red-950/30"
              : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            }`}
        >
          <span className="w-4 h-4 shrink-0">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Upload Zone (drag + button) ──────────────────────────────────────────────

function UploadArea({
  currentFolderId,
  onUploaded,
}: {
  currentFolderId: string | null;
  onUploaded: (doc: BestandRow, aiSuggestion: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setUploading(true);
    setProgress(10);

    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(year));
    fd.append("quarter", String(quarter));
    if (currentFolderId) fd.append("folder_id", currentFolderId);

    setProgress(40);

    try {
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const json = await res.json() as { id?: string; error?: string };
      setProgress(70);

      if (!json.id) throw new Error(json.error ?? "Upload mislukt");

      // Fetch the uploaded doc metadata
      const docRes = await fetch(`/api/files/${json.id}`);
      const docJson = await docRes.json() as { document?: BestandRow };

      setProgress(100);
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        onUploaded(docJson.document ?? {
          id: json.id!,
          file_name: file.name,
          file_url: "",
          file_size: file.size,
          file_type: file.type,
          doc_type: null,
          period: null,
          year,
          notes: null,
          invoice_id: null,
          created_at: new Date().toISOString(),
          folder_id: currentFolderId,
          ai_processed: false,
          ai_doc_type: null,
          ai_suggested_folder: null,
          source: "upload",
        }, null);
      }, 400);
    } catch {
      setUploading(false);
      setProgress(0);
      alert("Upload mislukt. Probeer opnieuw.");
    }
  }, [currentFolderId, onUploaded]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  if (uploading) {
    return (
      <div className="border-2 border-dashed border-[#007aff]/40 rounded-2xl p-6 flex flex-col items-center gap-3">
        <IconSpinner className="w-8 h-8 text-[#007aff]" />
        <p className="text-sm text-zinc-500">Uploaden...</p>
        <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-[#007aff] rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-all select-none
        ${dragging
          ? "border-[#007aff] bg-[#007aff]/5 scale-[0.99]"
          : "border-zinc-200 dark:border-zinc-700 hover:border-[#007aff]/50 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        }`}
    >
      <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
        <IconDownload className="w-6 h-6 text-zinc-400 rotate-180" />
      </div>
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        {dragging ? "Loslaten om te uploaden" : "Sleep een bestand of tik om te uploaden"}
      </p>
      <p className="text-xs text-zinc-400">PDF, afbeelding, Excel, Word — max 25MB</p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.doc,.docx,.xls,.xlsx,.csv,.xml,.zip,.eml"
      />
    </div>
  );
}

// ─── Folder Tree Sidebar ──────────────────────────────────────────────────────

function FolderTreeItem({
  node,
  depth,
  activeFolderId,
  onSelect,
  onRename,
  onDelete,
}: {
  node: FolderNode;
  depth: number;
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = activeFolderId === node.id;
  const hasChildren = node.children.length > 0;
  const isShared = node.name === "Gedeeld met boekhouder";

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl cursor-pointer select-none group transition-colors
          ${isActive
            ? "bg-[#007aff]/10 text-[#007aff]"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => { onSelect(node.id); setOpen(true); }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          className={`w-4 h-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"} ${hasChildren ? "opacity-50" : "opacity-0 pointer-events-none"}`}
        >
          <IconChevronDown className="w-4 h-4" />
        </button>
        <IconFolder color={folderColor(node.color)} className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-sm truncate">{node.name}</span>
        {isShared && <span className="text-xs bg-[#007aff]/10 text-[#007aff] px-1.5 py-0.5 rounded-md font-medium shrink-0">Gedeeld</span>}
        {!isShared && (
          <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onRename(node.id, node.name); }}
              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700">
              <IconEdit className="w-3 h-3" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
              className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-[#ff3b30]">
              <IconTrash className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Document Grid Card ───────────────────────────────────────────────────────

function DocCard({
  doc,
  selected,
  onPreview,
  onContextMenu,
  onDragStart,
  onToggle,
  cardRef,
}: {
  doc: BestandRow;
  selected: boolean;
  onPreview: (doc: BestandRow) => void;
  onContextMenu: (e: React.MouseEvent, doc: BestandRow) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, doc: BestandRow) => void;
  onToggle: (id: string) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const isImage = doc.file_type.startsWith("image/");

  return (
    <div
      ref={cardRef}
      data-doc-card
      draggable={!selected}
      onDragStart={(e) => onDragStart(e, doc)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); onToggle(doc.id); return; }
        if (selected) { onToggle(doc.id); return; }
        onPreview(doc);
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, doc); }}
      className={`relative bg-white dark:bg-zinc-900 border rounded-2xl overflow-hidden cursor-pointer transition-all group select-none
        ${selected
          ? "border-[#007aff] ring-2 ring-[#007aff]/30 shadow-md scale-[0.98]"
          : "border-zinc-100 dark:border-zinc-800 hover:shadow-md active:scale-[0.97]"
        }`}
    >
      {/* Checkbox */}
      <div
        onClick={(e) => { e.stopPropagation(); onToggle(doc.id); }}
        className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
          ${selected
            ? "bg-[#007aff] border-[#007aff]"
            : "bg-white/80 border-zinc-300 opacity-0 group-hover:opacity-100"
          }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Thumbnail area */}
      <div className={`h-28 flex items-center justify-center relative transition-colors ${selected ? "bg-[#007aff]/5" : "bg-zinc-50 dark:bg-zinc-800"}`}>
        {isImage && doc.file_url ? (
          <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
            <FileTypeIcon fileType={doc.file_type} className="text-3xl opacity-30" />
          </div>
        ) : (
          <FileTypeIcon fileType={doc.file_type} className="text-3xl" />
        )}
        {/* More button */}
        {!selected && (
          <button
            onClick={(e) => { e.stopPropagation(); onContextMenu(e, doc); }}
            className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
          >
            <IconMore className="w-4 h-4" />
          </button>
        )}
        {doc.ai_processed && (
          <div className="absolute top-2 right-2 w-5 h-5 bg-[#34c759]/15 rounded-lg flex items-center justify-center">
            <span className="text-xs">✨</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <p className={`text-xs font-medium truncate leading-snug ${selected ? "text-[#007aff]" : "text-zinc-800 dark:text-zinc-100"}`}>{doc.file_name}</p>
        <p className="text-[10px] text-zinc-400 mt-0.5">{formatDate(doc.created_at)}</p>
      </div>
    </div>
  );
}

// ─── Document List Row ────────────────────────────────────────────────────────

function DocRow({
  doc,
  selected,
  onPreview,
  onContextMenu,
  onDragStart,
  onToggle,
}: {
  doc: BestandRow;
  selected: boolean;
  onPreview: (doc: BestandRow) => void;
  onContextMenu: (e: React.MouseEvent, doc: BestandRow) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, doc: BestandRow) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      draggable={!selected}
      onDragStart={(e) => onDragStart(e, doc)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); onToggle(doc.id); return; }
        if (selected) { onToggle(doc.id); return; }
        onPreview(doc);
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, doc); }}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group select-none
        ${selected
          ? "bg-[#007aff]/8 dark:bg-[#007aff]/15"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 active:bg-zinc-100 dark:active:bg-zinc-800"
        }`}
    >
      {/* Checkbox */}
      <div
        onClick={(e) => { e.stopPropagation(); onToggle(doc.id); }}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
          ${selected
            ? "bg-[#007aff] border-[#007aff]"
            : "border-zinc-300 opacity-0 group-hover:opacity-100"
          }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <FileTypeIcon fileType={doc.file_type} className="text-xl shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${selected ? "text-[#007aff]" : "text-zinc-800 dark:text-zinc-100"}`}>{doc.file_name}</p>
        <p className="text-xs text-zinc-400">{formatDate(doc.created_at)} · {formatSize(doc.file_size)}</p>
      </div>
      {doc.ai_processed && <span className="text-xs text-[#34c759] font-medium shrink-0 hidden sm:block">AI ✓</span>}
      {!selected && (
        <button
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, doc); }}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-zinc-300 opacity-0 group-hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-600 transition-all shrink-0"
        >
          <IconMore className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  folders,
  currentFolderId,
  onNavigate,
}: {
  folders: FolderRow[];
  currentFolderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const buildPath = (id: string | null): FolderRow[] => {
    if (!id) return [];
    const folder = folders.find((f) => f.id === id);
    if (!folder) return [];
    return [...buildPath(folder.parent_id), folder];
  };

  const path = buildPath(currentFolderId);

  return (
    <div className="flex items-center gap-1 text-sm overflow-x-auto scrollbar-none">
      <button
        onClick={() => onNavigate(null)}
        className={`shrink-0 font-medium transition-colors ${currentFolderId === null ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
      >
        Mijn bestanden
      </button>
      {path.map((f) => (
        <div key={f.id} className="flex items-center gap-1 shrink-0">
          <IconChevronRight className="w-4 h-4 text-zinc-300 shrink-0" />
          <button
            onClick={() => onNavigate(f.id)}
            className={`font-medium transition-colors ${currentFolderId === f.id ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
          >
            {f.name}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export function BestandenPage() {
  // ── State ──
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
  const [sharePopup, setSharePopup] = useState<{ doc: BestandRow; fileName: string } | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{ doc: BestandRow; suggestion: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const newFolderRef = useRef<HTMLInputElement>(null);

  // [BOEK-033] Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const mainRef = useRef<HTMLDivElement>(null);

  // Toggle one item — Cmd/Ctrl+click or checkbox click
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Escape → clear selection
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedIds(new Set()); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(`${ids.length} bestand(en) verwijderen?`)) return;
    await Promise.all(ids.map((id) => fetch(`/api/files/${id}`, { method: "DELETE" })));
    setDocs((prev) => prev.filter((d) => !selectedIds.has(d.id)));
    setSelectedIds(new Set());
  };

  // Bulk move
  const handleBulkMove = async (folderId: string | null) => {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) =>
      fetch(`/api/bestanden?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      })
    ));
    setDocs((prev) => prev.filter((d) => !selectedIds.has(d.id)));
    setSelectedIds(new Set());
  };

  // Bulk share
  const handleBulkShare = async () => {
    const sharedFolder = allFolders.find((f) => f.name === "Gedeeld met boekhouder");
    if (!sharedFolder) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) =>
      fetch(`/api/bestanden?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: sharedFolder.id }),
      })
    ));
    setDocs((prev) => prev.filter((d) => !selectedIds.has(d.id)));
    setSelectedIds(new Set());
  };

  // Drag-to-select state
  const dragSelectRef = useRef<{ startX: number; startY: number; active: boolean }>({ startX: 0, startY: 0, active: false });
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Load folder tree ──
  const loadFolderTree = useCallback(async () => {
    const res = await fetch("/api/bestanden/folders-tree").catch(() => null);
    if (!res?.ok) return;
    // We'll get it from the contents endpoint instead — just load contents
  }, []);
  void loadFolderTree;

  // ── Load contents of current folder ──
  const loadContents = useCallback(async (folderId: string | null) => {
    setLoading(true);
    const param = folderId ?? "root";
    const res = await fetch(`/api/bestanden?folder_id=${param}`);
    const json = await res.json() as { folders?: FolderRow[]; documents?: BestandRow[] };
    setSubFolders(json.folders ?? []);
    setDocs(json.documents ?? []);
    setLoading(false);
  }, []);

  // ── Load flat folder list for move modal ──
  const loadAllFolders = useCallback(async () => {
    const res = await fetch("/api/bestanden?folder_id=root");
    const json = await res.json() as { folders?: FolderRow[] };
    // We need all folders — fetch from tree
    const treeRes = await fetch("/api/bestanden/folders?all=true").catch(() => null);
    if (treeRes?.ok) {
      const treeJson = await treeRes.json() as FolderRow[];
      setAllFolders(treeJson);
      setFolderTree(buildTree(treeJson, null));
    } else {
      setAllFolders(json.folders ?? []);
    }
  }, []);

  useEffect(() => {
    loadContents(currentFolderId);
    loadAllFolders();
  }, [currentFolderId]); // eslint-disable-line

  // ── Search ──
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const res = await fetch(`/api/bestanden?search=${encodeURIComponent(search)}`);
      const json = await res.json() as { results?: SearchResult[] };
      setSearchResults(json.results ?? []);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── New folder inline ──
  useEffect(() => {
    if (newFolderInline) setTimeout(() => newFolderRef.current?.focus(), 50);
  }, [newFolderInline]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) { setNewFolderInline(false); return; }
    const res = await fetch("/api/bestanden/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim(), parent_id: currentFolderId }),
    });
    const json = await res.json() as FolderRow;
    if (json.id) {
      setSubFolders((prev) => [...prev, json]);
      setAllFolders((prev) => [...prev, json]);
    }
    setNewFolderName("");
    setNewFolderInline(false);
  };

  // ── Upload callback ──
  const handleUploaded = useCallback((doc: BestandRow, _suggestion: string | null) => {
    setDocs((prev) => [doc, ...prev]);
    // Show share popup (in real app, check if user has linked accountant)
    setSharePopup({ doc, fileName: doc.file_name });
  }, []);

  // ── Share ──
  const handleShare = async (doc: BestandRow) => {
    // Move to shared folder
    const sharedFolder = allFolders.find((f) => f.name === "Gedeeld met boekhouder");
    if (sharedFolder) {
      await fetch(`/api/bestanden?id=${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: sharedFolder.id }),
      });
    }
    setSharePopup(null);
  };

  // ── Context menu actions ──
  const handleDelete = async (doc: BestandRow) => {
    if (!confirm(`"${doc.file_name}" verwijderen?`)) return;
    await fetch(`/api/files/${doc.id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
  };

  const handleMove = async (doc: BestandRow, folderId: string | null) => {
    await fetch(`/api/bestanden?id=${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: folderId }),
    });
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    setMoveModal(null);
  };

  const handleRenameFolder = async (id: string, currentName: string) => {
    const newName = prompt("Naam wijzigen:", currentName);
    if (!newName?.trim() || newName === currentName) return;
    await fetch(`/api/bestanden/folders?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setSubFolders((prev) => prev.map((f) => f.id === id ? { ...f, name: newName.trim() } : f));
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Map verwijderen? Bestanden worden naar root verplaatst.")) return;
    await fetch(`/api/bestanden/folders?id=${id}`, { method: "DELETE" });
    setSubFolders((prev) => prev.filter((f) => f.id !== id));
    loadContents(currentFolderId);
  };

  // ── Drag & drop docs onto folders ──
  const handleDocDragStart = (e: DragEvent<HTMLDivElement>, doc: BestandRow) => {
    setDraggedDocId(doc.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleFolderDrop = async (e: DragEvent<HTMLDivElement>, folderId: string) => {
    e.preventDefault();
    setDragOverFolder(null);
    if (!draggedDocId) return;
    await fetch(`/api/bestanden?id=${draggedDocId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: folderId }),
    });
    setDocs((prev) => prev.filter((d) => d.id !== draggedDocId));
    setDraggedDocId(null);
  };

  const isEmpty = subFolders.length === 0 && docs.length === 0 && !loading;

  return (
    <div className="min-h-dvh bg-[#f2f2f7] dark:bg-zinc-950 flex flex-col">

      {/* ── Modals ── */}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {sharePopup && (
        <SharePopup
          fileName={sharePopup.fileName}
          accountantName="uw boekhouder"
          onShare={() => handleShare(sharePopup.doc)}
          onKeepPrivate={() => setSharePopup(null)}
        />
      )}
      {moveModal && (
        <MoveModal
          folders={allFolders}
          onMove={(fid) => handleMove(moveModal.doc, fid)}
          onClose={() => setMoveModal(null)}
          title={moveModal.doc.file_name}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "Bekijken", icon: <IconEye className="w-4 h-4" />, onClick: () => setPreview(contextMenu.doc) },
            {
              label: "Downloaden",
              icon: <IconDownload className="w-4 h-4" />,
              onClick: async () => {
                const res = await fetch(`/api/files/${contextMenu.doc.id}/url`);
                const { url } = await res.json() as { url: string };
                if (url) { const a = document.createElement("a"); a.href = url; a.download = contextMenu.doc.file_name; a.click(); }
              },
            },
            { label: "Verplaatsen", icon: <IconMove className="w-4 h-4" />, onClick: () => setMoveModal({ doc: contextMenu.doc }) },
            {
              label: "Delen met boekhouder",
              icon: <IconShare className="w-4 h-4" />,
              onClick: () => setSharePopup({ doc: contextMenu.doc, fileName: contextMenu.doc.file_name }),
            },
            { label: "Verwijderen", icon: <IconTrash className="w-4 h-4" />, onClick: () => handleDelete(contextMenu.doc), danger: true },
          ]}
        />
      )}

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl shadow-2xl px-4 py-3">
          <span className="text-sm font-semibold mr-1">{selectedIds.size} geselecteerd</span>
          <div className="w-px h-5 bg-zinc-700 dark:bg-zinc-300 mx-1" />
          <button
            onClick={handleBulkShare}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
          >
            <IconShare className="w-4 h-4" /> Delen
          </button>
          <button
            onClick={() => {
              // reuse MoveModal for bulk — set a fake "multi" doc
              // We'll use a separate bulk move modal state
              setBulkMoveOpen(true);
            }}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
          >
            <IconMove className="w-4 h-4" /> Verplaatsen
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl hover:bg-red-600 dark:hover:bg-red-100 text-[#ff453a] transition-colors"
          >
            <IconTrash className="w-4 h-4" /> Verwijderen
          </button>
          <div className="w-px h-5 bg-zinc-700 dark:bg-zinc-300 mx-1" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="w-7 h-7 flex items-center justify-center rounded-xl hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk move modal */}
      {bulkMoveOpen && (
        <MoveModal
          folders={allFolders}
          onMove={(fid) => { handleBulkMove(fid); setBulkMoveOpen(false); }}
          onClose={() => setBulkMoveOpen(false)}
          title={`${selectedIds.size} bestanden verplaatsen`}
        />
      )}

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-30 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/60 dark:border-zinc-800">
        <div className="flex items-center gap-3 px-4 h-14">
          {/* Sidebar toggle (mobile) */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <IconFolder color="#f59e0b" className="w-5 h-5" />
          </button>

          {/* Search bar */}
          <div className="flex-1 relative min-w-0">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoeken in bestanden..."
              className="w-full pl-9 pr-9 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 border-0 rounded-xl text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            {search && (
              <button onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-zinc-300 dark:bg-zinc-600">
                <IconX className="w-3 h-3 text-zinc-600 dark:text-zinc-300" />
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-xl p-0.5 shrink-0">
            <button onClick={() => setViewMode("grid")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${viewMode === "grid" ? "bg-white dark:bg-zinc-700 shadow-sm text-[#007aff]" : "text-zinc-400"}`}>
              <IconGrid className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode("list")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${viewMode === "list" ? "bg-white dark:bg-zinc-700 shadow-sm text-[#007aff]" : "text-zinc-400"}`}>
              <IconList className="w-4 h-4" />
            </button>
          </div>

          {/* + Nieuw */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowNewMenu((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#007aff] text-white text-sm font-semibold rounded-xl active:scale-95 transition-transform"
            >
              <IconPlus className="w-4 h-4" />
              <span className="hidden sm:block">Nieuw</span>
            </button>
            {showNewMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-100 dark:border-zinc-700 overflow-hidden min-w-[180px] z-50 py-1">
                <button
                  onClick={() => { setShowNewMenu(false); setNewFolderInline(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-left"
                >
                  <IconFolder color="#f59e0b" className="w-4 h-4 shrink-0" /> Nieuwe map
                </button>
                <label className="w-full flex items-center gap-3 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer">
                  <IconDownload className="w-4 h-4 shrink-0 rotate-180" /> Bestand uploaden
                  <input type="file" className="hidden"
                    onChange={async (e) => {
                      setShowNewMenu(false);
                      const files = e.target.files;
                      if (!files) return;
                      // Trigger via hidden UploadArea — just trigger handleUploaded manually
                      const file = files[0];
                      const fd = new FormData();
                      const now = new Date();
                      fd.append("file", file);
                      fd.append("year", String(now.getFullYear()));
                      fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
                      if (currentFolderId) fd.append("folder_id", currentFolderId);
                      const res = await fetch("/api/files", { method: "POST", body: fd });
                      const json = await res.json() as { id?: string };
                      if (json.id) {
                        const newDoc: BestandRow = {
                          id: json.id,
                          file_name: file.name,
                          file_url: "",
                          file_size: file.size,
                          file_type: file.type,
                          doc_type: null,
                          period: null,
                          year: now.getFullYear(),
                          notes: null,
                          invoice_id: null,
                          created_at: now.toISOString(),
                          folder_id: currentFolderId,
                          ai_processed: false,
                          ai_doc_type: null,
                          ai_suggested_folder: null,
                          source: "upload",
                        };
                        handleUploaded(newDoc, null);
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar — folder tree ── */}
        <>
          {/* Mobile overlay */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          <aside className={`
            fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto
            w-64 bg-white dark:bg-zinc-900 border-r border-zinc-100 dark:border-zinc-800
            flex flex-col overflow-y-auto
            transition-transform duration-300 ease-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
            style={{ top: "3.5rem" }}
          >
            <div className="px-3 py-4 space-y-0.5">
              {/* Root */}
              <button
                onClick={() => { setCurrentFolderId(null); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors
                  ${currentFolderId === null
                    ? "bg-[#007aff]/10 text-[#007aff] font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
              >
                <span className="text-base">🏠</span> Mijn bestanden
              </button>

              {/* Folder tree */}
              {folderTree.map((node) => (
                <FolderTreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  activeFolderId={currentFolderId}
                  onSelect={(id) => { setCurrentFolderId(id); setSidebarOpen(false); }}
                  onRename={handleRenameFolder}
                  onDelete={handleDeleteFolder}
                />
              ))}

              {/* Inline new folder input */}
              {newFolderInline && (
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <IconFolder color="#f59e0b" className="w-4 h-4 shrink-0" />
                  <input
                    ref={newFolderRef}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") { setNewFolderInline(false); setNewFolderName(""); }
                    }}
                    onBlur={handleCreateFolder}
                    placeholder="Mapnaam..."
                    className="flex-1 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1 border-0 focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 text-zinc-800 dark:text-zinc-100"
                  />
                </div>
              )}
            </div>
          </aside>
        </>

        {/* ── Main content ── */}
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto relative"
          onMouseDown={(e) => {
            // Only start drag-select on bare background (not on a card/button)
            const target = e.target as HTMLElement;
            if (target.closest("[data-doc-card]") || target.closest("button") || target.closest("a")) return;
            if (e.button !== 0) return;
            dragSelectRef.current = { startX: e.clientX, startY: e.clientY, active: true };
          }}
          onMouseMove={(e) => {
            if (!dragSelectRef.current.active) return;
            const { startX, startY } = dragSelectRef.current;
            const x = Math.min(e.clientX, startX);
            const y = Math.min(e.clientY, startY);
            const w = Math.abs(e.clientX - startX);
            const h = Math.abs(e.clientY - startY);
            if (w < 5 && h < 5) return; // dead zone
            setSelectionBox({ x, y, w, h });
            // Hit-test each card
            const newSelected = new Set<string>();
            cardRefs.current.forEach((el, id) => {
              const r = el.getBoundingClientRect();
              if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) {
                newSelected.add(id);
              }
            });
            if (newSelected.size > 0) setSelectedIds(newSelected);
          }}
          onMouseUp={() => {
            dragSelectRef.current.active = false;
            setSelectionBox(null);
          }}
          onMouseLeave={() => {
            dragSelectRef.current.active = false;
            setSelectionBox(null);
          }}
        >
          {/* Selection box overlay */}
          {selectionBox && (
            <div
              className="fixed pointer-events-none z-40 border-2 border-[#007aff] bg-[#007aff]/10 rounded-lg"
              style={{
                left: selectionBox.x,
                top: selectionBox.y,
                width: selectionBox.w,
                height: selectionBox.h,
              }}
            />
          )}
          <div className="max-w-4xl mx-auto px-4 py-5 space-y-5">

            {/* Breadcrumb */}
            <Breadcrumb
              folders={allFolders}
              currentFolderId={currentFolderId}
              onNavigate={(id) => setCurrentFolderId(id)}
            />

            {/* AI Suggestion */}
            {aiSuggestion && (
              <AISuggestionBar
                suggestion={aiSuggestion.suggestion}
                onAccept={async () => {
                  const folder = allFolders.find((f) => f.name === aiSuggestion.suggestion);
                  if (folder) await handleMove(aiSuggestion.doc, folder.id);
                  setAiSuggestion(null);
                }}
                onDismiss={() => setAiSuggestion(null)}
              />
            )}

            {/* Search results */}
            {search.trim() ? (
              <div className="space-y-3">
                <p className="text-xs text-zinc-400 font-medium">
                  {searchLoading ? "Zoeken..." : `${searchResults?.length ?? 0} resultaten voor "${search}"`}
                </p>
                {searchLoading ? (
                  <div className="flex justify-center py-12">
                    <IconSpinner className="w-7 h-7 text-[#007aff]" />
                  </div>
                ) : (searchResults ?? []).length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-center">
                    <span className="text-4xl opacity-30">🔍</span>
                    <p className="text-sm text-zinc-400">Geen bestanden gevonden</p>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-50 dark:divide-zinc-800">
                    {(searchResults ?? []).map((doc) => (
                      <div key={doc.id} className="relative">
                        <DocRow
                          doc={doc}
                          selected={selectedIds.has(doc.id)}
                          onPreview={setPreview}
                          onContextMenu={(e, d) => setContextMenu({ x: e.clientX, y: e.clientY, doc: d })}
                          onDragStart={handleDocDragStart}
                          onToggle={toggleSelect}
                        />
                        {doc.folder_name && (
                          <span className="absolute right-12 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hidden sm:block">
                            {doc.folder_name}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Upload area */}
                <UploadArea
                  currentFolderId={currentFolderId}
                  onUploaded={handleUploaded}
                />

                {/* Loading */}
                {loading ? (
                  <div className="flex justify-center py-12">
                    <IconSpinner className="w-7 h-7 text-[#007aff]" />
                  </div>
                ) : isEmpty ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-center">
                    <div className="w-20 h-20 rounded-3xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                      <span className="text-4xl">📂</span>
                    </div>
                    <p className="text-base font-semibold text-zinc-600 dark:text-zinc-400">Deze map is leeg</p>
                    <p className="text-sm text-zinc-400">Upload een bestand of maak een nieuwe map aan</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Sub-folders */}
                    {subFolders.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Mappen</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {subFolders.map((folder) => (
                            <div
                              key={folder.id}
                              onDragOver={(e) => { e.preventDefault(); setDragOverFolder(folder.id); }}
                              onDragLeave={() => setDragOverFolder(null)}
                              onDrop={(e) => handleFolderDrop(e, folder.id)}
                              onClick={() => setCurrentFolderId(folder.id)}
                              className={`flex flex-col items-center gap-2 p-4 rounded-2xl cursor-pointer transition-all select-none
                                ${dragOverFolder === folder.id
                                  ? "bg-[#007aff]/10 border-2 border-[#007aff] scale-[0.98]"
                                  : "bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:shadow-md active:scale-[0.97]"
                                }`}
                            >
                              <IconFolder color={folderColor(folder.color)} className="w-10 h-10" />
                              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 text-center leading-snug line-clamp-2">{folder.name}</p>
                              {folder.name === "Gedeeld met boekhouder" && (
                                <span className="text-[10px] bg-[#007aff]/10 text-[#007aff] px-1.5 py-0.5 rounded-md font-medium">Gedeeld</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Documents */}
                    {docs.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                          Bestanden — {docs.length}
                        </p>
                        {viewMode === "grid" ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {docs.map((doc) => (
                              <DocCard
                                key={doc.id}
                                doc={doc}
                                selected={selectedIds.has(doc.id)}
                                onPreview={setPreview}
                                onContextMenu={(e, d) => setContextMenu({ x: e.clientX, y: e.clientY, doc: d })}
                                onDragStart={handleDocDragStart}
                                onToggle={toggleSelect}
                                cardRef={(el) => {
                                  if (el) cardRefs.current.set(doc.id, el);
                                  else cardRefs.current.delete(doc.id);
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-50 dark:divide-zinc-800">
                            {docs.map((doc) => (
                              <DocRow
                                key={doc.id}
                                doc={doc}
                                selected={selectedIds.has(doc.id)}
                                onPreview={setPreview}
                                onContextMenu={(e, d) => setContextMenu({ x: e.clientX, y: e.clientY, doc: d })}
                                onDragStart={handleDocDragStart}
                                onToggle={toggleSelect}
                              />
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
    </div>
  );
}