"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="nl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          backgroundColor: "#f8f9fa",
          color: "#202124",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <p style={{ fontSize: 48, fontWeight: 700, color: "#dadce0", margin: 0 }}>!</p>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "16px 0 4px" }}>
            Er is iets misgegaan
          </h1>
          <p style={{ fontSize: 14, color: "#9aa0a6", margin: 0 }}>
            Er is iets misgegaan. Probeer het opnieuw.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "center",
              marginTop: 20,
            }}
          >
            <button
              onClick={() => reset()}
              style={{
                backgroundColor: "#1a73e8",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                padding: "10px 20px",
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
              }}
            >
              Opnieuw proberen
            </button>
            <Link
              href="/"
              style={{
                border: "1px solid #e0e0e0",
                color: "#1a73e8",
                fontSize: 14,
                fontWeight: 500,
                padding: "10px 20px",
                borderRadius: 12,
                textDecoration: "none",
              }}
            >
              Terug naar de startpagina
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
