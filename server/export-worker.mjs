import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFile } from "node:fs/promises";

const workerUrl = (process.env.WORKER_URL || "https://xcbot-nav-api.lingxiaoyiyu.workers.dev").replace(/\/$/, "");
const outputPath = process.env.OUTPUT || "./kv-export.json";

async function readAdminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  const rl = createInterface({ input, output });
  const key = await rl.question("Cloudflare Worker admin key: ", { hideEchoBack: true });
  rl.close();
  return key.trim();
}

async function get(path, adminKey) {
  const response = await fetch(workerUrl + path, {
    headers: { "X-Admin-Key": adminKey },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const adminKey = await readAdminKey();
if (!adminKey) throw new Error("An admin key is required.");

const [sites, commonSites, tutorials, feedbacks, combinedStats] = await Promise.all([
  get("/sites", adminKey),
  get("/common-sites", adminKey),
  get("/tutorials", adminKey),
  get("/feedback", adminKey),
  get("/stats", adminKey),
]);

const values = {
  sites: JSON.stringify(sites, null, 2),
  commonSites: JSON.stringify(commonSites, null, 2),
  tutorials: JSON.stringify(tutorials, null, 2),
  feedbacks: JSON.stringify(feedbacks, null, 2),
  // /stats is the public admin view and already includes legacy common-nav stats.
  siteStats: JSON.stringify(combinedStats, null, 2),
};

await writeFile(outputPath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
console.log(`Exported ${Object.keys(values).length} KV keys to ${outputPath}`);
