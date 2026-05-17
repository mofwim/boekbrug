"use client";
// src/app/dashboard/bestanden/components/UploadArea.tsx
// [BOEK-033] Drop zone + progress bar for file uploads

import { useState, useRef, useCallback, DragEvent } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { Spinner } from "./ui/Spinner";
import { BestandRow } from "../types";

interface UploadAreaProps {
  currentFolderId: string | null;
  onUploaded: (doc: BestandRow) => void;
}

export function UploadArea({ currentFolderId, onUploaded }: UploadAreaProps) {
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
        onUploaded(dj.document ?? {
          id: json.id!, file_name: file.name, file_url: "",
          file_size: file.size, file_type: file.type,
          doc_type: null, period: null, year: now.getFullYear(),
          notes: null, invoice_id: null, created_at: now.toISOString(),
          folder_id: currentFolderId, ai_processed: false,
          ai_doc_type: null, ai_suggested_folder: null, source: "upload",
        });
      }, 350);
    } catch {
      setUploading(false); setProgress(0);
      alert("Upload mislukt. Probeer opnieuw.");
    }
  }, [currentFolderId, onUploaded]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  if (uploading) return (
    <div style={{
      border: `2px dashed ${T.primary}`, borderRadius: T.lg, padding: 24,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
      background: T.primaryContainer,
    }}>
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
        {dragging ? "Loslaten om te uploaden" : "Sleep een bestand of tik om te uploaden"}
      </p>
      <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>PDF, afbeelding, Excel, Word — max 25MB</p>
      <input
        ref={inputRef} type="file" style={{ display: "none" }}
        onChange={e => handleFiles(e.target.files)}
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tiff,.doc,.docx,.xls,.xlsx,.csv,.xml,.zip,.eml"
      />
    </div>
  );
}