-- 003: province master, location columns, and an explicit "verified" flag for talukas.
-- Safe to re-run (idempotent). Existing districts/members rows are kept; districts are linked to Sindh.

create table if not exists public.provinces (
  id          serial primary key,
  code        text not null unique check (code ~ '^[a-z0-9-]{2,20}$'),
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.provinces (code, name) values ('sindh', 'Sindh') on conflict (code) do nothing;

-- districts: link to province, keep existing "code" column as the slug
alter table public.districts add column if not exists province_id integer references public.provinces(id) on delete restrict;
alter table public.districts add column if not exists created_at timestamptz not null default now();
update public.districts
   set province_id = (select id from public.provinces where code = 'sindh')
 where province_id is null;
alter table public.districts alter column province_id set not null;
create unique index if not exists districts_province_name_key on public.districts (province_id, name);
create index if not exists districts_province_idx on public.districts (province_id);

-- talukas: "verified" is TRUE only after the name has been checked against an official source.
-- The public API returns talukas only when active AND verified.
alter table public.talukas add column if not exists verified boolean not null default false;
alter table public.talukas add column if not exists source text;
alter table public.talukas add column if not exists created_at timestamptz not null default now();
create index if not exists talukas_district_idx on public.talukas (district_id);

-- members: store the province the applicant selected (district_id and taluka_id already exist)
alter table public.members add column if not exists province_id integer references public.provinces(id) on delete set null;
create index if not exists members_province_idx on public.members (province_id);

-- Row Level Security: same policy as the other tables (no anon/authenticated access; the server uses the secret key)
alter table public.provinces enable row level security;
revoke all on public.provinces from anon, authenticated;
