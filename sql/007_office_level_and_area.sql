-- 007: where in the organisation a member holds office (separate from the free-text designation).
-- Safe to run on a live database: both columns are nullable, so the old form keeps working.
alter table public.members add column if not exists office_level text
  check (office_level is null or office_level in ('provincial','district','taluka','city','member'));
alter table public.members add column if not exists office_area text
  check (office_area is null or char_length(office_area) <= 100);
