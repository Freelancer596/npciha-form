-- Religion value "Hinduism" is renamed to "Hindu" everywhere.
-- Existing rows are updated first, then the CHECK constraint is replaced.
begin;
update public.members set religion = 'Hindu' where religion = 'Hinduism';
alter table public.members drop constraint if exists members_religion_check;
alter table public.members add constraint members_religion_check
  check (religion in ('Islam','Hindu','Christianity','Sikhism','Other'));
commit;
