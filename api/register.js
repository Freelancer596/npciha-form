'use strict';
const crypto = require('crypto');
const sb = require('../lib/sb');
const { MAX_BODY, secHeaders, send, sendError, sameOrigin, readJson, handleError } = require('../lib/http');
const { validateRegistration, validatePhoto } = require('../lib/validate');
const { rateLimit } = require('../lib/auth');
const { validateLocation } = require('../lib/location');

const RATE_MAX = Math.min(Math.max(parseInt(process.env.REGISTER_RATE_MAX || '30', 10) || 30, 1), 500);

function karachiDate(iso) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(iso));
  const g = t => p.find(x => x.type === t).value;
  return `${+g('day')}-${+g('month')}-${g('year')}`; // same d-m-yyyy style as the original form
}

// Only fields the printed form needs; never includes the storage path or internal ids.
function publicMember(v, row) {
  return {
    ref: row.ref_no, date: karachiDate(row.created_at), name: v.name, father: v.father_name, cnic: v.cnic, dob: v.dob,
    religion: v.religion, education: v.education || '', designation: v.designation, wing: v.wing,
    res: v.residence_address, off: v.office_address || '', prof: v.profession || '', contact: v.contact, email: v.email || '',
  };
}

const STORED = 'ref_no,created_at,cnic,name,father_name,dob,religion,education,designation,wing,residence_address,office_address,profession,contact,email';
function fromStored(r) {
  return publicMember({ name: r.name, father_name: r.father_name, cnic: r.cnic, dob: r.dob, religion: r.religion, education: r.education, designation: r.designation, wing: r.wing, residence_address: r.residence_address, office_address: r.office_address, profession: r.profession, contact: r.contact, email: r.email }, r);
}

module.exports = async (req, res) => {
  secHeaders(res);
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'method_not_allowed', 'Method not allowed.'); }
    if (!sameOrigin(req, { required: false })) return sendError(res, 403, 'forbidden', 'Request not allowed.');

    if (!(await rateLimit(req, 'register', 3600, RATE_MAX))) {
      res.setHeader('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'Too many registrations from this network. Please try again later.');
    }

    const body = await readJson(req, MAX_BODY.register);
    const r = validateRegistration(body);
    const ph = validatePhoto(body.photo);
    if (!r.ok || !ph.ok) {
      const fields = Object.assign({}, r.errors); if (!ph.ok) fields.photo = ph.error;
      return sendError(res, 422, 'validation_failed', 'Please correct the highlighted information.', { fields });
    }
    const v = r.value;

    // Province / district / taluka must exist, be active, and match each other (checked in the database).
    const loc = await validateLocation(body);
    if (!loc.ok) return sendError(res, 422, 'validation_failed', 'Please correct the highlighted information.', { fields: loc.errors });

    // Idempotent retry: same submission token already saved -> return the saved record, do not create another.
    const prior = await sb.select('members', [['submission_token', 'eq.' + v.submission_token], ['select', STORED], ['limit', '1']], { single: true });
    if (prior.data) {
      if (prior.data.cnic !== v.cnic) return sendError(res, 409, 'token_reused', 'This submission was already used. Please reload the page.');
      return send(res, 200, { ok: true, duplicate_submission: true, ref: prior.data.ref_no, date: karachiDate(prior.data.created_at), member: fromStored(prior.data) });
    }

    // Early duplicate check (the database UNIQUE constraint remains the final authority)
    const dup = await sb.select('members', [['cnic', 'eq.' + v.cnic], ['select', 'id'], ['limit', '1']], { single: true });
    if (dup.data) return sendError(res, 409, 'duplicate_cnic', 'A registration with this CNIC already exists.');

    // 1) store photo in the PRIVATE bucket  2) insert the member row  3) on failure remove the orphaned photo
    const id = crypto.randomUUID();
    const photoPath = 'members/' + id + '.jpg';
    await sb.putObject(photoPath, ph.buffer, 'image/jpeg');

    let row;
    try {
      const out = await sb.insert('members', {
        id, submission_token: v.submission_token, name: v.name, father_name: v.father_name, cnic: v.cnic, dob: v.dob,
        religion: v.religion, education: v.education || null, designation: v.designation, wing: v.wing,
        residence_address: v.residence_address, office_address: v.office_address || null, profession: v.profession || null,
        contact: v.contact, email: v.email || null, photo_path: photoPath,
        province_id: loc.value.province_id, district_id: loc.value.district_id, taluka_name: loc.value.taluka_name,
      }, { query: [['select', 'ref_no,created_at']] });
      row = out && out[0];
      if (!row || !row.ref_no) throw new sb.DbError('db', 500, 'no_row');
    } catch (e) {
      try { await sb.deleteObject(photoPath); } catch (e2) { console.error('[register] orphan photo cleanup failed'); }
      if (e && e.kind === 'db' && e.code === '23505') {
        // A concurrent double-submit with the same token may have won the race: answer idempotently.
        // Which constraint Postgres names first is not relied upon.
        const again = await sb.select('members', [['submission_token', 'eq.' + v.submission_token], ['select', STORED], ['limit', '1']], { single: true });
        if (again.data && again.data.cnic === v.cnic) return send(res, 200, { ok: true, duplicate_submission: true, ref: again.data.ref_no, date: karachiDate(again.data.created_at), member: fromStored(again.data) });
        return sendError(res, 409, 'duplicate_cnic', 'A registration with this CNIC already exists.');
      }
      throw e;
    }

    // Mirror the saved application to Google Sheets when configured. A Sheets outage must not
    // undo or block the authoritative Supabase registration.
    const publicRecord = publicMember(v, row);
    try {
      const { appendRegistration } = require('../lib/google-sheets');
      await appendRegistration(publicRecord, loc.value);
    } catch (sheetError) {
      console.error('[register] Google Sheets sync failed:', sheetError && sheetError.message ? sheetError.message : 'unknown_error');
    }

    // Success is reported only now, after the database confirmed the row.
    console.log('[register] saved member ref=' + row.ref_no);
    return send(res, 201, { ok: true, ref: row.ref_no, date: karachiDate(row.created_at), member: publicRecord });
  } catch (e) {
    return handleError(res, e, 'register');
  }
};
