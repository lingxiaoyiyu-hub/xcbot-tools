const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_KEY;
  const actual = request.headers.get('X-Admin-Key') || '';
  return Boolean(expected && actual && actual === expected);
}

async function getSites(env) {
  const raw = await env.NAV_KV.get('sites');
  if (!raw) {
    return { announcement: { enabled: false, text: '' }, sites: [] };
  }
  return JSON.parse(raw);
}

function normalizePayload(payload) {
  if (Array.isArray(payload)) {
    return { announcement: { enabled: false, text: '' }, sites: payload };
  }
  return {
    announcement: payload.announcement || { enabled: false, text: '' },
    sites: Array.isArray(payload.sites) ? payload.sites : [],
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'xcbot-nav-api' });
    }

    if (pathname === '/sites' && request.method === 'GET') {
      try {
        const data = await getSites(env);
        return json(data, {
          headers: {
            'Cache-Control': 'public, max-age=30',
          },
        });
      } catch (error) {
        return json({ error: 'Failed to read navigation data.' }, { status: 500 });
      }
    }

    if (pathname === '/sites' && request.method === 'PUT') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }

      try {
        const payload = normalizePayload(await request.json());
        await env.NAV_KV.put('sites', JSON.stringify(payload, null, 2));
        return json({ ok: true, updatedAt: new Date().toISOString(), count: payload.sites.length });
      } catch (error) {
        return json({ error: 'Invalid navigation data.' }, { status: 400 });
      }
    }

    return json({ error: 'Not found.' }, { status: 404 });
  },
};
