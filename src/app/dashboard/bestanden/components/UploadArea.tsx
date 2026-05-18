"use client";
// src/app/dashboard/bestanden/components/UploadArea.tsx
// [BOEK-033] Multi-file upload — sequential, silent AI, user-visible errors

import { useState, useRef, useCallback, DragEvent } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { Spinner } from "./ui/Spinner";
import { BestandRow } from "../types";

interface UploadAreaProps {
  currentFolderId: string | null;
  onUploaded: (doc: BestandRow) => void;
}

interface FailedFile {
  name: string;
  reason: string;
}

export function UploadArea({ currentFolderId, onUploaded }: UploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentFileIdx, setCurrentFileIdx] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [progress, setProgress] = useState(0);
  const [failedFiles, setFailedFiles] = useState<FailedFile[]>([]);

  const uploadSingleFile = useCallback(async (file: File): Promise<void> => {
    const now = new Date();
    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", String(now.getFullYear()));
    fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
    if (currentFolderId) fd.append("folder_id", currentFolderId);

    setProgress(20);
    const res = await fetch("/api/files", { method: "POST", body: fd });
    const json = await res.json() as { id?: string; error?: string };
    if (!json.id) throw new Error(json.error ?? "Upload mislukt");

    setProgress(60);

    // [BOEK-033] Silent AI — no popup, places file automatically
    try {
      const cr = await fetch("/api/bestanden/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: json.id, fileName: file.name }),
      });
      if (cr.ok) {
        const result = await cr.json() as { folderId: string | null; confidence?: number; type: string };
        if (result.folderId && result.type !== "unknown" && (result.confidence ?? 1) >= 0.7) {
          await fetch(`/api/bestanden?id=${json.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_id: result.folderId }),
          });
        }
      }
    } catch { /* AI failed silently */ }

    setProgress(90);
    const dr = await fetch(`/api/files/${json.id}`);
    const dj = await dr.json() as { document?: BestandRow };
    setProgress(100);

    onUploaded(dj.document ?? {
      id: json.id, file_name: file.name, file_url: "",
      file_size: file.size, file_type: file.type,
      doc_type: null, period: null, year: now.getFullYear(),
      notes: null, invoice_id: null, created_at: now.toISOString(),
      folder_id: currentFolderId, ai_processed: false,
      ai_doc_type: null, ai_suggested_folder: null, source: "upload",
    });
  }, [currentFolderId, onUploaded]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const fileArray = Array.from(files);
    setUploading(true);
    setTotalFiles(fileArray.length);
    setFailedFiles([]);
    const failed: FailedFile[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      setCurrentFileIdx(i + 1);
      setProgress(0);
      try {
        await uploadSingleFile(fileArray[i]);
      } catch (err) {
        failed.push({
          name: fileArray[i].name,
          reason: err instanceof Error ? err.message : "Onbekende fout",
        });
      }
    }

    setUploading(false);
    setProgress(0);
    setCurrentFileIdx(0);
    setTotalFiles(0);
    if (failed.length > 0) setFailedFiles(failed);
  }, [uploadSingleFile]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

      {uploading ? (
        <div style={{
          border: `2px dashed ${T.primary}`, borderRadius: T.lg, padding: 24,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          background: T.primaryContainer,
        }}>
          <Spinner size={32} />
          <p style={{ fontSize: 14, color: T.primary, margin: 0, fontWeight: 500 }}>
            {totalFiles > 1 ? `${currentFileIdx} van ${totalFiles} geüpload` : "Uploaden..."}
          </p>
          {/* Per-file progress */}
          <div style={{ width: "100%", height: 4, background: T.surfaceVariant, borderRadius: T.full, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: T.primary, borderRadius: T.full, transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)" }} />
          </div>
          {/* Overall batch progress */}
          {totalFiles > 1 && (
            <div style={{ width: "100%", height: 2, background: T.surfaceVariant, borderRadius: T.full, overflow: "hidden" }}>
              <div style={{
                width: `${((currentFileIdx - 1) / totalFiles) * 100}%`,
                height: "100%", background: `${T.primary}55`,
                borderRadius: T.full, transition: "width 0.3s",
              }} />
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? T.primary : T.outline}`,
            borderRadius: T.lg, padding: "20px 16px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            cursor: "pointer",
            background: dragging ? T.primaryContainer : "transparent",
            transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <div style={{ width: 44, height: 44, borderRadius: T.lg, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="upload" size={22} color={T.primary} />
          </div>
          <p style={{ fontSize: 14, fontWeight: 500, color: T.onSurface, margin: 0 }}>
            {dragging ? "Loslaten om te uploaden" : "Sleep bestanden of tik om te uploaden"}
          </p>
          <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>
            Alle bestandstypen — max 50MB · meerdere bestanden tegelijk
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* [BOEK-033] Failed files — shown to user with actual error reason */}
      {failedFiles.length > 0 && (
        <div style={{ borderRadius: T.md, overflow: "hidden", border: `1px solid ${T.errorContainer}` }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 14px", background: T.errorContainer,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="error" size={16} color={T.error} />
              <span style={{ fontSize: 13, fontWeight: 600, color: T.error }}>
                {failedFiles.length} bestand{failedFiles.length > 1 ? "en" : ""} niet geüpload
              </span>
            </div>
            <button onClick={() => setFailedFiles([])}
              style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}>
              <Icon name="close" size={16} color={T.error} />
            </button>
          </div>
          {failedFiles.map((f, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "8px 14px",
              borderTop: `1px solid ${T.errorContainer}`,
              background: "white",
            }}>
              <Icon name="insert_drive_file" size={16} color={T.outline} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: T.onSurface, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </p>
                <p style={{ fontSize: 12, color: T.error, margin: 0 }}>
                  {f.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}