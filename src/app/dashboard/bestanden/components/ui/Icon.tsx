"use client";
// src/app/dashboard/bestanden/components/ui/Icon.tsx
// [BOEK-033] Material Symbols Outlined icon wrapper
// Requires in layout.tsx:
// <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&family=Google+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, lineHeight: 1, userSelect: "none", color, ...style }}
      aria-hidden>
      {name}
    </span>
  );
}