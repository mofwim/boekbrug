// src/app/dashboard/bestanden/tokens.ts
// [BOEK-033] BoekBrug Design System v1.0 — ZZP / Material You
// Single source — import everywhere inside bestanden/

export const T = {
  primary:            "#1A73E8",
  primaryContainer:   "#D3E3FD",
  onPrimary:          "#FFFFFF",
  onPrimaryContainer: "#041E49",
  secondary:          "#00897B",
  secondaryContainer: "#B2DFDB",
  surface:            "#ffffff",
  surfaceVariant:     "#f1f3f4",
  onSurface:          "#202124",
  outline:            "#80868b",
  error:              "#B3261E",
  errorContainer:     "#F9DEDC",
  success:            "#34A853",
  successContainer:   "#CEEAD6",
  warning:            "#E37400",
  warningContainer:   "#FEE8C4",
  star:               "#FBBC04",
  elev1: "0 1px 2px rgba(0,0,0,0.08)",
  elev2: "0 2px 6px rgba(0,0,0,0.12)",
  elev3: "0 4px 12px rgba(0,0,0,0.16)",
  sm:   "8px",
  md:   "12px",
  lg:   "16px",
  xl:   "24px",
  full: "9999px",
} as const;

export type Token = typeof T;