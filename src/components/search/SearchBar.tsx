// components/search/SearchBar.tsx
// [BOEK-012] Mobile-first iOS-design search — May 2026
// Keyboard nav (↑↓ Enter Esc), recent searches, highlight, accountant mode
// Full-screen overlay on mobile (<640px), floating dropdown on desktop

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useSearch } from "@/hooks/useSearch";
import type { SearchResult } from "@/lib/search";

// ─── constants ────────────────────────────────────────────────────────────────

const RECENT_KEY = "bb_recent_searches";
const MAX_RECENT = 5;

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  draft:   { label: "Concept",   bg: "#F1EFE8", text: "#5F5E5A" },
  sent:    { label: "Verzonden", bg: "#E6F1FB", text: "#185FA5" },
  paid:    { label: "Betaald",   bg: "#EAF3DE", text: "#3B6D11" },
  overdue: { label: "Verlopen",  bg: "#FCEBEB", text: "#A32D2D" },
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(term: string) {
  if (!term.trim()) return;
  const next = [term, ...getRecent().filter((s) => s !== term)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const re = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  return (
    <>
      {text.split(re).map((part, i) =>
        re.test(part) ? (
          <mark
            key={i}
            style={{
              background: "#FAC775",
              color: "#412402",
              borderRadius: 3,
              padding: "0 2px",
              fontStyle: "normal",
            }}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ─── Icons (inline SVG — no external dep) ────────────────────────────────────

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

const IconDoc = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const IconInvoice = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="1.5" strokeLinejoin="round" />
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

// ─── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "10px 16px 4px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--color-text-tertiary)",
      userSelect: "none",
    }}>
      {children}
    </div>
  );
}

// ─── ResultRow ────────────────────────────────────────────────────────────────

function ResultRow({
  item,
  query,
  selected,
  onMouseEnter,
  onClick,
}: {
  item: SearchResult;
  query: string;
  selected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const isInvoice = item.type === "invoice";
  const st = STATUS_CONFIG[item.status ?? ""] ?? STATUS_CONFIG.draft;

  return (
    <button
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 16px",
        textAlign: "left",
        background: selected ? "var(--color-background-secondary)" : "transparent",
        border: "none",
        cursor: "pointer",
        transition: "background 0.1s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Icon circle */}
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: isInvoice ? "#E6F1FB" : "#EAF3DE",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: isInvoice ? "#185FA5" : "#3B6D11",
      }}>
        {isInvoice ? <IconInvoice /> : <IconDoc />}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
            <Highlight text={item.title} query={query} />
          </span>
          {isInvoice && item.status && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 20,
              background: st.bg,
              color: st.text,
              flexShrink: 0,
            }}>
              {st.label}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Highlight text={item.subtitle} query={query} />
          {item.meta ? <span style={{ color: "var(--color-text-tertiary)" }}> · {item.meta}</span> : null}
        </p>
      </div>

      {/* Trailing */}
      {isInvoice && item.meta ? (
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", flexShrink: 0 }}>
          {item.meta}
        </span>
      ) : (
        <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>
          <IconChevron />
        </span>
      )}
    </button>
  );
}

// ─── Kbd hint ─────────────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "1px 5px",
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-secondary)",
      borderRadius: 4,
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      color: "var(--color-text-secondary)",
    }}>
      {children}
    </kbd>
  );
}

// ─── Main SearchBar ───────────────────────────────────────────────────────────

export function SearchBar() {
  const router = useRouter();
  const { query, setQuery, results, loading, clear } = useSearch({ debounceMs: 200 });

  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const invoices = results.filter((r) => r.type === "invoice");
  const docs = results.filter((r) => r.type === "document");

  const showRecent = open && query.length < 2;
  const showResults = open && query.length >= 2;

  const navItems: Array<{ kind: "recent"; value: string } | { kind: "result"; value: SearchResult }> =
    showRecent
      ? recent.map((v) => ({ kind: "recent", value: v }))
      : results.map((v) => ({ kind: "result", value: v }));

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Load recent on open
  useEffect(() => {
    if (open) setRecent(getRecent());
  }, [open]);

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

  // Close on outside click (desktop only)
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!isMobile && !containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isMobile]);

  // Lock body scroll on mobile overlay
  useEffect(() => {
    if (isMobile && open) {
      document.body.style.overflow = "hidden";
      // Focus mobile input after overlay animates in
      setTimeout(() => mobileInputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isMobile, open]);

  // Reset selectedIdx on results change
  useEffect(() => {
    setSelectedIdx(-1);
  }, [results, recent]);

  // ─── helpers ──────────────────────────────────────────────────────────────

  function recentIdx(i: number) { return i; }
  function resultIdx(item: SearchResult) { return results.indexOf(item); }

  const openSearch = useCallback(() => {
    setOpen(true);
    if (!isMobile) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isMobile]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    clear();
    if (inputRef.current) inputRef.current.value = "";
    if (mobileInputRef.current) mobileInputRef.current.value = "";
  }, [clear]);

  const navigate = useCallback(
    (result: SearchResult) => {
      saveRecent(result.title);
      closeSearch();
      router.push(result.href);
    },
    [router, closeSearch]
  );

  const applyRecent = useCallback(
    (term: string) => {
      const ref = isMobile ? mobileInputRef : inputRef;
      if (ref.current) ref.current.value = term;
      setQuery(term);
      setSelectedIdx(-1);
    },
    [setQuery, isMobile]
  );

  // ─── keyboard ─────────────────────────────────────────────────────────────

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

  // ─── shared input handler ─────────────────────────────────────────────────

  function onInputChange(val: string) {
    setQuery(val);
    setSelectedIdx(-1);
    if (!open) setOpen(true);
  }

  // ─── Dropdown content (shared between desktop/mobile) ────────────────────

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
                aria-selected={selectedIdx === recentIdx(i)}
                onMouseEnter={() => setSelectedIdx(recentIdx(i))}
                onClick={() => applyRecent(term)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  textAlign: "left",
                  background: selectedIdx === recentIdx(i) ? "var(--color-background-secondary)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                  <IconClock />
                </span>
                <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>{term}</span>
              </button>
            ))}
          </>
        )}

        {/* Empty state */}
        {showResults && !loading && results.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "var(--color-text-tertiary)", margin: 0 }}>
              Geen resultaten voor{" "}
              <strong style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>
                &ldquo;{query}&rdquo;
              </strong>
            </p>
          </div>
        )}

        {/* Invoices section */}
        {showResults && invoices.length > 0 && (
          <>
            <SectionLabel>Facturen ({invoices.length})</SectionLabel>
            {invoices.map((item) => (
              <ResultRow
                key={item.id}
                item={item}
                query={query}
                selected={selectedIdx === resultIdx(item)}
                onMouseEnter={() => setSelectedIdx(resultIdx(item))}
                onClick={() => navigate(item)}
              />
            ))}
          </>
        )}

        {/* Documents section */}
        {showResults && docs.length > 0 && (
          <>
            <SectionLabel>Documenten ({docs.length})</SectionLabel>
            {docs.map((item) => (
              <ResultRow
                key={item.id}
                item={item}
                query={query}
                selected={selectedIdx === resultIdx(item)}
                onMouseEnter={() => setSelectedIdx(resultIdx(item))}
                onClick={() => navigate(item)}
              />
            ))}
          </>
        )}
      </>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Inject keyframe for spinner */}
      <style>{`@keyframes bb-spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Desktop trigger + dropdown ── */}
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", maxWidth: 320 }}
        className="hidden sm:block"
      >
        {/* Input pill */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--color-background-secondary)",
          border: open
            ? "1px solid var(--color-border-primary)"
            : "1px solid var(--color-border-tertiary)",
          borderRadius: 12,
          transition: "border-color 0.15s, box-shadow 0.15s",
          boxShadow: open ? "0 0 0 3px rgba(0,0,0,0.04)" : "none",
        }}>
          <span style={{ color: loading ? "var(--color-text-tertiary)" : "var(--color-text-tertiary)", flexShrink: 0 }}>
            {loading ? <IconSpinner size={16} /> : <IconSearch size={16} />}
          </span>
          <input
            ref={inputRef}
            type="text"
            defaultValue=""
            placeholder="Zoeken…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Zoeken"
            aria-expanded={open}
            aria-haspopup="listbox"
            role="combobox"
            aria-autocomplete="list"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "var(--color-text-primary)",
              minWidth: 0,
            }}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
          />
          {query ? (
            <button
              tabIndex={-1}
              aria-label="Zoekopdracht wissen"
              onClick={() => { clear(); if (inputRef.current) inputRef.current.value = ""; }}
              style={{
                background: "none",
                border: "none",
                padding: 2,
                cursor: "pointer",
                color: "var(--color-text-tertiary)",
                display: "flex",
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              <IconX size={14} />
            </button>
          ) : (
            <kbd style={{
              padding: "1px 5px",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-tertiary)",
              background: "var(--color-background-primary)",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: 4,
              userSelect: "none",
              flexShrink: 0,
            }}>
              ⌘K
            </kbd>
          )}
        </div>

        {/* Desktop dropdown */}
        {open && (showRecent || showResults) && (
          <div
            role="listbox"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              background: "var(--color-background-primary)",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: 14,
              boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
              zIndex: 50,
              overflow: "hidden",
            }}
          >
            <div style={{ maxHeight: 360, overflowY: "auto", overscrollBehavior: "contain" }}>
              <DropdownContent />
            </div>
            {/* Footer */}
            <div style={{
              display: "flex",
              gap: 12,
              padding: "8px 16px",
              borderTop: "0.5px solid var(--color-border-tertiary)",
              background: "var(--color-background-secondary)",
            }}>
              {[["↑↓", "navigeren"], ["↵", "openen"], ["Esc", "sluiten"]].map(([key, label]) => (
                <span key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  <Kbd>{key}</Kbd> {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile: tap target → full-screen overlay ── */}
      <button
        className="sm:hidden"
        aria-label="Zoeken openen"
        onClick={openSearch}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          cursor: "pointer",
          color: "var(--color-text-secondary)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <IconSearch size={18} />
      </button>

      {/* Mobile full-screen overlay */}
      {isMobile && open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "var(--color-background-primary)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Safe area top + header */}
          <div style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            borderBottom: "0.5px solid var(--color-border-tertiary)",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
            }}>
              {/* Search input */}
              <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                background: "var(--color-background-secondary)",
                borderRadius: 12,
                border: "0.5px solid var(--color-border-secondary)",
              }}>
                <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                  {loading ? <IconSpinner size={16} /> : <IconSearch size={16} />}
                </span>
                <input
                  ref={mobileInputRef}
                  type="search"
                  defaultValue=""
                  placeholder="Zoeken naar facturen, documenten…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Zoeken"
                  role="combobox"
                  aria-expanded={true}
                  aria-autocomplete="list"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: 16, // iOS prevents zoom at 16px
                    color: "var(--color-text-primary)",
                    minWidth: 0,
                  }}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                {query && (
                  <button
                    tabIndex={-1}
                    aria-label="Wissen"
                    onClick={() => { clear(); if (mobileInputRef.current) mobileInputRef.current.value = ""; }}
                    style={{
                      background: "var(--color-background-tertiary)",
                      border: "none",
                      borderRadius: "50%",
                      width: 18,
                      height: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "var(--color-text-secondary)",
                      flexShrink: 0,
                    }}
                  >
                    <IconX size={10} />
                  </button>
                )}
              </div>

              {/* Cancel button */}
              <button
                onClick={closeSearch}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 16,
                  fontWeight: 500,
                  color: "var(--color-text-info, #185FA5)",
                  cursor: "pointer",
                  padding: "4px 0 4px 4px",
                  whiteSpace: "nowrap",
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
              flex: 1,
              overflowY: "auto",
              overscrollBehavior: "contain",
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