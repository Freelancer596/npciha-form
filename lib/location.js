'use strict';
// Server-side checks for the province / district / taluka selected on the registration form.
// Never trust client-supplied names or IDs: every ID is checked against the database.
const sb = require('./sb');

const ID_RE = /^[1-9]\d{0,8}$/;
const toId = v => (v === undefined || v === null || v === '') ? null : (ID_RE.test(String(v)) ? Number(v) : NaN);

// Returns { ok, errors, value } where value = { province_id, district_id, taluka_id }.
async function validateLocation(b) {
  const errors = {};
  const province_id = toId(b.province_id);
  const district_id = toId(b.district_id);
  const taluka_raw = toId(b.taluka_id);

  if (!province_id || Number.isNaN(province_id)) errors.province = 'Select a valid province.';
  if (!district_id || Number.isNaN(district_id)) errors.district = 'Select a district from the list.';
  if (Number.isNaN(taluka_raw)) errors.taluka = 'Select a taluka from the list.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const p = await sb.select('provinces', [['select', 'id'], ['id', 'eq.' + province_id], ['active', 'eq.true'], ['limit', '1']], { single: true });
  if (!p.data) errors.province = 'Select a valid province.';

  const d = await sb.select('districts', [['select', 'id,province_id'], ['id', 'eq.' + district_id], ['active', 'eq.true'], ['limit', '1']], { single: true });
  if (!d.data || (p.data && d.data.province_id !== province_id)) errors.district = 'Select a district from the list.';

  // A district with an official (verified) taluka list requires a taluka. Districts without one (e.g. Karachi) do not.
  const anyTaluka = await sb.select('talukas', [['select', 'id'], ['district_id', 'eq.' + district_id], ['active', 'eq.true'], ['verified', 'eq.true'], ['limit', '1']], { single: true });
  if (taluka_raw) {
    const t = await sb.select('talukas', [['select', 'id'], ['id', 'eq.' + taluka_raw], ['district_id', 'eq.' + district_id], ['active', 'eq.true'], ['verified', 'eq.true'], ['limit', '1']], { single: true });
    if (!t.data) errors.taluka = 'Select a taluka that belongs to the chosen district.';
  } else if (anyTaluka.data) {
    errors.taluka = 'Select a taluka.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, value: { province_id, district_id, taluka_id: taluka_raw || null } };
}

module.exports = { validateLocation, toId };
