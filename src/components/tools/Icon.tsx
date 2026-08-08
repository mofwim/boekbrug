// src/components/tools/Icon.tsx
// [PDF-TOOLS] A small icon set drawn inline — no icon font, no extra request,
// and they inherit colour from the surface they sit on. Only the shapes these
// tools actually use, so nobody has to prune it later.
"use client";

const PATHS: Record<string, string> = {
  chevron: "m9 6 6 6-6 6",
  check: "m5 12.5 4.5 4.5L19 7",
  alert: "M12 8v5M12 17h.01 M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  download: "M12 3v12M7.5 11l4.5 4.5 4.5-4.5 M4 20h16",
  file: "M14 3v5h5 M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M9 10a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 9 10 M21 15.5 16 11l-9 8.5",
  shuffle: "M17 3.5 20.5 7 17 10.5 M3 7h3.5l3 4.5 M3 17h3.5L14 6h6.5 M17 13.5 20.5 17 17 20.5 M14 17h6.5",
  crop: "M6.5 2v13.5a2 2 0 0 0 2 2H22 M2 6.5h13.5a2 2 0 0 1 2 2V22",
  trash: "M4 7h16 M10 11v6M14 11v6 M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12 M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 11a8 8 0 0 0-14-4.5L4 9 M4 5v4h4 M4 13a8 8 0 0 0 14 4.5L20 15 M20 19v-4h-4",
  link: "M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.5 6 M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7L12.5 18",
  eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3 M5 10h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z",
  pencil: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z M14 6l4 4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M21 21l-4.2-4.2",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.4a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1.2Z",
};

export default function Icon({
  name,
  size = 16,
  className = "",
  strokeWidth = 1.7,
}: {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}
