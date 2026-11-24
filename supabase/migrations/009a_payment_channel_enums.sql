-- 009a · New payment channels for customer-submitted payments.
-- Enum values must be committed before 009b can use them (same pattern as 004a / 005a).
alter type public.payment_method add value if not exists 'Online Payment (GCash / Maya)';
alter type public.payment_method add value if not exists 'Bank Transfer';
alter type public.payment_type add value if not exists 'Full Payment';
