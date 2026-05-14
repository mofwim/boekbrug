// app/dashboard/documents/DocumentsClient.tsx
// Document manager (BOEK-010) — upload, list, delete

"use client";

import { useState, useCallback, useRef } from "react";
import { InfiniteList } from "@/components/ui/InfiniteList";

interface Doc {
  id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  doc_type: string;
  period: string | null;
  created_at: string;
}

interface DocumentsClientProps {
  userId: string;
}

const PAGE_SIZE = 30;

export function DocumentsClient({ userId }: DocumentsClientProps) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursorRef.current) params.set("cursor", cursorRef.current);

    const res = await fetch(`/api/files?${params}`);
    const data = await res.json();

    const rows: Doc[] = data.documents ?? [];
    setDocs((prev) => {
      const ids = new Set(prev.map((d) => d.id));
      return [...prev, ...rows.filter((r) => !ids.has(r.id))];
    });
    if (rows.length < PAGE_SIZE || !data.hasMore) setHasMore(false);
    if (rows.length > 0) cursorRef.current = rows[rows.length - 1].created_at;
    setLoading(false);
  }, [loading, hasMore]);

  // Load on mount
  useState(() => { loadMore(); });

  async function uploadFiles(files: File[]) {
    setUploading(true);
    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);

    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      form.append("year", String(year));
      form.append("quarter", String(quarter));

      const res = await fetch("/api/files", { method: "POST", body: form });
      if (res.ok) {
        const { id } = await res.json();
        // Optimistic: add to top of list
        setDocs((prev) => [
          {
            id,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type,
            doc_type: "other",
            period: `${year}-Q${quarter}`,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    }
    setUploading(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files);
  }

  async function handleDelete(doc: Doc) {
    if (!confirm(`"${doc.file_name}" verwijderen?`)) return;
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    await fetch(`/api/files/${doc.id}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver ? "border-foreground bg-muted/50" : "border-muted-foreground/30 hover:border-foreground/50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.xlsx,.csv,.xml,.jpg,.jpeg,.png,.webp,.heic,.tiff,.eml,.zip"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) uploadFiles(files);
            e.target.value = "";
          }}
        />
        <div className="text-3xl mb-2">📂</div>
        <p className="text-sm font-medium">
          {uploading ? "Uploaden…" : "Sleep bestanden hierheen of klik"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, Word, Excel, CSV, XML, afbeeldingen, e-mail — max 25MB
        </p>
      </div>

      {/* File list */}
      <InfiniteList onLoadMore={loadMore} hasMore={hasMore} loading={loading}>
        {docs.length === 0 && !loading ? (
          <p className="text-center text-muted-foreground py-12 text-sm">
            Nog geen documenten geüpload
          </p>
        ) : (
          <div className="border rounded-lg divide-y overflow-hidden">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <FileIcon type={doc.file_type} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.period ?? ""} · {formatSize(doc.file_size)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(doc)}
                  className="text-muted-foreground hover:text-red-600 transition-colors p-1"
                  title="Verwijderen"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </InfiniteList>
    </div>
  );
}

function FileIcon({ type }: { type: string }) {
  const emoji =
    type.startsWith("image/") ? "🖼️" :
    type === "application/pdf" ? "📄" :
    type.includes("excel") || type.includes("spreadsheet") ? "📊" :
    type.includes("word") || type.includes("document") ? "📝" :
    type === "message/rfc822" ? "📧" :
    type === "application/zip" ? "🗜️" :
    "📁";

  return <span className="text-lg shrink-0">{emoji}</span>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
