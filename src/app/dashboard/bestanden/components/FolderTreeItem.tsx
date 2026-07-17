"use client";
// src/app/dashboard/bestanden/components/FolderTreeItem.tsx
// [BOEK-033] Sidebar folder tree item — recursive, with rename/delete

import { useState } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { FolderNode } from "../types";
import { folderColor } from "../helpers";

interface FolderTreeItemProps {
  node: FolderNode;
  depth: number;
  activeFolderId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string) => void;
}

export function FolderTreeItem({ node, depth, activeFolderId, onSelect, onRename, onDelete }: FolderTreeItemProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isActive = activeFolderId === node.id;
  const isShared = node.name === "Gedeeld met boekhouder";

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { onSelect(node.id); setOpen(true); }}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: `8px 10px 8px ${10 + depth * 16}px`,
          borderRadius: T.md, cursor: "pointer", userSelect: "none",
          background: isActive ? T.primaryContainer : hovered ? T.surfaceVariant : "transparent",
          color: isActive ? T.primary : T.onSurface,
          transition: "background 0.1s",
        }}
      >
        {/* Expand/collapse */}
        <button
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          aria-label="Uitklappen"
          style={{
            width: 20, height: 20, border: "none", background: "none",
            cursor: node.children.length ? "pointer" : "default",
            opacity: node.children.length ? 0.6 : 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.15s", flexShrink: 0,
          }}
        >
          <Icon name="expand_more" size={16} />
        </button>

        <Icon name="folder" size={18} color={folderColor(node.color)} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>

        {node.starred && <Icon name="star" size={13} color={T.star} style={{ flexShrink: 0 }} />}

        {isShared && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: T.primaryContainer, color: T.primary, borderRadius: T.full, flexShrink: 0 }}>
            Gedeeld
          </span>
        )}

        {!isShared && hovered && (
          <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onRename(node.id, node.name); }}
              aria-label="Naam wijzigen"
              style={{ width: 22, height: 22, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.sm }}
            >
              <Icon name="edit" size={13} color={T.outline} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(node.id); }}
              aria-label="Verwijderen"
              style={{ width: 22, height: 22, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: T.sm }}
            >
              <Icon name="delete" size={13} color={T.error} />
            </button>
          </div>
        )}
      </div>

      {open && node.children.map(child => (
        <FolderTreeItem
          key={child.id} node={child} depth={depth + 1}
          activeFolderId={activeFolderId}
          onSelect={onSelect} onRename={onRename} onDelete={onDelete}
        />
      ))}
    </div>
  );
}