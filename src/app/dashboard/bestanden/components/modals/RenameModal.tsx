"use client";
// src/app/dashboard/bestanden/components/modals/RenameModal.tsx
// [BOEK-033] Rename modal — files and folders

import { useState, useEffect, useRef } from "react";
import { T } from "../../tokens";
import { Icon } from "../ui/Icon";
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'

interface RenameModalProps {
  currentName: string;
  type: "file" | "folder";
  onConfirm: (newName: string) => void;
  onClose: () => void;
}

export function RenameModal({ currentName, type, onConfirm, onClose }: RenameModalProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        // Select name without extension for files
        if (type === "file") {
          const dotIdx = currentName.lastIndexOf(".");
          inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : currentName.length);
        } else {
          inputRef.current.select();
        }
      }
    }, 50);
  }, [currentName, type]);
  // [BACK-CLOSES] The system back button closes this, instead of leaving the page behind it.
  useCloseOnBack(true, onClose)


  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) onConfirm(trimmed);
    else onClose();
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, borderRadius: T.xl,
        boxShadow: T.elev3, padding: 24, width: "100%", maxWidth: 400,
        fontFamily: "'Roboto',sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: T.lg, background: T.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={type === "folder" ? "drive_file_rename_outline" : "edit"} size={22} color={T.primary} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: 0 }}>
            {type === "folder" ? "Map hernoemen" : "Bestand hernoemen"}
          </p>
        </div>

        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
          style={{
            width: "100%", padding: "12px 14px", fontSize: 15,
            border: `2px solid ${T.primary}`, borderRadius: T.md,
            outline: "none", color: T.onSurface, background: "white",
            boxSizing: "border-box", marginBottom: 20,
          }}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px", background: T.surfaceVariant,
            color: T.onSurface, border: "none", borderRadius: T.full,
            fontSize: 14, fontWeight: 500, cursor: "pointer",
          }}>
            Annuleren
          </button>
          <button onClick={handleSubmit} style={{
            flex: 1, padding: "10px", background: T.primary,
            color: T.onPrimary, border: "none", borderRadius: T.full,
            fontSize: 14, fontWeight: 500, cursor: "pointer",
          }}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}