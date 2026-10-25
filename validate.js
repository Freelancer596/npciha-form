'use strict';

const RELIGIONS = ['Islam', 'Hinduism', 'Christianity', 'Sikhism', 'Other'];
const WINGS = ['HRC'];                       // extend when new wings are added to the form
const PHOTO_MAX_BYTES = 350 * 1024;          // decoded JPEG; client sends ~420x540 (~40-90 KB)
const PHOTO_MAX_DIM = 2000;

// strip control chars, collapse whitespace, trim
function clean(v, max) {
  if (v === undefined || v === null) return '';
  let s = String(v).replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max + 1) : s; // +1 so the length check can fail instead of silently truncating
}

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u;

function normCnic(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 13) return null;
  return d.slice(0, 5) + '-' + d.slice(5, 12) + '-' + d.slice(12);
}

// Accepts 03XXXXXXXXX, 03XX-XXXXXXX, +923XXXXXXXXX, 00923XXXXXXXXX, 923XXXXXXXXX; returns 03XXXXXXXXX
function normMobile(v) {
  let s = String(v || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0092')) s = s.slice(4);
  else if (s.startsWith('92')) s = s.slice(2);
  else if (s.startsWith('0')) s = s.slice(1);
  if (!/^3\d{9}$/.test(s)) return null;
  return '0' + s;
}

function validDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== iso) return false;
  return iso >= '1900-01-01' && iso <= new Date().toISOString().slice(0, 10);
}

// Validates the registration form. Returns { ok, errors, value }.
function validateRegistration(b) {
  const e = {}; const v = {};
  b = b && typeof b === 'object' ? b : {};

  v.name = clean(b.name, 100);
  if (v.name.length < 2 || v.name.length > 100 || !NAME_RE.test(v.name)) e.name = 'Enter a valid name (letters only).';
  v.father_name = clean(b.father, 100);
  if (v.father_name.length < 2 || v.father_name.length > 100 || !NAME_RE.test(v.father_name)) e.father = 'Enter a valid father name (letters only).';

  v.cnic = normCnic(b.cnic);
  if (!v.cnic) e.cnic = 'CNIC must be 13 digits in the format #####-#######-#.';

  const dob = clean(b.dob, 10);
  if (!validDate(dob)) e.dob = 'Enter a valid date of birth.'; else v.dob = dob;

  v.religion = clean(b.religion, 20);
  if (!RELIGIONS.includes(v.religion)) e.religion = 'Select a valid religion.';

  v.education = clean(b.education, 100); if (v.education.length > 100) e.education = 'Education is too long.';
  v.designation = clean(b.designation, 100);
  if (!v.designation || v.designation.length > 100) e.designation = 'Designation is required (max 100 characters).';
  v.wing = clean(b.wing, 50);
  if (!WINGS.includes(v.wing)) e.wing = 'Select a valid wing.';

  v.residence_address = clean(b.res, 250);
  if (v.residence_address.length < 3 || v.residence_address.length > 250) e.res = 'Residence address is required (max 250 characters).';
  v.office_address = clean(b.off, 250); if (v.office_address.length > 250) e.off = 'Office address is too long.';
  v.profession = clean(b.prof, 100); if (v.profession.length > 100) e.prof = 'Profession is too long.';

  v.contact = normMobile(b.contact);
  if (!v.contact) e.contact = 'Enter a valid Pakistani mobile number, e.g. 03001234567.';

  v.email = clean(b.email, 120).toLowerCase();
  if (v.email && (v.email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email))) e.email = 'Enter a valid e-mail address.';

  const tok = clean(b.token, 40);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tok)) e.token = 'Invalid submission token.'; else v.submission_token = tok.toLowerCase();

  return { ok: Object.keys(e).length === 0, errors: e, value: v };
}

// Validates the photograph (data URI). Only JPEG is accepted (the page converts every chosen photo to JPEG).
function validatePhoto(dataUri) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUri || ''));
  if (!m) return { ok: false, error: 'Photo must be a JPEG image.' };
  if (m[1].length > Math.ceil(PHOTO_MAX_BYTES * 4 / 3) + 8) return { ok: false, error: 'Photo is too large (max 350 KB).' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > PHOTO_MAX_BYTES) return { ok: false, error: 'Photo is too large (max 350 KB).' };
  if (buf.length < 500 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF || buf[buf.length - 2] !== 0xFF || buf[buf.length - 1] !== 0xD9) {
    return { ok: false, error: 'Photo is not a valid JPEG image.' };
  }
  // read dimensions from the SOF marker
  let i = 2, w = 0, h = 0;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const mk = buf[i + 1];
    if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
    if (mk === 0xDA) break;
    i += 2 + len;
  }
  if (!w || !h || w > PHOTO_MAX_DIM || h > PHOTO_MAX_DIM || w < 50 || h < 50) return { ok: false, error: 'Photo dimensions are not acceptable.' };
  return { ok: true, buffer: buf };
}

// Fields an admin may change (keys as in the PATCH body -> DB columns)
const EDITABLE = {
  name: 'name', father: 'father_name', dob: 'dob', religion: 'religion', education: 'education',
  designation: 'designation', wing: 'wing', res: 'residence_address', off: 'office_address',
  prof: 'profession', contact: 'contact', email: 'email', cnic: 'cnic',
};

// Validate a partial update. Returns { ok, errors, patch } keyed by DB column.
function validateEdit(b) {
  const errors = {}; const patch = {};
  for (const k of Object.keys(EDITABLE)) {
    if (!(k in b)) continue;
    // validate by running the single field through the full validator with a valid scaffold
    const scaffold = {
      name: 'Valid Name', father: 'Valid Name', cnic: '12345-1234567-1', dob: '1990-01-01', religion: 'Islam',
      designation: 'x', wing: 'HRC', res: 'address', contact: '03001234567',
      token: '00000000-0000-4000-8000-000000000000',
    };
    scaffold[k] = b[k];
    const r = validateRegistration(scaffold);
    if (r.errors[k]) errors[k] = r.errors[k]; else patch[EDITABLE[k]] = r.value[EDITABLE[k]] === '' ? null : r.value[EDITABLE[k]];
  }
  if ('district_id' in b) {
    if (b.district_id === null || b.district_id === '') patch.district_id = null;
    else if (Number.isInteger(+b.district_id) && +b.district_id > 0) patch.district_id = +b.district_id;
    else errors.district_id = 'Invalid district.';
  }
  if ('taluka_id' in b) {
    if (b.taluka_id === null || b.taluka_id === '') patch.taluka_id = null;
    else if (Number.isInteger(+b.taluka_id) && +b.taluka_id > 0) patch.taluka_id = +b.taluka_id;
    else errors.taluka_id = 'Invalid taluka.';
  }
  return { ok: Object.keys(errors).length === 0 && Object.keys(patch).length > 0, errors, patch };
}

function maskCnic(c) { return c ? c.slice(0, 5) + '-*******-' + c.slice(-1) : c; }

module.exports = { validateRegistration, validatePhoto, validateEdit, normCnic, normMobile, maskCnic, clean, RELIGIONS, WINGS };
