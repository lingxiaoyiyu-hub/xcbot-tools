#!/usr/bin/env node
/**
 * AI 绘图提示词库 — 数据导入脚本
 *
 * 数据源：https://raw.githubusercontent.com/Jermic/awesome-aiart-pics-prompts/refs/heads/master/README.md
 *
 * 功能：
 *   1. 下载 raw README.md（Node 原生 https，零第三方依赖）
 *   2. 保存原始文件到 data/sources/awesome-aiart-pics-prompts/README.md
 *   3. 用状态机解析全部可解析条目（跳过严重缺字段者），输出到 prompts/data/aiart-prompts.json
 *
 * README 结构（已实测样本）：
 *   ## 作者名                              ← 作者块（同作者后续条目无 ##）
 *   ### [标题](aiart.pics 详情链接)         ← 条目起始
 *   **作者**: [@名](链接)
 *   **来源**: [平台](链接)
 *   <img src="..." width="500" alt="...">  ← 1~N 张，独占一行
 *   ```                                    ← 代码块（语言标记不统一：``` 或 ```json）
 *   提示词正文
 *   ```
 *   ---                                    ← 条目分隔符（注意：代码块内也可能有 ---，必须用状态机区分）
 *
 * 输出字段见 README 中 JSON 示例。
 *
 * 用法：node scripts/import-aiart-prompts.js
 * 幂等：可重复运行，覆盖旧文件。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── 配置 ────────────────────────────────────────────────────────────
const README_URL = 'https://raw.githubusercontent.com/Jermic/awesome-aiart-pics-prompts/refs/heads/master/README.md';
const ORIGIN_REPO = 'https://github.com/Jermic/awesome-aiart-pics-prompts';
const LICENSE = 'CC BY 4.0';
// 第一版曾限制 300 条，现已改为导入全部可解析条目。
// 跳过条件：prompt 正文为空（提示词库的核心字段缺失即视为严重缺字段）。
const SKIP_IF_NO_PROMPT = true;

// 仓库根目录 = 脚本所在目录的上一级
const ROOT = path.resolve(__dirname, '..');
const SRC_README_PATH = path.join(ROOT, 'data', 'sources', 'awesome-aiart-pics-prompts', 'README.md');
const OUT_JSON_PATH = path.join(ROOT, 'prompts', 'data', 'aiart-prompts.json');

// ── 工具函数 ────────────────────────────────────────────────────────

/** 下载 URL 内容为字符串（跟随重定向）。 */
function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.from(chunks.join(''), 'utf8').toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** 递归建目录（已存在则跳过）。 */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * 标签生成：关键词简单匹配。
 * 每条至少含 ["AI绘图"]，若匹配到具体类别则追加，若 prompt/title 提到模型名则加模型标签。
 */
function buildTags(title, prompt) {
  const text = ((title || '') + ' ' + (prompt || '')).toLowerCase();
  const tags = [];

  const rules = [
    { tag: '摄影',   kws: ['摄影', 'photo', 'camera', 'portrait', 'photograph'] },
    { tag: '插画',   kws: ['插画', 'illustration', 'anime', 'cartoon'] },
    { tag: '3D',     kws: ['3d', 'render', 'blender', 'octane'] },
    { tag: '海报',   kws: ['poster', '海报'] },
    { tag: 'UI',     kws: ['ui', 'interface', 'app design'] },
    { tag: '产品图', kws: ['product', '产品'] },
    { tag: '表情包', kws: ['sticker', 'emoji', '表情', 'line stamp'] },
  ];
  for (const r of rules) {
    if (r.kws.some((kw) => text.indexOf(kw) !== -1)) tags.push(r.tag);
  }

  // 模型标签
  if (text.indexOf('nano banana') !== -1) tags.push('Nano Banana');
  if (text.indexOf('midjourney') !== -1) tags.push('Midjourney');
  if (text.indexOf('stable diffusion') !== -1 || text.indexOf('stable-diffusion') !== -1) tags.push('Stable Diffusion');

  // 至少含 AI绘图；去重
  tags.unshift('AI绘图');
  return Array.from(new Set(tags));
}

/**
 * slug 生成：优先复用 detailUrl 末尾段，缺失则用 prompt-序号。
 * 去重：若 slug 已存在，追加 -2、-3 ...
 */
function makeSlug(detailUrl, index, usedSet) {
  let slug = '';
  if (detailUrl) {
    const m = detailUrl.match(/\/prompt\/([^/]+?)\/?$/);
    if (m && m[1]) slug = m[1];
  }
  if (!slug) slug = 'prompt-' + String(index + 1).padStart(3, '0');

  // 唯一化
  let final = slug;
  let n = 2;
  while (usedSet.has(final)) {
    final = slug + '-' + n;
    n++;
  }
  usedSet.add(final);
  return final;
}

/** 提取 markdown 链接 [text](url) 中的 text 与 url。 */
function parseMdLink(line) {
  const m = line.match(/\[([^\]]*)\]\(([^)]*)\)/);
  if (m) return { text: m[1].trim(), url: m[2].trim() };
  return null;
}

/** 解析 <img src="..." alt="..."> 标签，返回第一张图信息。 */
function parseImg(line) {
  const srcM = line.match(/src\s*=\s*"([^"]+)"/);
  const altM = line.match(/alt\s*=\s*"([^"]*)"/);
  if (srcM) return { url: srcM[1], alt: altM ? altM[1] : '' };
  return null;
}

// ── 核心解析：状态机逐行扫描 ─────────────────────────────────────────

/**
 * 解析 README 为条目数组。
 *
 * 状态：
 *   IDLE       - 顶部非条目内容（简介、徽章等），等待遇到第一个 ##
 *   IN_AUTHOR  - 刚读到 ## 作者名，等待 ### 起始条目
 *   IN_ENTRY   - 在条目内部，收集作者行/来源行/图片/代码块
 *   IN_CODE    - 在代码块内部（此时 --- 不算分隔符）
 *
 * 条目边界判定：
 *   - 在 IN_ENTRY 且不在代码块内时，遇到 ### → 结束当前条目，开始新条目
 *   - 在 IN_ENTRY 且不在代码块内时，遇到 ## → 结束当前条目，进入新作者
 *   - 在 IN_ENTRY 且不在代码块内时，遇到独占一行的 --- → 结束当前条目，回到 IN_AUTHOR
 */
function parseReadme(md) {
  const lines = md.split(/\r?\n/);
  const items = [];
  let state = 'IDLE';
  let curAuthor = '';        // 当前作者名（带 @）
  let curAuthorUrl = '';
  let cur = null;            // 当前正在构建的条目
  let codeBuf = [];          // 代码块内容缓冲
  let codeLangSeen = false;  // 是否已见过代码块起始 ```

  function flushItem() {
    if (!cur) return;
    if (cur.prompt === undefined) cur.prompt = '';
    cur.prompt = cur.prompt.trim();
    if (!cur.title && !cur.prompt) {
      // 空条目，丢弃
      cur = null;
      return;
    }
    items.push(cur);
    cur = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // 代码块边界检测（必须在所有状态之前，因为 ``` 可出现在 IN_ENTRY 内）
    // 起始：独占一行的 ``` 或 ```lang
    // 结束：独占一行的 ```
    const isCodeFence = /^```/.test(line);

    if (state === 'IN_CODE') {
      if (line === '```') {
        // 代码块结束
        state = 'IN_ENTRY';
        if (cur) cur.prompt = codeBuf.join('\n');
        codeBuf = [];
        codeLangSeen = false;
        continue;
      }
      codeBuf.push(raw);  // 保留原始缩进
      continue;
    }

    // ── 不在代码块内 ──

    // 作者块：## 作者名（注意 README 第一条作者行是 "## 🅰️nanto Mohammad" 这种，可能含 emoji）
    if (/^##\s+\S/.test(line) && !/^###\s/.test(line)) {
      if (cur) flushItem();
      curAuthor = line.replace(/^##\s+/, '').trim();
      state = 'IN_AUTHOR';
      continue;
    }

    // 条目起始：### [标题](链接)
    const entryMatch = line.match(/^###\s+\[([^\]]*)\]\(([^)]*)\)/);
    if (entryMatch) {
      if (cur) flushItem();
      cur = {
        title: entryMatch[1].trim(),
        detailUrl: entryMatch[2].trim(),
        author: curAuthor.replace(/^@\s*/, '').trim(),
        authorUrl: curAuthorUrl,
        sourcePlatform: '',
        sourceUrl: '',
        imageUrl: '',
        imageAlt: '',
        prompt: '',
      };
      state = 'IN_ENTRY';
      continue;
    }

    // 在 IN_ENTRY 状态下收集字段
    if (state === 'IN_ENTRY' && cur) {
      // 代码块起始
      if (isCodeFence) {
        state = 'IN_CODE';
        codeBuf = [];
        // 记录是否带语言标记（不影响逻辑，仅备用）
        codeLangSeen = /^```\S/.test(line);
        continue;
      }

      // 条目分隔符：独占一行的 --- （不在代码块内才算）
      if (line === '---') {
        flushItem();
        state = 'IN_AUTHOR';  // 保持当前作者，等待下一个 ###
        continue;
      }

      // 作者行：**作者**: [@名](链接)
      if (/^\*\*作者\*\*/.test(line)) {
        const rest = line.replace(/^\*\*作者\*\*\s*:?\s*/, '');
        const link = parseMdLink(rest);
        if (link) {
          cur.author = link.text.replace(/^@\s*/, '').trim();
          cur.authorUrl = link.url;
          // 同步更新当前作者块状态（后续同作者条目继承）
          curAuthor = link.text;
          curAuthorUrl = link.url;
        }
        continue;
      }

      // 来源行：**来源**: [平台](链接)
      if (/^\*\*来源\*\*/.test(line)) {
        const rest = line.replace(/^\*\*来源\*\*\s*:?\s*/, '');
        const link = parseMdLink(rest);
        if (link) {
          cur.sourcePlatform = link.text.trim();
          cur.sourceUrl = link.url.trim();
        }
        continue;
      }

      // 图片行：<img src="..." ...>
      if (/^<img\s/i.test(line)) {
        const img = parseImg(line);
        if (img && !cur.imageUrl) {
          // 取第一张图
          cur.imageUrl = img.url;
          cur.imageAlt = img.alt;
        }
        // 多张图：仅保存第一张作为 imageUrl（规格要求）
        continue;
      }

      // 其它行忽略
      continue;
    }

    // IN_AUTHOR 状态下，等待 ### 起始；其它行忽略
    // （作者块下通常紧跟 ###，无需额外处理）
  }

  // 文件结束：冲刷最后一个条目
  if (cur) flushItem();

  return items;
}

// ── 主流程 ──────────────────────────────────────────────────────────

async function main() {
  console.log('[1/4] 下载 README: ' + README_URL);
  const md = await download(README_URL);
  console.log('      下载完成，长度 ' + md.length + ' 字符');

  console.log('[2/4] 保存原始 README 到: ' + path.relative(ROOT, SRC_README_PATH));
  ensureDir(path.dirname(SRC_README_PATH));
  fs.writeFileSync(SRC_README_PATH, md, 'utf8');

  console.log('[3/4] 解析 README ...');
  const allItems = parseReadme(md);
  const totalParsed = allItems.length;
  console.log('      共解析出 ' + totalParsed + ' 条提示词条目');

  // 导入全部可解析条目；跳过严重缺字段者（prompt 正文为空）
  const usedSlugs = new Set();
  const skipped = [];
  const out = [];
  allItems.forEach((it, idx) => {
    if (SKIP_IF_NO_PROMPT && !it.prompt) {
      skipped.push({ index: idx, title: it.title, reason: '无 prompt 正文' });
      return;
    }
    const slug = makeSlug(it.detailUrl, idx, usedSlugs);
    const tags = buildTags(it.title, it.prompt);
    out.push({
      id: slug,
      title: it.title || '',
      detailUrl: it.detailUrl || '',
      author: it.author || '',
      authorUrl: it.authorUrl || '',
      sourcePlatform: it.sourcePlatform || '',
      sourceUrl: it.sourceUrl || '',
      imageUrl: it.imageUrl || '',
      imageAlt: it.imageAlt || '',
      prompt: it.prompt || '',
      tags: tags,
      license: LICENSE,
      originRepo: ORIGIN_REPO,
    });
  });

  console.log('[4/4] 写出 JSON: ' + path.relative(ROOT, OUT_JSON_PATH) + ' (' + out.length + ' 条)');
  ensureDir(path.dirname(OUT_JSON_PATH));
  fs.writeFileSync(OUT_JSON_PATH, JSON.stringify(out, null, 2), 'utf8');

  // ── 完整统计 ──
  const withImg = out.filter((x) => x.imageUrl).length;
  const withAuthor = out.filter((x) => x.author).length;
  const withSource = out.filter((x) => x.sourceUrl).length;
  const withPrompt = out.filter((x) => x.prompt).length;
  const imgRate = out.length ? (withImg / out.length * 100).toFixed(1) : '0.0';
  const authorRate = out.length ? (withAuthor / out.length * 100).toFixed(1) : '0.0';
  const sourceRate = out.length ? (withSource / out.length * 100).toFixed(1) : '0.0';

  console.log('\n========== 导入统计 ==========');
  console.log('README 解析到的总条目数 : ' + totalParsed);
  console.log('成功导入条数           : ' + out.length);
  console.log('跳过条数               : ' + skipped.length);
  console.log('图片字段覆盖率         : ' + withImg + '/' + out.length + ' (' + imgRate + '%)');
  console.log('作者字段覆盖率         : ' + withAuthor + '/' + out.length + ' (' + authorRate + '%)');
  console.log('来源字段覆盖率         : ' + withSource + '/' + out.length + ' (' + sourceRate + '%)');
  console.log('有正文条数             : ' + withPrompt + '/' + out.length);
  console.log('slug 唯一性            : ' + (new Set(out.map((x) => x.id)).size === out.length ? '是' : '否'));

  if (skipped.length > 0) {
    console.log('\n--- 跳过条目明细（前 20 条）---');
    skipped.slice(0, 20).forEach((s) => {
      console.log('  #' + (s.index + 1) + ' [' + s.reason + '] ' + (s.title || '(无标题)'));
    });
    if (skipped.length > 20) console.log('  ... 还有 ' + (skipped.length - 20) + ' 条');
  }

  // 前 3 条预览
  console.log('\n=== 前 3 条预览 ===');
  out.slice(0, 3).forEach((x, i) => {
    console.log('--- #' + (i + 1) + ' ---');
    console.log('  id: ' + x.id);
    console.log('  title: ' + x.title);
    console.log('  author: ' + x.author + ' (' + x.authorUrl + ')');
    console.log('  source: ' + x.sourcePlatform + ' - ' + x.sourceUrl);
    console.log('  image: ' + x.imageUrl);
    console.log('  tags: ' + JSON.stringify(x.tags));
    console.log('  prompt(前60字): ' + (x.prompt || '').slice(0, 60).replace(/\n/g, ' '));
  });
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
