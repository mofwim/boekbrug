export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accountant_clients: {
        Row: {
          accountant_id: string | null
          created_at: string | null
          id: string
          zzper_id: string | null
        }
        Insert: {
          accountant_id?: string | null
          created_at?: string | null
          id?: string
          zzper_id?: string | null
        }
        Update: {
          accountant_id?: string | null
          created_at?: string | null
          id?: string
          zzper_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountant_clients_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountant_clients_zzper_id_fkey"
            columns: ["zzper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accountant_subject_status: {
        Row: {
          accountant_id: string
          created_at: string
          id: string
          status: string
          subject_id: string
          subject_type: string
          updated_at: string
          verwerkt_at: string | null
          vraag_text: string | null
        }
        Insert: {
          accountant_id: string
          created_at?: string
          id?: string
          status?: string
          subject_id: string
          subject_type: string
          updated_at?: string
          verwerkt_at?: string | null
          vraag_text?: string | null
        }
        Update: {
          accountant_id?: string
          created_at?: string
          id?: string
          status?: string
          subject_id?: string
          subject_type?: string
          updated_at?: string
          verwerkt_at?: string | null
          vraag_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountant_subject_status_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number | null
          category: string | null
          category_confirmed: boolean
          category_source: string | null
          counterpart_iban: string | null
          counterpart_name: string | null
          created_at: string | null
          date: string | null
          description: string | null
          id: string
          invoice_id: string | null
          reference: string | null
          status: string | null
          statement_document_id: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          category?: string | null
          category_confirmed?: boolean
          category_source?: string | null
          counterpart_iban?: string | null
          counterpart_name?: string | null
          created_at?: string | null
          date?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          reference?: string | null
          status?: string | null
          statement_document_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          category?: string | null
          category_confirmed?: boolean
          category_source?: string | null
          counterpart_iban?: string | null
          counterpart_name?: string | null
          created_at?: string | null
          date?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          reference?: string | null
          status?: string | null
          statement_document_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_tx_invoices: {
        Row: {
          amount_applied: number | null
          created_at: string | null
          id: string
          invoice_id: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          amount_applied?: number | null
          created_at?: string | null
          id?: string
          invoice_id: string
          transaction_id: string
          user_id: string
        }
        Update: {
          amount_applied?: number | null
          created_at?: string | null
          id?: string
          invoice_id?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: []
      }
      counterpart_memory: {
        Row: {
          category: string
          counterpart_key: string
          created_at: string | null
          id: string
          last_used_at: string | null
          times_seen: number
          user_id: string
        }
        Insert: {
          category: string
          counterpart_key: string
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          times_seen?: number
          user_id: string
        }
        Update: {
          category?: string
          counterpart_key?: string
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          times_seen?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterpart_memory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_turnover: {
        Row: {
          base_0: number
          base_21: number
          base_9: number
          btw_21: number
          btw_9: number
          cash_amount: number | null
          created_at: string | null
          document_id: string | null
          id: string
          other_amount: number | null
          pin_amount: number | null
          source: string
          total_incl: number | null
          turnover_date: string
          user_id: string
        }
        Insert: {
          base_0?: number
          base_21?: number
          base_9?: number
          btw_21?: number
          btw_9?: number
          cash_amount?: number | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          other_amount?: number | null
          pin_amount?: number | null
          source?: string
          total_incl?: number | null
          turnover_date: string
          user_id: string
        }
        Update: {
          base_0?: number
          base_21?: number
          base_9?: number
          btw_21?: number
          btw_9?: number
          cash_amount?: number | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          other_amount?: number | null
          pin_amount?: number | null
          source?: string
          total_incl?: number | null
          turnover_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_turnover_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_turnover_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          active: boolean
          btw_rate: number
          code: string | null
          created_at: string | null
          description: string
          id: string
          unit: string | null
          unit_price: number
          updated_at: string | null
          usage_count: number
          user_id: string
        }
        Insert: {
          active?: boolean
          btw_rate?: number
          code?: string | null
          created_at?: string | null
          description: string
          id?: string
          unit?: string | null
          unit_price?: number
          updated_at?: string | null
          usage_count?: number
          user_id: string
        }
        Update: {
          active?: boolean
          btw_rate?: number
          code?: string | null
          created_at?: string | null
          description?: string
          id?: string
          unit?: string | null
          unit_price?: number
          updated_at?: string | null
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      eft_settlements: {
        Row: {
          by_scheme: Json | null
          created_at: string | null
          document_id: string | null
          first_trx: string | null
          gross_total: number
          id: string
          last_trx: string | null
          period_end: string | null
          period_nr: string | null
          period_start: string | null
          settlement_date: string
          shift_nr: string | null
          source: string
          terminal_id: string | null
          tx_count: number
          user_id: string
        }
        Insert: {
          by_scheme?: Json | null
          created_at?: string | null
          document_id?: string | null
          first_trx?: string | null
          gross_total: number
          id?: string
          last_trx?: string | null
          period_end?: string | null
          period_nr?: string | null
          period_start?: string | null
          settlement_date: string
          shift_nr?: string | null
          source?: string
          terminal_id?: string | null
          tx_count?: number
          user_id: string
        }
        Update: {
          by_scheme?: Json | null
          created_at?: string | null
          document_id?: string | null
          first_trx?: string | null
          gross_total?: number
          id?: string
          last_trx?: string | null
          period_end?: string | null
          period_nr?: string | null
          period_start?: string | null
          settlement_date?: string
          shift_nr?: string | null
          source?: string
          terminal_id?: string | null
          tx_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eft_settlements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eft_settlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_entries: {
        Row: {
          amount: number
          btw_rate: number | null
          category: string
          created_at: string | null
          description: string | null
          direction: string
          document_id: string | null
          entry_date: string
          id: string
          user_id: string
        }
        Insert: {
          amount: number
          btw_rate?: number | null
          category: string
          created_at?: string | null
          description?: string | null
          direction: string
          document_id?: string | null
          entry_date?: string
          id?: string
          user_id: string
        }
        Update: {
          amount?: number
          btw_rate?: number | null
          category?: string
          created_at?: string | null
          description?: string | null
          direction?: string
          document_id?: string | null
          entry_date?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_daily: {
        Row: {
          account_nr: string | null
          created_at: string | null
          document_id: string | null
          id: string
          kind: string
          ledger_date: string
          received: number
          source: string
          spent: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_nr?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          kind: string
          ledger_date: string
          received?: number
          source?: string
          spent?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_nr?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          kind?: string
          ledger_date?: string
          received?: number
          source?: string
          spent?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_daily_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          btw_number: string | null
          city: string | null
          created_at: string | null
          email: string | null
          iban: string | null
          id: string
          kvk_number: string | null
          name: string
          notes: string | null
          postal_code: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          btw_number?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name: string
          notes?: string | null
          postal_code?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          btw_number?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name?: string
          notes?: string | null
          postal_code?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          created_at: string | null
          data_eligible_for_deletion_at: string | null
          deleted_at: string | null
          email_confirmed: boolean | null
          export_confirmed: boolean | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data_eligible_for_deletion_at?: string | null
          deleted_at?: string | null
          email_confirmed?: boolean | null
          export_confirmed?: boolean | null
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data_eligible_for_deletion_at?: string | null
          deleted_at?: string | null
          email_confirmed?: boolean | null
          export_confirmed?: boolean | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          ai_doc_type: string | null
          ai_processed: boolean | null
          ai_suggested_folder: string | null
          content_hash: string | null
          created_at: string
          doc_type: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          folder_id: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          period: string | null
          search_vector: unknown
          shared: boolean
          source: string | null
          starred: boolean | null
          trashed: boolean | null
          trashed_at: string | null
          user_id: string
          year: number | null
        }
        Insert: {
          ai_doc_type?: string | null
          ai_processed?: boolean | null
          ai_suggested_folder?: string | null
          content_hash?: string | null
          created_at?: string
          doc_type?: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          folder_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period?: string | null
          search_vector?: unknown
          shared?: boolean
          source?: string | null
          starred?: boolean | null
          trashed?: boolean | null
          trashed_at?: string | null
          user_id: string
          year?: number | null
        }
        Update: {
          ai_doc_type?: string | null
          ai_processed?: boolean | null
          ai_suggested_folder?: string | null
          content_hash?: string | null
          created_at?: string
          doc_type?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          folder_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period?: string | null
          search_vector?: unknown
          shared?: boolean
          source?: string | null
          starred?: boolean | null
          trashed?: boolean | null
          trashed_at?: string | null
          user_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_queue: {
        Row: {
          accountant_id: string | null
          client_id: string
          created_at: string | null
          id: string
          items: Json
          updated_at: string | null
        }
        Insert: {
          accountant_id?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          items?: Json
          updated_at?: string | null
        }
        Update: {
          accountant_id?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          items?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_queue_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_connections: {
        Row: {
          access_token_secret_id: string | null
          connected_at: string | null
          email: string | null
          id: string
          last_synced_email_at: string | null
          needs_reauth: boolean
          provider: string
          refresh_token_secret_id: string | null
          tokens_encrypted_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token_secret_id?: string | null
          connected_at?: string | null
          email?: string | null
          id?: string
          last_synced_email_at?: string | null
          needs_reauth?: boolean
          provider: string
          refresh_token_secret_id?: string | null
          tokens_encrypted_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token_secret_id?: string | null
          connected_at?: string | null
          email?: string | null
          id?: string
          last_synced_email_at?: string | null
          needs_reauth?: boolean
          provider?: string
          refresh_token_secret_id?: string | null
          tokens_encrypted_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_skipped_attachments: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          reason: string
          source_message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          reason?: string
          source_message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          reason?: string
          source_message_id?: string
          user_id?: string
        }
        Relationships: []
      }
      email_failed_attempts: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          source_message_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          source_message_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          source_message_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      folders: {
        Row: {
          color: string | null
          created_at: string | null
          folder_type: string | null
          id: string
          is_system: boolean | null
          name: string
          parent_id: string | null
          starred: boolean | null
          user_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          folder_type?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          parent_id?: string | null
          starred?: boolean | null
          user_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          folder_type?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          parent_id?: string | null
          starred?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accountant_email: string
          created_at: string | null
          id: string
          invited_by: string | null
          status: string | null
          token: string | null
          zzper_id: string | null
        }
        Insert: {
          accountant_email: string
          created_at?: string | null
          id?: string
          invited_by?: string | null
          status?: string | null
          token?: string | null
          zzper_id?: string | null
        }
        Update: {
          accountant_email?: string
          created_at?: string | null
          id?: string
          invited_by?: string | null
          status?: string | null
          token?: string | null
          zzper_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_zzper_id_fkey"
            columns: ["zzper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          last_seq: number
          type: string
          user_id: string
          year: number
        }
        Insert: {
          last_seq?: number
          type: string
          user_id: string
          year: number
        }
        Update: {
          last_seq?: number
          type?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          btw_rate: number | null
          description: string | null
          id: string
          invoice_id: string | null
          line_total: number | null
          quantity: number | null
          unit_price: number | null
        }
        Insert: {
          btw_rate?: number | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          line_total?: number | null
          quantity?: number | null
          unit_price?: number | null
        }
        Update: {
          btw_rate?: number | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          line_total?: number | null
          quantity?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          accountant_note: string | null
          accountant_status: string | null
          amount_paid: number
          btw_amount: number | null
          client_address: string | null
          client_btw_number: string | null
          client_city: string | null
          client_email: string | null
          client_id: string | null
          client_name: string | null
          client_postal_code: string | null
          created_at: string | null
          delivery_date: string | null
          direction: string | null
          document_id: string | null
          due_date: string | null
          field_confidence: Json | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string | null
          marked_paid_at: string | null
          offerte_converted_to: string | null
          original_invoice_id: string | null
          payment_date: string | null
          payment_method: string | null
          payment_prepared_at: string | null
          pay_token: string | null
          payment_reference: string | null
          pdf_url: string | null
          receiver_id: string | null
          reminders_paused: boolean
          replaced_by_number: string | null
          search_vector: unknown
          sender_id: string | null
          shared: boolean | null
          source: string | null
          source_message_id: string | null
          status: string | null
          supplier_id: string | null
          total_ex_btw: number | null
          total_inc_btw: number | null
          updated_at: string | null
          vendor_iban: string | null
        }
        Insert: {
          accountant_note?: string | null
          accountant_status?: string | null
          amount_paid?: number
          btw_amount?: number | null
          client_address?: string | null
          client_btw_number?: string | null
          client_city?: string | null
          client_email?: string | null
          client_id?: string | null
          client_name?: string | null
          client_postal_code?: string | null
          created_at?: string | null
          delivery_date?: string | null
          direction?: string | null
          document_id?: string | null
          due_date?: string | null
          field_confidence?: Json | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          marked_paid_at?: string | null
          offerte_converted_to?: string | null
          original_invoice_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_prepared_at?: string | null
          pay_token?: string | null
          payment_reference?: string | null
          pdf_url?: string | null
          receiver_id?: string | null
          reminders_paused?: boolean
          replaced_by_number?: string | null
          search_vector?: unknown
          sender_id?: string | null
          shared?: boolean | null
          source?: string | null
          source_message_id?: string | null
          status?: string | null
          supplier_id?: string | null
          total_ex_btw?: number | null
          total_inc_btw?: number | null
          updated_at?: string | null
          vendor_iban?: string | null
        }
        Update: {
          accountant_note?: string | null
          accountant_status?: string | null
          amount_paid?: number
          btw_amount?: number | null
          client_address?: string | null
          client_btw_number?: string | null
          client_city?: string | null
          client_email?: string | null
          client_id?: string | null
          client_name?: string | null
          client_postal_code?: string | null
          created_at?: string | null
          delivery_date?: string | null
          direction?: string | null
          document_id?: string | null
          due_date?: string | null
          field_confidence?: Json | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          marked_paid_at?: string | null
          offerte_converted_to?: string | null
          original_invoice_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_prepared_at?: string | null
          pay_token?: string | null
          payment_reference?: string | null
          pdf_url?: string | null
          receiver_id?: string | null
          reminders_paused?: boolean
          replaced_by_number?: string | null
          search_vector?: unknown
          sender_id?: string | null
          shared?: boolean | null
          source?: string | null
          source_message_id?: string | null
          status?: string | null
          supplier_id?: string | null
          total_ex_btw?: number | null
          total_inc_btw?: number | null
          updated_at?: string | null
          vendor_iban?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_offerte_converted_to_fkey"
            columns: ["offerte_converted_to"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_reminders: {
        Row: {
          day_offset: number
          email_to: string | null
          id: string
          invoice_id: string
          sent_at: string
          status: string
          user_id: string
        }
        Insert: {
          day_offset: number
          email_to?: string | null
          id?: string
          invoice_id: string
          sent_at?: string
          status?: string
          user_id: string
        }
        Update: {
          day_offset?: number
          email_to?: string | null
          id?: string
          invoice_id?: string
          sent_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_reminders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          read: boolean | null
          receiver_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          receiver_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          link: string | null
          read: boolean | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          link?: string | null
          read?: boolean | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          link?: string | null
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          btw_number: string | null
          city: string | null
          company_name: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          iban: string | null
          id: string
          invoice_number_padding: number
          kas_opening_balance: number
          kor_active: boolean
          vat_scheme: string
          vat_scheme_since: string | null
          invoice_number_template: string | null
          kvk_number: string | null
          onboarding_done: boolean
          onboarding_step: number
          phone: string | null
          postal_code: string | null
          preferred_language: string | null
          referral_accountant_id: string | null
          reminder_offsets: number[]
          reminders_enabled: boolean
          role: string | null
          subscription_plan: string | null
          subscription_stripe_id: string | null
        }
        Insert: {
          address?: string | null
          btw_number?: string | null
          city?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          iban?: string | null
          id: string
          invoice_number_padding?: number
          kas_opening_balance?: number
          kor_active?: boolean
          vat_scheme?: string
          vat_scheme_since?: string | null
          invoice_number_template?: string | null
          kvk_number?: string | null
          onboarding_done?: boolean
          onboarding_step?: number
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string | null
          referral_accountant_id?: string | null
          reminder_offsets?: number[]
          reminders_enabled?: boolean
          role?: string | null
          subscription_plan?: string | null
          subscription_stripe_id?: string | null
        }
        Update: {
          address?: string | null
          btw_number?: string | null
          city?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          iban?: string | null
          id?: string
          invoice_number_padding?: number
          kas_opening_balance?: number
          kor_active?: boolean
          vat_scheme?: string
          vat_scheme_since?: string | null
          invoice_number_template?: string | null
          kvk_number?: string | null
          onboarding_done?: boolean
          onboarding_step?: number
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string | null
          referral_accountant_id?: string | null
          reminder_offsets?: number[]
          reminders_enabled?: boolean
          role?: string | null
          subscription_plan?: string | null
          subscription_stripe_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referral_accountant_id_fkey"
            columns: ["referral_accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          endpoint: string
          id: string
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          endpoint: string
          id?: string
          user_id: string
          window_start?: string
        }
        Update: {
          count?: number
          endpoint?: string
          id?: string
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          accountant_id: string | null
          active: boolean | null
          client_id: string | null
          created_at: string | null
          id: string
        }
        Insert: {
          accountant_id?: string | null
          active?: boolean | null
          client_id?: string | null
          created_at?: string | null
          id?: string
        }
        Update: {
          accountant_id?: string | null
          active?: boolean | null
          client_id?: string | null
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          btw_number: string | null
          created_at: string
          iban: string | null
          id: string
          kvk_number: string | null
          name: string
          name_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          btw_number?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name: string
          name_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          btw_number?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name?: string
          name_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_bank_payment: {
        Args: {
          p_user_id: string
          p_tx_id: string
          p_invoice_id: string
          p_amount: number
          p_pay_date: string | null
        }
        Returns: {
          applied: number
          amount_paid: number
          total: number
          is_paid: boolean
        }[]
      }
      book_bank_batch: {
        Args: {
          p_user_id: string
          p_tx_id: string
          p_invoice_ids: string[]
          p_pay_date: string | null
        }
        Returns: {
          invoice_id: string
        }[]
      }
      check_rate_limit: {
        Args: {
          p_endpoint: string
          p_max_requests: number
          p_user_id: string
          p_window_minutes: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      cleanup_old_rate_limits: { Args: never; Returns: number }
      get_accountant_for_zzper: {
        Args: { zzper_uuid: string }
        Returns: string
      }
      is_my_accountant_client: { Args: { client: string }; Returns: boolean }
      next_invoice_seq: {
        Args: { p_type: string; p_user_id: string; p_year: number }
        Returns: number
      }
      recompute_invoice_amount_paid: {
        Args: { p_user_id: string; p_invoice_id: string }
        Returns: number
      }
      vault_delete_secret: { Args: { p_secret_id: string }; Returns: boolean }
      vault_read_secret: { Args: { p_secret_id: string }; Returns: string }
      vault_update_or_create_secret: {
        Args: { p_name: string; p_secret_id: string; p_value: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
