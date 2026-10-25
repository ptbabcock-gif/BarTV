// A tiny in-memory stand-in for the parts of Supabase the app uses (auth signup/refresh,
// PostgREST select/upsert/patch, the two RPCs and photo uploads). Used by the unit tests as a
// fetch implementation and by the browser smoke test via request interception.
import { randomUUID } from 'node:crypto';

export function createFakeSupabase({ base = 'https://fake.supabase.co' } = {}) {
  const db = { groups: [], members: [], venues: [], tastings: [], venue_photos: [] };
  const users = new Map(); // access token -> user id
  const refreshTokens = new Map();
  let clock = Date.parse('2026-10-25T00:00:00Z');
  const now = () => new Date((clock += 1000)).toISOString();
  const log = [];

  function session(userId) {
    const access = 'acc-' + randomUUID();
    const refresh = 'ref-' + randomUUID();
    users.set(access, userId);
    refreshTokens.set(refresh, userId);
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'bearer', user: { id: userId } };
  }
  function userOf(headers) {
    const auth = headers.get ? headers.get('authorization') : headers.authorization || headers.Authorization;
    const token = String(auth || '').replace(/^Bearer /, '');
    return users.get(token) || null;
  }
  function isMember(g, u) { return db.members.some((m) => m.group_id === g && m.user_id === u); }
  function parseQuery(qs) {
    const out = {};
    for (const [k, v] of new URLSearchParams(qs)) out[k] = v;
    return out;
  }
  function filterRows(rows, q, uid) {
    let r = rows;
    for (const [k, v] of Object.entries(q)) {
      if (['select', 'order', 'on_conflict'].includes(k)) continue;
      const m = v.match(/^(eq|gte|gt)\.(.*)$/);
      if (!m) continue;
      const [, op, val] = m;
      r = r.filter((row) => (op === 'eq' ? String(row[k]) === val : op === 'gte' ? row[k] >= val : row[k] > val));
    }
    return r.filter((row) => !('group_id' in row) || isMember(row.group_id, uid));
  }

  async function handle(method, url, headers, bodyText) {
    const u = new URL(url);
    const path = u.pathname;
    const body = bodyText && headers.get('content-type')?.includes('json') ? JSON.parse(bodyText) : bodyText;
    log.push({ method, path });
    const json = (status, data) => ({ status, body: JSON.stringify(data), contentType: 'application/json' });

    if (path === '/auth/v1/signup' && method === 'POST') return json(200, session('user-' + randomUUID()));
    if (path === '/auth/v1/token' && method === 'POST') {
      const uid = refreshTokens.get(body.refresh_token);
      return uid ? json(200, session(uid)) : json(400, { message: 'bad refresh token' });
    }
    const uid = userOf(headers);
    if (!uid) return json(401, { message: 'no session' });

    if (path === '/rest/v1/rpc/create_group') {
      const g = { id: randomUUID(), name: body.p_name.trim(), join_code: Math.random().toString(36).slice(2, 8).toUpperCase(), created_by: uid, created_at: now() };
      db.groups.push(g);
      db.members.push({ group_id: g.id, user_id: uid, display_name: body.p_display_name.trim(), joined_at: now() });
      return json(200, g);
    }
    if (path === '/rest/v1/rpc/join_group') {
      const g = db.groups.find((x) => x.join_code === body.p_code.trim().toUpperCase());
      if (!g) return json(400, { message: 'no group with that code' });
      const m = db.members.find((x) => x.group_id === g.id && x.user_id === uid);
      if (m) m.display_name = body.p_display_name.trim(); else db.members.push({ group_id: g.id, user_id: uid, display_name: body.p_display_name.trim(), joined_at: now() });
      return json(200, g);
    }
    const t = path.match(/^\/rest\/v1\/(venues|tastings|venue_photos|members)$/);
    if (t) {
      const table = t[1];
      const q = parseQuery(u.search);
      if (method === 'GET') return json(200, filterRows(db[table], q, uid));
      if (method === 'POST') {
        for (const row of Array.isArray(body) ? body : [body]) {
          if (!isMember(row.group_id, uid)) return json(403, { message: 'row-level security' });
          if (table === 'tastings' && row.user_id !== uid) return json(403, { message: 'row-level security: user_id' });
          if (table === 'venues' && row.created_by !== uid && !db.venues.some((v) => v.id === row.id)) return json(403, { message: 'row-level security: created_by' });
          const i = db[table].findIndex((x) => x.id === row.id);
          const merged = { ...(i >= 0 ? db[table][i] : { created_at: now() }), ...row, updated_at: now() };
          if (i >= 0) db[table][i] = merged; else db[table].push(merged);
        }
        return { status: 201, body: '', contentType: 'text/plain' };
      }
      if (method === 'PATCH') {
        const rows = filterRows(db[table], q, uid);
        for (const row of rows) {
          if (table === 'tastings' && row.user_id !== uid) continue;
          Object.assign(row, body, { updated_at: now() });
        }
        return { status: 204, body: '', contentType: 'text/plain' };
      }
    }
    const s = path.match(/^\/storage\/v1\/object\/photos\/(.+)$/);
    if (s && method === 'POST') return json(200, { Key: 'photos/' + s[1] });
    return json(404, { message: `fake: no route for ${method} ${path}` });
  }

  /** fetch-compatible function for Node tests. */
  const fetchImpl = async (url, init = {}) => {
    const headers = new Map(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const bodyText = init.body instanceof Blob ? await init.body.text() : init.body;
    const r = await handle(init.method || 'GET', url, headers, bodyText);
    return { ok: r.status < 400, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
  };

  /** Playwright route handler. */
  const route = async (r) => {
    const req = r.request();
    const headers = new Map(Object.entries(await req.allHeaders()).map(([k, v]) => [k.toLowerCase(), v]));
    const res = await handle(req.method(), req.url(), headers, req.postData());
    await r.fulfill({ status: res.status, contentType: res.contentType, body: res.body, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  };

  return { base, db, log, fetchImpl, route, handle };
}
