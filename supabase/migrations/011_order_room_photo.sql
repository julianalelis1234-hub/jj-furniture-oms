-- 011 — the customer's room photo (taken with "View in your room" / AR).
-- Additive only: one nullable column and one private storage bucket.
-- Files are written and read by the server with the service role (like the
-- payment-proofs bucket from 009); no storage policies are added, so browsers
-- can never list or read the bucket directly.

alter table public.orders
  add column if not exists room_photo_path text;

comment on column public.orders.room_photo_path is
  'Private path in the room-photos bucket (<order_code>/<uuid>.<ext>); never a public URL. Staff open it through /api/orders/<id>/room-photo.';

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('room-photos', 'room-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false;
  end if;
end $$;
