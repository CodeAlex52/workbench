# 工作台

一份 Markdown，发到自己的博客、小红书、公众号。

不装浏览器扩展，不连第三方 SaaS，不引入数据库。一个 Node 进程加一个本地网页，内容就是磁盘上的 `.md`。

```
┌─ Obsidian / 编辑器 ─┐
│  一篇笔记 + 一张封面  │
└──────────┬──────────┘
           │
      ┌────▼─────┐
      │  工作台   │  localhost:7788
      └────┬─────┘
     ┌─────┼──────────┐
     ▼     ▼          ▼
  博客(md) 小红书(HTTP) 公众号(草稿箱)
```

## 为什么自己做

三端发布不是三个按钮的问题，是三次格式翻译、三套登录态、三种失败语义。现成方案要么只管一个平台，要么要求你接入它的云端账号——而公众号对个人订阅号已经把发布类接口关掉了，这一步谁都绕不过去。

这个项目的取舍是：

- **文件即库**。状态不进数据库，写在 `meta.json` 里；产物写在 `platforms/` 下，生成一次就归你，手改不会被覆盖。
- **不自动点"发表"**。公众号只建草稿，最后一步人来点。原因见下。
- **失败要分得清**。"没发出去"和"不确定发没发出去"是两件事，后者不能重试。

## 三个平台，三种接法

| 平台 | 怎么接 | 关键点 |
|---|---|---|
| 博客 | 写进静态站仓库 → `npm run build` → `wrangler deploy` | 不自动 `git commit`；工作树有未提交改动也照常部署，只在面板上标出来 |
| 小红书 | HTTP 调 [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) | 发布是分钟级的浏览器任务，需要 `POST /health` + 登录态预检 |
| 公众号 | 浏览器登录态的 `cgi-bin` 接口 | 见下节 |

### 公众号这块为什么特殊

2025 年 7 月起，微信回收了个人主体账号的发布类接口权限。个人订阅号调 `draft/add` 会直接返回：

```
48001 api unauthorized
```

服务端 API 还要求固定出口 IP 白名单，报 `40164 invalid ip`——本地开发机或 Cloudflare 的浮动出口都过不了。所以"官方 API + AppSecret"这条路上，个人号是走不通的。

工作台走的是**你浏览器里那个后台**：复用 `mp.weixin.qq.com` 的 cookie 和页面 token，调它自己用的那几个接口——

- `POST /cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77` 建草稿
- `POST /cgi-bin/filetransfer?action=upload_material&scene=8` 把封面换成微信图床

需要的东西：一个 Chrome、一次扫码。不需要 AppSecret，不需要 IP 白名单，不需要认证主体。代价是这条路依赖非公开接口，微信改版可能失效——所以它的失败必须显式降级为"生成可粘贴的 HTML"，而不是假装成功。

生成 HTML 时已经踩过的坑：

- `<ul>/<li>` 在编辑器里不渲染，会挤成一行 → 列表直接展开成带 `•` 的段落
- 裸 `<br>` 会被忽略 → 用 `<span leaf=""><br></span>`
- 非微信域名的 `<a>` 会被拦 → 外链降级成纯文本
- 图片 `src` 必须是 `mmbiz.qpic.cn` 图床
- 去标签正文超过 2 万字会被拒

## 快速开始

需要 Node 20+ 和 Google Chrome。

```bash
git clone <this-repo> workbench && cd workbench
npm install
cp workbench.config.example.json workbench.config.json   # 改里面的路径
node src/index.mjs serve
```

打开 `http://127.0.0.1:7788`。

首次发公众号时，点左下角「检查连通」，浏览器会弹出公众号后台，扫码登录一次即可，登录态存在 `.wechat-profile/`。

### 让工作台读你的 Obsidian vault

在 `workbench.config.json` 里设 `vaultDir` 指向 vault 根目录。工作台会扫描里面所有带这个 frontmatter 的笔记：

```yaml
---
workbench: true
---
```

只有标了 `workbench: true` 的笔记会进列表，其它笔记不会被读到。产物和状态写在 `vault/产出/<slug>/`，源笔记本身不动。这个目录**故意放在 vault 里**，你在 Obsidian 侧边栏能直接看到生成的博客稿、小红书文案和公众号 HTML；扫描时会跳过它，所以产物不会被误当成新笔记。

不配置 `vaultDir` 时，退回读仓库里的 `content/<slug>/source.md`。

## 写作格式

```yaml
---
workbench: true                      # vault 模式下必须，本地 content/ 模式可省
title: 标题
description: 摘要，公众号会用它当 digest（≤120 字）
tags: [标签一, 标签二]
category: 分类
cover: cover.png                     # 或 assets/cover.png
published: 2026-01-01
---
```

正文用二级标题分段，列表用 `-`。三端各自的翻译规则在 `src/lib/markdown.mjs` 里，都是几十行，想改直接改。

## 目录

```
content/<slug>/
├── source.md            源稿（vault 模式下不在这里）
├── assets/cover.png     封面
├── meta.json            三端状态、哈希、草稿 id
└── platforms/
    ├── blog.md          博客产物（带 frontmatter）
    ├── xhs.json         小红书产物（标题/正文/话题/图片）
    └── wechat.html      公众号产物（内联样式）
```

## 状态机

```
empty → ready → publishing → published
                          ├→ awaiting_confirm   公众号草稿已建，等人点发表
                          ├→ unknown            小红书跳转超时，可能已发出
                          └→ failed             确定没发出去
```

`unknown` 和 `failed` 是两件事。前者禁止直接重试，得先去平台确认；后者可以安心重发。

同一篇内容重复发布同一平台会被哈希拦下，除非显式点「强制重发」。

## API

面板用到的接口，也可以直接脚本调：

```
GET  /api/state                      内容列表 + 各端状态
GET  /api/content/:slug              单篇详情（源稿 + 三端产物）
POST /api/content/:slug/build        派生三端稿  {rebuild?: boolean}
POST /api/publish/:slug/:portal      发布（202 + jobId，进度轮询 /api/job/:id）
GET  /api/health                     三端连通性
```

并发发布在服务端串行排队，同一时间只有一个浏览器任务在跑。

## 已知边界

- 公众号那条依赖后台非公开接口，微信改版会挂。挂了就退回"生成 HTML 手动粘贴"，这是设计好的降级路径，不是意外。
- 小红书不返回笔记 id，发布后的链接是 best-effort 反查，查不到就留空。
- 只支持单机单人。没有账号体系，也没有多用户隔离——面板只监听 `127.0.0.1`。
- 不做 AI 改写。派生是机械翻译，改稿你自己改。

## License

MIT
