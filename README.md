# 小乘工具箱 (xcbot.cyou)

一个纯静态、零依赖、无需服务器的在线工具聚合站。所有工具均在浏览器本地运行，**数据不出本地**，即开即用。基于 GitHub Pages 部署，push 到 main 分支即自动上线。

🌐 **在线访问**：<https://xcbot.cyou>

![首页](docs/screenshots/home.png)

## ✨ 特点

- **纯前端实现**：单个 HTML 文件 + 原生 JS，无构建步骤、无后端
- **本地优先**：所有文件处理在浏览器内完成，不上传到任何服务器，注重隐私
- **轻量部署**：push 到 main 分支，GitHub Actions 自动编译发布（约 35-45 秒生效）
- **GitHub 风格 UI**：白底深色 header、横排卡片、分类 tag，简洁清爽

## 🧰 收录工具

| 工具 | 说明 | 链接 |
| --- | --- | --- |
| 🖼️ 图片水印助手 | 批量添加水印与胶片/徕卡风格边框，支持本地预览与导出 | [/watermark/](https://xcbot.cyou/watermark/) |
| 🔧 运行库修复 | 一键检测并修复常见系统运行库缺失问题 | [/system-repair/](https://xcbot.cyou/system-repair/) |
| 📝 文本排版助手 | 一键排版、清除 HTML、简繁转换、错别字检查 | [/typesetter/](https://xcbot.cyou/typesetter/) |
| 📅 日历排班助手 | 四班三倒等排班计算，生成排班表并支持打印导出 | [/shift-helper/](https://xcbot.cyou/shift-helper/) |
| 🗜️ 图片智能压缩 | 本地压缩图片体积，保持清晰度的同时减小文件大小 | [/compressor/](https://xcbot.cyou/compressor/) |
| 🔳 二维码美化助手 | 生成并美化二维码，支持自定义样式与配色 | [/qrcode/](https://xcbot.cyou/qrcode/) |
| 📕 PDF 工具箱 | 合并、拆分、压缩 PDF，纯本地处理，无需上传 | [/pdf-tools/](https://xcbot.cyou/pdf-tools/) |
| ⏱️ 噪音时钟 | 白噪音与番茄钟结合，提升专注与休息质量 | [/zen-pomodoro/](https://xcbot.cyou/zen-pomodoro/) |
| 🧭 公益站导航 | 免费大模型、AI 绘图、公益中转站导航，整理可直接打开使用的 AI 资源 | [/api-nav/](https://xcbot.cyou/api-nav/) |
| 📮 临时邮箱导航 | 一次性邮箱、临时收信和邮件转发服务聚合，适合注册测试和保护真实邮箱 | [/temp-mail/](https://xcbot.cyou/temp-mail/) |

## 📸 截图预览

### 首页
![首页](docs/screenshots/home.png)

### 公益站导航
![公益站导航](docs/screenshots/api-nav.png)

### 临时邮箱聚合导航
![临时邮箱聚合导航](docs/screenshots/temp-mail.png)

### 图片水印助手
![图片水印助手](docs/screenshots/watermark.png)

### 日历排班助手
![日历排班助手](docs/screenshots/shift-helper.png)

## 🏗️ 目录结构

```
.
├── index.html              # 首页（工具聚合入口）
├── watermark/              # 图片水印助手
├── system-repair/          # 运行库修复
├── typesetter/             # 文本排版助手
├── shift-helper/           # 日历排班助手
├── compressor/             # 图片智能压缩
├── qrcode/                 # 二维码美化助手
├── pdf-tools/              # PDF 工具箱
├── zen-pomodoro/           # 噪音时钟
├── api-nav/                # 公益站导航（含后台管理 admin.html + sites.json CMS）
├── temp-mail/              # 临时邮箱聚合导航
├── docs/
│   └── screenshots/        # README 截图
└── .github/workflows/
    └── deploy.yml          # GitHub Pages 自动部署
```

## 🛠️ 技术栈

- **前端**：原生 HTML / CSS / JavaScript（无框架、无构建工具）
- **部署**：GitHub Pages + GitHub Actions
- **CMS**：公益站导航后台通过 GitHub Contents API 直接推送 `sites.json`，实现无服务器 CMS

## 🚀 部署方式

1. Fork 或克隆本仓库
2. 在仓库 Settings → Pages 中选择 "GitHub Actions" 作为构建来源
3. push 到 `main` 分支，`.github/workflows/deploy.yml` 会自动编译并发布
4. 约 35-45 秒后即可通过 `https://<用户名>.github.io/<仓库名>/` 访问

如需自定义域名，在仓库根目录添加 `CNAME` 文件并配置 DNS 即可。

## 🧭 公益站导航后台

`api-nav/admin.html` 提供了一个无服务器的后台管理面板：

- 通过 GitHub Personal Access Token（PAT，需 `repo` 权限）直接调用 GitHub Contents API
- 在线增删改站点、发布公告，保存后立即同步到线上 `sites.json`
- Token 仅保存在浏览器 LocalStorage，不上传至任何第三方
- 投稿反馈数据同样存于浏览器 LocalStorage，不上传

## 📄 License

本项目仅作工具聚合与个人使用，所有子工具的版权归各自所有。

---

&copy; 2026 小乘工具箱 · Powered by GitHub Pages
