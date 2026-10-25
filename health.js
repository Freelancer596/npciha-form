'use strict';
const sb = require('../lib/sb');
const { secHeaders, send } = require('../lib/http');
const { rateLimit } = require('../lib/auth');

// Reports whether configuration, database tables/functions and the private bucket are reachable.
// Returns only yes/no style status. No keys, URLs or data are included.
module.exports = async (req, res) => {
  secHeaders(res);
  const out = {
    ok: false,
    config: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      APP_SECRET: (process.env.APP_SECRET || '').length >= 24,
    },
    database: 'unchecked', rate_limit_function: 'unchecked', storage_bucket: 'unchecked', districts_loaded: null,
  };
  if (!out.config.SUPABASE_URL || !out.config.SUPABASE_SERVICE_ROLE_KEY) return send(res, 503, out);
  try {
    if (out.config.APP_SECRET) { await rateLimit(req, 'health', 60, 30); out.rate_limit_function = 'ok'; } else out.rate_limit_function = 'skipped (APP_SECRET missing)';
  } catch (e) { out.rate_limit_function = 'error (did you run sql/001_schema.sql?)'; }
  try {
    const d = await sb.select('districts', [['select', 'id'], ['limit', '1']], { count: true });
    out.database = 'ok'; out.districts_loaded = (d.count || 0) > 0;
  } catch (e) { out.database = 'error (check SUPABASE_URL / service key and that sql/001_schema.sql was run)'; }
  try { out.storage_bucket = (await sb.bucketExists()) ? 'ok' : 'missing (run sql/001_schema.sql)'; } catch (e) { out.storage_bucket = 'error'; }
  out.ok = out.config.APP_SECRET && out.database === 'ok' && out.rate_limit_function === 'ok' && out.storage_bucket === 'ok';
  return send(res, out.ok ? 200 : 503, out);
};
