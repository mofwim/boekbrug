// src/components/search/SearchBar.tsx
// [BOEK-012] Smart search — grouped results (Facturen / Bestanden / Klanten) — May 2026
// [BOEK-012] FIX: SearchInput + DropdownContent moved OUTSIDE SearchBar — May 2026
//   Root cause of focus-loss bug: inner functions recreate component identity on every
//   keystroke → React unmounts/remounts the input → focus stolen after each character.
//   Solution: extract to module-level components, pass all needed values as props.

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
import { flattenGroups, type SearchResult, type SearchResultGroup } from "@/lib/search";

// ─── constants ────────────────────────────────────────────────────────────────

const RECENT_KEY = "bb_recent_searches";
const MAX_RECENT = 5;

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft:   { label: "Concept",   bg: "#f1f3f4", text: "#5f6368" },
  sent:    { label: "Verzonden", bg: "#e8f0fe", text: "#1967d2" },
  paid:    { label: "Betaald",   bg: "#e6f4ea", text: "#137333" },
  overdue: { label: "Verlopen",  bg: "#fce8e6", text: "#b3261e" },
};

const TYPE_CONFIG: Record<string, { bg: string; color: string }> = {
  invoice:  { bg: "#e8f0fe", color: "#1967d2" },
  document: { bg: "#e6f4ea", color: "#137333" },
  client:   { bg: "#F3EFFE", color: "#7b1fa2" },
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

// [SEARCH] Enter-with-no-selection should open the BEST match across all groups, not
// just the first invoice (flatResults is grouped invoices→documents→clients, so the
// API's per-group ranking is otherwise lost for the Enter shortcut).
const foldStr = (s: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
function pickBest(results: SearchResult[], query: string): SearchResult | undefined {
  if (results.length === 0) return undefined;
  const q = foldStr(query.trim());
  if (!q) return results[0];
  const score = (r: SearchResult) => {
    const t = foldStr(r.title), s = foldStr(r.subtitle);
    if (t === q) return 5;
    if (t.startsWith(q)) return 4;
    if (s === q || s.startsWith(q)) return 3;
    if (t.includes(q)) return 2;
    if (s.includes(q)) return 1;
    return 0;
  };
  return results.reduce((best, r) => (score(r) > score(best) ? r : best), results[0]);
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  // Capture group → String.split returns [text, match, text, match, …] so the
  // matched fragments sit at ODD indices. (The old code used a stateful /g regex
  // with .test() inside .map(), whose lastIndex drifted and mis-marked fragments.)
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
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

// ─── Pure sub-components ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "10px 16px 4px", fontSize: 11, fontWeight: 600,
      letterSpacing: "0.06em", textTransform: "uppercase" as const,
      color: "#80868b", userSelect: "none" as const,
    }}>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-flex", alignItems: "center",
      padding: "1px 5px", background: "#f8f9fa",
      border: "0.5px solid #E0E0E0", borderRadius: 4,
      fontSize: 10, color: "#5f6368",
    }}>
      {children}
    </kbd>
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
  item, query, selected, optionId, onMouseEnter, onClick,
}: {
  item: SearchResult; query: string; selected: boolean; optionId?: string;
  onMouseEnter: () => void; onClick: () => void;
}) {
  const st = STATUS_CONFIG[item.status ?? ""];
  return (
    <button
      id={optionId}
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "11px 16px", textAlign: "left",
        background: selected ? "#f1f3f4" : "transparent",
        border: "none", cursor: "pointer",
        transition: "background 0.1s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <TypeIcon type={item.type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#202124" }}>
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
          fontSize: 13, color: "#5f6368", margin: 0, marginTop: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          <Highlight text={item.subtitle} query={query} />
          {item.meta ? <span style={{ color: "#80868b" }}> · {item.meta}</span> : null}
        </p>
      </div>
      {item.type === "invoice" && item.meta ? (
        <span style={{ fontSize: 14, fontWeight: 600, color: "#202124", flexShrink: 0 }}>
          {item.meta}
        </span>
      ) : (
        <span style={{ color: "#dadce0", flexShrink: 0 }}><IconChevron /></span>
      )}
    </button>
  );
}

// ─── [BOEK-012] SearchInput — MODULE LEVEL (not inside SearchBar) ─────────────
// Must be outside SearchBar to preserve React identity across re-renders.
// If defined inside SearchBar, every keystroke recreates the function →
// React unmounts+remounts the input → focus lost after every character.

interface SearchInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  open: boolean;
  loading: boolean;
  placeholder: string;
  fontSize?: number;
  activeId?: string;
  onChange: (val: string) => void;
  onFocus?: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
}

function SearchInput({
  inputRef, query, open, loading, placeholder,
  fontSize = 14, activeId, onChange, onFocus, onKeyDown, onClear,
}: SearchInputProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", background: "#f1f3f4", borderRadius: 12,
      border: open ? "1px solid #dadce0" : "1px solid #E0E0E0",
      transition: "border-color 0.15s", flex: 1,
    }}>
      <span style={{ color: "#80868b", flexShrink: 0 }}>
        {loading ? <IconSpinner size={16} /> : <IconSearch size={16} />}
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-label="Zoeken"
        aria-expanded={open}
        aria-haspopup="listbox"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="bb-search-listbox"
        aria-activedescendant={activeId}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          fontSize, color: "#202124", minWidth: 0,
        }}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      {query && (
        <button
          tabIndex={-1}
          aria-label="Wissen"
          onClick={onClear}
          style={{
            background: "#E0E0E0", border: "none", borderRadius: "50%",
            width: 18, height: 18, display: "flex",
            alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#5f6368", flexShrink: 0,
          }}
        >
          <IconX size={10} />
        </button>
      )}
    </div>
  );
}

// ─── [BOEK-012] DropdownContent — MODULE LEVEL (not inside SearchBar) ────────
// Same reason: must be stable across re-renders.

interface DropdownContentProps {
  showRecent: boolean;
  showResults: boolean;
  loading: boolean;
  error: string | null;
  query: string;
  recent: string[];
  groups: SearchResultGroup;
  flatResults: SearchResult[];
  selectedIdx: number;
  totalCount: number;
  onSelectRecent: (term: string) => void;
  onSelectResult: (item: SearchResult) => void;
  onHoverIdx: (idx: number) => void;
}

function DropdownContent({
  showRecent, showResults, loading, error, query, recent,
  groups, flatResults, selectedIdx, totalCount,
  onSelectRecent, onSelectResult, onHoverIdx,
}: DropdownContentProps) {
  return (
    <>
      {/* Recent searches */}
      {showRecent && recent.length > 0 && (
        <>
          <SectionLabel>Recent</SectionLabel>
          {recent.map((term, i) => (
            <button
              key={term}
              id={`bb-opt-${i}`}
              role="option"
              aria-selected={selectedIdx === i}
              onMouseEnter={() => onHoverIdx(i)}
              onClick={() => onSelectRecent(term)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 16px", textAlign: "left",
                background: selectedIdx === i ? "#f1f3f4" : "transparent",
                border: "none", cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{ color: "#dadce0", flexShrink: 0 }}><IconClock /></span>
              <span style={{ fontSize: 14, color: "#5f6368" }}>{term}</span>
            </button>
          ))}
        </>
      )}

      {/* Error state — a backend/network failure must not masquerade as "no results" */}
      {showResults && error && (
        <div role="status" style={{ padding: "28px 16px", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#b3261e", margin: 0, fontWeight: 500 }}>
            Zoeken mislukt
          </p>
          <p style={{ fontSize: 13, color: "#80868b", margin: "4px 0 0" }}>
            Controleer je verbinding en probeer het opnieuw.
          </p>
        </div>
      )}

      {/* Empty state */}
      {showResults && !loading && !error && totalCount === 0 && (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#80868b", margin: 0 }}>
            Geen resultaten voor{" "}
            <strong style={{ color: "#5f6368", fontWeight: 500 }}>
              &ldquo;{query}&rdquo;
            </strong>
          </p>
        </div>
      )}

      {/* FACTUREN */}
      {showResults && groups.invoices.length > 0 && (
        <>
          <SectionLabel>Facturen ({groups.invoices.length})</SectionLabel>
          {groups.invoices.map((item) => {
            const idx = flatResults.indexOf(item);
            return (
              <ResultRow
                key={item.id} item={item} query={query}
                selected={selectedIdx === idx}
                optionId={`bb-opt-${idx}`}
                onMouseEnter={() => onHoverIdx(idx)}
                onClick={() => onSelectResult(item)}
              />
            );
          })}
        </>
      )}

      {/* BESTANDEN */}
      {showResults && groups.documents.length > 0 && (
        <>
          <SectionLabel>Bestanden ({groups.documents.length})</SectionLabel>
          {groups.documents.map((item) => {
            const idx = flatResults.indexOf(item);
            return (
              <ResultRow
                key={item.id} item={item} query={query}
                selected={selectedIdx === idx}
                optionId={`bb-opt-${idx}`}
                onMouseEnter={() => onHoverIdx(idx)}
                onClick={() => onSelectResult(item)}
              />
            );
          })}
        </>
      )}

      {/* KLANTEN */}
      {showResults && groups.clients.length > 0 && (
        <>
          <SectionLabel>Klanten ({groups.clients.length})</SectionLabel>
          {groups.clients.map((item) => {
            const idx = flatResults.indexOf(item);
            return (
              <ResultRow
                key={item.id} item={item} query={query}
                selected={selectedIdx === idx}
                optionId={`bb-opt-${idx}`}
                onMouseEnter={() => onHoverIdx(idx)}
                onClick={() => onSelectResult(item)}
              />
            );
          })}
        </>
      )}
    </>
  );
}

// ─── Main SearchBar ───────────────────────────────────────────────────────────

export function SearchBar({ variant = "inline" }: { variant?: "inline" | "launcher" } = {}) {
  const router = useRouter();
  const { query, setQuery, groups, totalCount, loading, error, clear } = useSearch({ debounceMs: 200 });

  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  // [SEARCH] "launcher" variant (global floating search) uses the compact
  // button + full-screen overlay on ALL viewports, not just mobile.
  const compact = variant === "launcher" || isMobile;
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const portalDropdownRef = useRef<HTMLDivElement>(null);

  const flatResults = flattenGroups(groups);
  const showRecent = open && query.length < 2;
  const showResults = open && query.length >= 2;

  const navItems: Array<{ kind: "recent"; value: string } | { kind: "result"; value: SearchResult }> =
    showRecent
      ? recent.map((v) => ({ kind: "recent", value: v }))
      : flatResults.map((v) => ({ kind: "result", value: v }));

  useEffect(() => { setPortalEl(document.body); }, []);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, [open]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { if (open) setRecent(getRecent()); }, [open]);

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

  // [BOEK-012] Outside-click excludes portal div
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (compact) return;
      const inContainer = containerRef.current?.contains(e.target as Node);
      const inPortal = portalDropdownRef.current?.contains(e.target as Node);
      if (!inContainer && !inPortal) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [compact]);

  useEffect(() => {
    if (compact && open) {
      document.body.style.overflow = "hidden";
      setTimeout(() => mobileInputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [compact, open]);

  useEffect(() => { setSelectedIdx(-1); }, [flatResults.length, recent.length]);

  // ─── handlers ─────────────────────────────────────────────────────────────

  const openSearch = useCallback(() => {
    setOpen(true);
    if (!compact) setTimeout(() => inputRef.current?.focus(), 10);
  }, [compact]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    clear();
  }, [clear]);

  const navigate = useCallback((result: SearchResult) => {
    // Recent = what the user actually typed (falls back to the title only when the
    // result was opened without a live query, e.g. via keyboard on recents).
    saveRecent(query.trim() || result.title);
    closeSearch();
    router.push(result.href);
  }, [router, closeSearch, query]);

  const applyRecent = useCallback((term: string) => {
    setQuery(term);
    setSelectedIdx(-1);
  }, [setQuery]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
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
        // [SEARCH] Enter with no selection → open the top result if there is one;
        // otherwise fall back to the facturen list pre-filled with the query
        // (FacturenClient now reads ?search=). — Jul 2026
        if (selectedIdx < 0) {
          const top = showResults ? pickBest(flatResults, query) : undefined;
          if (top) { navigate(top); break; }
          if (query.trim()) {
            saveRecent(query.trim());
            closeSearch();
            router.push(`/dashboard/facturen?search=${encodeURIComponent(query.trim())}`);
          }
          break;
        }
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
  }, [open, navItems, selectedIdx, applyRecent, navigate, closeSearch, showResults, flatResults, query, router]);

  const onInputChange = useCallback((val: string) => {
    setQuery(val);
    setSelectedIdx(-1);
    if (!open) setOpen(true);
  }, [setQuery, open]);

  // ─── shared dropdown props ─────────────────────────────────────────────────

  const activeId = selectedIdx >= 0 ? `bb-opt-${selectedIdx}` : undefined;

  const dropdownProps: DropdownContentProps = {
    showRecent, showResults, loading, error, query, recent,
    groups, flatResults, selectedIdx, totalCount,
    onSelectRecent: applyRecent,
    onSelectResult: navigate,
    onHoverIdx: setSelectedIdx,
  };

  const desktopInputProps: SearchInputProps = {
    inputRef, query, open, loading, activeId,
    placeholder: "Zoeken…",
    onChange: onInputChange,
    onFocus: () => setOpen(true),
    onKeyDown: handleKeyDown,
    onClear: clear,
  };

  const mobileInputProps: SearchInputProps = {
    inputRef: mobileInputRef, query, open, loading, activeId,
    placeholder: "Zoeken naar facturen, bestanden…",
    fontSize: 16,
    onChange: onInputChange,
    onKeyDown: handleKeyDown,
    onClear: clear,
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`@keyframes bb-spin{to{transform:rotate(360deg)}}`}</style>

      {/* Desktop */}
      <div
        ref={containerRef}
        style={{
          position: "relative", width: "100%", maxWidth: 320,
          display: compact ? "none" : "block",
        }}
      >
        <SearchInput {...desktopInputProps} />

        {!compact && open && (showRecent || showResults) && portalEl && createPortal(
          <div
            ref={portalDropdownRef}
            id="bb-search-listbox"
            role="listbox"
            aria-label="Zoekresultaten"
            style={{
              position: "fixed",
              top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width,
              background: "white",
              border: "1px solid #E0E0E0", borderRadius: 12,
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              zIndex: 100, overflow: "hidden",
            }}
          >
            <div style={{ maxHeight: 400, overflowY: "auto", overscrollBehavior: "contain" }}>
              <DropdownContent {...dropdownProps} />
            </div>
            <div style={{
              display: "flex", gap: 12, padding: "8px 16px",
              borderTop: "1px solid #f1f3f4", background: "#f8f9fa",
            }}>
              {[["↑↓", "navigeren"], ["↵", "openen"], ["Esc", "sluiten"]].map(([key, label]) => (
                <span key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#80868b" }}>
                  <Kbd>{key}</Kbd> {label}
                </span>
              ))}
            </div>
          </div>,
          portalEl
        )}
      </div>

      {/* Compact tap-target (mobile always; desktop only in launcher variant).
          In launcher mode it's a floating action button; otherwise a header icon. */}
      <button
        aria-label="Zoeken openen"
        onClick={openSearch}
        style={{
          display: compact ? "flex" : "none",
          alignItems: "center", justifyContent: "center",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent", flexShrink: 0,
          ...(variant === "launcher"
            ? { width: 52, height: 52, borderRadius: 26, background: "#1A73E8", border: "none", color: "#fff", boxShadow: "0 4px 14px rgba(26,115,232,0.45)" }
            : { width: 40, height: 40, borderRadius: 12, background: "#f1f3f4", border: "1px solid #E0E0E0", color: "#5f6368" }),
        }}
      >
        <IconSearch size={variant === "launcher" ? 22 : 18} />
      </button>

      {/* Full-screen overlay (compact mode). High z-index so the search overlay sits
          above page modals / sticky action bars (some reach z:1500–3000). */}
      {compact && open && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2147483000,
          background: "white", display: "flex", flexDirection: "column",
        }}>
          <div style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            borderBottom: "1px solid #f1f3f4",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
              <SearchInput {...mobileInputProps} />
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
          <div
            id="bb-search-listbox"
            role="listbox"
            aria-label="Zoekresultaten"
            style={{
              flex: 1, overflowY: "auto", overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "env(safe-area-inset-bottom, 16px)",
            }}
          >
            <DropdownContent {...dropdownProps} />
          </div>
        </div>
      )}
    </>
  );
}