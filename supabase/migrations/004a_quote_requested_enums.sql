-- =============================================================================
-- Migration 004a: enum values for the dual-option ordering workflow.
-- Kept separate from 004b because Postgres cannot use a newly added enum value
-- inside the same transaction that adds it.
-- ADDITIVE ONLY.
-- =============================================================================

-- Pre-production intake state for customer self-service requests (Option 2).
-- Not a workshop stage: craftsmen never see orders in this state.
alter type public.order_status add value if not exists 'Quote Requested' before 'Waiting for Confirmation';

-- Revision 1 of a customer self-service request (no price yet).
alter type public.revision_type add value if not exists 'customer_request' before 'customer_proposal';
