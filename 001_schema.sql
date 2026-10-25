-- NPCIH-A membership database schema (Supabase / PostgreSQL)
-- Run once in Supabase Dashboard > SQL Editor. Safe to re-run (idempotent).

create extension if not exists pgcrypto;

-- ---------- Reference data (edit these tables to add districts / talukas) ----------
create table if not exists public.districts (
  id        serial primary key,
  code      text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  name      text not null,
  name_ur   text,
  active    boolean not null default true
);

create table if not exists public.talukas (
  id          serial primary key,
  district_id integer not null references public.districts(id) on delete restrict,
  name        text not null,
  name_ur     text,
  active      boolean not null default true,
  unique (district_id, name)
);

-- ---------- Members ----------
create sequence if not exists public.member_ref_seq start 1;

create table if not exists public.members (
  id                uuid primary key default gen_random_uuid(),
  ref_no            text not null unique
                    default ('NPCIHA/' || to_char(now() at time zone 'Asia/Karachi', 'YYYY') || '/' ||
                             lpad(nextval('public.member_ref_seq')::text, 6, '0')),
  submission_token  uuid unique,
  name              text not null check (char_length(name) between 2 and 100),
  father_name       text not null check (char_length(father_name) between 2 and 100),
  cnic              text not null,
  dob               date not null check (dob >= date '1900-01-01'),
  religion          text not null check (religion in ('Islam','Hinduism','Christianity','Sikhism','Other')),
  education         text check (char_length(education) <= 100),
  designation       text not null check (char_length(designation) between 1 and 100),
  wing              text not null check (char_length(wing) between 1 and 50),
  residence_address text not null check (char_length(residence_address) between 3 and 250),
  office_address    text check (char_length(office_address) <= 250),
  profession        text check (char_length(profession) <= 100),
  contact           text not null check (contact ~ '^03[0-9]{9}$'),
  email             text check (char_length(email) <= 120),
  photo_path        text,
  district_id       integer references public.districts(id) on delete set null,
  taluka_id         integer references public.talukas(id) on delete set null,
  status            text not null default 'pending' check (status in ('pending','approved','rejected')),
  status_note       text check (char_length(status_note) <= 300),
  reviewed_by       text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint members_cnic_format check (cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'),
  constraint members_cnic_key unique (cnic)          -- duplicate CNIC protection
);

create index if not exists members_district_idx on public.members (district_id);
create index if not exists members_taluka_idx   on public.members (taluka_id);
create index if not exists members_status_idx   on public.members (status);
create index if not exists members_created_idx  on public.members (created_at desc);
create index if not exists members_name_idx     on public.members (lower(name));

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists members_touch on public.members;
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

-- ---------- Administrators and sessions ----------
create table if not exists public.admins (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  full_name       text,
  password_hash   text not null,
  role            text not null check (role in ('super_admin','district_admin','data_entry')),
  district_id     integer references public.districts(id) on delete restrict,
  active          boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  constraint admins_district_required check (role = 'super_admin' or district_id is not null)
);

create table if not exists public.admin_sessions (
  token_hash  text primary key,                 -- SHA-256 of the cookie token (raw token is never stored)
  admin_id    uuid not null references public.admins(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip_hash     text
);
create index if not exists admin_sessions_admin_idx   on public.admin_sessions (admin_id);
create index if not exists admin_sessions_expires_idx on public.admin_sessions (expires_at);

-- ---------- Audit log ----------
create table if not exists public.audit_log (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  admin_id        uuid,
  admin_username  text,
  action          text not null,
  target_type     text,
  target_id       text,
  detail          jsonb,          -- never contains full CNIC / passwords / tokens
  ip_hash         text
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- ---------- Rate limiting (works across serverless instances) ----------
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
    delete from public.admin_sessions where expires_at < now();
  end if;
  return v_hits <= p_max;
end $$;

-- ---------- Summary (district x status counts) ----------
create or replace function public.admin_summary(p_district_id integer default null)
returns table (district_id integer, status text, n bigint)
language sql stable security definer set search_path = public as $$
  select m.district_id, m.status, count(*)::bigint
  from public.members m
  where p_district_id is null or m.district_id = p_district_id
  group by m.district_id, m.status
$$;

-- ---------- Row Level Security: deny everything to the public API ----------
-- RLS is enabled and NO policies exist for anon/authenticated, so the public (anon)
-- key can read or write nothing. Only the server (service_role key, which bypasses
-- RLS) reaches these tables. The service key never leaves the server.
alter table public.districts      enable row level security;
alter table public.talukas        enable row level security;
alter table public.members        enable row level security;
alter table public.admins         enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.audit_log      enable row level security;
alter table public.rate_limits    enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
grant  execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant  execute on function public.admin_summary(integer)                 to service_role;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- ---------- Private storage bucket for photographs ----------
-- public = false: files are NOT reachable by URL. No storage.objects policies are
-- created for this bucket, so anon/authenticated users cannot list, read or upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 524288, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 524288, allowed_mime_types = array['image/jpeg'];
