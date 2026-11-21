-- =============================================================================
-- Migration 006: retire Order ID + PIN customer access; email login only.
--
-- Removes the two active PIN / Order-ID endpoints. Historical data is KEPT:
-- orders.pin_code_hash / pin_code_display, the customer_pin_attempts table and
-- its rows, and the 'Customer Portal PIN' confirmation-method label on past
-- acceptances are untouched (audit trail). Applied migrations are not edited.
--
-- Adds database-level ownership for signed-in customers: a customer can read
-- ONLY the order rows where orders.customer_user_id = auth.uid(). Revisions,
-- payments, confirmations and history stay invisible to customers (the app
-- server loads those only for orders whose ownership the database confirmed).
-- =============================================================================

drop function if exists public.customer_verify_pin(text, text, text);
drop function if exists public.customer_track(text);

drop policy if exists orders_select_customer_own on public.orders;
create policy orders_select_customer_own on public.orders for select to authenticated
  using (customer_user_id = (select auth.uid()) and (select private.app_role()) = 'customer');
