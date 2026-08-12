"use client";
// src/app/dashboard/bestanden/components/UploadArea.tsx
// [BOEK-033] Multi-file upload — sequential, silent AI, user-visible errors

import { useState, useRef, useEffect, useCallback, DragEvent } from "react";
import { useRouter } from "next/navigation";
// [UPLOAD-PLAFOND] Fit a document to the upload budget and survive a platform 413 — upload-fit.ts.
import { sendWithFit } from "@/lib/upload-fit";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { Spinner } from "./ui/Spinner";
import { BestandRow } from "../types";
// [TAAL] A component holds no language of its own.
import { useLocale } from "@/lib/i18n/use-locale";
import { translator } from "@/lib/i18n/t";

interface UploadAreaProps {
  currentFolderId: string | null;
  onUploaded: (doc: BestandRow) => void;
}

interface FailedFile {
  name: string;
  reason: string;
  // [BRIDGE-EXTRACT] When the failure is a duplicate, this points to the
  // existing copy so we can render a link straight to it.
  existing?: {
    id: string;
    file_name: string;
    folder_id: string | null;       // [BESTANDEN-DUP] target for "open de map"
    folder_name: string | null;
    folder_path: string[];
  };
}

export function UploadArea({ currentFolderId, onUploaded }: UploadAreaProps) {
  const t = translator(useLocale());
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // [F#8] Guard against setState after unmount (navigating away mid-upload). React 19
  // swallows the warning, but this keeps the batch-completion updates from firing into
  // a torn-down component.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentFileIdx, setCurrentFileIdx] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [progress, setProgress] = useState(0);
  const [failedFiles, setFailedFiles] = useState<FailedFile[]>([]);

  const uploadSingleFile = useCallback(async (file: File): Promise<void> => {
    const now = new Date();
    setProgress(20);
    // [UPLOAD-PLAFOND] Mijn bestanden takes whatever the owner has — including the 8 MB scan the
    // platform refuses before our route sees it. Fitted like every other document path.
    const { response: res } = await sendWithFit(file, (f) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("year", String(now.getFullYear()));
      fd.append("quarter", String(Math.ceil((now.getMonth() + 1) / 3)));
      if (currentFolderId) fd.append("folder_id", currentFolderId);
      return fetch("/api/files", { method: "POST", body: fd });
    });
    const json = await res.json() as {
      id?: string;
      error?: string;
      duplicate?: boolean;
      existing?: FailedFile["existing"];
    };
    if (!json.id) {
      // [BRIDGE-EXTRACT] Duplicate (409) carries `existing` → surface it so the
      // catch can render a link to the file that's already there.
      const e = new Error(json.error ?? t("bst.uploadMislukt")) as Error & {
        existing?: FailedFile["existing"];
      };
      if (json.duplicate && json.existing) e.existing = json.existing;
      throw e;
    }

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
        const e = err as Error & { existing?: FailedFile["existing"] };
        failed.push({
          name: fileArray[i].name,
          reason: e instanceof Error ? e.message : t("bst.onbekendeFout"),
          existing: e?.existing,
        });
      }
    }

    if (!mountedRef.current) return; // [F#8] component gone — don't touch state
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

  // [BRIDGE-EXTRACT] Open the existing duplicate in a new tab via signed URL —
  // same mechanism as the file list's download/preview (/api/files/[id]/url).
  // [BESTANDEN-DUP] Open the FOLDER that contains the existing file (not the
  // file itself) and FOCUS it — BestandenPage reads ?folder={id}&focus={docId}
  // from the URL on load: opens the folder, scrolls to + highlights the file.
  // [INSTANT] router.push, not window.location.href — this is a navigation
  // WITHIN the page that is already open, so a full document reload threw away
  // everything just to change two query parameters. BestandenPage already
  // handles the soft case: it re-reads ?folder=/?focus= from an effect
  // precisely because a client navigation does not re-run its useState
  // initializers (see the comment above that effect).
  const openExistingFolder = useCallback((folderId: string | null, docId: string) => {
    const base = folderId
      ? `/dashboard/bestanden?folder=${folderId}`
      : `/dashboard/bestanden?folder=`;
    router.push(`${base}&focus=${docId}`);
  }, [router]);

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
                // [F#7] Include the current file's own progress so the batch bar
                // actually reaches 100% on the last file (was capped at (N-1)/N).
                width: `${(((currentFileIdx - 1) + progress / 100) / totalFiles) * 100}%`,
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
            {dragging ? t("bst.loslaten") : t("bst.sleep")}
          </p>
          <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>
            Alle bestandstypen — max 50MB · meerdere bestanden tegelijk
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            // [F#2] Reset value after handling so picking the SAME file again still
            // fires onChange (handleFiles captures the list synchronously via Array.from).
            onChange={e => { const input = e.currentTarget; handleFiles(input.files); input.value = ""; }}
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
            <button onClick={() => setFailedFiles([])} aria-label={t("bst.sluiten")}
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
                {f.existing ? (
                  // [BRIDGE-EXTRACT] Duplicate → clickable link straight to the
                  // existing file, with the full folder path so the user knows
                  // exactly where it lives.
                  <button
                    type="button"
                    onClick={() => openExistingFolder(f.existing!.folder_id, f.existing!.id)}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      textAlign: "start", display: "flex", alignItems: "center", gap: 4,
                      fontSize: 12, color: T.primary, textDecoration: "underline",
                    }}
                  >
                    <Icon name="folder" size={13} color={T.primary} />
                    <span>
                      Al aanwezig in:{" "}
                      {f.existing.folder_path.length
                        ? f.existing.folder_path.join(" / ")
                        : "Hoofdmap"}
                      {" "}— map openen
                    </span>
                  </button>
                ) : (
                  <p style={{ fontSize: 12, color: T.error, margin: 0 }}>
                    {f.reason}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}