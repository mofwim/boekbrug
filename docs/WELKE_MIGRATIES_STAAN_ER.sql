-- =====================================================================
-- WELKE MIGRATIES STAAN ER ÉCHT? — één query, het echte antwoord.
-- BoekBrug · automatisch gegenereerd, NIET met de hand bijwerken.
-- =====================================================================
--
-- GEGENEREERD DOOR: scripts/migration-inventory.ts
--   npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql
--
-- Handmatige wijzigingen gaan bij de eerstvolgende run verloren, en een poort in
-- lifecycle-gates.test.ts faalt zodra dit bestand niet meer overeenkomt met de map.
--
-- ── WAAROM GEGENEREERD ──
--
-- De vorige versie stelde de goede vraag met een lijst die iemand met de hand bijhield, en
-- zei daar zelf over: "Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de
-- hand in. Een migratie die er niet in staat, kan dit bestand ook niet 'OPEN' noemen." Dat is
-- twee keer misgegaan — één keer dekte de lijst 17 van 71 migraties en gaf een schoon "alles
-- toegepast" terug, met de vier waar de betaalkant op leunt er niet in.
--
-- Nu wordt de vraag AFGELEID uit supabase/migrations/, en kan hij niet achterlopen op de map.
--
-- ── WAT DE UITKOMST BETEKENT ──
--
--   TOEGEPAST     elk object dat deze migratie aanmaakt, bestaat.
--   GEDEELTELIJK  sommige wel, sommige niet. Dit is het gevaarlijke geval: de migratie is
--                 halverwege gestopt. Lees het CONTROLE-blok onderaan dát migratiebestand.
--   OPEN          geen enkel object bestaat.
--
-- "TOEGEPAST" bewijst dat de migratie GEDRAAID heeft, niet dat ze FOUTLOOS liep. Daarvoor is
-- het CONTROLE-blok onderaan het migratiebestand zelf.
--
-- Leest alleen de catalogus. Verandert niets. Draai hem als service_role in de SQL-editor.
-- =====================================================================

with probe(bestand, soort, object, tabel) as (values
  ('account_purpose_archief.sql', 'column', 'account_purpose', 'profiles'),
  ('account_purpose_archief.sql', 'constraint', 'profiles_account_purpose_check', null),
  ('account_purpose_archief.sql', 'function', 'handle_new_user', null),
  ('accountant_confirm_mandate.sql', 'column', 'confirmed_by', 'invoices'),
  ('accountant_confirm_mandate.sql', 'column', 'kind', 'accountant_invoice_mandates'),
  ('accountant_confirm_mandate.sql', 'constraint', 'accountant_invoice_mandates_kind_check', null),
  ('accountant_confirm_mandate.sql', 'function', 'has_active_confirm_mandate', null),
  ('accountant_confirm_mandate.sql', 'function', 'has_active_invoice_mandate', null),
  ('accountant_confirm_mandate.sql', 'function', 'prevent_accountant_amount_changes', null),
  ('accountant_invoice_mandate.sql', 'function', 'has_active_invoice_mandate', null),
  ('accountant_invoice_mandate.sql', 'function', 'next_invoice_seq', null),
  ('accountant_invoice_mandate.sql', 'function', 'prevent_accountant_amount_changes', null),
  ('accountant_invoice_mandate.sql', 'index', 'accountant_invoice_mandates_accountant', null),
  ('accountant_invoice_mandate.sql', 'policy', 'accountant_invoice_mandates_select', null),
  ('accountant_invoice_mandate.sql', 'policy', 'invoice_lines_mandate_read', null),
  ('accountant_subject_status.sql', 'index', 'accountant_subject_status_unique', null),
  ('accountant_subject_status.sql', 'policy', 'acc_status_client_read_document', null),
  ('accountant_subject_status.sql', 'table', 'accountant_subject_status', null),
  ('accountant_write_guard_fix.sql', 'function', 'prevent_accountant_amount_changes', null),
  ('accountant_write_holes.sql', 'function', 'prevent_accountant_amount_changes', null),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_invoice_date', null),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_receiver_id', null),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_sender_id', null),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_shared', null),
  ('accountant_write_holes.sql', 'policy', 'acc_status_owner_read', null),
  ('ai_budget_settle.sql', 'function', 'ai_budget_settle', null),
  ('ai_spend_guard.sql', 'column', 'bucket_key', 'rate_limits'),
  ('ai_spend_guard.sql', 'constraint', 'rate_limits_one_identity', null),
  ('ai_spend_guard.sql', 'function', 'ai_budget_consume', null),
  ('ai_spend_guard.sql', 'function', 'check_rate_limit_key', null),
  ('ai_spend_guard.sql', 'index', 'accountant_clients_accountant_idx', null),
  ('ai_spend_guard.sql', 'index', 'rate_limits_bucket_endpoint_key', null),
  ('allocate_bank_payment.sql', 'function', 'allocate_bank_payment', null),
  ('articles.sql', 'index', 'idx_articles_user_active', null),
  ('articles.sql', 'index', 'idx_articles_user_code', null),
  ('articles.sql', 'policy', 'articles_delete_own', null),
  ('articles.sql', 'policy', 'articles_insert_own', null),
  ('articles.sql', 'policy', 'articles_select_own', null),
  ('articles.sql', 'policy', 'articles_update_own', null),
  ('audit_logs_client_read.sql', 'function', 'audit_row_is_about_me', null),
  ('audit_logs_client_read.sql', 'policy', 'audit_logs_about_me', null),
  ('auto_incasso.sql', 'column', 'auto_incasso', 'suppliers'),
  ('auto_incasso.sql', 'column', 'auto_incasso_since', 'suppliers'),
  ('auto_incasso.sql', 'index', 'idx_suppliers_auto_incasso', null),
  ('bank_auto_match_reason.sql', 'column', 'auto_match_reason', 'bank_transactions'),
  ('bank_confirm_atomic.sql', 'function', 'book_bank_batch', null),
  ('bank_confirm_atomic.sql', 'function', 'confirm_bank_payment', null),
  ('bank_connections.sql', 'index', 'bank_connection_accounts_connection_idx', null),
  ('bank_connections.sql', 'index', 'bank_connection_accounts_due_idx', null),
  ('bank_connections.sql', 'index', 'bank_connections_reference_uidx', null),
  ('bank_connections.sql', 'index', 'bank_connections_user_created_idx', null),
  ('bank_connections.sql', 'policy', 'bank_connection_accounts_select_own', null),
  ('bank_connections.sql', 'policy', 'bank_connections_select_own', null),
  ('bank_connections_updated_at.sql', 'function', 'set_updated_at', null),
  ('bank_identity.sql', 'column', 'category', 'bank_transactions'),
  ('bank_identity.sql', 'column', 'category_confirmed', 'bank_transactions'),
  ('bank_identity.sql', 'column', 'category_source', 'bank_transactions'),
  ('bank_identity.sql', 'index', 'idx_counterpart_memory_lookup', null),
  ('bank_identity.sql', 'policy', 'counterpart_memory_delete_own', null),
  ('bank_identity.sql', 'policy', 'counterpart_memory_insert_own', null),
  ('bank_ignore_reason.sql', 'column', 'ignore_reason', 'bank_transactions'),
  ('bank_ignore_reason.sql', 'constraint', 'bank_transactions_ignore_reason_check', null),
  ('bank_ignore_reason.sql', 'index', 'idx_bank_tx_ignore_reason', null),
  ('bank_statement_periods.sql', 'index', 'idx_bsp_user_iban_start', null),
  ('bank_statement_periods.sql', 'policy', 'bsp_owner_read', null),
  ('bank_statement_periods.sql', 'table', 'bank_statement_periods', null),
  ('bank_tx_counterpart_iban.sql', 'column', 'counterpart_iban', 'bank_transactions'),
  ('bank_tx_counterpart_iban.sql', 'index', 'idx_bank_transactions_counterpart_iban', null),
  ('bank_tx_direct_debit.sql', 'column', 'creditor_id', 'bank_transactions'),
  ('bank_tx_direct_debit.sql', 'column', 'incasso_suggested_at', 'suppliers'),
  ('bank_tx_direct_debit.sql', 'column', 'mandate_id', 'bank_transactions'),
  ('bank_tx_direct_debit.sql', 'column', 'type_code', 'bank_transactions'),
  ('bank_tx_direct_debit.sql', 'index', 'idx_bank_tx_direct_debit', null),
  ('bank_tx_invoices.sql', 'index', 'bank_tx_invoices_unique_pair', null),
  ('bank_tx_invoices.sql', 'index', 'idx_bank_tx_invoices_inv', null),
  ('bank_tx_invoices.sql', 'index', 'idx_bank_tx_invoices_tx', null),
  ('bank_tx_invoices.sql', 'index', 'idx_bank_tx_invoices_user', null),
  ('bank_tx_invoices.sql', 'policy', 'bank_tx_invoices_delete_own', null),
  ('bank_tx_invoices.sql', 'policy', 'bank_tx_invoices_insert_own', null),
  ('bank_tx_invoices_memory_index.sql', 'index', 'idx_bank_tx_invoices_user_recent', null),
  ('bank_tx_source_identity.sql', 'column', 'external_id', 'bank_transactions'),
  ('bank_tx_source_identity.sql', 'column', 'source', 'bank_transactions'),
  ('bank_tx_source_identity.sql', 'index', 'uniq_bank_tx_source_identity', null),
  ('bank_tx_statement_link.sql', 'column', 'statement_document_id', 'bank_transactions'),
  ('bank_tx_statement_link.sql', 'index', 'idx_bank_transactions_statement_doc', null),
  ('betaalverzoek.sql', 'column', 'pay_token', 'invoices'),
  ('betaalverzoek.sql', 'index', 'idx_invoices_pay_token', null),
  ('billing_subscription.sql', 'column', 'current_period_end', 'profiles'),
  ('billing_subscription.sql', 'column', 'stripe_customer_id', 'profiles'),
  ('billing_subscription.sql', 'column', 'subscription_status', 'profiles'),
  ('billing_subscription.sql', 'constraint', 'profiles_subscription_status_check', null),
  ('billing_subscription.sql', 'function', 'prevent_billing_self_grant', null),
  ('billing_subscription.sql', 'index', 'profiles_stripe_customer_id_key', null),
  ('book_bank_batch_atomic.sql', 'function', 'book_bank_batch', null),
  ('bookkeeping_date_sane.sql', 'function', 'assert_bookkeeping_date_sane', null),
  ('btw_filings.sql', 'index', 'btw_filings_user_period_idx', null),
  ('btw_filings.sql', 'policy', 'btw_filings own rows', null),
  ('btw_filings.sql', 'table', 'btw_filings', null),
  ('cash_entry_soft_delete.sql', 'column', 'deleted_at', 'cash_entries'),
  ('cash_entry_soft_delete.sql', 'index', 'cash_entries_one_settlement_per_instalment', null),
  ('cash_entry_soft_delete.sql', 'index', 'idx_cash_entries_user_date_live', null),
  ('cash_ledger.sql', 'index', 'idx_cash_entries_user_date', null),
  ('cash_ledger.sql', 'policy', 'cash_entries_delete_own', null),
  ('cash_ledger.sql', 'policy', 'cash_entries_insert_own', null),
  ('cash_ledger.sql', 'policy', 'cash_entries_select_own', null),
  ('cash_ledger.sql', 'policy', 'cash_entries_update_own', null),
  ('cash_ledger.sql', 'table', 'cash_entries', null),
  ('cash_settlement_invoice_link.sql', 'column', 'invoice_id', 'cash_entries'),
  ('cash_settlement_per_instalment.sql', 'column', 'settlement_id', 'cash_entries'),
  ('cash_settlement_per_instalment.sql', 'index', 'cash_entries_one_settlement_per_instalment', null),
  ('cash_settlement_per_instalment.sql', 'index', 'idx_cash_entries_settlement', null),
  ('circle_integrity_and_indexes.sql', 'column', 'content_hash', 'documents'),
  ('circle_integrity_and_indexes.sql', 'column', 'last_synced_email_at', 'email_connections'),
  ('circle_integrity_and_indexes.sql', 'column', 'needs_reauth', 'email_connections'),
  ('circle_integrity_and_indexes.sql', 'column', 'shared', 'documents'),
  ('circle_integrity_and_indexes.sql', 'constraint', 'invoices_document_id_fkey', null),
  ('circle_integrity_and_indexes.sql', 'index', 'idx_bank_transactions_invoice_id', null),
  ('client_extra_lines.sql', 'column', 'client_extra_line1', 'invoices'),
  ('client_extra_lines.sql', 'column', 'client_extra_line2', 'invoices'),
  ('client_extra_lines.sql', 'column', 'client_extra_line3', 'invoices'),
  ('client_extra_lines.sql', 'column', 'client_extra_line4', 'invoices'),
  ('company_members_sales_role.sql', 'column', 'created_by', 'invoices'),
  ('company_members_sales_role.sql', 'column', 'created_by', 'clients'),
  ('company_members_sales_role.sql', 'function', 'acting_for_owner', null),
  ('company_members_sales_role.sql', 'function', 'next_invoice_seq', null),
  ('company_members_sales_role.sql', 'index', 'clients_created_by_idx', null),
  ('company_members_sales_role.sql', 'index', 'company_member_invites_owner_idx', null),
  ('creditnota_partial.sql', 'function', 'assert_credit_within_original', null),
  ('crm_backbone.sql', 'column', 'client_id', 'invoices'),
  ('crm_backbone.sql', 'column', 'notes', 'clients'),
  ('crm_backbone.sql', 'index', 'idx_invoices_client_id', null),
  ('cron_runs.sql', 'index', 'cron_runs_job_started_idx', null),
  ('cron_runs.sql', 'table', 'cron_runs', null),
  ('daily_turnover.sql', 'index', 'idx_daily_turnover_user_date', null),
  ('daily_turnover.sql', 'policy', 'daily_turnover_delete_own', null),
  ('daily_turnover.sql', 'policy', 'daily_turnover_insert_own', null),
  ('daily_turnover.sql', 'policy', 'daily_turnover_select_own', null),
  ('daily_turnover.sql', 'policy', 'daily_turnover_update_own', null),
  ('daily_turnover.sql', 'table', 'daily_turnover', null),
  ('deletion_request_purge_warning.sql', 'column', 'purge_warning_sent_at', 'deletion_requests'),
  ('deletion_request_purge_warning.sql', 'index', 'deletion_requests_unwarned_idx', null),
  ('documents_accountant_read_policy.sql', 'policy', 'documents_accountant_read', null),
  ('documents_content_hash_unique.sql', 'function', 'document_is_referenced', null),
  ('documents_content_hash_unique.sql', 'index', 'uq_documents_user_content_hash', null),
  ('documents_shared_and_storage_policies.sql', 'column', 'content_hash', 'documents'),
  ('documents_shared_and_storage_policies.sql', 'column', 'shared', 'documents'),
  ('documents_shared_and_storage_policies.sql', 'index', 'idx_documents_user_content_hash', null),
  ('documents_shared_and_storage_policies.sql', 'policy', 'documents_delete', null),
  ('documents_shared_and_storage_policies.sql', 'policy', 'documents_read', null),
  ('documents_shared_and_storage_policies.sql', 'policy', 'documents_upload', null),
  ('eft_settlements.sql', 'index', 'idx_eft_settlements_user_date', null),
  ('eft_settlements.sql', 'policy', 'eft_settlements_delete_own', null),
  ('eft_settlements.sql', 'policy', 'eft_settlements_insert_own', null),
  ('eft_settlements.sql', 'policy', 'eft_settlements_select_own', null),
  ('eft_settlements.sql', 'policy', 'eft_settlements_update_own', null),
  ('eft_settlements.sql', 'table', 'eft_settlements', null),
  ('email_failed_attempts.sql', 'index', 'email_failed_attempts_user_msg_uidx', null),
  ('email_failed_attempts.sql', 'policy', 'email_failed_attempts_select_own', null),
  ('email_failed_attempts.sql', 'table', 'email_failed_attempts', null),
  ('email_sender_rules.sql', 'index', 'email_sender_rules_user_email_uidx', null),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_delete_own', null),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_insert_own', null),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_select_own', null),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_update_own', null),
  ('email_sender_rules.sql', 'table', 'email_sender_rules', null),
  ('factuur_b_numbering.sql', 'column', 'invoice_number_padding', 'profiles'),
  ('factuur_b_numbering.sql', 'column', 'invoice_number_template', 'profiles'),
  ('factuur_b_numbering.sql', 'constraint', 'invoices_sender_invoice_number_key', null),
  ('factuur_b_numbering.sql', 'function', 'next_invoice_seq', null),
  ('factuur_b_numbering.sql', 'policy', 'invoice_counters_select_own', null),
  ('factuur_b_numbering.sql', 'table', 'invoice_counters', null),
  ('fair_use_usage.sql', 'function', 'fair_use_consume', null),
  ('fair_use_usage.sql', 'function', 'fair_use_release', null),
  ('fair_use_usage.sql', 'index', 'usage_counters_period_idx', null),
  ('fair_use_usage.sql', 'policy', 'usage_counters_select_own', null),
  ('fair_use_usage.sql', 'table', 'usage_counters', null),
  ('feedback.sql', 'index', 'feedback_user_created_idx', null),
  ('feedback.sql', 'policy', 'feedback_insert_own', null),
  ('feedback.sql', 'policy', 'feedback_select_own', null),
  ('feedback.sql', 'table', 'feedback', null),
  ('folders_accountant_read.sql', 'policy', 'folders_accountant_read', null),
  ('invitations_rls_scoped_read.sql', 'policy', 'invitee or inviter can read invitations', null),
  ('invoice_accountant_write_guard.sql', 'function', 'prevent_accountant_amount_changes', null),
  ('invoice_accountant_write_guard.sql', 'function', 'prevent_verwerkt_invoice_changes', null),
  ('invoice_archive_reason.sql', 'column', 'archive_reason', 'invoices'),
  ('invoice_archive_reason.sql', 'column', 'archived_at', 'invoices'),
  ('invoice_archive_reason.sql', 'constraint', 'invoices_archive_reason_check', null),
  ('invoice_archive_reason.sql', 'index', 'idx_invoices_archived_reason', null),
  ('invoice_bijlage.sql', 'column', 'attachment_document_id', 'invoices'),
  ('invoice_bijlage.sql', 'constraint', 'invoices_attachment_document_id_fkey', null),
  ('invoice_bijlage.sql', 'index', 'invoices_attachment_document_id_idx', null),
  ('invoice_corrected_at.sql', 'column', 'corrected_at', 'invoices'),
  ('invoice_discount.sql', 'column', 'discount_type', 'invoices'),
  ('invoice_discount.sql', 'column', 'discount_value', 'invoices'),
  ('invoice_discount.sql', 'constraint', 'invoices_discount_pair_check', null),
  ('invoice_discount.sql', 'constraint', 'invoices_discount_type_check', null),
  ('invoice_discount.sql', 'constraint', 'invoices_discount_value_check', null),
  ('invoice_line_discount.sql', 'column', 'discount_type', 'invoice_lines'),
  ('invoice_line_discount.sql', 'column', 'discount_value', 'invoice_lines'),
  ('invoice_line_discount.sql', 'constraint', 'invoice_lines_discount_type_check', null),
  ('invoice_line_discount.sql', 'constraint', 'invoice_lines_discount_value_check', null),
  ('invoice_line_unit.sql', 'column', 'unit', 'invoice_lines'),
  ('invoice_lines_accountant_gate.sql', 'policy', 'invoice_lines_select_accountant', null),
  ('invoice_manual_payment_idempotency_scope.sql', 'function', 'apply_manual_payment', null),
  ('invoice_manual_payments.sql', 'column', 'client_key', 'bank_tx_invoices'),
  ('invoice_manual_payments.sql', 'column', 'method', 'bank_tx_invoices'),
  ('invoice_manual_payments.sql', 'column', 'paid_on', 'bank_tx_invoices'),
  ('invoice_manual_payments.sql', 'constraint', 'bank_tx_invoices_method_check', null),
  ('invoice_manual_payments.sql', 'constraint', 'bank_tx_invoices_origin_check', null),
  ('invoice_manual_payments.sql', 'function', 'apply_manual_payment', null),
  ('invoice_move_payment.sql', 'function', 'move_invoice_payment', null),
  ('invoice_move_payment_creditnota_guard.sql', 'function', 'move_invoice_payment', null),
  ('invoice_partial_payments.sql', 'column', 'amount_applied', 'bank_tx_invoices'),
  ('invoice_partial_payments.sql', 'column', 'amount_paid', 'invoices'),
  ('invoice_partial_payments.sql', 'function', 'apply_bank_payment', null),
  ('invoice_partial_payments.sql', 'function', 'recompute_invoice_amount_paid', null),
  ('invoice_payment_date_rederive.sql', 'function', 'recompute_invoice_amount_paid', null),
  ('invoice_questions.sql', 'policy', 'acc_status_client_read_invoice', null),
  ('invoice_reminders.sql', 'column', 'reminder_offsets', 'profiles'),
  ('invoice_reminders.sql', 'column', 'reminders_enabled', 'profiles'),
  ('invoice_reminders.sql', 'column', 'reminders_paused', 'invoices'),
  ('invoice_reminders.sql', 'index', 'invoice_reminders_invoice_idx', null),
  ('invoice_reminders.sql', 'index', 'invoice_reminders_user_idx', null),
  ('invoice_reminders.sql', 'policy', 'invoice_reminders_select_own', null),
  ('invoice_schedules.sql', 'column', 'schedule_id', 'invoices'),
  ('invoice_schedules.sql', 'index', 'idx_invoice_schedules_due', null),
  ('invoice_schedules.sql', 'index', 'idx_invoice_schedules_user', null),
  ('invoice_schedules.sql', 'index', 'invoice_schedules_one_per_source', null),
  ('invoice_schedules.sql', 'index', 'invoices_one_per_schedule_date', null),
  ('invoice_schedules.sql', 'policy', 'invoice_schedules_delete_own', null),
  ('invoice_superseded_by.sql', 'column', 'superseded_by_number', 'invoices'),
  ('kas_opening_balance.sql', 'column', 'kas_opening_balance', 'profiles'),
  ('kluis_subscriptions.sql', 'index', 'kluis_subscriptions_session_uidx', null),
  ('kluis_subscriptions.sql', 'index', 'kluis_subscriptions_user_idx', null),
  ('kluis_subscriptions.sql', 'policy', 'kluis_subscriptions_select_own', null),
  ('kluis_subscriptions.sql', 'table', 'kluis_subscriptions', null),
  ('ledger_daily.sql', 'index', 'idx_ledger_daily_user_date', null),
  ('ledger_daily.sql', 'index', 'ledger_daily_unique_day_kind', null),
  ('ledger_daily.sql', 'policy', 'ledger_daily_delete_own', null),
  ('ledger_daily.sql', 'policy', 'ledger_daily_insert_own', null),
  ('ledger_daily.sql', 'policy', 'ledger_daily_select_own', null),
  ('ledger_daily.sql', 'policy', 'ledger_daily_update_own', null),
  ('offerte_akkoord.sql', 'column', 'offerte_responded_at', 'invoices'),
  ('offerte_akkoord.sql', 'column', 'offerte_response', 'invoices'),
  ('offerte_akkoord.sql', 'column', 'offerte_response_name', 'invoices'),
  ('offerte_akkoord.sql', 'column', 'offerte_token', 'invoices'),
  ('offerte_akkoord.sql', 'constraint', 'invoices_offerte_response_check', null),
  ('offerte_akkoord.sql', 'constraint', 'invoices_offerte_response_paired_check', null),
  ('pay_bundles.sql', 'index', 'idx_pay_bundle_invoices_bundle', null),
  ('pay_bundles.sql', 'index', 'idx_pay_bundle_invoices_invoice', null),
  ('pay_bundles.sql', 'index', 'idx_pay_bundles_token', null),
  ('pay_bundles.sql', 'index', 'idx_pay_bundles_user', null),
  ('pay_bundles.sql', 'index', 'pay_bundle_invoices_unique_pair', null),
  ('pay_bundles.sql', 'policy', 'pay_bundle_invoices_delete_own', null),
  ('push_subscriptions.sql', 'index', 'idx_push_subscriptions_user', null),
  ('push_subscriptions.sql', 'policy', 'push_subscriptions_delete_own', null),
  ('push_subscriptions.sql', 'policy', 'push_subscriptions_select_own', null),
  ('push_subscriptions.sql', 'table', 'push_subscriptions', null),
  ('regime_kor.sql', 'column', 'kor_active', 'profiles'),
  ('register_profile_from_metadata.sql', 'function', 'handle_new_user', null),
  ('repair_mandate_policies.sql', 'column', 'purge_warning_sent_at', 'deletion_requests'),
  ('repair_mandate_policies.sql', 'index', 'deletion_requests_unwarned_idx', null),
  ('repair_mandate_policies.sql', 'policy', 'invoice_lines_mandate_read', null),
  ('repair_mandate_policies.sql', 'policy', 'invoices_mandate_draft_issue', null),
  ('repair_mandate_policies.sql', 'policy', 'invoices_mandate_draft_read', null),
  ('retention_purge.sql', 'column', 'purged_at', 'deletion_requests'),
  ('retention_purge.sql', 'index', 'deletion_requests_purge_due_idx', null),
  ('search_bank_cash.sql', 'index', 'bank_transactions_counterpart_iban_trgm', null),
  ('search_bank_cash.sql', 'index', 'bank_transactions_counterpart_name_trgm', null),
  ('search_bank_cash.sql', 'index', 'bank_transactions_description_trgm', null),
  ('search_bank_cash.sql', 'index', 'bank_transactions_reference_trgm', null),
  ('search_bank_cash.sql', 'index', 'cash_entries_category_trgm', null),
  ('search_bank_cash.sql', 'index', 'cash_entries_description_trgm', null),
  ('search_engine.sql', 'index', 'clients_email_trgm', null),
  ('search_engine.sql', 'index', 'clients_name_trgm', null),
  ('search_engine.sql', 'index', 'documents_ai_doc_type_trgm', null),
  ('search_engine.sql', 'index', 'documents_doc_type_trgm', null),
  ('search_engine.sql', 'index', 'documents_file_name_trgm', null),
  ('search_engine.sql', 'index', 'documents_notes_trgm', null),
  ('search_engine_clients_kvk_city.sql', 'index', 'clients_city_trgm', null),
  ('search_engine_clients_kvk_city.sql', 'index', 'clients_kvk_number_trgm', null),
  ('search_smart.sql', 'function', 'search_clients_fuzzy', null),
  ('search_smart.sql', 'function', 'search_documents_fuzzy', null),
  ('search_smart.sql', 'function', 'search_folders_fuzzy', null),
  ('search_smart.sql', 'function', 'search_invoices_fuzzy', null),
  ('seed_invoice_counter.sql', 'function', 'seed_invoice_counter', null),
  ('snelstart_claim_before_push.sql', 'constraint', 'snelstart_exports_status_check', null),
  ('snelstart_claim_before_push.sql', 'index', 'snelstart_exports_user_invoice_claim_uidx', null),
  ('snelstart_connection.sql', 'index', 'snelstart_exports_user_pushed_at_idx', null),
  ('snelstart_connection.sql', 'policy', 'snelstart_connections_select_own', null),
  ('snelstart_connection.sql', 'policy', 'snelstart_exports_select_own', null),
  ('snelstart_connection.sql', 'table', 'snelstart_connections', null),
  ('snelstart_connection.sql', 'table', 'snelstart_exports', null),
  ('subscription_plans_fair_use.sql', 'constraint', 'profiles_subscription_plan_check', null),
  ('supplier_aliases.sql', 'index', 'idx_supplier_aliases_supplier', null),
  ('supplier_aliases.sql', 'index', 'supplier_aliases_unique_key', null),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_delete_own', null),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_insert_own', null),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_select_own', null),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_update_own', null),
  ('supplier_kvk_index.sql', 'index', 'suppliers_user_kvk_uidx', null),
  ('supplier_registry.sql', 'column', 'supplier_id', 'invoices'),
  ('supplier_registry.sql', 'index', 'idx_invoices_supplier_id', null),
  ('supplier_registry.sql', 'index', 'suppliers_name_trgm', null),
  ('supplier_registry.sql', 'index', 'suppliers_user_iban_uidx', null),
  ('supplier_registry.sql', 'index', 'suppliers_user_name_key_idx', null),
  ('supplier_registry.sql', 'policy', 'suppliers_delete_own', null),
  ('vat_exemption.sql', 'column', 'vat_deduction', 'invoices'),
  ('vat_exemption.sql', 'column', 'vat_exempt_activity', 'profiles'),
  ('vat_exemption.sql', 'column', 'vat_exempt_since', 'profiles'),
  ('vat_exemption.sql', 'column', 'vat_treatment', 'invoice_lines'),
  ('vat_exemption.sql', 'constraint', 'invoice_lines_vat_treatment_check', null),
  ('vat_exemption.sql', 'constraint', 'invoices_vat_deduction_check', null),
  ('vat_scheme.sql', 'column', 'vat_scheme', 'profiles'),
  ('vat_scheme.sql', 'column', 'vat_scheme_since', 'profiles'),
  ('vat_statement_note.sql', 'column', 'vat_statement_note', 'profiles')
),
bevonden as (
  select p.*,
    case p.soort
      when 'table' then exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = p.object)
      when 'column' then exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = p.tabel and column_name = p.object)
      when 'function' then exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
             where n.nspname = 'public' and f.proname = p.object)
      when 'index' then exists (select 1 from pg_indexes
             where schemaname = 'public' and indexname = p.object)
      when 'constraint' then exists (select 1 from pg_constraint where conname = p.object)
      when 'policy' then exists (select 1 from pg_policies
             where schemaname = 'public' and policyname = p.object)
    end as aanwezig
  from probe p
)
select
  case when bool_and(aanwezig) then 'TOEGEPAST'
       when bool_or(aanwezig)  then 'GEDEELTELIJK  <-- KIJK HIER'
       else 'OPEN' end                                        as stand,
  bestand,
  count(*) filter (where aanwezig) || ' / ' || count(*)       as objecten_gevonden,
  string_agg(case when not aanwezig then soort || ' ' || object end, ', ')  as ontbreekt
from bevonden
group by bestand
-- GEDEELTELIJK eerst, dan OPEN, dan de rest: de regels waar iets aan te doen is, bovenaan.
order by case when bool_and(aanwezig) then 3 when bool_or(aanwezig) then 1 else 2 end, bestand;

-- =====================================================================
-- NIET VAST TE STELLEN — 9 van de 104 migraties
-- =====================================================================
--
-- Deze maken niets aan: ze trekken rechten in, gooien iets weg, zetten commentaar of
-- wijzigen alleen bestaande objecten. Er is dus geen object waarvan het BESTAAN iets
-- bewijst. Ze krijgen met opzet GEEN verzonnen vingerafdruk — een lijst die zwijgt over wat
-- ze niet weet, is precies de lijst waar dit bestand tegen is geschreven.
--
-- Controleer deze met het CONTROLE-blok onderaan het migratiebestand zelf.
--
--   BRIDGE-D_soft_delete_test_pollution.sql
--   accountant_clients_insert_consent.sql
--   accountant_clients_update_consent.sql
--   bank_tx_invoices_amount.sql
--   creditnota_one_per_original.sql
--   function_search_path.sql
--   rpc_anon_revoke.sql
--   storage_bucket_hardening.sql
--   supplier_backfill.sql
--
-- =====================================================================
-- OBJECTEN DIE LATER ZIJN OPGERUIMD — tellen niet mee in het oordeel
-- =====================================================================
--
-- Deze objecten worden door een LATERE migratie weer weggegooid. Hun afwezigheid bewijst
-- niets over de migratie die ze aanmaakte — die kan allang gedraaid hebben. Meetellen zou
-- een toegepaste migratie als OPEN aanmerken, en dat is de duurste soort fout die deze
-- lijst kan maken: hem nog een keer draaien.
--
--   accountant_invoice_mandate.sql → index accountant_invoice_mandates_one_active
--   accountant_subject_status.sql → policy acc_status_owner_all
--   cash_settlement_invoice_link.sql → index cash_entries_one_settlement_per_invoice
--   creditnota_one_per_original.sql → index invoices_one_creditnota_per_original
--   snelstart_connection.sql → index snelstart_exports_user_invoice_pushed_uidx

