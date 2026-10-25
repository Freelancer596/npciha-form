-- 005: the applicant types the taluka name (free text). Stored as entered; no official list is required.
alter table public.members add column if not exists taluka_name text check (char_length(taluka_name) <= 100);
