// src/components/nav/SubPageHeaderContext.tsx
// [SUBNAV] Lets a dashboard page push a DYNAMIC title (and optional right-side
// actions) into the ONE shared sticky sub-page header — without the page drawing
// its own bar. Needed for routes whose title isn't a static path→label mapping:
// /dashboard/invoice/[id] ("Factuur 263323"), /dashboard/clients/[id] (the client
// name), etc., and for pages that want a small action (menu, convert, unlink) in
// the bar.
//
// Flow: the provider (mounted once in the dashboard layout) holds the current
// config; a page calls useSubPageHeader({ title, actions }, [deps]) to register it
// on mount and clear it on unmount; DashboardChrome reads it and prefers it over
// the static path→title map. Pure client state — no portals, no DOM probing.

"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

export type SubPageHeaderConfig = {
  /** Overrides the static/pattern title for the current route. */
  title?: string;
  /** Optional right-aligned node (e.g. a small menu or action button). */
  actions?: ReactNode;
};

const ConfigContext = createContext<SubPageHeaderConfig | null>(null);
const SetContext = createContext<(c: SubPageHeaderConfig | null) => void>(() => {});

export function SubPageHeaderProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SubPageHeaderConfig | null>(null);
  const set = useCallback((c: SubPageHeaderConfig | null) => setConfig(c), []);
  return (
    <SetContext.Provider value={set}>
      <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
    </SetContext.Provider>
  );
}

/** Read the current dynamic header config (used by DashboardChrome). */
export function useSubPageHeaderConfig(): SubPageHeaderConfig | null {
  return useContext(ConfigContext);
}

/**
 * Register a dynamic title / actions for the current page's shared header.
 * Pass a `deps` array that changes whenever `title` or `actions` should update
 * (e.g. [invoiceNumber] or [clientName, isBusy]) — the config is re-applied then,
 * and cleared on unmount so the next page starts fresh.
 */
export function useSubPageHeader(
  config: SubPageHeaderConfig,
  deps: readonly unknown[]
): void {
  const set = useContext(SetContext);
  useEffect(() => {
    set(config);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, ...deps]);
}
