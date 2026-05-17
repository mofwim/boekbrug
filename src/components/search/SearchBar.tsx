// src/components/search/SearchBar.tsx
// [BOEK-012] Smart search — grouped results (Facturen / Bestanden / Klanten) — May 2026
// Fixes included:
//   - [BOEK-012] dropdown background: explicit white, no CSS var transparency
//   - [BOEK-012] portal outside-click: portalDropdownRef excludes portal from closing
//   - [BOEK-012] mobile button: restored, isMobile-driven display (no Tailwind dependency)

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSearch } from "@/hooks/useSearch";
import { flattenGroups, type SearchResult } from "@/lib/search";

// ─── constants ────────────────────────────────────────────────────────────────

const RECENT_KEY = "bb_recent_searches";
const MAX_RECENT = 5;

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft:   { label: "Concept",   bg: "#F1EFE8", text: "#5F5E5A" },
  sent:    { label: "Verzonden", bg: "#E6F1FB", text: "#185FA5" },
  paid:    { label: "Betaald",   bg: "#EAF3DE", text: "#3B6D11" },
  overdue: { label: "Verlopen",  bg: "#FCEBEB", text: "#A32D2D" },
};

// Icon color per type
const TYPE_CONFIG: Record<string, { bg: string; color: string }> = {
  invoice:  { bg: "#E6F1FB", color: "#185FA5" },
  document: { bg: "#EAF3DE", color: "#3B6D11" },
  client:   { bg: "#F3EFFE", color: "#6B21A8" },
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
  catch { return []; }
}

function saveRecent(term: string) {
  if (!term.trim()) return;
  const next = [term, ...getRecent().filter((s) => s !== term)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

// ─── Highlight matching text ──────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        re.test(part) ? (
          <mark key={i} style={{ background: "#FAC775", color: "#412402", borderRadius: 3, padding: "0 2px", fontStyle: "normal" }}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconSearch = ({ size = 18 }: { size?: number }) => (
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

const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="9" strokeWidth="1.5" />
    <path d="M12 7v5l3 3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconInvoice = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const IconDoc = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const IconClient = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="7" r="4" strokeWidth="1.5" />
  </svg>
);

const IconX = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 5l7 7-7 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "10px 16px 4px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase" as const,
      color: "#9E9E9E",
      userSelect: "none" as const,
    }}>
      {children}
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.invoice;
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 10,
      background: cfg.bg, color: cfg.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {type === "invoice" ? <IconInvoice /> : type === "document" ? <IconDoc /> : <IconClient />}
    </div>
  );
}

function ResultRow({
  item, query, selected, onMouseEnter, onClick,
}: {
  item: SearchResult; query: string; selected: boolean;
  onMouseEnter: () => void; onClick: () => void;
}) {
  const st = STATUS_CONFIG[item.status ?? ""];

  return (
    <button
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "11px 16px", textAlign: "left",
        background: selected ? "#F5F5F5" : "transparent",
        border: "none", cursor: "pointer",
        transition: "background 0.1s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <TypeIcon type={item.type} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#212121" }}>
            <Highlight text={item.title} query={query} />
          </span>
          {item.type === "invoice" && st && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "2px 7px",
              borderRadius: 20, background: st.bg, color: st.text, flexShrink: 0,
            }}>
              {st.label}
            </span>
          )}
        </div>
        <p style={{
          fontSize: 13, color: "#757575", margin: 0, marginTop: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          <Highlight text={item.subtitle} query={query} />
          {item.meta
            ? <span style={{ color: "#9E9E9E" }}> · {item.meta}</span>
            : null}
        </p>
      </div>

      {/* Trailing: amount for invoices, chevron for others */}
      {item.type === "invoice" && item.meta ? (
        <span style={{ fontSize: 14, fontWeight: 600, color: "#212121", flexShrink: 0 }}>
          {item.meta}
        </span>
      ) : (
        <span style={{ color: "#BDBDBD", flexShrink: 0 }}><IconChevron /></span>
      )}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-flex", alignItems: "center",
      padding: "1px 5px", background: "#FAFAFA",
      border: "0.5px solid #E0E0E0", borderRadius: 4,
      fontSize: 10, color: "#757575",
    }}>
      {children}
    </kbd>
  );
}

// ─── Main SearchBar ───────────────────────────────────────────────────────────

export function SearchBar() {
  const router = useRouter();
  const { query, setQuery, groups, totalCount, loading, clear } = useSearch({ debounceMs: 200 });

  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // [BOEK-012] ref to portal div — needed to exclude it from outside-click detection
  const portalDropdownRef = useRef<HTMLDivElement>(null);

  // Flat list for keyboard navigation (invoices first, then docs, then clients)
  const flatResults = flattenGroups(groups);

  const showRecent = open && query.length < 2;
  const showResults = open && query.length >= 2;

  const navItems: Array<{ kind: "recent"; value: string } | { kind: "result"; value: SearchResult }> =
    showRecent
      ? recent.map((v) => ({ kind: "recent", value: v }))
      : flatResults.map((v) => ({ kind: "result", value: v }));

  // Init portal target
  useEffect(() => { setPortalEl(document.body); }, []);

  // Recalculate dropdown position when opened
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, [open]);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Load recent on open
  useEffect(() => { if (open) setRecent(getRecent()); }, [open]);

  // ⌘K global shortcut
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // [BOEK-012] Outside-click — check BOTH containerRef AND portalDropdownRef.
  // The portal renders outside containerRef (appended to body), so without this
  // check, any click on a result would close the dropdown before onClick fires.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (isMobile) return;
      const inContainer = containerRef.current?.contains(e.target as Node);
      const inPortal = portalDropdownRef.current?.contains(e.target as Node);
      if (!inContainer && !inPortal) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isMobile]);

  // Lock body scroll on mobile overlay
  useEffect(() => {
    if (isMobile && open) {
      document.body.style.overflow = "hidden";
      setTimeout(() => mobileInputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isMobile, open]);

  // Reset selection on results/recent change
  useEffect(() => { setSelectedIdx(-1); }, [flatResults.length, recent.length]);

  // ─── helpers ──────────────────────────────────────────────────────────────

  const openSearch = useCallback(() => {
    setOpen(true);
    if (!isMobile) setTimeout(() => inputRef.current?.focus(), 10);
  }, [isMobile]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    clear();
    if (inputRef.current) inputRef.current.value = "";
    if (mobileInputRef.current) mobileInputRef.current.value = "";
  }, [clear]);

  const navigate = useCallback((result: SearchResult) => {
    saveRecent(result.title);
    closeSearch();
    router.push(result.href);
  }, [router, closeSearch]);

  const applyRecent = useCallback((term: string) => {
    const ref = isMobile ? mobileInputRef : inputRef;
    if (ref.current) ref.current.value = term;
    setQuery(term);
    setSelectedIdx(-1);
  }, [setQuery, isMobile]);

  // ─── keyboard nav ─────────────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) { setOpen(true); return; }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, navItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIdx < 0) break;
        const item = navItems[selectedIdx];
        if (!item) break;
        if (item.kind === "recent") { applyRecent(item.value); break; }
        navigate(item.value);
        break;
      case "Escape":
        e.preventDefault();
        closeSearch();
        break;
    }
  }

  function onInputChange(val: string) {
    setQuery(val);
    setSelectedIdx(-1);
    if (!open) setOpen(true);
  }

  // ─── Grouped dropdown content ──────────────────────────────────────────────

  function DropdownContent() {
    return (
      <>
        {/* Recent searches */}
        {showRecent && recent.length > 0 && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {recent.map((term, i) => (
              <button
                key={term}
                role="option"
                aria-selected={selectedIdx === i}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => applyRecent(term)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 16px", textAlign: "left",
                  background: selectedIdx === i ? "#F5F5F5" : "transparent",
                  border: "none", cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span style={{ color: "#BDBDBD", flexShrink: 0 }}><IconClock /></span>
                <span style={{ fontSize: 14, color: "#757575" }}>{term}</span>
              </button>
            ))}
          </>
        )}

        {/* Empty state */}
        {showResults && !loading && totalCount === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "#9E9E9E", margin: 0 }}>
              Geen resultaten voor{" "}
              <strong style={{ color: "#616161", fontWeight: 500 }}>
                &ldquo;{query}&rdquo;
              </strong>
            </p>
          </div>
        )}

        {/* [BOEK-012] FACTUREN */}
        {showResults && groups.invoices.length > 0 && (
          <>
            <SectionLabel>Facturen ({groups.invoices.length})</SectionLabel>
            {groups.invoices.map((item) => {
              const idx = flatResults.indexOf(item);
              return (
                <ResultRow
                  key={item.id}
                  item={item}
                  query={query}
                  selected={selectedIdx === idx}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => navigate(item)}
                />
              );
            })}
          </>
        )}

        {/* [BOEK-012] BESTANDEN */}
        {showResults && groups.documents.length > 0 && (
          <>
            <SectionLabel>Bestanden ({groups.documents.length})</SectionLabel>
            {groups.documents.map((item) => {
              const idx = flatResults.indexOf(item);
              return (
                <ResultRow
                  key={item.id}
                  item={item}
                  query={query}
                  selected={selectedIdx === idx}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => navigate(item)}
                />
              );
            })}
          </>
        )}

        {/* [BOEK-012] KLANTEN */}
        {showResults && groups.clients.length > 0 && (
          <>
            <SectionLabel>Klanten ({groups.clients.length})</SectionLabel>
            {groups.clients.map((item) => {
              const idx = flatResults.indexOf(item);
              return (
                <ResultRow
                  key={item.id}
                  item={item}
                  query={query}
                  selected={selectedIdx === idx}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => navigate(item)}
                />
              );
            })}
          </>
        )}
      </>
    );
  }

  // ─── Shared input wrapper ──────────────────────────────────────────────────

  function SearchInput({ inputR, placeholder, fontSize = 14, onFocus }: {
    inputR: React.RefObject<HTMLInputElement | null>;
    placeholder: string;
    fontSize?: number;
    onFocus?: () => void;
  }) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        background: "#F5F5F5",
        borderRadius: 12,
        border: open ? "1px solid #BDBDBD" : "1px solid #E0E0E0",
        transition: "border-color 0.15s",
        flex: 1,
      }}>
        <span style={{ color: "#9E9E9E", flexShrink: 0 }}>
          {loading ? <IconSpinner size={16} /> : <IconSearch size={16} />}
        </span>
        <input
          ref={inputR}
          type="search"
          defaultValue=""
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-label="Zoeken"
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
          aria-autocomplete="list"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontSize, color: "#212121", minWidth: 0,
          }}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            tabIndex={-1}
            aria-label="Wissen"
            onClick={() => { clear(); if (inputR.current) inputR.current.value = ""; }}
            style={{
              background: "#E0E0E0", border: "none", borderRadius: "50%",
              width: 18, height: 18, display: "flex",
              alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#757575", flexShrink: 0,
            }}
          >
            <IconX size={10} />
          </button>
        )}
      </div>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`@keyframes bb-spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Desktop: input + portal dropdown ── */}
      <div
        ref={containerRef}
        style={{
          position: "relative", width: "100%", maxWidth: 320,
          display: isMobile ? "none" : "block",
        }}
      >
        <SearchInput
          inputR={inputRef}
          placeholder="Zoeken…"
          onFocus={() => setOpen(true)}
        />

        {/* [BOEK-012] Portal dropdown — fixed position, solid white, portal-ref for outside-click */}
        {open && (showRecent || showResults) && portalEl && createPortal(
          <div
            ref={portalDropdownRef}
            role="listbox"
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              background: "white",           // [BOEK-012] explicit — no CSS var
              border: "1px solid #E0E0E0",
              borderRadius: 12,
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              zIndex: 100,
              overflow: "hidden",
            }}
          >
            <div style={{ maxHeight: 400, overflowY: "auto", overscrollBehavior: "contain" }}>
              <DropdownContent />
            </div>
            {/* Keyboard hint footer */}
            <div style={{
              display: "flex", gap: 12, padding: "8px 16px",
              borderTop: "1px solid #F0F0F0", background: "#FAFAFA",
            }}>
              {[["↑↓", "navigeren"], ["↵", "openen"], ["Esc", "sluiten"]].map(([key, label]) => (
                <span key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9E9E9E" }}>
                  <Kbd>{key}</Kbd> {label}
                </span>
              ))}
            </div>
          </div>,
          portalEl
        )}
      </div>

      {/* [BOEK-012] Mobile tap-target — isMobile-driven, no Tailwind dependency */}
      <button
        aria-label="Zoeken openen"
        onClick={openSearch}
        style={{
          display: isMobile ? "flex" : "none",
          alignItems: "center", justifyContent: "center",
          width: 40, height: 40, borderRadius: 12,
          background: "#F5F5F5", border: "1px solid #E0E0E0",
          cursor: "pointer", color: "#616161",
          WebkitTapHighlightColor: "transparent", flexShrink: 0,
        }}
      >
        <IconSearch size={18} />
      </button>

      {/* Mobile full-screen overlay */}
      {isMobile && open && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "white", display: "flex", flexDirection: "column",
        }}>
          {/* Header */}
          <div style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            borderBottom: "1px solid #F0F0F0",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
              <SearchInput
                inputR={mobileInputRef}
                placeholder="Zoeken naar facturen, bestanden…"
                fontSize={16} // 16px prevents iOS auto-zoom
              />
              <button
                onClick={closeSearch}
                style={{
                  background: "none", border: "none", fontSize: 16, fontWeight: 500,
                  color: "#1A73E8", cursor: "pointer",
                  padding: "4px 0 4px 4px", whiteSpace: "nowrap",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                Annuleren
              </button>
            </div>
          </div>

          {/* Scrollable results */}
          <div
            role="listbox"
            style={{
              flex: 1, overflowY: "auto", overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "env(safe-area-inset-bottom, 16px)",
            }}
          >
            <DropdownContent />
          </div>
        </div>
      )}
    </>
  );
}