// src/components/tools/DashboardTools.tsx
// [DASHBOARD-TOOLS] The file tools, within reach from inside the app.
//
// LINKS, not components. Every one of these pages loads pdf-lib or pdfjs — a
// megabyte between them — and the dashboard is the screen people open every
// day. Rendering the tools here would put that in its first load whether or not
// anybody touches a file, which is the exact shape of the finding in
// bundle-weight-gates.test.ts: a deferral written, commented, and cancelled by
// an ordinary import somewhere along the chain. An <a> costs nothing.
//
// Not every tool is here either. The market has favicon generators and
// Instagram sizes; those belong on /tools, where somebody who wants one goes
// looking. What a bookkeeping screen should offer is the handful that come up
// while handling documents — and the shorter the list, the more it reads as an
// answer rather than as a drawer.

import Link from "next/link";

interface Tool {
  slug: string;
  emoji: string;
  label: string;
  /** Why it is on THIS screen — the moment it answers, not what it does. */
  when: string;
}

/** For the owner: getting documents in, and out again in one piece. */
const FOR_OWNER: Tool[] = [
  { slug: "/pdf-verkleinen", emoji: "📉", label: "PDF verkleinen", when: "Te groot om te uploaden" },
  { slug: "/afbeeldingen-naar-pdf", emoji: "🖼️", label: "Foto's naar PDF", when: "Bonnetjes als één document" },
  { slug: "/pdf-samenvoegen", emoji: "🔗", label: "PDF samenvoegen", when: "Losse pagina's bij elkaar" },
  { slug: "/pdf-splitsen", emoji: "✂️", label: "PDF splitsen", when: "Eén bon uit een hele stapel" },
  { slug: "/pdf-ondertekenen", emoji: "🖊️", label: "PDF ondertekenen", when: "Offerte tekenen zonder printen" },
  { slug: "/afbeelding-verkleinen", emoji: "📷", label: "Foto verkleinen", when: "Telefoonfoto van 4 MB" },
];

/** For the accountant: the same work, plus what you do to somebody else's file. */
const FOR_ACCOUNTANT: Tool[] = [
  { slug: "/pdf-samenvoegen", emoji: "🔗", label: "PDF samenvoegen", when: "Stukken van één klant bundelen" },
  { slug: "/pdf-splitsen", emoji: "✂️", label: "PDF splitsen", when: "Eén factuur uit een batch" },
  { slug: "/pdf-verkleinen", emoji: "📉", label: "PDF verkleinen", when: "Te groot om door te sturen" },
  { slug: "/pdf-paginas-ordenen", emoji: "🔃", label: "Pagina's ordenen", when: "Scheve scan rechtzetten" },
  { slug: "/pdf-naar-tekst", emoji: "📝", label: "PDF naar tekst", when: "Bedragen overnemen" },
  { slug: "/pdf-eigenschappen", emoji: "🏷️", label: "PDF-eigenschappen", when: "Naam eruit voor je doorstuurt" },
];

export default function DashboardTools({ audience }: { audience: "owner" | "accountant" }) {
  const tools = audience === "accountant" ? FOR_ACCOUNTANT : FOR_OWNER;

  return (
    <section
      aria-labelledby="dashboard-tools-heading"
      style={{ marginTop: 32, fontFamily: "'Roboto', system-ui, sans-serif" }}
    >
      <h2
        id="dashboard-tools-heading"
        style={{ fontSize: 15, fontWeight: 600, color: "#202124", margin: "0 0 4px" }}
      >
        Gereedschap voor je bestanden
      </h2>
      <p style={{ fontSize: 13, color: "#5f6368", margin: "0 0 14px" }}>
        Gratis, en alles gebeurt in je eigen browser — je bestand wordt nergens naartoe gestuurd.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 10,
        }}
      >
        {tools.map((tool) => (
          <Link
            key={tool.slug}
            href={tool.slug}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 14,
              padding: "12px 14px",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
              {tool.emoji}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "#202124",
                }}
              >
                {tool.label}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "#5f6368" }}>{tool.when}</span>
            </span>
          </Link>
        ))}
      </div>

      <Link
        href="/tools"
        style={{
          display: "inline-block",
          marginTop: 12,
          fontSize: 13,
          fontWeight: 600,
          color: "#1a73e8",
          textDecoration: "none",
        }}
      >
        Alle gratis tools →
      </Link>
    </section>
  );
}
