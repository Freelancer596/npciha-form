'use strict';
const sb = require('../lib/sb');
const { secHeaders, send, sendError, sameOrigin, readJson } = require('../lib/http');
const { rateLimit } = require('../lib/auth');
const nodemailer = require('nodemailer');

const MAX_PDF_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 1500 * 1024;

module.exports = async (req, res) => {
  secHeaders(res);
  let claimedMemberId = null;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
    }
    if (!sameOrigin(req, { required: false })) return sendError(res, 403, 'forbidden', 'Request not allowed.');
    if (!(await rateLimit(req, 'pdf:send', 3600, 10))) {
      res.setHeader('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'Too many PDF email requests.');
    }

    const body = await readJson(req, MAX_BODY_BYTES);
    const token = typeof body.submission_token === 'string' ? body.submission_token : '';
    const encoded = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) || !encoded || encoded.length > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return sendError(res, 400, 'invalid_payload', 'PDF email request is invalid.');
    }
    const pdfBuffer = Buffer.from(encoded, 'base64');
    if (pdfBuffer.length < 4 || pdfBuffer.length > MAX_PDF_BYTES || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      return sendError(res, 400, 'invalid_pdf', 'PDF file is invalid.');
    }

    const found = await sb.select('members', [
      ['submission_token', 'eq.' + token.toLowerCase()],
      ['select', 'id,ref_no,name,created_at'],
      ['limit', '1'],
    ], { single: true });
    const member = found.data;
    if (!member || !member.id || !member.created_at) return sendError(res, 404, 'not_found', 'Application not found.');
    const createdAt = Date.parse(member.created_at);
    if (!Number.isFinite(createdAt) || createdAt > Date.now() || Date.now() - createdAt > 10 * 60 * 1000) {
      return sendError(res, 410, 'expired', 'PDF email request has expired.');
    }

    try {
      await sb.insert('pdf_emails', { member_id: member.id, sent_at: new Date().toISOString() });
      claimedMemberId = member.id;
    } catch (e) {
      if (e && e.kind === 'db' && e.code === '23505') return send(res, 200, { ok: true, already_sent: true });
      throw e;
    }

    const user = (process.env.GMAIL_USER || '').trim();
    const password = (process.env.GMAIL_APP_PASSWORD || '').trim();
    const recipient = (process.env.NOTIFY_TO || '').trim();
    if (!user || !password || !recipient) throw new Error('email_not_configured');

    const safeName = String(member.name || 'Member').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Member';
    const refNo = String(member.ref_no || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass: password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
    });
    await transporter.sendMail({
      from: user,
      to: recipient,
      subject: 'NPCIHA Application ' + refNo + ' - ' + String(member.name || 'Member'),
      text: 'Application Ref: ' + refNo + '\nName: ' + String(member.name || 'Member'),
      attachments: [{ filename: 'NPCIHA-' + refNo + '-' + safeName + '.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
    });
    return send(res, 200, { ok: true });
  } catch (e) {
    if (claimedMemberId) {
      try { await sb.remove('pdf_emails', [['member_id', 'eq.' + claimedMemberId]]); } catch (cleanupError) { /* retry claim cleanup on the next application attempt */ }
    }
    if (e && e.kind === 'too_large') return sendError(res, 413, 'too_large', 'PDF request is too large.');
    if (e && (e.kind === 'bad_json')) return sendError(res, 400, 'bad_request', 'PDF email request is invalid.');
    return sendError(res, 500, 'email_failed', 'Application PDF email could not be sent.');
  }
};
