-- One email claim per successfully registered member. Server uses the service-role key only.
create table if not exists public.pdf_emails (
  member_id uuid primary key references public.members(id) on delete cascade,
  sent_at timestamptz not null default now()
);

alter table public.pdf_emails enable row level security;
revoke all on table public.pdf_emails from anon, authenticated;
