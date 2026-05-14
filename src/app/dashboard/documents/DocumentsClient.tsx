// app/dashboard/documents/DocumentsClient.tsx
// BOEK-010 — upload, list, filter, preview, delete
// Tabs: Privé (ZZP only) | Gedeeld (ZZP + accountant)

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { InfiniteList } from "@/components/ui/InfiniteList";
import { inferDocType } from "@/lib/documents-utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

function fileEmoji(type: string): string {
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

// ─── Preview Modal ──────────────────────────────────────────────────────────────

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <span className="text-2xl">{fileEmoji(doc.file_type)}</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{doc.file_name}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(doc.file_size)} · {doc.period ?? ""} · {formatDate(doc.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                Openen ↗
              </a>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xl leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-muted/30 flex items-center justify-center p-4 min-h-[300px]">
          {loadingUrl ? (
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : !canPreview || !signedUrl ? (
            <div className="text-center space-y-3">
              <div className="text-5xl">{fileEmoji(doc.file_type)}</div>
              <p className="text-sm text-muted-foreground">Preview niet beschikbaar</p>
              {signedUrl && (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  Downloaden
                </a>
              )}
            </div>
          ) : doc.file_type.startsWith("image/") ? (
            <img
              src={signedUrl}
              alt={doc.file_name}
              className="max-w-full max-h-[65vh] object-contain rounded-lg shadow"
            />
          ) : (
            <iframe
              src={signedUrl}
              className="w-full h-[65vh] rounded-lg border-0"
              title={doc.file_name}
            />
          )}
        </div>

        {doc.notes && (
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground shrink-0">
            <span className="font-medium text-foreground">Notitie:</span> {doc.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Upload Zone ────────────────────────────────────────────────────────────────

function UploadZone({
  shared,
  onUploaded,
}: {
  shared: boolean;
  onUploaded: (doc: Doc) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function processFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setErrors([]);
    const errs: string[] = [];

    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      form.append("year", String(CURRENT_YEAR));
      form.append("quarter", String(CURRENT_QUARTER));
      if (shared) form.append("shared", "true");

      const res = await fetch("/api/files", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) {
        errs.push(`${file.name}: ${json.error ?? "Upload mislukt"}`);
      } else {
        onUploaded({
          id: json.id,
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
    }

    if (errs.length) setErrors(errs);
    setUploading(false);
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); processFiles(Array.from(e.dataTransfer.files)); }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-150
          ${uploading ? "opacity-60 cursor-wait" : "cursor-pointer"}
          ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.xlsx,.csv,.xml,.jpg,.jpeg,.png,.webp,.heic,.tiff,.eml,.zip"
          onChange={(e) => { processFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        <div className="text-3xl mb-2">{uploading ? "⏳" : shared ? "📤" : "📂"}</div>
        <p className="text-sm font-medium">
          {uploading
            ? "Uploaden…"
            : shared
            ? "Sleep bestanden om te delen met je accountant"
            : "Sleep bestanden hierheen of klik"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, Word, Excel, CSV, XML, afbeeldingen, e-mail — max 25 MB
        </p>
      </div>

      {errors.map((err, i) => (
        <p key={i} className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {err}
        </p>
      ))}
    </div>
  );
}

// ─── Doc Row ────────────────────────────────────────────────────────────────────

function DocRow({
  doc,
  onDelete,
  onPreview,
}: {
  doc: Doc;
  onDelete: (doc: Doc) => void;
  onPreview: (doc: Doc) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await fetch(`/api/files/${doc.id}`, { method: "DELETE" });
    onDelete(doc);
  }

  return (
    <div className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
      <button onClick={() => onPreview(doc)} className="text-lg shrink-0 hover:scale-110 transition-transform" title="Preview">
        {fileEmoji(doc.file_type)}
      </button>

      <div className="flex-1 min-w-0">
        <button
          onClick={() => onPreview(doc)}
          className="text-sm font-medium truncate block hover:text-primary transition-colors text-left w-full"
        >
          {doc.file_name}
        </button>
        <p className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
          <span>{doc.period ?? "—"}</span>
          <span>{formatSize(doc.file_size)}</span>
          <span>{formatDate(doc.created_at)}</span>
          {doc.doc_type && doc.doc_type !== "other" && (
            <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
              {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={handleDelete}
          disabled={deleting}
          title={confirmDelete ? "Nogmaals klikken om te bevestigen" : "Verwijderen"}
          className={`p-1.5 rounded-lg transition-colors ${
            confirmDelete ? "bg-red-500 text-white hover:bg-red-600" : "text-muted-foreground hover:text-red-500 hover:bg-red-50"
          }`}
        >
          {deleting ? (
            <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Doc List (infinite scroll per tab) ────────────────────────────────────────

function DocList({ tab, filters }: { tab: Tab; filters: FilterState }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [preview, setPreview] = useState<Doc | null>(null);

  const cursorRef   = useRef<string | null>(null);
  const loadingRef  = useRef(false);
  const filtersRef  = useRef(filters);
  filtersRef.current = filters;

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const f = filtersRef.current;
    const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (tab === "shared") p.set("shared", "true");
    if (f.year)    p.set("year",     f.year);
    if (f.year && f.quarter) p.set("quarter", f.quarter);
    if (f.docType) p.set("doc_type", f.docType);
    if (cursorRef.current) p.set("cursor", cursorRef.current);

    const res  = await fetch(`/api/files?${p}`);
    const data = await res.json();
    const rows: Doc[] = data.documents ?? [];

    setDocs((prev) => {
      const ids = new Set(prev.map((d) => d.id));
      return [...prev, ...rows.filter((r) => !ids.has(r.id))];
    });

    if (rows.length < PAGE_SIZE || !data.hasMore) setHasMore(false);
    if (rows.length > 0) cursorRef.current = rows[rows.length - 1].created_at;
    loadingRef.current = false;
    setLoading(false);
  }, [tab]);

  // Reset on tab or filter change
  useEffect(() => {
    cursorRef.current = null;
    setDocs([]);
    setHasMore(true);
    loadingRef.current = false;
    setTimeout(() => loadMore(), 0);
  }, [tab, filters]); // eslint-disable-line

  return (
    <>
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}

      <UploadZone
        shared={tab === "shared"}
        onUploaded={(doc) => setDocs((prev) => [doc, ...prev])}
      />

      {!loading && docs.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4">
          {docs.length}{!hasMore ? "" : "+"} {docs.length === 1 ? "bestand" : "bestanden"}
        </p>
      )}

      <div className="mt-3">
        <InfiniteList onLoadMore={loadMore} hasMore={hasMore} loading={loading}>
          {docs.length === 0 && !loading ? (
            <p className="text-center text-muted-foreground py-12 text-sm">
              {tab === "shared"
                ? "Nog geen gedeelde documenten"
                : "Nog geen privé documenten"}
            </p>
          ) : (
            <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
              {docs.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onDelete={(d) => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                  onPreview={setPreview}
                />
              ))}
            </div>
          )}
        </InfiniteList>
      </div>
    </>
  );
}

// ─── Filter Bar ─────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }: { filters: FilterState; onChange: (f: FilterState) => void }) {
  const hasFilter = filters.year || filters.quarter || filters.docType;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={filters.year}
        onChange={(e) => onChange({ ...filters, year: e.target.value, quarter: "" })}
        className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Alle kwartalen</option>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
        </select>
      )}

      <select
        value={filters.docType}
        onChange={(e) => onChange({ ...filters, docType: e.target.value })}
        className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Alle types</option>
        {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>

      {hasFilter && (
        <button
          onClick={() => onChange({ year: "", quarter: "", docType: "" })}
          className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
        >
          Wis filters
        </button>
      )}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────────

export function DocumentsClient() {
  const [tab, setTab]         = useState<Tab>("private");
  const [filters, setFilters] = useState<FilterState>({ year: "", quarter: "", docType: "" });

  return (
    <div className="space-y-5">
      {/* Tabs: Privé | Gedeeld */}
      <div className="flex border-b border-border">
        {(["private", "shared"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "private" ? "🔒 Privé" : "📤 Gedeeld met accountant"}
          </button>
        ))}
      </div>

      {/* Info banner for shared tab */}
      {tab === "shared" && (
        <div className="text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-2">
          Bestanden hier zijn zichtbaar voor jouw gekoppelde accountant.
        </div>
      )}

      {/* Filters */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* List — remounts per tab to keep separate state */}
      <DocList key={tab} tab={tab} filters={filters} />
    </div>
  );
}