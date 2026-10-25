'use strict';
// Server-side checks for the province / district selected on the registration form.
// The taluka is free text (typed by the applicant), stored as entered, and limited in length.
const sb = require('./sb');
const { clean } = require('./validate');

const ID_RE = /^[1-9]\d{0,8}$/;
const toId = v => (v === undefined || v === null || v === '') ? null : (ID_RE.test(String(v)) ? Number(v) : NaN);
const TALUKA_RE = /^[\p{L}\p{M}\d][\p{L}\p{M}\d\s.'’\-()]*$/u;

// Returns { ok, errors, value } where value = { province_id, district_id, taluka_name }.
async function validateLocation(b) {
  const errors = {};
  const province_id = toId(b.province_id);
  const district_id = toId(b.district_id);

  if (!province_id || Number.isNaN(province_id)) errors.province = 'Select a valid province.';
  if (!district_id || Number.isNaN(district_id)) errors.district = 'Select a district from the list.';

  const taluka_name = clean(b.taluka_name, 100);
  if (taluka_name && (taluka_name.length > 100 || !TALUKA_RE.test(taluka_name))) errors.taluka = 'Enter a valid taluka name (letters only, max 100 characters).';
  if (Object.keys(errors).length) return { ok: false, errors };

  const p = await sb.select('provinces', [['select', 'id'], ['id', 'eq.' + province_id], ['active', 'eq.true'], ['limit', '1']], { single: true });
  if (!p.data) errors.province = 'Select a valid province.';

  const d = await sb.select('districts', [['select', 'id,province_id'], ['id', 'eq.' + district_id], ['active', 'eq.true'], ['limit', '1']], { single: true });
  if (!d.data || (p.data && d.data.province_id !== province_id)) errors.district = 'Select a district from the list.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, value: { province_id, district_id, taluka_name: taluka_name || null } };
}

module.exports = { validateLocation, toId };
