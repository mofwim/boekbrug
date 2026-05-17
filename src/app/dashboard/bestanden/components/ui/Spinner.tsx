"use client";
// src/app/dashboard/bestanden/components/ui/Spinner.tsx
// [BOEK-033] Material You loading spinner

import { T } from "../../tokens";

export function Spinner({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: "m3spin 0.8s linear infinite" }}>
      <style>{`@keyframes m3spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="12" cy="12" r="10" stroke={T.primaryContainer} strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={T.primary} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}