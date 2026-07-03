# 小乘工具箱维护手册

## 项目概况

小乘工具箱是一个纯静态 GitHub Pages 工具箱站点，线上域名为：

- http://xcbot.cyou/
- https://xcbot.cyou/（证书签发完成后使用）

站点所有工具均在浏览器本地运行，不依赖后端服务。

## 当前目录结构

```text
/
├── CNAME
├── index.html
├── styles.css
├── walkthrough.md
├── watermark/
│   └── index.html
├── typesetter/
│   └── index.html
├── shift-helper/
│   └── index.html
└── compressor/
    └── index.html
```

## 文件说明

- `index.html`：工具箱主页门户，包含工具网格、技术文库入口和即时搜索。
- `styles.css`：主页样式表，负责绿色极简风格和响应式适配。
- `CNAME`：GitHub Pages 自定义域名配置，当前为 `xcbot.cyou`。
- `watermark/index.html`：图片水印助手，批量添加水印、胶片边框和徕卡边框。
- `typesetter/index.html`：文本排版助手，处理文本排版、HTML 清理、简繁转换等。
- `shift-helper/index.html`：日历排班助手，用于四班三倒等排班计算和打印导出。
- `compressor/index.html`：图片智能压缩工具。
- `walkthrough.md`：部署与维护手册。

## 更新流程

1. 修改对应文件。
2. 本地检查页面是否能打开。
3. 提交并推送到 `main` 分支。
4. GitHub Pages 会从 `main` 分支根目录发布。
5. 等待 GitHub Pages 构建完成后访问线上地址验证。

常用命令：

```bash
git status
git add .
git commit -m "Update site"
git push origin main
```

## 新增子工具规范

每个子工具保持高内聚、自包含：

- 新建目录，例如 `new-tool/`。
- 入口文件固定为 `new-tool/index.html`。
- 子工具自己的 CSS 和 JavaScript 写在该 HTML 内。
- 在主页 `index.html` 添加工具卡片入口。
- 如需样式复用，只复用主页级公共视觉，不把子工具逻辑拆散到多个共享文件。

## GitHub Pages 设置

推荐设置：

- Source：Deploy from a branch
- Branch：`main`
- Folder：`/`
- Custom domain：`xcbot.cyou`
- Enforce HTTPS：证书签发完成后开启

DNS 推荐配置：

```text
A    @    185.199.108.153
A    @    185.199.109.153
A    @    185.199.110.153
A    @    185.199.111.153
```

## 故障排查

### 首页 404

检查：

- `index.html` 是否在仓库根目录。
- Pages 是否发布 `main` 分支根目录。
- 最近一次 push 是否成功。

### 子工具 404

检查：

- 子工具目录名是否和首页链接一致。
- 子工具目录下是否存在 `index.html`。
- 路径大小写是否一致。

### HTTPS 证书异常

检查：

- `CNAME` 内容是否为 `xcbot.cyou`。
- DNS 是否只指向 GitHub Pages 推荐记录。
- GitHub Pages 设置中自定义域名是否保存成功。
- GitHub Pages 是否已经完成证书签发。

证书签发可能需要等待一段时间。证书可用后再开启 `Enforce HTTPS`。

