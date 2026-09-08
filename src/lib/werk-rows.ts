// src/lib/werk-rows.ts
// [WERK] The row shapes the work API returns. work_items is newer than the generated database
// types, so the routes read it through an untyped client and hand out these shapes instead.
import type { FieldValues, WorkLine, WorkStatus } from "./werk";

export interface WorkRow {
  id: string;
  vak: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  vehicle_id: string | null;
  /** The plate, resolved by the API; null when there is no vehicle. */
  kenteken: string | null;
  status: WorkStatus;
  planned_on: string | null;
  done_on: string | null;
  fields: FieldValues;
  /** What the work charges — see readLines in werk.ts. */
  lines: WorkLine[];
  notes: string | null;
  invoice_id: string | null;
  created_at: string;
}

export interface AttachedHours {
  id: string;
  worked_on: string;
  description: string;
  hours: number;
  hourly_rate: number | null;
  invoice_id: string | null;
}

export interface AttachedCost {
  id: string;
  client_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_ex_btw: number | null;
  total_inc_btw: number | null;
  status: string | null;
}

export interface AttachedDocument {
  id: string;
  file_name: string | null;
  created_at: string | null;
}

export interface WorkInvoiceSummary {
  id: string;
  invoice_number: string | null;
  status: string | null;
  total_ex_btw: number | null;
  total_inc_btw: number | null;
}
