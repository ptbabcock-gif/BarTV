// Minimal Supabase client over fetch: anonymous auth, PostgREST tables, RPC and photo storage.
// No SDK, so the app stays dependency-free. `fetchImpl` is injectable for tests.

export class CloudError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const type = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function createCloud({ url, anonKey, fetchImpl, getSession, setSession, now = () => Date.now() }) {
  const base = String(url || '').replace(/\/+$/, '');
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const configured = Boolean(base && anonKey);
  let refreshing = null;

  async function parse(res) {
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = (body && (body.message || body.msg || body.error_description || body.error || body.hint)) || `Request failed (${res.status})`;
      throw new CloudError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status, body?.code);
    }
    return body;
  }

  async function authFetch(path, { method = 'POST', body, headers = {}, token } = {}) {
    const res = await doFetch(base + path, {
      method,
      headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body)),
    });
    return parse(res);
  }

  function sessionFromAuth(j) {
    return { access: j.access_token, refresh: j.refresh_token, expiresAt: now() + (Number(j.expires_in) || 3600) * 1000, userId: j.user?.id };
  }

  async function signInAnonymously() {
    const j = await authFetch('/auth/v1/signup', { body: { data: {}, gotrue_meta_security: {} } });
    if (!j?.access_token) throw new CloudError('Anonymous sign-in is not enabled for this project', 400);
    const s = sessionFromAuth(j);
    setSession(s);
    return s;
  }

  async function refresh(session) {
    const j = await authFetch('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh } });
    const s = sessionFromAuth(j);
    if (!s.userId) s.userId = session.userId;
    setSession(s);
    return s;
  }

  /** A valid access token, signing in or refreshing as needed. */
  async function token() {
    let s = getSession();
    if (!s?.access) s = await signInAnonymously();
    else if (s.expiresAt - now() < 60_000) {
      refreshing = refreshing || refresh(s).finally(() => { refreshing = null; });
      s = await refreshing;
    }
    return s.access;
  }

  async function request(path, opts = {}) {
    const t = await token();
    try {
      return await authFetch(path, { ...opts, token: t });
    } catch (e) {
      if (e.status === 401 && getSession()?.refresh) { // token rejected: refresh once and retry
        const s = await refresh(getSession());
        return authFetch(path, { ...opts, token: s.access });
      }
      throw e;
    }
  }

  return {
    configured,
    userId: () => getSession()?.userId || null,
    signInAnonymously,
    token,
    rpc: (name, args = {}) => request(`/rest/v1/rpc/${name}`, { body: args }),
    select: (table, query) => request(`/rest/v1/${table}?${query}`, { method: 'GET' }),
    upsert: (table, rows) => request(`/rest/v1/${table}`, { body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }),
    update: (table, query, patch) => request(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } }),
    remove: (table, query) => request(`/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    /** Upload an image (data URL or Blob) to the public photos bucket; returns its public URL. */
    async uploadPhoto(path, image) {
      const blob = typeof image === 'string' ? dataUrlToBlob(image) : image;
      await request(`/storage/v1/object/photos/${path}`, { body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' } });
      return `${base}/storage/v1/object/public/photos/${path}`;
    },
  };
}
