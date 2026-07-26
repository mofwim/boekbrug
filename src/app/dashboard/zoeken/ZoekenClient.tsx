// src/app/dashboard/zoeken/ZoekenClient.tsx
// [SEARCH] Dedicated, full-app search RESULTS page — the one place that searches
// everything (facturen, bestanden, klanten) and shows every match, grouped, with
// type filters. The header dropdown is a quick-jump preview; this is the full view.
// It reuses the SAME /api/search endpoint (full=1 → more rows per group).

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSearch } from "@/hooks/useSearch";
import { flattenGroups, EMPTY_GROUP, type SearchResult, type SearchResultGroup, type SearchTarget } from "@/lib/search";
import { M3, FONT } from "@/lib/design/tokens";
import { BackLink } from "@/components/ui/BackLink";
import type { Role } from "@/lib/navigation";

// ─── icons (compact, self-contained) ─────────────────────────────────────────
const IconSearch = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="11" cy="11" r="8" strokeWidth="1.75" />
    <path d="M21 21l-4.35-4.35" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);
const IconSpinner = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ animation: "bb-spin 0.75s linear infinite" }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const IconX = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const IconChevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 5l7 7-7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconInvoice = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);
const IconDoc = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);
const IconClient = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="7" r="4" strokeWidth="1.5" />
  </svg>
);

const IconBank = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth="1.5" /><path d="M2 10h20" strokeWidth="1.5" />
  </svg>
);
const IconCash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="8" strokeWidth="1.5" /><path d="M14.5 9.5a3 3 0 00-5 2.5 3 3 0 005 2.5" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  invoice: { bg: "#e8f0fe", color: "#1967d2" },
  document: { bg: "#e6f4ea", color: "#137333" },
  client: { bg: "#F3EFFE", color: "#7b1fa2" },
  banktransaction: { bg: "#E3F2FD", color: "#01579B" },
  cashentry: { bg: "#FFF3E0", color: "#B26A00" },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: "Concept", bg: "#f1f3f4", text: "#5f6368" },
  sent: { label: "Verzonden", bg: "#e8f0fe", text: "#1967d2" },
  paid: { label: "Betaald", bg: "#e6f4ea", text: "#137333" },
  overdue: { label: "Verlopen", bg: "#fce8e6", text: "#b3261e" },
};

// ─── highlight matched fragments ─────────────────────────────────────────────
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q || !text) return <>{text}</>;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} style={{ background: "#FAC775", color: "#412402", borderRadius: 3, padding: "0 2px" }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function TypeIcon({ type }: { type: string }) {
  const cfg = TYPE_STYLE[type] ?? TYPE_STYLE.invoice;
  return (
    <div style={{ width: 40, height: 40, borderRadius: 11, background: cfg.bg, color: cfg.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {type === "invoice" ? <IconInvoice /> : type === "document" ? <IconDoc /> : type === "banktransaction" ? <IconBank /> : type === "cashentry" ? <IconCash /> : <IconClient />}
    </div>
  );
}

function ResultRow({ item, query, onClick }: { item: SearchResult; query: string; onClick: () => void }) {
  const st = STATUS_CONFIG[item.status ?? ""];
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", textAlign: "left", background: "transparent",
        border: "none", borderRadius: 12, cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = M3.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <TypeIcon type={item.type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 500, color: M3.onSurface }}>
            <Highlight text={item.title} query={query} />
          </span>
          {item.type === "invoice" && st && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: st.bg, color: st.text, flexShrink: 0 }}>
              {st.label}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: "1px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Highlight text={item.subtitle} query={query} />
          {item.meta && item.type !== "invoice" ? <span style={{ color: M3.outline }}> · {item.meta}</span> : null}
        </p>
      </div>
      {item.type === "invoice" && item.meta ? (
        <span style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, flexShrink: 0 }}>{item.meta}</span>
      ) : (
        <span style={{ color: "#dadce0", flexShrink: 0 }}><IconChevron /></span>
      )}
    </button>
  );
}

function Section({ label, items, query, onOpen }: { label: string; items: SearchResult[]; query: string; onOpen: (r: SearchResult) => void }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ padding: "4px 6px 8px", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: M3.outline }}>
        {label} ({items.length})
      </div>
      <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: 4 }}>
        {items.map((item) => (
          <ResultRow key={`${item.type}-${item.id}`} item={item} query={query} onClick={() => onOpen(item)} />
        ))}
      </div>
    </div>
  );
}

// ─── main ────────────────────────────────────────────────────────────────────
const CHIPS: Array<{ key: Exclude<SearchTarget, "all"> | "all"; label: string }> = [
  { key: "all", label: "Alles" },
  { key: "invoices", label: "Facturen" },
  { key: "documents", label: "Bestanden" },
  { key: "clients", label: "Klanten" },
  { key: "bank", label: "Bank" },
  { key: "kas", label: "Kas" },
];

export default function ZoekenClient({ initialQuery, role }: { initialQuery: string; role: Role }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<SearchTarget>("all");

  // Always fetch ALL groups (full mode) so every chip can show a live count; the
  // chips only change which groups are DISPLAYED, not what we fetch.
  const { query, setQuery, groups, totalCount, loading, error, clear } = useSearch({
    full: true,
    debounceMs: 200,
    initialQuery,
  });

  // Keep the URL's ?q= in sync (shareable / back-button) WITHOUT a Next navigation —
  // native replaceState avoids a server round-trip on every keystroke.
  useEffect(() => {
    const url = query.trim()
      ? `/dashboard/zoeken?q=${encodeURIComponent(query.trim())}`
      : "/dashboard/zoeken";
    window.history.replaceState(window.history.state, "", url);
  }, [query]);

  // Adopt the ?q= when it changes from OUTSIDE (e.g. the floating launcher pushes a
  // new query while this page is already mounted). The equality guard makes this a
  // no-op for our own replaceState writes, so it can never loop with the effect above.
  useEffect(() => {
    const urlQ = searchParams.get("q") ?? "";
    if (urlQ !== query) setQuery(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const open = useCallback((r: SearchResult) => router.push(r.href), [router]);

  const counts = useMemo(() => ({
    all: totalCount,
    invoices: groups.invoices.length,
    documents: groups.documents.length,
    clients: groups.clients.length,
    bank: groups.bankTransactions.length,
    kas: groups.cashEntries.length,
  }), [groups, totalCount]);

  const trimmed = query.trim();
  const showResults = trimmed.length >= 2;
  const shown: SearchResultGroup =
    tab === "invoices" ? { ...EMPTY_GROUP, invoices: groups.invoices }
    : tab === "documents" ? { ...EMPTY_GROUP, documents: groups.documents }
    : tab === "clients" ? { ...EMPTY_GROUP, clients: groups.clients }
    : tab === "bank" ? { ...EMPTY_GROUP, bankTransactions: groups.bankTransactions }
    : tab === "kas" ? { ...EMPTY_GROUP, cashEntries: groups.cashEntries }
    : groups;
  const shownCount = flattenGroups(shown).length;

  return (
    <div style={{ minHeight: "100vh", background: M3.bg, fontFamily: FONT }}>
      <style>{`@keyframes bb-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 64px" }}>
        <div style={{ marginBottom: 12 }}>
          <BackLink role={role} />
        </div>

        {/* Search field */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
          <span style={{ color: M3.outline, flexShrink: 0 }}>
            {loading ? <IconSpinner size={20} /> : <IconSearch size={20} />}
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek in de hele app — facturen, bestanden, klanten…"
            aria-label="Zoeken in de hele app"
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 16, color: M3.onSurface, minWidth: 0 }}
          />
          {query && (
            <button onClick={clear} aria-label="Wissen" style={{ background: M3.outlineVariant, border: "none", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M3.onSurfaceVariant, flexShrink: 0 }}>
              <IconX size={12} />
            </button>
          )}
        </div>

        {/* Type filter chips */}
        {showResults && totalCount > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {CHIPS.map((c) => {
              const n = counts[c.key];
              const active = tab === c.key;
              const disabled = c.key !== "all" && n === 0;
              return (
                <button
                  key={c.key}
                  onClick={() => setTab(c.key as SearchTarget)}
                  disabled={disabled}
                  style={{
                    padding: "7px 13px", borderRadius: 20, fontSize: 13, fontWeight: 500,
                    cursor: disabled ? "default" : "pointer",
                    border: `1px solid ${active ? M3.primary : M3.outlineVariant}`,
                    background: active ? M3.primary : M3.surface,
                    color: active ? M3.onPrimary : disabled ? "#bdc1c6" : M3.onSurfaceVariant,
                    opacity: disabled ? 0.6 : 1,
                  }}
                >
                  {c.label}{c.key !== "all" || n > 0 ? ` ${n}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div style={{ marginTop: 18 }}>
          {!showResults ? (
            <div style={{ textAlign: "center", padding: "56px 16px", color: M3.outline }}>
              <div style={{ opacity: 0.5, marginBottom: 10 }}><IconSearch size={34} /></div>
              <p style={{ fontSize: 14.5, margin: 0 }}>Begin met typen om overal in de app te zoeken.</p>
              <p style={{ fontSize: 13, margin: "4px 0 0", color: "#9aa0a6" }}>Facturen, bestanden en klanten — op naam, nummer of bedrag.</p>
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: "48px 16px" }}>
              <p style={{ fontSize: 14.5, color: M3.error, fontWeight: 500, margin: 0 }}>Zoeken mislukt</p>
              <p style={{ fontSize: 13, color: M3.outline, margin: "4px 0 0" }}>Controleer je verbinding en probeer het opnieuw.</p>
            </div>
          ) : loading && totalCount === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px", color: M3.outline }}>
              <div style={{ display: "inline-flex" }}><IconSpinner size={26} /></div>
            </div>
          ) : shownCount === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px" }}>
              <p style={{ fontSize: 14.5, color: M3.onSurfaceVariant, margin: 0 }}>
                Geen resultaten voor <strong style={{ fontWeight: 600 }}>&ldquo;{trimmed}&rdquo;</strong>
              </p>
              <p style={{ fontSize: 13, color: M3.outline, margin: "4px 0 0" }}>Probeer een andere naam, factuurnummer of bedrag.</p>
            </div>
          ) : (
            <>
              <Section label="Facturen" items={shown.invoices} query={trimmed} onOpen={open} />
              <Section label="Bestanden" items={shown.documents} query={trimmed} onOpen={open} />
              <Section label="Klanten" items={shown.clients} query={trimmed} onOpen={open} />
              <Section label="Bankmutaties" items={shown.bankTransactions} query={trimmed} onOpen={open} />
              <Section label="Kasboekingen" items={shown.cashEntries} query={trimmed} onOpen={open} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
