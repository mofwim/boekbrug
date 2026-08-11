"use client";
// src/app/dashboard/bestanden/components/Trash.tsx
// [BOEK-033] Prullenbak (Trash) — soft delete, restore, permanent delete
// Files are soft-deleted: trashed=true in DB, not physically removed yet

import { useState, useEffect } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { Spinner } from "./ui/Spinner";
import { BestandRow } from "../types";
import { fileEmoji, formatDate, formatSize } from "../helpers";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

interface TrashProps {
  onBack: () => void;
}

export function Trash({ onBack }: TrashProps) {
  const t = translator(useLocale())
  const dialog = useDialog();
  const toast = useToast();
  const [items, setItems] = useState<BestandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/bestanden/trash")
      .then(r => r.json())
      .then((data: BestandRow[]) => setItems(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const restore = async (ids: string[]) => {
    await Promise.all(ids.map(id =>
      fetch(`/api/bestanden/trash?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      })
    ));
    setItems(p => p.filter(d => !ids.includes(d.id)));
    setSelected(new Set());
  };

  const permanentDelete = async (ids: string[]) => {
    // Permanently destroying a document in a bookkeeping app is the single
    // most irreversible thing a user can do here — it deserves the app's own
    // dialog rather than the browser's, with the consequence spelled out.
    const ok = await dialog.confirm({
      title: ids.length === 1 ? 'Bestand permanent verwijderen?' : `${ids.length} bestanden permanent verwijderen?`,
      message: 'Dit kan niet ongedaan worden gemaakt. Denk aan de bewaarplicht: de Belastingdienst verwacht dat je administratie zeven jaar bewaard blijft.',
      confirmLabel: 'Permanent verwijderen',
      danger: true,
    });
    if (!ok) return;
    // [COHERENCE-TRASH] Call the REAL purge endpoint and only remove rows that actually
    // deleted. The old code hit the deprecated DELETE /api/files/[id] (410 Gone) and
    // filtered items unconditionally, so files silently stayed trashed and reappeared on
    // reload while the app claimed success. Now we check res.ok per file and report failures.
    const results = await Promise.all(ids.map(async id => {
      try {
        const res = await fetch(`/api/bestanden/trash?id=${id}`, { method: "DELETE" });
        return { id, ok: res.ok };
      } catch {
        return { id, ok: false };
      }
    }));
    const deletedIds = results.filter(r => r.ok).map(r => r.id);
    const failed = results.length - deletedIds.length;
    if (deletedIds.length > 0) setItems(p => p.filter(d => !deletedIds.includes(d.id)));
    setSelected(new Set());
    if (failed > 0) {
      toast(`${failed} bestand(en) konden niet worden verwijderd. Ze staan nog in de prullenbak.`, { tone: 'error' });
    }
  };

  const emptyTrash = () => permanentDelete(items.map(i => i.id));

  return (
    <div style={{ fontFamily: "'Roboto',sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} aria-label={t('best.terug')} style={{
            width: 36, height: 36, border: "none", background: T.surfaceVariant,
            borderRadius: T.full, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer",
          }}>
            <Icon name="arrow_back" size={18} color={T.outline} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="delete" size={22} color={T.outline} />
            <h2 style={{ fontSize: 18, fontWeight: 600, color: T.onSurface, margin: 0 }}>{t('prul.titel')}</h2>
          </div>
        </div>

        {items.length > 0 && (
          <button onClick={emptyTrash} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", background: "none",
            border: `1px solid ${T.error}`, borderRadius: T.full,
            fontSize: 14, fontWeight: 500, color: T.error, cursor: "pointer",
            transition: "background 0.1s",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = T.errorContainer)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <Icon name="delete_forever" size={18} color={T.error} />
            {t('prul.legen')}
          </button>
        )}
      </div>

      {/* Info bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", background: T.warningContainer,
        borderRadius: T.md, marginBottom: 20,
      }}>
        <Icon name="info" size={18} color={T.warning} />
        <p style={{ fontSize: 13, color: T.onSurface, margin: 0 }}>
          Bestanden in de prullenbak worden na 30 dagen automatisch permanent verwijderd.
        </p>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", background: T.primaryContainer,
          borderRadius: T.md, marginBottom: 16,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: T.primary, flex: 1 }}>
            {selected.size} geselecteerd
          </span>
          <button onClick={() => restore([...selected])} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", background: T.primary, color: T.onPrimary,
            border: "none", borderRadius: T.full, fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>
            <Icon name="restore" size={16} color={T.onPrimary} /> {t('prul.herstellen')}
          </button>
          <button onClick={() => permanentDelete([...selected])} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", background: T.error, color: "white",
            border: "none", borderRadius: T.full, fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>
            <Icon name="delete_forever" size={16} color="white" /> {t('lijst.verwijderen')}
          </button>
          <button onClick={() => setSelected(new Set())} aria-label={t('prul.selectieWissen')} style={{
            width: 28, height: 28, border: "none", background: "none",
            cursor: "pointer", borderRadius: T.full,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="close" size={16} color={T.outline} />
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spinner size={32} />
        </div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{
            width: 80, height: 80, borderRadius: T.xl,
            background: T.surfaceVariant,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <Icon name="delete" size={40} color={T.outline} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 6px" }}>
            {t('prul.leeg')}
          </p>
          <p style={{ fontSize: 14, color: T.outline, margin: 0 }}>
            {t('prul.verschijnen')}
          </p>
        </div>
      ) : (
        <div style={{ background: "white", borderRadius: T.lg, boxShadow: T.elev1, overflow: "hidden" }}>
          {items.map((doc, i) => {
            const isSelected = selected.has(doc.id);
            return (
              <div
                key={doc.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 16px",
                  borderTop: i > 0 ? `1px solid ${T.surfaceVariant}` : "none",
                  background: isSelected ? T.primaryContainer : "transparent",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onClick={() => toggle(doc.id)}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = T.surfaceVariant; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Checkbox */}
                <div style={{
                  width: 20, height: 20, borderRadius: T.full, flexShrink: 0,
                  background: isSelected ? T.primary : "transparent",
                  border: `2px solid ${isSelected ? T.primary : "#dadce0"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}>
                  {isSelected && (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                <span style={{ fontSize: 20, flexShrink: 0 }}>{fileEmoji(doc.file_type)}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.onSurface }}>
                    {doc.file_name}
                  </p>
                  <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>
                    {formatSize(doc.file_size)} · Verwijderd op {doc.trashed_at ? formatDate(doc.trashed_at) : "–"}
                  </p>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={e => { e.stopPropagation(); restore([doc.id]); }}
                    title={t('prul.herstellen')}
                    style={{ width: 32, height: 32, border: "none", background: "none", cursor: "pointer", borderRadius: T.full, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.successContainer)}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <Icon name="restore" size={18} color={T.success} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); permanentDelete([doc.id]); }}
                    title={t('prul.permanent')}
                    style={{ width: 32, height: 32, border: "none", background: "none", cursor: "pointer", borderRadius: T.full, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.errorContainer)}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <Icon name="delete_forever" size={18} color={T.error} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}