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

async function getCommonSites(env) {
  const raw = await env.NAV_KV.get('commonSites');
  if (!raw) {
    return { announcement: { enabled: false, text: '' }, sites: [] };
  }
  return JSON.parse(raw);
}

function emptyCommonStats() {
  return {
    views: { total: 0, byDay: {} },
    opens: { total: 0, byDay: {}, bySite: {} },
    updatedAt: null,
  };
}

function normalizeCommonStats(value) {
  const base = emptyCommonStats();
  if (!value || typeof value !== 'object') return base;
  const views = value.views || {};
  const opens = value.opens || {};
  return {
    views: {
      total: Number(views.total || 0),
      byDay: views.byDay && typeof views.byDay === 'object' ? views.byDay : {},
    },
    opens: {
      total: Number(opens.total || 0),
      byDay: opens.byDay && typeof opens.byDay === 'object' ? opens.byDay : {},
      bySite: opens.bySite && typeof opens.bySite === 'object' ? opens.bySite : {},
    },
    updatedAt: value.updatedAt || null,
  };
}

async function getCommonStats(env) {
  const raw = await env.NAV_KV.get('commonStats');
  if (!raw) return emptyCommonStats();
  return normalizeCommonStats(JSON.parse(raw));
}

function emptySiteStats() {
  return {
    pageViews: { total: 0, byDay: {}, byPage: {} },
    linkClicks: { total: 0, byDay: {}, byTarget: {} },
    updatedAt: null,
  };
}

function normalizeSiteStats(value) {
  if (!value || typeof value !== 'object') return emptySiteStats();
  const pageViews = value.pageViews || {};
  const linkClicks = value.linkClicks || {};
  return {
    pageViews: {
      total: Number(pageViews.total || 0),
      byDay: pageViews.byDay && typeof pageViews.byDay === 'object' ? pageViews.byDay : {},
      byPage: pageViews.byPage && typeof pageViews.byPage === 'object' ? pageViews.byPage : {},
    },
    linkClicks: {
      total: Number(linkClicks.total || 0),
      byDay: linkClicks.byDay && typeof linkClicks.byDay === 'object' ? linkClicks.byDay : {},
      byTarget: linkClicks.byTarget && typeof linkClicks.byTarget === 'object' ? linkClicks.byTarget : {},
    },
    updatedAt: value.updatedAt || null,
  };
}

async function getSiteStats(env) {
  const raw = await env.NAV_KV.get('siteStats');
  if (!raw) return emptySiteStats();
  return normalizeSiteStats(JSON.parse(raw));
}

function todayKey() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function bumpDay(bucket, day) {
  bucket.byDay = bucket.byDay && typeof bucket.byDay === 'object' ? bucket.byDay : {};
  bucket.byDay[day] = Number(bucket.byDay[day] || 0) + 1;
}

function trimDailyMap(map, keepDays = 90) {
  const keys = Object.keys(map || {}).sort().slice(-keepDays);
  return keys.reduce((out, key) => {
    out[key] = Number(map[key] || 0);
    return out;
  }, {});
}

async function saveCommonStats(env, stats) {
  stats.views.byDay = trimDailyMap(stats.views.byDay);
  stats.opens.byDay = trimDailyMap(stats.opens.byDay);
  Object.keys(stats.opens.bySite || {}).forEach(id => {
    const site = stats.opens.bySite[id];
    site.byDay = trimDailyMap(site.byDay || {});
  });
  stats.updatedAt = new Date().toISOString();
  await env.NAV_KV.put('commonStats', JSON.stringify(stats, null, 2));
}

function trimNestedDailyStats(stats) {
  stats.pageViews.byDay = trimDailyMap(stats.pageViews.byDay);
  stats.linkClicks.byDay = trimDailyMap(stats.linkClicks.byDay);
  Object.keys(stats.pageViews.byPage || {}).forEach(key => {
    stats.pageViews.byPage[key].byDay = trimDailyMap(stats.pageViews.byPage[key].byDay || {});
  });
  Object.keys(stats.linkClicks.byTarget || {}).forEach(key => {
    stats.linkClicks.byTarget[key].byDay = trimDailyMap(stats.linkClicks.byTarget[key].byDay || {});
  });
}

async function saveSiteStats(env, stats) {
  trimNestedDailyStats(stats);
  stats.updatedAt = new Date().toISOString();
  await env.NAV_KV.put('siteStats', JSON.stringify(stats, null, 2));
}

function cleanPath(path) {
  const value = (path || '/').toString().trim();
  if (!value || value[0] !== '/') return '/';
  return value.split('#')[0].split('?')[0].slice(0, 160) || '/';
}

function cleanLabel(value, fallback = '') {
  return (value || fallback || '').toString().trim().slice(0, 120);
}

async function recordSitePageView(env, payload = {}) {
  const stats = await getSiteStats(env);
  const day = todayKey();
  const path = cleanPath(payload.path);
  stats.pageViews.total += 1;
  bumpDay(stats.pageViews, day);
  stats.pageViews.byPage[path] = stats.pageViews.byPage[path] || { count: 0, byDay: {}, lastAt: null, title: '' };
  stats.pageViews.byPage[path].count = Number(stats.pageViews.byPage[path].count || 0) + 1;
  bumpDay(stats.pageViews.byPage[path], day);
  stats.pageViews.byPage[path].lastAt = new Date().toISOString();
  stats.pageViews.byPage[path].title = cleanLabel(payload.title, stats.pageViews.byPage[path].title || path);
  await saveSiteStats(env, stats);
}

async function recordSiteLinkClick(env, payload = {}) {
  const stats = await getSiteStats(env);
  const day = todayKey();
  const id = cleanLabel(payload.id || payload.targetId || payload.path || 'unknown', 'unknown');
  stats.linkClicks.total += 1;
  bumpDay(stats.linkClicks, day);
  stats.linkClicks.byTarget[id] = stats.linkClicks.byTarget[id] || { count: 0, byDay: {}, lastAt: null, label: '', type: '', category: '', path: '' };
  stats.linkClicks.byTarget[id].count = Number(stats.linkClicks.byTarget[id].count || 0) + 1;
  bumpDay(stats.linkClicks.byTarget[id], day);
  stats.linkClicks.byTarget[id].lastAt = new Date().toISOString();
  stats.linkClicks.byTarget[id].label = cleanLabel(payload.label, stats.linkClicks.byTarget[id].label || id);
  stats.linkClicks.byTarget[id].type = cleanLabel(payload.type, stats.linkClicks.byTarget[id].type || 'link');
  stats.linkClicks.byTarget[id].category = cleanLabel(payload.category, stats.linkClicks.byTarget[id].category || '');
  stats.linkClicks.byTarget[id].path = cleanPath(payload.path || stats.linkClicks.byTarget[id].path || '/');
  await saveSiteStats(env, stats);
}

function mergeDailyMap(target, source) {
  Object.keys(source || {}).forEach(day => {
    target[day] = Number(target[day] || 0) + Number(source[day] || 0);
  });
}

async function getCombinedSiteStats(env) {
  const stats = normalizeSiteStats(await getSiteStats(env));
  const commonStats = normalizeCommonStats(await getCommonStats(env));
  const commonSites = normalizePayload(await getCommonSites(env)).sites;

  if (commonStats.views.total) {
    stats.pageViews.total += Number(commonStats.views.total || 0);
    mergeDailyMap(stats.pageViews.byDay, commonStats.views.byDay);
    const page = stats.pageViews.byPage['/common-nav/'] || { count: 0, byDay: {}, lastAt: null, title: '常用网站导航' };
    page.count += Number(commonStats.views.total || 0);
    mergeDailyMap(page.byDay, commonStats.views.byDay);
    page.title = page.title || '常用网站导航';
    stats.pageViews.byPage['/common-nav/'] = page;
  }

  if (commonStats.opens.total) {
    stats.linkClicks.total += Number(commonStats.opens.total || 0);
    mergeDailyMap(stats.linkClicks.byDay, commonStats.opens.byDay);
    Object.keys(commonStats.opens.bySite || {}).forEach(id => {
      const legacy = commonStats.opens.bySite[id] || {};
      const site = commonSites.find(item => (item.id || '').toString() === id) || {};
      const targetId = 'common-site:' + id;
      const target = stats.linkClicks.byTarget[targetId] || { count: 0, byDay: {}, lastAt: null, label: '', type: 'common-site', category: '', path: '/common-nav/' };
      target.count += Number(legacy.count || 0);
      mergeDailyMap(target.byDay, legacy.byDay);
      target.lastAt = target.lastAt || legacy.lastAt || null;
      target.label = target.label || site.name || id;
      target.type = 'common-site';
      target.category = target.category || site.category || '';
      target.path = '/common-nav/';
      stats.linkClicks.byTarget[targetId] = target;
    });
  }

  return stats;
}

async function recordCommonStat(env, type, siteId = '') {
  const stats = await getCommonStats(env);
  const day = todayKey();
  if (type === 'view') {
    stats.views.total += 1;
    bumpDay(stats.views, day);
  }
  if (type === 'open') {
    const id = siteId.toString();
    stats.opens.total += 1;
    bumpDay(stats.opens, day);
    stats.opens.bySite[id] = stats.opens.bySite[id] || { count: 0, byDay: {}, lastAt: null };
    stats.opens.bySite[id].count = Number(stats.opens.bySite[id].count || 0) + 1;
    bumpDay(stats.opens.bySite[id], day);
    stats.opens.bySite[id].lastAt = new Date().toISOString();
  }
  await saveCommonStats(env, stats);
}

function publicCommonPayload(data) {
  const payload = normalizePayload(data);
  return {
    announcement: payload.announcement,
    sites: payload.sites.map(site => ({
      id: (site.id || '').toString(),
      name: (site.name || '').toString(),
      category: (site.category || '').toString(),
      description: (site.description || '').toString(),
      tags: Array.isArray(site.tags) ? site.tags.map(tag => tag.toString()) : [],
      pinned: Boolean(site.pinned),
      date: (site.date || '').toString(),
    })).filter(site => site.id && site.name),
  };
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

    if (pathname === '/stats/track' && request.method === 'POST') {
      try {
        const origin = request.headers.get('Origin') || '';
        if (origin && origin !== ALLOWED_ORIGIN) {
          return json({ error: 'Origin not allowed.' }, { status: 403 });
        }
        const raw = await request.text();
        const body = raw ? JSON.parse(raw) : {};
        if ((body.type || body.event) !== 'page_view') {
          return json({ error: 'Unsupported stats event.' }, { status: 400 });
        }
        await recordSitePageView(env, body);
        return json({ ok: true });
      } catch (error) {
        return json({ error: 'Invalid stats event.' }, { status: 400 });
      }
    }

    if (pathname === '/stats' && request.method === 'GET') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        return json(await getCombinedSiteStats(env), {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return json({ error: 'Failed to read stats.' }, { status: 500 });
      }
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

    if (pathname === '/common-sites/open' && request.method === 'GET') {
      try {
        const id = (url.searchParams.get('id') || '').toString();
        const data = normalizePayload(await getCommonSites(env));
        const site = data.sites.find(item => (item.id || '').toString() === id);
        if (!site || !site.url) {
          return json({ error: 'Link not found.' }, { status: 404 });
        }
        const target = new URL(site.url);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return json({ error: 'Invalid link.' }, { status: 400 });
        }
        try {
          await recordSiteLinkClick(env, {
            id: 'common-site:' + id,
            label: site.name || id,
            type: 'common-site',
            category: site.category || '',
            path: '/common-nav/',
          });
        } catch (error) {
          // Statistics should never block a valid redirect.
        }
        return Response.redirect(target.toString(), 302);
      } catch (error) {
        return json({ error: 'Invalid link.' }, { status: 400 });
      }
    }

    if (pathname === '/common-sites/track' && request.method === 'POST') {
      try {
        const origin = request.headers.get('Origin') || '';
        if (origin && origin !== ALLOWED_ORIGIN) {
          return json({ error: 'Origin not allowed.' }, { status: 403 });
        }
        const raw = await request.text();
        const body = raw ? JSON.parse(raw) : {};
        if ((body.type || body.event) !== 'view') {
          return json({ error: 'Unsupported stats event.' }, { status: 400 });
        }
        await recordSitePageView(env, { path: '/common-nav/', title: '常用网站导航' });
        return json({ ok: true });
      } catch (error) {
        return json({ error: 'Invalid stats event.' }, { status: 400 });
      }
    }

    if (pathname === '/common-sites/stats' && request.method === 'GET') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        return json(await getCombinedSiteStats(env), {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return json({ error: 'Failed to read stats.' }, { status: 500 });
      }
    }

    if (pathname === '/common-sites' && request.method === 'GET') {
      try {
        const data = normalizePayload(await getCommonSites(env));
        const isAdmin = requireAdmin(request, env);
        return json(isAdmin ? data : publicCommonPayload(data), {
          headers: { 'Cache-Control': isAdmin ? 'no-store' : 'public, max-age=30' },
        });
      } catch (error) {
        return json({ error: 'Failed to read common navigation data.' }, { status: 500 });
      }
    }

    if (pathname === '/common-sites' && request.method === 'PUT') {
      if (!requireAdmin(request, env)) {
        return json({ error: 'Unauthorized.' }, { status: 401 });
      }
      try {
        const payload = normalizePayload(await request.json());
        await env.NAV_KV.put('commonSites', JSON.stringify(payload, null, 2));
        return json({ ok: true, updatedAt: new Date().toISOString(), count: payload.sites.length });
      } catch (error) {
        return json({ error: 'Invalid common navigation data.' }, { status: 400 });
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
