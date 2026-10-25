-- Districts of Sindh. This is DATA, not code: edit, add or deactivate rows freely
-- (Supabase > Table Editor > districts). Re-running is safe.
-- Please verify against current official notifications; boundaries change.
insert into public.districts (code, name) values
 ('karachi-central','Karachi Central'),('karachi-east','Karachi East'),('karachi-south','Karachi South'),
 ('karachi-west','Karachi West'),('korangi','Korangi'),('malir','Malir'),('keamari','Keamari'),
 ('hyderabad','Hyderabad'),('jamshoro','Jamshoro'),('dadu','Dadu'),('matiari','Matiari'),
 ('tando-allahyar','Tando Allahyar'),('tando-muhammad-khan','Tando Muhammad Khan'),('badin','Badin'),
 ('thatta','Thatta'),('sujawal','Sujawal'),('sanghar','Sanghar'),('mirpurkhas','Mirpurkhas'),
 ('umerkot','Umerkot'),('tharparkar','Tharparkar'),('shaheed-benazirabad','Shaheed Benazirabad'),
 ('naushahro-feroze','Naushahro Feroze'),('khairpur','Khairpur'),('sukkur','Sukkur'),('ghotki','Ghotki'),
 ('shikarpur','Shikarpur'),('jacobabad','Jacobabad'),('kashmore','Kashmore'),('larkana','Larkana'),
 ('kamber-shahdadkot','Kamber Shahdadkot')
on conflict (code) do nothing;

-- Talukas are intentionally NOT pre-seeded (no unverified list). Add them in the Table Editor
-- or with statements like:
--   insert into public.talukas (district_id, name)
--   select id, 'Example Taluka' from public.districts where code = 'hyderabad';
