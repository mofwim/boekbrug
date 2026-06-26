// app/dashboard/documents/DocumentsClient.tsx
// [BOEK-010] Full rewrite — iOS mobile-first design, clientId support, download, back button
// Accountant mode: ?clientId= → shows shared folder of that client (read-only)

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { InfiniteList } from "@/components/ui/InfiniteList";
import { inferDocType } from "@/lib/documents-utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface Doc {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  doc_type: string | null;
  period: string | null;
  year: number | null;
  notes: string | null;
  created_at: string;
}

type Tab = "private" | "shared";

interface FilterState {
  year: string;
  quarter: string;
  docType: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 30;
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_QUARTER = Math.ceil((new Date().getMonth() + 1) / 3);

const DOC_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  image: "Afbeelding",
  spreadsheet: "Spreadsheet",
  document: "Document",
  csv: "CSV",
  xml: "XML",
  email: "E-mail",
  archive: "Archief",
  other: "Overig",
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fileIcon(type: string): string {
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

// ─── Preview Modal ───────────────────────────────────────────────────────────────

function PreviewModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(true);

  useEffect(() => {
    fetch(`/api/files/${doc.id}/url`)
      .then((r) => r.json())
      .then(({ url }) => setSignedUrl(url))
      .catch(() => setSignedUrl(null))
      .finally(() => setLoadingUrl(false));
  }, [doc.id]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const canPreview = doc.file_type.startsWith("image/") || doc.file_type === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 w-full sm:w-auto sm:min-w-[520px] sm:max-w-3xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ marginBottom: 0 }}
      >
        {/* iOS-style drag handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="text-2xl mt-0.5 shrink-0">{fileIcon(doc.file_type)}</div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 leading-snug break-all line-clamp-2">
              {doc.file_name}
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
              {formatSize(doc.file_size)} · {doc.period ?? ""} · {formatDate(doc.created_at)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-lg leading-none mt-0.5"
            aria-label="Sluiten"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4 min-h-[220px]">
          {loadingUrl ? (
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : !canPreview || !signedUrl ? (
            <div className="text-center space-y-4 py-6">
              <div className="text-6xl">{fileIcon(doc.file_type)}</div>
              <p className="text-sm text-zinc-400">Preview niet beschikbaar</p>
              {signedUrl && (
                <a
                  href={signedUrl}
                  download={doc.file_name}
                  className="inline-flex items-center gap-1.5 text-sm px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 active:scale-95 transition-all"
                >
                  <DownloadIcon className="w-4 h-4" /> Downloaden
                </a>
              )}
            </div>
          ) : doc.file_type.startsWith("image/") ? (
            <img
              src={signedUrl}
              alt={doc.file_name}
              className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-md"
            />
          ) : (
            <iframe
              src={signedUrl}
              className="w-full h-[58vh] rounded-xl border-0"
              title={doc.file_name}
            />
          )}
        </div>

        {/* Footer — download + notes */}
        <div className="px-5 py-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-3 shrink-0">
          {signedUrl && (
            <a
              href={signedUrl}
              download={doc.file_name}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 active:scale-[0.98] transition-all"
            >
              <DownloadIcon className="w-4 h-4" /> Downloaden
            </a>
          )}
          {signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-2xl hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-[0.98] transition-all"
            >
              Openen ↗
            </a>
          )}
        </div>

        {doc.notes && (
          <div className="px-5 pb-5 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="font-medium text-zinc-600 dark:text-zinc-300">Notitie:</span> {doc.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────────

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  );
}

// ─── Upload Zone ─────────────────────────────────────────────────────────────────

function UploadZone({
  shared,
  onUploaded,
}: {
  shared: boolean;
  onUploaded: (doc: Doc) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // [BESTANDEN-DUP] duplicate confirmation modal — Mijn bestanden is the user's
  // own space; a duplicate is a "are you sure?" decision, not a hard block.
  const [dupModal, setDupModal] = useState<{
    file: File;
    where: string;
    folderPath: string[];
  } | null>(null);

  function emitUploaded(file: File, id: string) {
    onUploaded({
      id,
      file_name: file.name,
      file_url: "",
      file_size: file.size,
      file_type: file.type,
      doc_type: inferDocType(file.type),
      period: `${CURRENT_YEAR}-Q${CURRENT_QUARTER}`,
      year: CURRENT_YEAR,
      notes: null,
      created_at: new Date().toISOString(),
    });
  }

  // Upload a single file. Returns 'duplicate' (with details) / 'ok' / 'error'.
  async function uploadOne(
    file: File,
    allowDuplicate: boolean
  ): Promise<{ status: "ok" | "duplicate" | "error"; json: Record<string, unknown> }> {
    const form = new FormData();
    form.append("file", file);
    form.append("year", String(CURRENT_YEAR));
    form.append("quarter", String(CURRENT_QUARTER));
    if (shared) form.append("shared", "true");
    if (allowDuplicate) form.append("allowDuplicate", "true");

    const res = await fetch("/api/files", { method: "POST", body: form });
    const json = await res.json();
    if (res.status === 409 && json.duplicate) return { status: "duplicate", json };
    if (!res.ok) return { status: "error", json };
    return { status: "ok", json };
  }

  async function processFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setErrors([]);
    const errs: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (files.length > 1) setProgress(`${i + 1} / ${files.length}`);

      const r = await uploadOne(file, false);
      if (r.status === "ok") {
        emitUploaded(file, r.json.id as string);
      } else if (r.status === "duplicate") {
        // [BESTANDEN-DUP] Stop and ask — show where the file already lives. The
        // user confirms (upload again) or cancels via the modal. We surface one
        // at a time; remaining files in a multi-select aren't auto-forced.
        const existing = (r.json.existing ?? {}) as { folder_path?: string[] };
        setDupModal({
          file,
          where: (r.json.error as string) ?? "Dit bestand bestaat al",
          folderPath: existing.folder_path ?? [],
        });
      } else {
        errs.push(`${file.name}: ${(r.json.error as string) ?? "Upload mislukt"}`);
      }
    }

    setErrors(errs);
    setProgress("");
    setUploading(false);
  }

  // [BESTANDEN-DUP] User confirmed "upload again" → re-send with allowDuplicate.
  async function confirmUploadAgain() {
    if (!dupModal) return;
    const file = dupModal.file;
    setDupModal(null);
    setUploading(true);
    try {
      const r = await uploadOne(file, true);
      if (r.status === "ok") emitUploaded(file, r.json.id as string);
      else setErrors((e) => [...e, `${file.name}: ${(r.json.error as string) ?? "Upload mislukt"}`]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.doc,.docx,.xls,.xlsx,.csv,.xml,.eml,.zip"
        className="hidden"
        onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          processFiles(Array.from(e.dataTransfer.files));
        }}
        className={`
          w-full flex flex-col items-center gap-2 px-4 py-6 rounded-2xl border-2 border-dashed transition-all
          ${dragOver
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
            : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
          }
          ${uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer active:scale-[0.99]"}
        `}
      >
        {uploading ? (
          <>
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">{progress || "Uploaden..."}</p>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
              <UploadIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Tap om te uploaden
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">of sleep bestanden hierheen</p>
            </div>
          </>
        )}
      </button>

      {errors.length > 0 && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
          ))}
        </div>
      )}

      {/* [BESTANDEN-DUP] Duplicate confirmation — warn, don't block. Tells the
          user WHERE the file already lives and lets them upload again anyway. */}
      {dupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => setDupModal(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">
              Dit bestand bestaat al
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1 leading-relaxed">
              {dupModal.file.name}
            </p>
            {dupModal.folderPath.length > 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6 leading-relaxed">
                Staat al in: <span className="font-medium">{dupModal.folderPath.join(" / ")}</span>
              </p>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">{dupModal.where}</p>
            )}

            <button
              onClick={confirmUploadAgain}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-full py-3.5 font-semibold text-sm mb-2.5 transition-colors"
            >
              Toch opnieuw uploaden
            </button>
            <button
              onClick={() => setDupModal(null)}
              className="w-full text-zinc-500 dark:text-zinc-400 rounded-full py-3 font-semibold text-sm"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Doc Row ─────────────────────────────────────────────────────────────────────

function DocRow({
  doc,
  readOnly,
  onDelete,
  onPreview,
}: {
  doc: Doc;
  readOnly: boolean;
  onDelete: (d: Doc) => void;
  onPreview: (d: Doc) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    setDownloading(true);
    try {
      const res = await fetch(`/api/files/${doc.id}/url`);
      const { url } = await res.json();
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.file_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await fetch(`/api/files/${doc.id}`, { method: "DELETE" });
      if (res.ok) onDelete(doc);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5 active:bg-zinc-50 dark:active:bg-zinc-800/50 transition-colors cursor-pointer"
      onClick={() => onPreview(doc)}
    >
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xl">
        {fileIcon(doc.file_type)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate leading-snug">
          {doc.file_name}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-zinc-400">{formatDate(doc.created_at)}</span>
          <span className="text-xs text-zinc-300 dark:text-zinc-600">·</span>
          <span className="text-xs text-zinc-400">{formatSize(doc.file_size)}</span>
          {doc.doc_type && doc.doc_type !== "other" && (
            <>
              <span className="text-xs text-zinc-300 dark:text-zinc-600">·</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Download */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          title="Downloaden"
          aria-label="Downloaden"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors active:scale-90"
        >
          {downloading
            ? <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            : <DownloadIcon className="w-4 h-4" />
          }
        </button>

        {/* Delete — only if not read-only */}
        {!readOnly && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            title={confirmDelete ? "Nogmaals tikken om te bevestigen" : "Verwijderen"}
            aria-label="Verwijderen"
            className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all active:scale-90 ${
              confirmDelete
                ? "bg-red-500 text-white"
                : "text-zinc-300 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            }`}
          >
            {deleting
              ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <TrashIcon className="w-4 h-4" />
            }
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Doc List ────────────────────────────────────────────────────────────────────

function DocList({
  tab,
  filters,
  clientId,
  readOnly,
}: {
  tab: Tab;
  filters: FilterState;
  clientId: string | null;
  readOnly: boolean;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [preview, setPreview] = useState<Doc | null>(null);

  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const f = filtersRef.current;
    const p = new URLSearchParams({ limit: String(PAGE_SIZE) });

    // [BOEK-010] If clientId → accountant viewing a client's shared folder
    if (clientId) {
      p.set("clientId", clientId);
      p.set("shared", "true");
    } else {
      if (tab === "shared") p.set("shared", "true");
    }

    if (f.year) p.set("year", f.year);
    if (f.year && f.quarter) p.set("quarter", f.quarter);
    if (f.docType) p.set("doc_type", f.docType);
    if (cursorRef.current) p.set("cursor", cursorRef.current);

    try {
      const res = await fetch(`/api/files?${p}`);
      const data = await res.json();
      const rows: Doc[] = data.documents ?? [];

      setDocs((prev) => {
        const ids = new Set(prev.map((d) => d.id));
        return [...prev, ...rows.filter((r) => !ids.has(r.id))];
      });

      if (rows.length < PAGE_SIZE || !data.hasMore) setHasMore(false);
      if (rows.length > 0) cursorRef.current = rows[rows.length - 1].created_at;
    } catch {
      // silent fail — keep existing docs
    }

    loadingRef.current = false;
    setLoading(false);
  }, [tab, clientId]);

  // Reset on tab/filter change
  useEffect(() => {
    cursorRef.current = null;
    setDocs([]);
    setHasMore(true);
    loadingRef.current = false;
    setTimeout(() => loadMore(), 0);
  }, [tab, filters]); // eslint-disable-line

  const emptyLabel = clientId
    ? "Deze klant heeft nog geen gedeelde documenten"
    : tab === "shared"
    ? "Nog geen gedeelde documenten"
    : "Nog geen privé documenten";

  return (
    <>
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}

      {/* Upload zone — only shown if not read-only */}
      {!readOnly && (
        <UploadZone
          shared={tab === "shared"}
          onUploaded={(doc) => setDocs((prev) => [doc, ...prev])}
        />
      )}

      {!loading && docs.length > 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 px-1">
          {docs.length}{!hasMore ? "" : "+"} {docs.length === 1 ? "bestand" : "bestanden"}
        </p>
      )}

      <InfiniteList onLoadMore={loadMore} hasMore={hasMore} loading={loading}>
        {docs.length === 0 && !loading ? (
          <div className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="text-4xl opacity-40">📂</div>
            <p className="text-sm text-zinc-400">{emptyLabel}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
            {docs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                readOnly={readOnly}
                onDelete={(d) => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                onPreview={setPreview}
              />
            ))}
          </div>
        )}
      </InfiniteList>
    </>
  );
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }: { filters: FilterState; onChange: (f: FilterState) => void }) {
  const hasFilter = filters.year || filters.quarter || filters.docType;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
      <select
        value={filters.year}
        onChange={(e) => onChange({ ...filters, year: e.target.value, quarter: "" })}
        className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
      >
        <option value="">Alle jaren</option>
        {Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i).map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      {filters.year && (
        <select
          value={filters.quarter}
          onChange={(e) => onChange({ ...filters, quarter: e.target.value })}
          className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
        >
          <option value="">Alle kwartalen</option>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </select>
      )}

      <select
        value={filters.docType}
        onChange={(e) => onChange({ ...filters, docType: e.target.value })}
        className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
      >
        <option value="">Alle types</option>
        {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>

      {hasFilter && (
        <button
          onClick={() => onChange({ year: "", quarter: "", docType: "" })}
          className="text-xs text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap shrink-0 px-1 py-1"
        >
          Wis filters
        </button>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────

export function DocumentsClient({ clientName }: { clientName?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // [BOEK-010] clientId support — accountant views a specific client's shared docs
  const clientId = searchParams.get("clientId") ?? null;

  // If clientId is set → accountant mode → always show shared tab + read-only
  const isAccountantMode = !!clientId;

  const [tab, setTab] = useState<Tab>(isAccountantMode ? "shared" : "private");
  const [filters, setFilters] = useState<FilterState>({ year: "", quarter: "", docType: "" });

  // In accountant mode the list is read-only (no upload, no delete)
  const readOnly = isAccountantMode;

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      {/* ── Top navigation bar ── */}
      <div className="sticky top-0 z-30 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3 px-4 h-14 max-w-2xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-all -ml-1 shrink-0"
            aria-label="Terug"
          >
            <BackIcon className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
              {isAccountantMode && clientName
                ? `Documenten — ${clientName}`
                : "Documenten"}
            </h1>
            {isAccountantMode && (
              <p className="text-xs text-zinc-400 leading-tight">Gedeelde bestanden — alleen lezen</p>
            )}
          </div>
        </div>

        {/* Tabs — only shown when NOT in accountant mode */}
        {!isAccountantMode && (
          <div className="flex border-t border-zinc-100 dark:border-zinc-800 max-w-2xl mx-auto">
            {(["private", "shared"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                }`}
              >
                {t === "private" ? "🔒 Privé" : "📤 Gedeeld"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {/* Info banners */}
        {!isAccountantMode && tab === "shared" && (
          <div className="flex items-start gap-2 text-xs bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-2xl px-4 py-3">
            <span className="shrink-0 mt-0.5">ℹ️</span>
            <span>Bestanden in dit tabblad zijn zichtbaar voor jouw gekoppelde accountant.</span>
          </div>
        )}

        {isAccountantMode && (
          <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-2xl px-4 py-3">
            <span className="shrink-0 mt-0.5">👁️</span>
            <span>
              Je bekijkt de gedeelde documenten van{" "}
              <strong>{clientName ?? "deze klant"}</strong>. Uploaden en verwijderen is niet mogelijk.
            </span>
          </div>
        )}

        {/* Filters */}
        <FilterBar filters={filters} onChange={setFilters} />

        {/* List */}
        <DocList
          key={`${tab}-${clientId ?? "me"}`}
          tab={tab}
          filters={filters}
          clientId={clientId}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}