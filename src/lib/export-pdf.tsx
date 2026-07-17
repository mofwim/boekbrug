// lib/export-pdf.tsx
// PDF exports: BTW Aangifte + Factuuroverzicht (BOEK-014)
// Uses @react-pdf/renderer — same library as invoice-pdf.tsx
// Server-side generation only (called from API routes).

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { BtwSummary, InvRow } from "./export";
import { calcBtwRate, fmtDateNL } from "./export";

// ─── Shared styles ────────────────────────────────────────────────────────────

const shared = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    backgroundColor: "#ffffff",
  },
  // Page header band
  headerBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 32,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  brandName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#202124",
  },
  brandSub: {
    fontSize: 9,
    color: "#9aa0a6",
    marginTop: 2,
  },
  docTitle: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#202124",
    textAlign: "right",
  },
  docSub: {
    fontSize: 10,
    color: "#5f6368",
    textAlign: "right",
    marginTop: 3,
  },
  // Info block (gray background)
  infoBlock: {
    padding: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 6,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 9,
    color: "#9aa0a6",
    width: 120,
  },
  infoValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#202124",
    flex: 1,
  },
  // Section label
  sectionLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#9aa0a6",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableRowAlt: {
    flexDirection: "row",
    padding: 8,
    backgroundColor: "#fafafa",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  headerText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#5f6368",
  },
  cellText: {
    fontSize: 9,
    color: "#202124",
  },
  // Totals
  totalsBlock: {
    marginTop: 16,
    alignItems: "flex-end",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 220,
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 10,
    color: "#5f6368",
  },
  totalValue: {
    fontSize: 10,
    color: "#202124",
  },
  totalFinalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 220,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: "#202124",
  },
  totalFinalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#202124",
  },
  totalFinalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#202124",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: "#d1d5db",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingTop: 8,
  },
});

// ─── Format helpers ───────────────────────────────────────────────────────────

function eur(n: number): string {
  return `€ ${n.toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function today(): string {
  return new Date().toLocaleDateString("nl-NL");
}

// ─── BTW Aangifte PDF ─────────────────────────────────────────────────────────

/**
 * PDF document voor BTW aangifte.
 * Bevat omzetoverzicht per tarief (0%, 9%, 21%) en totaal te betalen BTW.
 * Bedoeld als bijlage bij de kwartaalaangifte bij de Belastingdienst.
 */
function BtwAangiftePDF({
  summary,
  companyName,
}: {
  summary: BtwSummary;
  companyName: string;
}) {
  return (
    <Document>
      <Page size="A4" style={shared.page}>
        {/* Header */}
        <View style={shared.headerBand}>
          <View>
            <Text style={shared.brandName}>BoekBrug</Text>
            <Text style={shared.brandSub}>
              De brug tussen jou en je boekhouder
            </Text>
          </View>
          <View>
            <Text style={shared.docTitle}>BTW Aangifte</Text>
            <Text style={shared.docSub}>{summary.period}</Text>
          </View>
        </View>

        {/* Bedrijfsinformatie */}
        <View style={shared.infoBlock}>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Bedrijf</Text>
            <Text style={shared.infoValue}>{companyName}</Text>
          </View>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Periode</Text>
            <Text style={shared.infoValue}>{summary.period}</Text>
          </View>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Aantal facturen</Text>
            <Text style={shared.infoValue}>{summary.invoiceCount}</Text>
          </View>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Gegenereerd op</Text>
            <Text style={shared.infoValue}>{today()}</Text>
          </View>
        </View>

        {/* Omzetoverzicht per tarief */}
        <Text style={shared.sectionLabel}>Omzetoverzicht per BTW-tarief</Text>

        <View style={shared.tableHeader}>
          <Text style={[shared.headerText, { flex: 2 }]}>Omschrijving</Text>
          <Text style={[shared.headerText, { flex: 1, textAlign: "right" }]}>
            Omzet excl. BTW
          </Text>
          <Text style={[shared.headerText, { flex: 1, textAlign: "right" }]}>
            BTW bedrag
          </Text>
        </View>

        {/* 0% */}
        <View style={shared.tableRow}>
          <Text style={[shared.cellText, { flex: 2 }]}>
            Omzet belast met 0%
          </Text>
          <Text style={[shared.cellText, { flex: 1, textAlign: "right" }]}>
            {eur(summary.btw0)}
          </Text>
          <Text style={[shared.cellText, { flex: 1, textAlign: "right" }]}>
            {eur(summary.btwBedrag0)}
          </Text>
        </View>

        {/* 9% */}
        <View style={shared.tableRowAlt}>
          <Text style={[shared.cellText, { flex: 2 }]}>
            Omzet belast met 9%
          </Text>
          <Text style={[shared.cellText, { flex: 1, textAlign: "right" }]}>
            {eur(summary.btw9)}
          </Text>
          <Text style={[shared.cellText, { flex: 1, textAlign: "right" }]}>
            {eur(summary.btwBedrag9)}
          </Text>
        </View>

        {/* 21% */}
        <View style={shared.tableRow}>
          <Text style={[shared.cellText, { flex: 2 }]}>
            Omzet belast met 21%
          </Text>
          <Text style={[shared.cellText, { flex: 1, textAlign: "right" }]}>
            {eur(summary.btw21)}
          </Text>
          <Text style={[shared.cellText, { flex: 1, textAlign: "right" }]}>
            {eur(summary.btwBedrag21)}
          </Text>
        </View>

        {/* Totalen */}
        <View style={shared.totalsBlock}>
          <View style={shared.totalRow}>
            <Text style={shared.totalLabel}>Totale omzet excl. BTW</Text>
            <Text style={shared.totalValue}>{eur(summary.totalExBtw)}</Text>
          </View>
          <View style={shared.totalRow}>
            <Text style={shared.totalLabel}>Totale omzet incl. BTW</Text>
            <Text style={shared.totalValue}>{eur(summary.totalIncBtw)}</Text>
          </View>
          <View style={shared.totalFinalRow}>
            <Text style={shared.totalFinalLabel}>Te betalen BTW</Text>
            <Text style={shared.totalFinalValue}>
              {eur(summary.btwTeBetalen)}
            </Text>
          </View>
        </View>

        {/* Disclaimer */}
        <View
          style={{
            marginTop: 32,
            padding: 10,
            backgroundColor: "#fef9ec",
            borderRadius: 6,
            borderLeftWidth: 3,
            borderLeftColor: "#f59e0b",
          }}
        >
          <Text style={{ fontSize: 8, color: "#78716c", lineHeight: 1.5 }}>
            Dit overzicht is een samenvatting gegenereerd door BoekBrug op basis
            van de ingevoerde facturen. Controleer altijd de cijfers in uw
            boekhoudsoftware voordat u aangifte doet bij de Belastingdienst.
          </Text>
        </View>

        <Text style={shared.footer}>
          BoekBrug — Gegenereerd op {today()} — boekbrug.nl
        </Text>
      </Page>
    </Document>
  );
}

// ─── Factuuroverzicht PDF ─────────────────────────────────────────────────────

/**
 * PDF document met factuuroverzicht.
 * Toont alle facturen van een periode met subtotalen.
 * Bedoeld voor archivering, bank, of als bijlage voor de boekhouder.
 */
function FactuuroverzichtPDF({
  invoices,
  title,
  companyName,
}: {
  invoices: InvRow[];
  title: string;
  companyName: string;
}) {
  const totalEx = invoices.reduce(
    (s, i) => s + Number(i.total_ex_btw ?? 0),
    0
  );
  const totalBtw = invoices.reduce(
    (s, i) => s + Number(i.btw_amount ?? 0),
    0
  );
  const totalInc = invoices.reduce(
    (s, i) => s + Number(i.total_inc_btw ?? 0),
    0
  );

  // Column widths (flex units)
  const COL = {
    nr: 1.4,
    klant: 2.2,
    datum: 1,
    status: 0.9,
    btw: 0.7,
    exbtw: 1,
    incbtw: 1,
  };

  const statusLabel = (s: string | null) => {
    const map: Record<string, string> = {
      paid: "Betaald",
      sent: "Verzonden",
      draft: "Concept",
      overdue: "Verlopen",
    };
    return map[s ?? ""] ?? s ?? "—";
  };

  return (
    <Document>
      <Page size="A4" style={shared.page}>
        {/* Header */}
        <View style={shared.headerBand}>
          <View>
            <Text style={shared.brandName}>BoekBrug</Text>
            <Text style={shared.brandSub}>
              De brug tussen jou en je boekhouder
            </Text>
          </View>
          <View>
            <Text style={shared.docTitle}>Factuuroverzicht</Text>
            <Text style={shared.docSub}>{title}</Text>
          </View>
        </View>

        {/* Meta */}
        <View style={shared.infoBlock}>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Bedrijf</Text>
            <Text style={shared.infoValue}>{companyName}</Text>
          </View>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Periode</Text>
            <Text style={shared.infoValue}>{title}</Text>
          </View>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Aantal facturen</Text>
            <Text style={shared.infoValue}>{invoices.length}</Text>
          </View>
          <View style={shared.infoRow}>
            <Text style={shared.infoLabel}>Gegenereerd op</Text>
            <Text style={shared.infoValue}>{today()}</Text>
          </View>
        </View>

        {/* Table header */}
        <View style={shared.tableHeader}>
          <Text style={[shared.headerText, { flex: COL.nr }]}>Nummer</Text>
          <Text style={[shared.headerText, { flex: COL.klant }]}>Klant</Text>
          <Text style={[shared.headerText, { flex: COL.datum }]}>Datum</Text>
          <Text style={[shared.headerText, { flex: COL.status }]}>Status</Text>
          <Text
            style={[
              shared.headerText,
              { flex: COL.btw, textAlign: "center" },
            ]}
          >
            BTW%
          </Text>
          <Text
            style={[
              shared.headerText,
              { flex: COL.exbtw, textAlign: "right" },
            ]}
          >
            Excl. BTW
          </Text>
          <Text
            style={[
              shared.headerText,
              { flex: COL.incbtw, textAlign: "right" },
            ]}
          >
            Incl. BTW
          </Text>
        </View>

        {/* Rows */}
        {invoices.map((inv, idx) => {
          const exBtw = Number(inv.total_ex_btw ?? 0);
          const btwAmt = Number(inv.btw_amount ?? 0);
          const incBtw = Number(inv.total_inc_btw ?? 0);
          const rate = calcBtwRate(btwAmt, exBtw);
          const RowStyle = idx % 2 === 0 ? shared.tableRow : shared.tableRowAlt;

          return (
            <View key={idx} style={RowStyle}>
              <Text style={[shared.cellText, { flex: COL.nr }]}>
                {inv.invoice_number ?? "—"}
              </Text>
              <Text style={[shared.cellText, { flex: COL.klant, overflow: "hidden" }]}>
                {(inv.client_name ?? "—").slice(0, 25)}
              </Text>
              <Text style={[shared.cellText, { flex: COL.datum }]}>
                {fmtDateNL(inv.invoice_date)}
              </Text>
              <Text style={[shared.cellText, { flex: COL.status }]}>
                {statusLabel(inv.status)}
              </Text>
              <Text
                style={[
                  shared.cellText,
                  { flex: COL.btw, textAlign: "center" },
                ]}
              >
                {rate}%
              </Text>
              <Text
                style={[
                  shared.cellText,
                  { flex: COL.exbtw, textAlign: "right" },
                ]}
              >
                {eur(exBtw)}
              </Text>
              <Text
                style={[
                  shared.cellText,
                  { flex: COL.incbtw, textAlign: "right" },
                ]}
              >
                {eur(incBtw)}
              </Text>
            </View>
          );
        })}

        {/* Totals */}
        <View style={shared.totalsBlock}>
          <View style={shared.totalRow}>
            <Text style={shared.totalLabel}>Subtotaal excl. BTW</Text>
            <Text style={shared.totalValue}>{eur(totalEx)}</Text>
          </View>
          <View style={shared.totalRow}>
            <Text style={shared.totalLabel}>Totaal BTW</Text>
            <Text style={shared.totalValue}>{eur(totalBtw)}</Text>
          </View>
          <View style={shared.totalFinalRow}>
            <Text style={shared.totalFinalLabel}>Totaal incl. BTW</Text>
            <Text style={shared.totalFinalValue}>{eur(totalInc)}</Text>
          </View>
        </View>

        <Text style={shared.footer}>
          BoekBrug — Gegenereerd op {today()} — boekbrug.nl
        </Text>
      </Page>
    </Document>
  );
}

// ─── Server-side render functions ─────────────────────────────────────────────

/**
 * Render BTW Aangifte PDF to a Buffer.
 * Call this from an API route — never from a client component.
 *
 * @example
 * const buf = await renderBtwAangiftePdf(summary, "Mijn BV");
 * return new NextResponse(buf, { headers: { "Content-Type": "application/pdf" } });
 */
export async function renderBtwAangiftePdf(
  summary: BtwSummary,
  companyName: string
): Promise<Buffer> {
  return renderToBuffer(
    <BtwAangiftePDF summary={summary} companyName={companyName} />
  ) as unknown as Promise<Buffer>;
}

/**
 * Render Factuuroverzicht PDF to a Buffer.
 * Call this from an API route — never from a client component.
 *
 * @example
 * const buf = await renderFactuuroverzichtPdf(invoices, "Q1 2026", "Mijn BV");
 * return new NextResponse(buf, { headers: { "Content-Type": "application/pdf" } });
 */
export async function renderFactuuroverzichtPdf(
  invoices: InvRow[],
  title: string,
  companyName: string
): Promise<Buffer> {
  return renderToBuffer(
    <FactuuroverzichtPDF
      invoices={invoices}
      title={title}
      companyName={companyName}
    />
  ) as unknown as Promise<Buffer>;
}