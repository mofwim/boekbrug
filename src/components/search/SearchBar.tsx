// components/search/SearchBar.tsx
// Global search bar with keyboard nav, highlight, recent searches (BOEK-012)

"use client";

import { useCallback, useEffect, useRef, useState, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useSearch } from "@/hooks/useSearch";
import type { SearchResult } from "@/lib/search";

// ─── constants ────────────────────────────────────────────────────────────────

const RECENT_KEY = "bb_recent_searches";
const MAX_RECENT = 5;

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  draft:   { label: "Concept",    cls: "bg-gray-100 text-gray-500" },
  sent:    { label: "Verzonden",  cls: "bg-blue-100 text-blue-600" },
  paid:    { label: "Betaald",    cls: "bg-green-100 text-green-700" },
  overdue: { label: "Verlopen",   cls: "bg-red-100 text-red-600" },
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
  const next = [term, ...getRecent().filter((s) => s !== term)].slice(
    0,
    MAX_RECENT
  );
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

// Wraps matched chars in <mark> — safe, no dangerouslySetInnerHTML
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
            className="bg-yellow-100 text-yellow-900 rounded-sm px-0.5 not-italic"
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

// ─── sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-2.5 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wider select-none">
      {children}
    </div>
  );
}

function KbdHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
      {children}
    </kbd>
  );
}

// ─── icons ────────────────────────────────────────────────────────────────────

function IconSearch({ spinning }: { spinning: boolean }) {
  if (spinning)
    return (
      <div
        className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin flex-shrink-0"
        aria-hidden="true"
      />
    );
  return (
    <svg
      className="w-4 h-4 text-gray-400 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" strokeWidth="2" />
      <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function SearchBar() {
  const router = useRouter();
  const { query, setQuery, results, loading, clear } = useSearch({
    debounceMs: 200,
  });

  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Split results into sections for display
  const invoices = results.filter((r) => r.type === "invoice");
  const docs = results.filter((r) => r.type === "document");

  const showRecent = open && query.length < 2;
  const showResults = open && query.length >= 2;

  // Items navigated by ↑↓ — recent OR result rows (not section headers)
  const navItems: Array<{ kind: "recent"; value: string } | { kind: "result"; value: SearchResult }> =
    showRecent
      ? recent.map((v) => ({ kind: "recent", value: v }))
      : results.map((v) => ({ kind: "result", value: v }));

  // Load recent on open
  useEffect(() => {
    if (open) setRecent(getRecent());
  }, [open]);

  // ⌘K / Ctrl+K global shortcut
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Reset selectedIdx when results change
  useEffect(() => {
    setSelectedIdx(-1);
  }, [results, recent]);

  // ─── actions ────────────────────────────────────────────────────────────────

  const navigate = useCallback(
    (result: SearchResult) => {
      saveRecent(result.title);
      setOpen(false);
      clear();
      if (inputRef.current) inputRef.current.value = "";
      router.push(result.href);
    },
    [router, clear]
  );

  const applyRecent = useCallback(
    (term: string) => {
      if (inputRef.current) inputRef.current.value = term;
      setQuery(term);
      setSelectedIdx(-1);
    },
    [setQuery]
  );

  // ─── keyboard ───────────────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      setOpen(true);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, navItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, -1));
        break;
      case "Enter": {
        e.preventDefault();
        if (selectedIdx < 0 || !navItems[selectedIdx]) break;
        const item = navItems[selectedIdx];
        if (item.kind === "recent") applyRecent(item.value);
        else navigate(item.value);
        break;
      }
      case "Escape":
        setOpen(false);
        inputRef.current?.blur();
        break;
    }
  }

  // ─── render helpers ─────────────────────────────────────────────────────────

  function recentIdx(i: number) {
    return i; // recent items fill navItems[0..n]
  }

  function resultIdx(result: SearchResult) {
    return results.indexOf(result); // navItems mirrors results order
  }

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      {/* Input */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-white border rounded-xl transition-colors ${
          open
            ? "border-gray-400 ring-1 ring-gray-200"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <IconSearch spinning={loading} />
        <input
          ref={inputRef}
          type="text"
          defaultValue=""
          placeholder="Zoeken…"
          className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Zoeken"
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
          aria-autocomplete="list"
        />
        {query ? (
          <button
            onClick={() => {
              clear();
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0 transition-colors"
            tabIndex={-1}
            aria-label="Zoekopdracht wissen"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-400 flex-shrink-0 select-none">
            ⌘K
          </kbd>
        )}
      </div>

      {/* Dropdown */}
      {open && (showRecent || showResults) && (
        <div
          role="listbox"
          className="absolute top-full mt-1.5 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
        >
          <div className="max-h-[340px] overflow-y-auto overscroll-contain">

            {/* Recent searches */}
            {showRecent && recent.length > 0 && (
              <>
                <SectionLabel>Recent</SectionLabel>
                {recent.map((term, i) => (
                  <button
                    key={term}
                    role="option"
                    aria-selected={selectedIdx === recentIdx(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      selectedIdx === recentIdx(i)
                        ? "bg-gray-50"
                        : "hover:bg-gray-50"
                    }`}
                    onMouseEnter={() => setSelectedIdx(recentIdx(i))}
                    onClick={() => applyRecent(term)}
                  >
                    <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-gray-600">{term}</span>
                  </button>
                ))}
              </>
            )}

            {/* Empty state */}
            {showResults && !loading && results.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm text-gray-400">
                  Geen resultaten voor{" "}
                  <strong className="text-gray-600">&ldquo;{query}&rdquo;</strong>
                </p>
              </div>
            )}

            {/* Invoices */}
            {showResults && invoices.length > 0 && (
              <>
                <SectionLabel>Facturen ({invoices.length})</SectionLabel>
                {invoices.map((item) => {
                  const idx = resultIdx(item);
                  const st = STATUS_STYLES[item.status ?? ""] ?? STATUS_STYLES.draft;
                  return (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected={selectedIdx === idx}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-50 last:border-0 ${
                        selectedIdx === idx ? "bg-gray-50" : "hover:bg-gray-50"
                      }`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => navigate(item)}
                    >
                      {/* Invoice icon */}
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">
                            <Highlight text={item.title} query={query} />
                          </span>
                          {item.status && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>
                              {st.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          <Highlight text={item.subtitle} query={query} />
                        </p>
                      </div>
                      {/* Amount */}
                      {item.meta && (
                        <span className="text-sm font-medium text-gray-700 flex-shrink-0">
                          {item.meta}
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}

            {/* Documents */}
            {showResults && docs.length > 0 && (
              <>
                <SectionLabel>Documenten ({docs.length})</SectionLabel>
                {docs.map((item) => {
                  const idx = resultIdx(item);
                  return (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected={selectedIdx === idx}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                        selectedIdx === idx ? "bg-gray-50" : "hover:bg-gray-50"
                      }`}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => navigate(item)}
                    >
                      {/* Doc icon */}
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          <Highlight text={item.title} query={query} />
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <Highlight text={item.subtitle} query={query} />
                          {item.meta ? ` · ${item.meta}` : ""}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Footer — keyboard hints */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 bg-gray-50">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <KbdHint>↑↓</KbdHint> navigeren
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <KbdHint>↵</KbdHint> openen
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <KbdHint>Esc</KbdHint> sluiten
            </span>
          </div>
        </div>
      )}
    </div>
  );
}