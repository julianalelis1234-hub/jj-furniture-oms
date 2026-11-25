-- 013 — who verified each payment (and when), and the owner-set installment plan.
-- Additive only: new nullable columns and one extra trigger. The 009 payments guard is
-- unchanged; the new trigger only stamps and protects the new verifier columns.

-- --------------------------------------------------------- payment verifier ----
alter table public.payments
  add column if not exists verified_by_id uuid references public.profiles(id),
  add column if not exists verified_at    timestamptz;

comment on column public.payments.verified_by_id is 'Owner/staff who verified the payment (set once, at verification).';
comment on column public.payments.verified_at    is 'When the payment was verified (set once, at verification).';

create or replace function private.payments_verifier_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and (new.verified_by_id is distinct from old.verified_by_id or new.verified_at is distinct from old.verified_at)
     and not (not old.verified_by_owner_or_staff and new.verified_by_owner_or_staff) then
    raise exception 'IMMUTABLE_RECORD: the verifier of a payment is recorded once, when it is verified' using errcode = '42501';
  end if;
  if new.verified_by_owner_or_staff and new.verified_at is null
     and (tg_op = 'INSERT' or not old.verified_by_owner_or_staff) then
    new.verified_at := now();
  end if;
  return new;
end; $$;

drop trigger if exists payments_verifier_stamp on public.payments;
create trigger payments_verifier_stamp before insert or update on public.payments
  for each row execute function private.payments_verifier_stamp();

-- ------------------------------------------------------- installment plan ----
-- 30% down payment, then the balance in 2–6 equal payments every 15 days from the
-- first due date. Set by the owner/staff after the customer chooses "Installment".
alter table public.orders
  add column if not exists installment_count     smallint,
  add column if not exists installment_first_due date,
  add column if not exists installment_set_by    uuid references public.profiles(id),
  add column if not exists installment_set_at    timestamptz;

do $$ begin
  alter table public.orders add constraint orders_installment_count_range
    check (installment_count is null or installment_count between 2 and 6);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_installment_complete
    check ((installment_count is null) = (installment_first_due is null));
exception when duplicate_object then null; end $$;
