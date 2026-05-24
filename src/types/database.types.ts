// src/types/database.types.ts
// [BOEK-TYPES] Auto-generated from schema — May 2026
// DO NOT edit manually — regenerate with: npx supabase gen types typescript --linked > src/types/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accountant_clients: {
        Row: {
          id: string
          accountant_id: string | null
          zzper_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          accountant_id?: string | null
          zzper_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          accountant_id?: string | null
          zzper_id?: string | null
          created_at?: string | null
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
      audit_logs: {
        Row: {
          id: string
          user_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          old_value: Json | null
          new_value: Json | null
          ip_address: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          action?: string
          entity_type?: string
          entity_id?: string | null
          old_value?: Json | null
          new_value?: Json | null
          ip_address?: string | null
          created_at?: string | null
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
          id: string
          user_id: string | null
          date: string | null
          amount: number | null
          description: string | null
          counterpart_name: string | null
          reference: string | null
          status: "matched" | "not_found" | "pending" | null
          invoice_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          date?: string | null
          amount?: number | null
          description?: string | null
          counterpart_name?: string | null
          reference?: string | null
          status?: "matched" | "not_found" | "pending" | null
          invoice_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          date?: string | null
          amount?: number | null
          description?: string | null
          counterpart_name?: string | null
          reference?: string | null
          status?: "matched" | "not_found" | "pending" | null
          invoice_id?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          id: string
          user_id: string | null
          name: string
          email: string | null
          kvk_number: string | null
          btw_number: string | null
          iban: string | null
          address: string | null
          postal_code: string | null
          city: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          email?: string | null
          kvk_number?: string | null
          btw_number?: string | null
          iban?: string | null
          address?: string | null
          postal_code?: string | null
          city?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          name?: string
          email?: string | null
          kvk_number?: string | null
          btw_number?: string | null
          iban?: string | null
          address?: string | null
          postal_code?: string | null
          city?: string | null
          created_at?: string | null
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
          id: string
          user_id: string | null
          export_confirmed: boolean | null
          email_confirmed: boolean | null
          deleted_at: string | null
          data_eligible_for_deletion_at: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          export_confirmed?: boolean | null
          email_confirmed?: boolean | null
          deleted_at?: string | null
          data_eligible_for_deletion_at?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          export_confirmed?: boolean | null
          email_confirmed?: boolean | null
          deleted_at?: string | null
          data_eligible_for_deletion_at?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          id: string
          user_id: string
          file_name: string
          file_url: string
          file_size: number
          file_type: string
          doc_type: string | null
          period: string | null
          year: number | null
          invoice_id: string | null
          notes: string | null
          created_at: string
          search_vector: unknown | null
          ai_processed: boolean | null
          ai_doc_type: string | null
          source: "email" | "upload" | "whatsapp" | "camera" | null
          folder_id: string | null
          ai_suggested_folder: string | null
          starred: boolean | null
          trashed: boolean | null
          trashed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          file_name: string
          file_url: string
          file_size: number
          file_type: string
          doc_type?: string | null
          period?: string | null
          year?: number | null
          invoice_id?: string | null
          notes?: string | null
          created_at?: string
          search_vector?: unknown | null
          ai_processed?: boolean | null
          ai_doc_type?: string | null
          source?: "email" | "upload" | "whatsapp" | "camera" | null
          folder_id?: string | null
          ai_suggested_folder?: string | null
          starred?: boolean | null
          trashed?: boolean | null
          trashed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          file_name?: string
          file_url?: string
          file_size?: number
          file_type?: string
          doc_type?: string | null
          period?: string | null
          year?: number | null
          invoice_id?: string | null
          notes?: string | null
          created_at?: string
          search_vector?: unknown | null
          ai_processed?: boolean | null
          ai_doc_type?: string | null
          source?: "email" | "upload" | "whatsapp" | "camera" | null
          folder_id?: string | null
          ai_suggested_folder?: string | null
          starred?: boolean | null
          trashed?: boolean | null
          trashed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_queue: {
        Row: {
          id: string
          accountant_id: string | null
          client_id: string | null
          items: Json
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          accountant_id?: string | null
          client_id?: string | null
          items?: Json
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          accountant_id?: string | null
          client_id?: string | null
          items?: Json
          created_at?: string | null
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
          id: string
          user_id: string | null
          provider: "gmail" | "outlook"
          access_token: string | null
          refresh_token: string | null
          email: string | null
          connected_at: string | null
          // [BOEK-SECURITY] Vault-backed token columns — added by BOEK-SECURITY migration
          access_token_secret_id: string | null
          refresh_token_secret_id: string | null
          tokens_encrypted_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          provider: "gmail" | "outlook"
          access_token?: string | null
          refresh_token?: string | null
          email?: string | null
          connected_at?: string | null
          access_token_secret_id?: string | null
          refresh_token_secret_id?: string | null
          tokens_encrypted_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          provider?: "gmail" | "outlook"
          access_token?: string | null
          refresh_token?: string | null
          email?: string | null
          connected_at?: string | null
          access_token_secret_id?: string | null
          refresh_token_secret_id?: string | null
          tokens_encrypted_at?: string | null
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
      folders: {
        Row: {
          id: string
          user_id: string | null
          name: string
          parent_id: string | null
          color: string | null
          created_at: string | null
          starred: boolean | null
          is_system: boolean | null
          folder_type: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          parent_id?: string | null
          color?: string | null
          created_at?: string | null
          starred?: boolean | null
          is_system?: boolean | null
          folder_type?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          name?: string
          parent_id?: string | null
          color?: string | null
          created_at?: string | null
          starred?: boolean | null
          is_system?: boolean | null
          folder_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          id: string
          zzper_id: string | null
          accountant_email: string
          status: "pending" | "accepted" | "declined" | null
          token: string | null
          created_at: string | null
          invited_by: string | null
        }
        Insert: {
          id?: string
          zzper_id?: string | null
          accountant_email: string
          status?: "pending" | "accepted" | "declined" | null
          token?: string | null
          created_at?: string | null
          invited_by?: string | null
        }
        Update: {
          id?: string
          zzper_id?: string | null
          accountant_email?: string
          status?: "pending" | "accepted" | "declined" | null
          token?: string | null
          created_at?: string | null
          invited_by?: string | null
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
      invoice_lines: {
        Row: {
          id: string
          invoice_id: string | null
          description: string | null
          quantity: number | null
          unit_price: number | null
          btw_rate: number | null
          line_total: number | null
        }
        Insert: {
          id?: string
          invoice_id?: string | null
          description?: string | null
          quantity?: number | null
          unit_price?: number | null
          btw_rate?: number | null
          line_total?: number | null
        }
        Update: {
          id?: string
          invoice_id?: string | null
          description?: string | null
          quantity?: number | null
          unit_price?: number | null
          btw_rate?: number | null
          line_total?: number | null
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
          id: string
          sender_id: string | null
          receiver_id: string | null
          invoice_number: string | null
          invoice_date: string | null
          due_date: string | null
          status: "draft" | "sent" | "paid" | "overdue" | "received" | "processing" | "processed" | "unclear" | "archived" | null
          direction: "outgoing" | "incoming" | null
          total_ex_btw: number | null
          btw_amount: number | null
          total_inc_btw: number | null
          pdf_url: string | null
          sent_to_accountant: boolean | null
          created_at: string | null
          client_name: string | null
          client_email: string | null
          client_address: string | null
          client_postal_code: string | null
          client_city: string | null
          client_btw_number: string | null
          updated_at: string | null
          search_vector: unknown | null
          accountant_status: string | null
          marked_paid_at: string | null
          source: "created" | "email" | "upload" | "camera" | null
          invoice_type: "factuur" | "creditnota" | "pro_forma" | "offerte" | null
          accountant_note: string | null
          replaced_by_number: string | null
          original_invoice_id: string | null
          offerte_converted_to: string | null
          source_message_id: string | null
          document_id: string | null
        }
        Insert: {
          id?: string
          sender_id?: string | null
          receiver_id?: string | null
          invoice_number?: string | null
          invoice_date?: string | null
          due_date?: string | null
          status?: "draft" | "sent" | "paid" | "overdue" | "received" | "processing" | "processed" | "unclear" | "archived" | null
          direction?: "outgoing" | "incoming" | null
          total_ex_btw?: number | null
          btw_amount?: number | null
          total_inc_btw?: number | null
          pdf_url?: string | null
          sent_to_accountant?: boolean | null
          created_at?: string | null
          client_name?: string | null
          client_email?: string | null
          client_address?: string | null
          client_postal_code?: string | null
          client_city?: string | null
          client_btw_number?: string | null
          updated_at?: string | null
          search_vector?: unknown | null
          accountant_status?: string | null
          marked_paid_at?: string | null
          source?: "created" | "email" | "upload" | "camera" | null
          invoice_type?: "factuur" | "creditnota" | "pro_forma" | "offerte" | null
          accountant_note?: string | null
          replaced_by_number?: string | null
          original_invoice_id?: string | null
          offerte_converted_to?: string | null
          source_message_id?: string | null
          document_id?: string | null
        }
        Update: {
          id?: string
          sender_id?: string | null
          receiver_id?: string | null
          invoice_number?: string | null
          invoice_date?: string | null
          due_date?: string | null
          status?: "draft" | "sent" | "paid" | "overdue" | "received" | "processing" | "processed" | "unclear" | "archived" | null
          direction?: "outgoing" | "incoming" | null
          total_ex_btw?: number | null
          btw_amount?: number | null
          total_inc_btw?: number | null
          pdf_url?: string | null
          sent_to_accountant?: boolean | null
          created_at?: string | null
          client_name?: string | null
          client_email?: string | null
          client_address?: string | null
          client_postal_code?: string | null
          client_city?: string | null
          client_btw_number?: string | null
          updated_at?: string | null
          search_vector?: unknown | null
          accountant_status?: string | null
          marked_paid_at?: string | null
          source?: "created" | "email" | "upload" | "camera" | null
          invoice_type?: "factuur" | "creditnota" | "pro_forma" | "offerte" | null
          accountant_note?: string | null
          replaced_by_number?: string | null
          original_invoice_id?: string | null
          offerte_converted_to?: string | null
          source_message_id?: string | null
          document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "invoices_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
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
            foreignKeyName: "invoices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          id: string
          sender_id: string
          receiver_id: string
          content: string
          read: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          sender_id: string
          receiver_id: string
          content: string
          read?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          sender_id?: string
          receiver_id?: string
          content?: string
          read?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string | null
          title: string
          body: string | null
          type: "invoice" | "payment" | "message" | "invite" | "status" | null
          read: boolean | null
          created_at: string | null
          link: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          title: string
          body?: string | null
          type?: "invoice" | "payment" | "message" | "invite" | "status" | null
          read?: boolean | null
          created_at?: string | null
          link?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          title?: string
          body?: string | null
          type?: "invoice" | "payment" | "message" | "invite" | "status" | null
          read?: boolean | null
          created_at?: string | null
          link?: string | null
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
          id: string
          role: "zzper" | "accountant" | "client" | null
          full_name: string | null
          company_name: string | null
          kvk_number: string | null
          btw_number: string | null
          iban: string | null
          email: string | null
          phone: string | null
          created_at: string | null
          address: string | null
          postal_code: string | null
          city: string | null
          onboarding_step: number
          onboarding_done: boolean
          preferred_language: "nl" | "en" | "ar" | "tr" | null
          referral_accountant_id: string | null
          subscription_plan: "free" | "pro" | "boekhouder" | "boekhouder_pro" | null
          subscription_stripe_id: string | null
        }
        Insert: {
          id: string
          role?: "zzper" | "accountant" | "client" | null
          full_name?: string | null
          company_name?: string | null
          kvk_number?: string | null
          btw_number?: string | null
          iban?: string | null
          email?: string | null
          phone?: string | null
          created_at?: string | null
          address?: string | null
          postal_code?: string | null
          city?: string | null
          onboarding_step?: number
          onboarding_done?: boolean
          preferred_language?: "nl" | "en" | "ar" | "tr" | null
          referral_accountant_id?: string | null
          subscription_plan?: "free" | "pro" | "boekhouder" | "boekhouder_pro" | null
          subscription_stripe_id?: string | null
        }
        Update: {
          id?: string
          role?: "zzper" | "accountant" | "client" | null
          full_name?: string | null
          company_name?: string | null
          kvk_number?: string | null
          btw_number?: string | null
          iban?: string | null
          email?: string | null
          phone?: string | null
          created_at?: string | null
          address?: string | null
          postal_code?: string | null
          city?: string | null
          onboarding_step?: number
          onboarding_done?: boolean
          preferred_language?: "nl" | "en" | "ar" | "tr" | null
          referral_accountant_id?: string | null
          subscription_plan?: "free" | "pro" | "boekhouder" | "boekhouder_pro" | null
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
      referrals: {
        Row: {
          id: string
          accountant_id: string | null
          client_id: string | null
          active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          accountant_id?: string | null
          client_id?: string | null
          active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          accountant_id?: string | null
          client_id?: string | null
          active?: boolean | null
          created_at?: string | null
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
      rate_limits: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          count: number
          window_start: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          count?: number
          window_start?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          count?: number
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      vault_read_secret: {
        Args: { p_secret_id: string }
        Returns: string
      }
      vault_update_or_create_secret: {
        Args: { p_secret_id: string | null; p_value: string; p_name: string }
        Returns: string
      }
      vault_delete_secret: {
        Args: { p_secret_id: string }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          p_user_id: string
          p_endpoint: string
          p_max_requests: number
          p_window_minutes: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      cleanup_old_rate_limits: {
        Args: Record<string, never>
        Returns: number
      }
      generate_invoice_number: {
        Args: { user_id: string }
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

// ─── Convenience type aliases ────────────────────────────────────────────────
// Use these everywhere instead of raw Row types

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"]

// ─── Named row types (use these in your components & hooks) ──────────────────

export type Profile             = Tables<"profiles">
export type Invoice             = Tables<"invoices">
export type InvoiceLine         = Tables<"invoice_lines">
export type Document            = Tables<"documents">
export type Folder              = Tables<"folders">
export type Client              = Tables<"clients">
export type AccountantClient    = Tables<"accountant_clients">
export type Notification        = Tables<"notifications">
export type Message             = Tables<"messages">
export type BankTransaction     = Tables<"bank_transactions">
export type DraftQueue          = Tables<"draft_queue">
export type EmailConnection     = Tables<"email_connections">
export type Invitation          = Tables<"invitations">
export type AuditLog            = Tables<"audit_logs">
export type Referral            = Tables<"referrals">
export type DeletionRequest     = Tables<"deletion_requests">
export type RateLimit           = Tables<"rate_limits">

// ─── Enum-style literals extracted from the DB CHECK constraints ─────────────
// Single source of truth — use these for status comparisons everywhere

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "received"
  | "processing"
  | "processed"
  | "unclear"
  | "archived"

export type InvoiceDirection = "outgoing" | "incoming"

export type InvoiceType = "factuur" | "creditnota" | "pro_forma" | "offerte"

export type InvoiceSource = "created" | "email" | "upload" | "camera"

export type DocumentSource = "email" | "upload" | "whatsapp" | "camera"

export type BankTransactionStatus = "matched" | "not_found" | "pending"

export type NotificationType = "invoice" | "payment" | "message" | "invite" | "status"

export type InvitationStatus = "pending" | "accepted" | "declined"

export type UserRole = "zzper" | "accountant" | "client"

export type PreferredLanguage = "nl" | "en" | "ar" | "tr"

export type SubscriptionPlan = "free" | "pro" | "boekhouder" | "boekhouder_pro"

export type EmailProvider = "gmail" | "outlook"