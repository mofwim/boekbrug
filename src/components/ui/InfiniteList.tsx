// src/components/ui/InfiniteList.tsx
// [BoekBrug v1.2] — BOEK-009 — Infinite Scroll container
// iOS-first, mobile-responsive, no external library
// IntersectionObserver triggers loadMore at bottom sentinel

"use client";

import { useEffect, useRef, ReactNode } from "react";

interface InfiniteListProps {
  /** The list items to render */
  children: ReactNode;
  /** Called when sentinel comes into view — fetch next page */
  onLoadMore: () => void;
  /** True while a page is being fetched */
  loading: boolean;
  /** False when all pages have been loaded */
  hasMore: boolean;
  /** Optional error string — shown inline */
  error?: string | null;
  /** Empty state — shown when children is empty and not loading */
  emptyState?: ReactNode;
  /** Pull-to-refresh on mobile */
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
  className?: string;
}

// ─── Pull-to-refresh threshold (px) ──────────────────────────────────────────
const PTR_THRESHOLD = 72;

export function InfiniteList({
  children,
  onLoadMore,
  loading,
  hasMore,
  error,
  emptyState,
  onRefresh,
  refreshing,
  className = "",
}: InfiniteListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── IntersectionObserver — triggers next page ──────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      {
        // [BOEK-009] 200px rootMargin so load starts before user hits bottom — May 2026
        rootMargin: "0px 0px 200px 0px",
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  // ── Pull-to-refresh (touch only) ──────────────────────────────────────────
  useEffect(() => {
    if (!onRefresh) return;
    const container = containerRef.current;
    if (!container) return;

    let startY = 0;
    let pulling = false;
    let pullIndicator: HTMLDivElement | null = null;

    const onTouchStart = (e: TouchEvent) => {
      // Only trigger when scrolled to top
      if (container.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { pulling = false; return; }

      if (!pullIndicator) {
        pullIndicator = document.createElement("div");
        pullIndicator.className = "bb-ptr-indicator";
        pullIndicator.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>`;
        container.prepend(pullIndicator);
      }

      const progress = Math.min(dy / PTR_THRESHOLD, 1);
      pullIndicator.style.opacity = String(progress);
      pullIndicator.style.transform = `translateY(${Math.min(dy * 0.4, PTR_THRESHOLD * 0.4)}px) rotate(${progress * 360}deg)`;
    };

    const onTouchEnd = async (e: TouchEvent) => {
      if (!pulling) return;
      const dy = e.changedTouches[0].clientY - startY;
      pulling = false;

      if (dy >= PTR_THRESHOLD && onRefresh) {
        await onRefresh();
      }

      if (pullIndicator) {
        pullIndicator.remove();
        pullIndicator = null;
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [onRefresh]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isEmpty =
    !loading &&
    !error &&
    Array.isArray(children)
      ? (children as ReactNode[]).length === 0
      : children == null;

  return (
    <>
      {/* Pull-to-refresh spinner (controlled state) */}
      {refreshing && (
        <div className="bb-ptr-bar" aria-live="polite" aria-label="Vernieuwen…">
          <svg
            className="bb-ptr-spin"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          <span className="sr-only">Vernieuwen…</span>
        </div>
      )}

      <div ref={containerRef} className={`bb-infinite-list ${className}`}>
        {/* Content */}
        {isEmpty && !loading ? (
          emptyState ?? (
            <div className="bb-empty-state">
              <span>Geen facturen gevonden</span>
            </div>
          )
        ) : (
          children
        )}

        {/* Error */}
        {error && (
          <div className="bb-error-row" role="alert">
            <span>{error}</span>
            <button
              onClick={onLoadMore}
              className="bb-retry-btn"
              aria-label="Opnieuw proberen"
            >
              Opnieuw
            </button>
          </div>
        )}

        {/* Loading skeleton rows */}
        {loading && (
          <div aria-busy="true" aria-label="Laden…">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bb-skeleton-row">
                <div className="bb-skeleton bb-skeleton-title" />
                <div className="bb-skeleton bb-skeleton-sub" />
              </div>
            ))}
          </div>
        )}

        {/* End-of-list message */}
        {!hasMore && !loading && !isEmpty && (
          <p className="bb-end-label">Alle facturen geladen</p>
        )}

        {/* Intersection sentinel — invisible, triggers loadMore */}
        <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      </div>

      {/* Scoped styles — no Tailwind dependency for this component */}
      <style>{`
        .bb-infinite-list {
          position: relative;
          overflow-anchor: none; /* prevent scroll jump on prepend */
        }

        /* Pull-to-refresh bar */
        .bb-ptr-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 36px;
          color: #5f6368;
          background: transparent;
        }
        .bb-ptr-spin {
          animation: bb-spin 0.8s linear infinite;
        }
        @keyframes bb-spin {
          to { transform: rotate(360deg); }
        }

        /* Pull indicator (injected via JS) */
        .bb-ptr-indicator {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          color: #5f6368;
          pointer-events: none;
          transition: opacity 0.1s;
          z-index: 10;
        }

        /* Empty state */
        .bb-empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          color: #9aa0a6;
          font-size: 0.9rem;
          text-align: center;
        }

        /* Error row */
        .bb-error-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          color: #ea4335;
          font-size: 0.875rem;
          background: #fef2f2;
          border-radius: 10px;
          margin: 8px 0;
        }
        .bb-retry-btn {
          font-size: 0.8rem;
          font-weight: 600;
          color: #ea4335;
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        }
        .bb-retry-btn:active {
          background: #fce8e6;
        }

        /* Skeleton rows */
        .bb-skeleton-row {
          padding: 14px 16px;
          border-bottom: 1px solid #f1f3f4;
        }
        .bb-skeleton {
          background: linear-gradient(90deg, #f1f3f4 25%, #e0e0e0 50%, #f1f3f4 75%);
          background-size: 200% 100%;
          border-radius: 6px;
          animation: bb-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes bb-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .bb-skeleton-title {
          height: 14px;
          width: 55%;
          margin-bottom: 8px;
        }
        .bb-skeleton-sub {
          height: 11px;
          width: 35%;
        }

        /* End-of-list */
        .bb-end-label {
          text-align: center;
          font-size: 0.78rem;
          color: #dadce0;
          padding: 20px 0 8px;
          letter-spacing: 0.02em;
        }

        /* iOS safe area — bottom padding for notch devices */
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          .bb-infinite-list {
            padding-bottom: env(safe-area-inset-bottom);
          }
        }
      `}</style>
    </>
  );
}