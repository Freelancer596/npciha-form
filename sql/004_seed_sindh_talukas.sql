-- 004: Sindh talukas (tehsils) per district.
-- SOURCE: Wikipedia "List of tehsils of Sindh" (secondary source, NOT an official gazette).
-- All rows are inserted with verified = false, so they are NOT shown to applicants.
-- To publish a taluka: check it against an official Government of Sindh / Board of Revenue source,
-- then set verified = true (Supabase Table Editor -> talukas). Re-running this file is safe.
-- Karachi districts are intentionally excluded: their sub-units are "towns", not talukas.
-- Ghauspur/Ghunspur is not in this list and must be verified before it is added.

insert into public.talukas (district_id, name, verified, source)
select d.id, t.name, false, 'Wikipedia: List of tehsils of Sindh (secondary; official verification pending)'
from (values
  ('badin','Badin'),('badin','Matli'),('badin','Shaheed Fazil Rahu'),('badin','Talhar'),('badin','Tando Bago'),
  ('sujawal','Jati'),('sujawal','Kharo Chan'),('sujawal','Mirpur Bathoro'),('sujawal','Shah Bandar'),('sujawal','Sujawal'),
  ('thatta','Ghorabari'),('thatta','Keti Bunder'),('thatta','Mirpur Sakro'),('thatta','Thatta'),
  ('dadu','Dadu'),('dadu','Johi'),('dadu','Khairpur Nathan Shah'),('dadu','Mehar'),
  ('hyderabad','Hyderabad City'),('hyderabad','Hyderabad'),('hyderabad','Latifabad'),('hyderabad','Qasimabad'),
  ('jamshoro','Kotri'),('jamshoro','Sehwan'),('jamshoro','Manjhand'),('jamshoro','Thana Bulla Khan'),
  ('matiari','Hala'),('matiari','Matiari'),('matiari','Saeedabad'),
  ('tando-allahyar','Chamber'),('tando-allahyar','Jhando Mari'),('tando-allahyar','Tando Allahyar'),
  ('tando-muhammad-khan','Bulri Shah Karim'),('tando-muhammad-khan','Tando Ghulam Hyder'),('tando-muhammad-khan','Tando Muhammad Khan'),
  ('jacobabad','Garhi Khairo'),('jacobabad','Jacobabad'),('jacobabad','Thul'),
  ('kashmore','Kandhkot'),('kashmore','Kashmore'),('kashmore','Tangwani'),
  ('larkana','Bakrani'),('larkana','Dokri'),('larkana','Larkana'),('larkana','Ratodero'),
  ('kamber-shahdadkot','Mirokhan'),('kamber-shahdadkot','Nasirabad'),('kamber-shahdadkot','Qambar'),('kamber-shahdadkot','Qubo Saeed Khan'),
  ('kamber-shahdadkot','Shahdadkot'),('kamber-shahdadkot','Sijawal Junejo'),('kamber-shahdadkot','Warah'),
  ('shikarpur','Garhi Yasin'),('shikarpur','Khanpur'),('shikarpur','Lakhi'),('shikarpur','Shikarpur'),
  ('ghotki','Daharki'),('ghotki','Ghotki'),('ghotki','Khan Garh'),('ghotki','Mirpur Mathelo'),('ghotki','Ubauro'),
  ('khairpur','Faiz Ganj'),('khairpur','Gambat'),('khairpur','Khairpur'),('khairpur','Kingri'),('khairpur','Kot Diji'),
  ('khairpur','Nara'),('khairpur','Sobho Dero'),('khairpur','Thari Mirwah'),
  ('sukkur','New Sukkur'),('sukkur','Pano Akil'),('sukkur','Rohri'),('sukkur','Salehpat'),('sukkur','Sukkur'),
  ('naushahro-feroze','Bhiria'),('naushahro-feroze','Kandiaro'),('naushahro-feroze','Mehrabpur'),('naushahro-feroze','Moro'),('naushahro-feroze','Naushahro Feroze'),
  ('shaheed-benazirabad','Kazi Ahmed'),('shaheed-benazirabad','Daur'),('shaheed-benazirabad','Nawabshah'),('shaheed-benazirabad','Sakrand'),
  ('sanghar','Jam Nawaz Ali'),('sanghar','Khipro'),('sanghar','Sanghar'),('sanghar','Shahdadpur'),('sanghar','Sinjhoro'),('sanghar','Tando Adam Khan'),
  ('mirpurkhas','Digri'),('mirpurkhas','Hussain Bux Mari'),('mirpurkhas','Jhuddo'),('mirpurkhas','Kot Ghulam Muhammad'),
  ('mirpurkhas','Mirpur Khas'),('mirpurkhas','Shujabad'),('mirpurkhas','Sindhri'),
  ('tharparkar','Chachro'),('tharparkar','Dahli'),('tharparkar','Diplo'),('tharparkar','Kaloi'),('tharparkar','Islamkot'),('tharparkar','Mithi'),('tharparkar','Nagarparkar'),
  ('umerkot','Kunri'),('umerkot','Pithoro'),('umerkot','Samaro'),('umerkot','Umerkot')
) as t(dcode, name)
join public.districts d on d.code = t.dcode
on conflict (district_id, name) do nothing;
