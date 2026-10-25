'use strict';
// Minimal Supabase REST client (PostgREST + Storage) using fetch. No npm dependencies.
// SERVER ONLY: uses the service-role key, which must never reach the browser.

class DbError extends Error {
  constructor(kind, status, code, message) {
    super(message || kind);
    this.kind = kind;      // 'config' | 'network' | 'db'
    this.status = status;  // HTTP status from Supabase, if any
    this.code = code;      // Postgres / PostgREST error code, if any
  }
}

const TIMEOUT_MS = 9000;

function cfg() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https?:\/\//.test(url) || !key) throw new DbError('config');
  return { url, key };
}

function authHeaders(key) {
  const h = { apikey: key };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key; // legacy JWT keys only
  return h;
}

async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const { url, key } = cfg();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url + path, {
      method, body, signal: ctl.signal,
      headers: { ...authHeaders(key), ...headers },
    });
  } catch (e) {
    throw new DbError('network');
  } finally {
    clearTimeout(timer);
  }
}

async function failFrom(res) {
  let j = null;
  try { j = await res.json(); } catch (e) { /* ignore */ }
  throw new DbError('db', res.status, j && j.code, j && j.message);
}

function qs(query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of query) p.append(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

// select rows. query: array of [key, value]. returns { data, count }
async function select(table, query, { count = false, single = false } = {}) {
  const headers = {};
  if (count) headers.Prefer = 'count=exact';
  const res = await call('/rest/v1/' + table + qs(query), { headers });
  if (!res.ok) await failFrom(res);
  const data = await res.json();
  let total = null;
  const cr = res.headers.get('content-range');
  if (cr && cr.includes('/')) { const n = cr.split('/')[1]; if (n !== '*') total = parseInt(n, 10); }
  return { data: single ? (data[0] || null) : data, count: total };
}

// insert one row (object) or many (array). returns inserted rows.
async function insert(table, rows, { query, upsert } = {}) {
  const prefer = ['return=representation'];
  if (upsert) prefer.push('resolution=merge-duplicates');
  const res = await call('/rest/v1/' + table + qs(query), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: prefer.join(',') },
    body: JSON.stringify(rows),
  });
  if (!res.ok) await failFrom(res);
  return res.json();
}

async function update(table, query, patch) {
  const res = await call('/rest/v1/' + table + qs(query), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) await failFrom(res);
  return res.json();
}

async function remove(table, query) {
  const res = await call('/rest/v1/' + table + qs(query), {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) await failFrom(res);
  return res.json();
}

async function rpc(fn, args) {
  const res = await call('/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}),
  });
  if (!res.ok) await failFrom(res);
  return res.json();
}

// ----- Storage (private bucket) -----
const BUCKET = 'member-photos';
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

async function putObject(path, buffer, contentType) {
  const res = await call('/storage/v1/object/' + BUCKET + '/' + encPath(path), {
    method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'false' }, body: buffer,
  });
  if (!res.ok) await failFrom(res);
}

async function getObject(path) {
  const res = await call('/storage/v1/object/authenticated/' + BUCKET + '/' + encPath(path));
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) await failFrom(res);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteObject(path) {
  const res = await call('/storage/v1/object/' + BUCKET + '/' + encPath(path), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) await failFrom(res);
}

async function bucketExists() {
  const res = await call('/storage/v1/bucket/' + BUCKET);
  return res.ok;
}

module.exports = { DbError, select, insert, update, remove, rpc, putObject, getObject, deleteObject, bucketExists };
