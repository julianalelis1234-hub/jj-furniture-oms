-- LOCAL TEST ONLY: emulates the parts of Supabase the migration relies on
-- (auth schema, auth.uid(), anon/authenticated/service_role roles) so that
-- 001_init.sql can be verified against a plain Postgres server.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Test helper: accept the given revision number with the exact quoted amounts
-- (what the app server does for the customer / staff) via accept_order_revision().
create schema if not exists tests;
create or replace function tests.accept(p_order uuid, p_rev int, p_method text, p_name text,
                                        p_recorded_by uuid default null, p_new_code text default null)
returns jsonb language plpgsql as $$
declare r record;
begin
  select * into r from public.order_specification_revisions where order_id = p_order and revision_number = p_rev;
  return public.accept_order_revision(p_order, r.revision_id, p_rev, coalesce(r.quoted_furniture_price, 0),
    coalesce(r.quoted_delivery_fee, 0), coalesce(r.quoted_furniture_price, 0) + coalesce(r.quoted_delivery_fee, 0),
    gen_random_uuid()::text, p_method::public.confirmation_method, p_name, p_recorded_by, p_new_code);
end; $$;
grant usage on schema tests to public;
grant execute on function tests.accept(uuid, int, text, text, uuid, text) to public;
