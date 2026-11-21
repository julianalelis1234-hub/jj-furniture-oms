-- Migration 005 on top of the live data: legacy rows marked (not reclassified),
-- no email invented, and legacy rows can still be updated.
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'TEST FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
\set QUIET off
select pg_temp.check(count(*) = 14 and bool_and(legacy_contact_unknown and customer_email is null and not has_no_email
                     and customer_user_id is null and provisioning_status = 'not_applicable'),
  'all 14 live orders marked legacy_contact_unknown: no email invented, not reclassified as walk-ins') from public.orders;
select pg_temp.check(count(*) = 14 and bool_and(pin_code_hash is not null), 'existing paper-slip PINs are kept') from public.orders;
update public.orders set special_instructions = coalesce(special_instructions, '') where true;
select pg_temp.check(true, 'legacy rows remain updatable under the email-or-walk-in rule');
update public.orders set customer_email = 'added.later@example.com'
where id = (select id from public.orders order by order_code limit 1);
select pg_temp.check(not legacy_contact_unknown and email_verified_at is null and provisioning_status = 'pending',
  'adding an email to a legacy order clears the marker and starts UNVERIFIED')
from public.orders where customer_email = 'added.later@example.com';
\echo 'MIGRATION 005 LEGACY TESTS PASSED'
