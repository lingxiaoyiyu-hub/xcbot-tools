import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class FileKV {
  constructor(filePath) {
    this.filePath = filePath;
    this.values = {};
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") this.values = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.flush();
    }
    return this;
  }

  async get(key, type = "text") {
    const entry = this.values[key];
    if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) return null;
    if (type === "json") return JSON.parse(entry.value);
    return entry.value;
  }

  async put(key, value, options = {}) {
    const expiresAt = options.expirationTtl
      ? Date.now() + Number(options.expirationTtl) * 1000
      : null;

    this.values[key] = { value: String(value), expiresAt };
    this.writeChain = this.writeChain.then(() => this.flush());
    return this.writeChain;
  }

  async delete(key) {
    delete this.values[key];
    this.writeChain = this.writeChain.then(() => this.flush());
    return this.writeChain;
  }

  async flush() {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.values, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
