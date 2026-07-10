import { readFile } from "node:fs/promises";
import { FileKV } from "./file-kv.mjs";

const inputPath = process.argv[2];
const outputPath = process.env.KV_FILE || "/opt/xcbot-data/kv.json";

if (!inputPath) {
  console.error("Usage: node server/import-kv.mjs /path/to/kv-export.json");
  process.exit(1);
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const kv = await new FileKV(outputPath).init();

for (const [key, value] of Object.entries(input)) {
  await kv.put(key, typeof value === "string" ? value : JSON.stringify(value));
}

console.log(`Imported ${Object.keys(input).length} KV keys into ${outputPath}`);
