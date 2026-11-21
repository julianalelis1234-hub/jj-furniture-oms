-- =============================================================================
-- Migration 005a: enum values for customer email authentication.
-- Separate from 005b because a new enum value cannot be used in the same
-- transaction that adds it. ADDITIVE ONLY.
-- =============================================================================
alter type public.app_role add value if not exists 'customer';
alter type public.notification_channel add value if not exists 'Email';
