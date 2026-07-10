import http from "node:http";
import { readFile } from "node:fs/promises";
import { FileKV } from "./file-kv.mjs";

const port = Number(process.env.PORT || 8787);
const kvFile = process.env.KV_FILE || "/opt/xcbot-data/kv.json";

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

const [worker, kv] = await Promise.all([
  loadWorker(),
  new FileKV(kvFile).init(),
]);

const env = {
  NAV_KV: kv,
  ADMIN_KEY: process.env.ADMIN_KEY || "",
};

const server = http.createServer(async (nodeRequest, nodeResponse) => {
  try {
    const host = nodeRequest.headers.host || `127.0.0.1:${port}`;
    const url = new URL(nodeRequest.url || "/", `http://${host}`);
    const method = nodeRequest.method || "GET";

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
