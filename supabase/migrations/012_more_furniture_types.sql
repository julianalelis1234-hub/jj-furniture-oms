-- 012 — seven more furniture types for the configurator and the AI designer.
-- Additive only: new values on the furniture_category enum. Existing orders and
-- revisions are untouched. Per-piece details (drawers, shelves, doors, leg style)
-- need no column: they are written in design_variant after the design name, e.g.
-- 'Chest of Drawers · 6 drawers · tapered legs', so they go through the existing
-- revision, quotation-approval and diff machinery unchanged.
alter type public.furniture_category add value if not exists 'Chair';
alter type public.furniture_category add value if not exists 'Bench';
alter type public.furniture_category add value if not exists 'TV Stand / Console';
alter type public.furniture_category add value if not exists 'Altar Table';
alter type public.furniture_category add value if not exists 'Study Desk';
alter type public.furniture_category add value if not exists 'Headboard';
alter type public.furniture_category add value if not exists 'Drawer Cabinet';
