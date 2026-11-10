-- Religion options are now: Islam, Hindu, Christian, Sikh.
-- No existing member uses Christianity, Sikhism or Other, so no rows change.
begin;
alter table public.members drop constraint if exists members_religion_check;
alter table public.members add constraint members_religion_check
  check (religion in ('Islam','Hindu','Christian','Sikh'));
commit;
