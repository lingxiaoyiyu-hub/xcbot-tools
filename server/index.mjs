import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FileKV } from "./file-kv.mjs";

const port = Number(process.env.PORT || 8787);
const kvFile = process.env.KV_FILE || "/opt/xcbot-data/kv.json";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "a0d848a9b27fd6ff66e2a91a5ccbec2a3e25512c7ada69eceb52ce8b756ab59d";
const adminSessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000;

async function loadWorker() {
  const workerPath = new URL("../cloudflare/xcbot-nav-api.js", import.meta.url);
  const source = await readFile(workerPath, "utf8");
  const moduleUrl = `data:text/javascript,${encodeURIComponent(source)}`;
  const module = await import(moduleUrl);
  return module.default;
}

function headersFromNode(headers) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) result.set(name, value.join(", "));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function writeResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) nodeResponse.setHeader(name, value);
  return response.arrayBuffer().then((body) => nodeResponse.end(Buffer.from(body)));
}

function nodeJson(nodeResponse, status, data, headers = {}) {
  nodeResponse.statusCode = status;
  nodeResponse.setHeader("Content-Type", "application/json; charset=utf-8");
  Object.entries(headers).forEach(([name, value]) => nodeResponse.setHeader(name, value));
  nodeResponse.end(JSON.stringify(data));
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || "";
  const match = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function isAdminSession(request) {
  const token = cookieValue(request, "xcbot_admin");
  const session = token && adminSessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function safePasswordMatch(actual) {
  if (!adminPassword) {
    const digest = createHash("sha256").update(actual || "").digest("hex");
    return digest === adminPasswordHash;
  }
  const expected = Buffer.from(adminPassword);
  const candidate = Buffer.from(actual || "");
  return expected.length > 0 && expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSeoContent(value) {
  return escapeHtml(value)
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`)
    .join("\n");
}

function seoLayout({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | XCbot 工具箱</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="stylesheet" href="/shared-white.css">
<style>
:root{--bg:#f7f8fa;--card:#fff;--border:#e5e7eb;--text:#111827;--muted:#6b7280;--blue:#2563eb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.85}
header{background:var(--card);border-bottom:1px solid var(--border)}.header-inner{max-width:960px;margin:auto;padding:14px 20px;display:flex;justify-content:space-between;gap:16px;align-items:center}.logo{font-weight:800;color:var(--text);text-decoration:none}.nav{color:var(--blue);text-decoration:none;font-size:.88rem;font-weight:700}
main{max-width:960px;margin:auto;padding:30px 20px 56px}.article{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:32px}.crumb{font-size:.82rem;color:var(--muted);margin-bottom:18px}.crumb a{color:var(--blue);text-decoration:none}h1{font-size:2rem;line-height:1.3;margin:0 0 8px}.meta{font-size:.82rem;color:var(--muted)}.summary{margin:20px 0;padding:14px 16px;background:#f3f4f6;border:1px solid var(--border);border-radius:10px;color:#374151}.content{font-size:1rem}.content p{margin:14px 0}.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}.tag{font-size:.76rem;color:var(--blue);background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:2px 8px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{display:block;color:var(--text);text-decoration:none;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}.card:hover{border-color:#93c5fd}.card h2{font-size:1.05rem;margin:0 0 8px}.card p{font-size:.88rem;color:var(--muted);margin:0}.empty{color:var(--muted)}@media(max-width:700px){main{padding:18px 14px 40px}.article{padding:22px 18px}h1{font-size:1.5rem}.grid{grid-template-columns:1fr}}
</style></head><body><header><div class="header-inner"><a class="logo" href="/">XCbot 工具箱</a><a class="nav" href="/seo/">SEO 文章</a></div></header><main>${body}</main><script src="/stats.js" defer></script></body></html>`;
}

function renderSeoIndex(articles) {
  const cards = articles.map((article) => `<a class="card" href="/seo/${encodeURIComponent(article.slug)}"><h2>${escapeHtml(article.title)}</h2><p>${escapeHtml(article.description)}</p></a>`).join("\n");
  return seoLayout({
    title: "SEO 文章",
    description: "XCbot 工具箱整理的 AI、API 和实用工具相关文章。",
    canonical: "https://xcbot.cyou/seo/",
    body: `<div class="crumb"><a href="/">首页</a> / SEO 文章</div><section class="article"><h1>SEO 文章</h1><p class="summary">AI 工具、API 资源和实用技巧文章。</p><div class="grid">${cards || '<p class="empty">暂无文章</p>'}</div></section>`,
  });
}

function renderSeoArticle(article) {
  const tags = (article.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const canonical = `https://xcbot.cyou/seo/${encodeURIComponent(article.slug)}`;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.date,
    dateModified: article.updatedAt || article.date,
    mainEntityOfPage: canonical,
  }).replaceAll("<", "\\u003c");
  return seoLayout({
    title: article.title,
    description: article.description,
    canonical,
    body: `<article class="article"><div class="crumb"><a href="/">首页</a> / <a href="/seo/">SEO 文章</a> / ${escapeHtml(article.title)}</div><h1>${escapeHtml(article.title)}</h1><div class="meta">${escapeHtml(article.date)}</div><div class="summary">${escapeHtml(article.description)}</div><div class="content">${renderSeoContent(article.content)}</div><div class="tags">${tags}</div></article><script type="application/ld+json">${jsonLd}</script>`,
  });
}

function renderSitemap(articles, textFormat = false) {
  const basePaths = ["/", "/api-nav/", "/common-nav/", "/games/", "/prompts/", "/tutorials/", "/seo/", "/watermark/", "/compressor/", "/qrcode/", "/temp-mail/", "/typesetter/", "/shift-helper/", "/system-repair/"];
  const paths = basePaths.concat(articles.map((article) => `/seo/${encodeURIComponent(article.slug)}`));
  if (textFormat) return paths.map((path) => `https://xcbot.cyou${path}`).join("\n") + "\n";
  const urls = paths.map((path) => `<url><loc>https://xcbot.cyou${escapeHtml(path)}</loc><changefreq>weekly</changefreq><priority>${path === "/" ? "1.0" : "0.7"}</priority></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

const [worker, kv] = await Promise.all([
  loadWorker(),
  new FileKV(kvFile).init(),
]);

const env = {
  NAV_KV: kv,
  ADMIN_KEY: process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || "",
};

const server = http.createServer(async (nodeRequest, nodeResponse) => {
  try {
    const host = nodeRequest.headers.host || `127.0.0.1:${port}`;
    const url = new URL(nodeRequest.url || "/", `http://${host}`);
    const method = nodeRequest.method || "GET";

    if (url.pathname === "/admin/session" && method === "GET") {
      nodeJson(nodeResponse, 200, { authenticated: isAdminSession(nodeRequest) });
      return;
    }

    if (url.pathname === "/admin/login" && method === "POST") {
      const body = JSON.parse((await readBody(nodeRequest)).toString("utf8") || "{}");
      if (!safePasswordMatch(body.password)) {
        nodeJson(nodeResponse, 401, { error: "Invalid password." });
        return;
      }
      const token = randomBytes(32).toString("hex");
      adminSessions.set(token, { expiresAt: Date.now() + SESSION_TTL });
      nodeJson(nodeResponse, 200, { ok: true }, {
        "Set-Cookie": `xcbot_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
      });
      return;
    }

    if (url.pathname === "/admin/logout" && method === "POST") {
      const token = cookieValue(nodeRequest, "xcbot_admin");
      if (token) adminSessions.delete(token);
      nodeJson(nodeResponse, 200, { ok: true }, { "Set-Cookie": "xcbot_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
      return;
    }

    if (method === "GET" && (url.pathname === "/sitemap.xml" || url.pathname === "/sitemap.txt")) {
      const articles = (await kv.get("seoArticles", "json")) || [];
      const textFormat = url.pathname.endsWith(".txt");
      nodeResponse.statusCode = 200;
      nodeResponse.setHeader("Content-Type", textFormat ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8");
      nodeResponse.setHeader("Cache-Control", "public, max-age=300");
      nodeResponse.end(renderSitemap(articles, textFormat));
      return;
    }

    if (method === "GET" && (url.pathname === "/seo" || url.pathname === "/seo/" || url.pathname.startsWith("/seo/"))) {
      const articles = (await kv.get("seoArticles", "json")) || [];
      const slug = url.pathname.slice("/seo/".length).replace(/\/$/, "");
      const article = slug ? articles.find((item) => item.slug === decodeURIComponent(slug)) : null;
      if (slug && !article) {
        nodeResponse.statusCode = 404;
        nodeResponse.setHeader("Content-Type", "text/html; charset=utf-8");
        nodeResponse.end("<!doctype html><title>Not found</title><h1>404</h1>");
        return;
      }
      nodeResponse.statusCode = 200;
      nodeResponse.setHeader("Content-Type", "text/html; charset=utf-8");
      nodeResponse.setHeader("Cache-Control", "public, max-age=60");
      nodeResponse.end(article ? renderSeoArticle(article) : renderSeoIndex(articles));
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      nodeResponse.statusCode = 200;
      nodeResponse.setHeader("Content-Type", "application/json; charset=utf-8");
      nodeResponse.end(JSON.stringify({ ok: true, service: "xcbot-nav-api" }));
      return;
    }

    const init = {
      method,
      headers: headersFromNode(nodeRequest.headers),
    };

    if (isAdminSession(nodeRequest)) init.headers.set("X-Admin-Key", env.ADMIN_KEY);

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      init.body = await readBody(nodeRequest);
    }

    const request = new Request(url, init);
    const response = await worker.fetch(request, env);
    await writeResponse(response, nodeResponse);
  } catch (error) {
    console.error("[xcbot-api] request failed", error);
    if (!nodeResponse.headersSent) {
      nodeResponse.statusCode = 500;
      nodeResponse.setHeader("Content-Type", "application/json; charset=utf-8");
      nodeResponse.end(JSON.stringify({ error: "Internal server error." }));
    } else {
      nodeResponse.destroy(error);
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[xcbot-api] listening on 127.0.0.1:${port}`);
  console.log(`[xcbot-api] KV file: ${kvFile}`);
});

function shutdown(signal) {
  console.log(`[xcbot-api] ${signal}; stopping`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
