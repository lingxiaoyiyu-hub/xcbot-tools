const ALLOWED_ORIGIN = 'https://xcbot.cyou';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

async function getFeedbacks(env) {
  const raw = await env.NAV_KV.get('feedbacks');
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function getTutorials(env) {
  const raw = await env.NAV_KV.get('tutorials');
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeTutorial(item) {
  return {
    id: (item.id || String(Date.now())).toString(),
    title: (item.title || '').toString().trim(),
    summary: (item.summary || '').toString().trim(),
    content: (item.content || '').toString().trim(),
    links: Array.isArray(item.links) ? item.links.map(link => ({
      label: (link.label || '').toString().trim(),
      url: (link.url || '').toString().trim(),
    })).filter(link => link.label && link.url) : [],
    tags: Array.isArray(item.tags) ? item.tags.map(tag => tag.toString().trim()).filter(Boolean) : [],
    pinned: Boolean(item.pinned),
    date: (item.date || new Date().toISOString().split('T')[0]).toString().trim(),
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
          headers: { 'Cache-Control': 'public, max-age=30' },
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

    if (pathname === '/feedback' && request.method === 'POST') {
      try {
        const body = await request.json();
        const message = (body.message || '').toString().trim();
        if (!message) {
          return json({ error: '请填写反馈内容。' }, { status: 400 });
        }
        if (message.length > 1000) {
          return json({ error: '反馈内容过长，请控制在 1000 字以内。' }, { status: 400 });
        }

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rlKey = 'rl:feedback:' + ip;
        const rlRaw = await env.NAV_KV.get(rlKey);
        const count = rlRaw ? parseInt(rlRaw, 10) : 0;
        if (count >= 5) {
          return json({ error: '提交太频繁，请稍后再试。' }, { status: 429 });
        }
        await env.NAV_KV.put(rlKey, String(count + 1), { expirationTtl: 60 });

        const now = new Date();
        const entry = {
          id: String(now.getTime()),
          time: now.toISOString(),
          name: (body.name || '匿名').toString().trim().slice(0, 50) || '匿名',
          url: (body.url || '').toString().trim().slice(0, 500),
          message,
          read: false,
        };

        const list = await getFeedbacks(env);
        list.push(entry);
        await env.NAV_KV.put('feedbacks', JSON.stringify(list, null, 2));
        return json({ ok: true, id: entry.id }, { status: 201 });
      } catch (error) {
        return json({ error: 'Invalid request.' }, { status: 400 });
      }
    }

    if (pathname === '/feedback' && request.method === 'GET') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        return json(await getFeedbacks(env));
      } catch (error) {
        return json({ error: 'Failed to read feedback data.' }, { status: 500 });
      }
    }

    if (pathname === '/feedback' && request.method === 'PUT') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        const list = await request.json();
        if (!Array.isArray(list)) {
          return json({ error: 'Expected an array.' }, { status: 400 });
        }
        await env.NAV_KV.put('feedbacks', JSON.stringify(list, null, 2));
        return json({ ok: true, count: list.length });
      } catch (error) {
        return json({ error: 'Invalid feedback data.' }, { status: 400 });
      }
    }

    if (pathname === '/tutorials' && request.method === 'GET') {
      try {
        const list = await getTutorials(env);
        return json(list, {
          headers: { 'Cache-Control': 'public, max-age=30' },
        });
      } catch (error) {
        return json({ error: 'Failed to read tutorials.' }, { status: 500 });
      }
    }

    if (pathname === '/tutorials' && request.method === 'PUT') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        const list = await request.json();
        if (!Array.isArray(list)) {
          return json({ error: 'Expected an array.' }, { status: 400 });
        }
        const tutorials = list.map(normalizeTutorial).filter(item => item.title && item.content);
        await env.NAV_KV.put('tutorials', JSON.stringify(tutorials, null, 2));
        return json({ ok: true, count: tutorials.length });
      } catch (error) {
        return json({ error: 'Invalid tutorials data.' }, { status: 400 });
      }
    }

    if (pathname === '/tutorials' && request.method === 'POST') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        const item = normalizeTutorial(await request.json());
        if (!item.title || !item.content) {
          return json({ error: 'Title and content are required.' }, { status: 400 });
        }
        const list = await getTutorials(env);
        const index = list.findIndex(t => t.id === item.id);
        if (index >= 0) list[index] = item;
        else list.push(item);
        await env.NAV_KV.put('tutorials', JSON.stringify(list, null, 2));
        return json({ ok: true, id: item.id, count: list.length });
      } catch (error) {
        return json({ error: 'Invalid tutorial data.' }, { status: 400 });
      }
    }

    return json({ error: 'Not found.' }, { status: 404 });
  },
};
