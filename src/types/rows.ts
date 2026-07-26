// src/types/rows.ts
// [TYPES] Korte namen voor de rij-typen uit de gegenereerde databasetypen.
//
// Waarom dit bestaat: op tientallen plekken stond `useState<any>(null)` voor een rij uit de
// database. `any` schakelt de typecontrole uit precies daar waar het om geld gaat — een
// hernoemde kolom of een verwijderd veld geeft dan geen compilerfout maar een leeg scherm
// of een `undefined` in een bedrag. Deze aliassen kosten niets en zetten die controle weer
// aan.
//
// Gebruik `Row<'invoices'>` voor een volledige rij, of de kant-en-klare namen hieronder.

import type { Database } from "@/types/database.types";

type Tables = Database["public"]["Tables"];

/** Volledige rij van een tabel: `Row<'invoices'>`. */
export type Row<T extends keyof Tables> = Tables[T]["Row"];

export type ProfileRow = Row<"profiles">;
export type InvoiceRow = Row<"invoices">;
export type InvoiceLineRow = Row<"invoice_lines">;
export type ClientRow = Row<"clients">;
export type NotificationRow = Row<"notifications">;
export type MessageRow = Row<"messages">;
export type DocumentRow = Row<"documents">;
export type InvitationRow = Row<"invitations">;
