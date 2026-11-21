# 图文流水线工作台 · 设计

日期：2026-11-21
状态：待批准
仓库工作名：`workbench`（正式名字待定，见「留给 builder」）

---

## 一、为什么做这个

现在发一篇内容，实际动作是：写一篇 md → 手改成小红书的标题和正文 → 生成封面 → 调 `localhost:18060` 发出去 → 再手动把同一篇放进博客、再手动往公众号后台粘一遍。

小红书这段已经跑通了（`blog/cosmos/src/content/posts/victorio.md` → `~/tmp/xhs-vittorioo/payload.json` → `POST /api/v1/publish` → `{"success":true,"status":"发布完成"}`）。剩下的问题不是"能不能发"，是**每篇都要重复一遍这一串动作，而且三端的状态散在三个地方**。

这个工作台要解决的就是这一件事：一篇稿子进来，三端的产出、发布、状态都在一个地方，并且每一步在终端里都能复现。

## 二、目标 / 非目标 / 反目标

**目标**

1. 一篇稿子 → 三端产出（小红书 JSON、公众号内联样式 HTML、博客带 frontmatter 的 md），一次生成。
2. 小红书一键发布，复用现有 `xiaohongshu-mcp`，不重写。
3. 博客一键上线：写入 `cosmos`、`astro build`、`wrangler deploy`，拿回 URL。
4. 公众号自动填进草稿箱（标题、正文、封面），**停在草稿，人手动点发表**。
5. 本地面板上看得见：队列、每篇的三端状态、失败原因、操作日志。
6. 每个按钮都对应一条终端命令，不依赖面板也能跑完整条链路。

**非目标（这一版明确不做）**

- AI 改写 / AI 生成正文。小红书的标题正文仍由现有 skill（`~/.claude/skills/xhs-note`、`xiaohongshu`）或人写。
- 历史文章迁移（公众号/小红书旧内容搬进博客）。
- 视频流（抖音、视频号）、音频、播客。
- 数据回流（阅读量、点赞、评论、D+1/D+7 复盘）。
- 多账号、多用户、权限。
- 手机访问。
- 已发布内容的版本管理（改稿历史、回滚、多版本草稿）。改稿走 `--force` 重新发布，不建版本库。

**反目标（技术上做成了也算失败）**

- 把公众号 cookie、appsecret 之类的东西传到云端。
- 必须开着 Claude Code 或某个 agent 会话才能用。
- 每次发布仍要人工重复五个步骤。
- 发布失败但状态显示成功，或者失败后没人知道哪一步断的。

## 三、约束（已经核实的事实）

| 项 | 事实 |
|---|---|
| 公众号主体 | 个人订阅号。2025-07 起官方回收发布类接口权限；未认证号调 `draft/add` 返回 `48001 api unauthorized`；服务端 API 还要 IP 白名单（`40164`）。**官方 API 这条路对本号不存在。** |
| 公众号可行路径 | 浏览器自动化，复用登录态，把内容填进草稿箱。登录态会过期，需要重扫码。 |
| 小红书 | `~/work/xiaohongshu-mcp`，端口 `18060`。`GET /health` 公开；`/api/v1/*` 走可选 Bearer（`--token` 或 `AUTH_TOKEN`，为空时放行）。`POST /api/v1/publish`，body `{title, content, tags, images[]}`。另有 `/api/v1/login/status`、`/api/v1/login/qrcode`。 |
| 博客 | `blog/cosmos`，Astro 5 + Cloudflare Workers，remote `github.com/CodeAlex52/cosmos`，**没有 CI**。部署 = `npm run build && npx wrangler deploy`，`wrangler.jsonc` 里 `name: cosmos`、`assets.directory: ./dist`，整站一起发。内容在 `src/content/posts/*.md`；`src/content.config.ts:6-16` 只认 `title`、`published`（必填）与 `description/tags/category/image`（可选）；`slug`、`pinned` 是惰性字段，URL 由 `src/pages/posts/[...slug].astro:10-12` 从文件名生成。 |
| 运行环境 | macOS，Node v22.23.4，Playwright 1.65.1 已装（chromium 已缓存）。 |
| 既有资产 | `blog/board`（Worker + D1 打卡板）、`~/.claude/agents/xhs-account-ops`（内容运营数据模型 + dashboard.html）、`xhs-note` / `xhs-layout` 封面生成 skill。 |

## 四、看过的现成轮子，以及为什么不直接用

| 项目 | 是什么 | 结论 |
|---|---|---|
| [amlei/tassello](https://github.com/amlei/tassello)（九漾 Onda） | 中文创作者多平台发布工作台。Markdown 事实源 + `state/` 文件状态库 + Bun/Elysia 本机后端 + Next.js UI + Electron + Chrome MV3 扩展 + Native Messaging + Obsidian 插件 + CLI。支持 wechat/xhs/zhihu/baijiahao 等。 | 最接近，但 2 stars、2026-09 才建、五端应用。fork 等于接手别人的架构。**借鉴其四个决定**：Markdown+frontmatter 作事实源、文件状态库而非数据库、发布停在 `awaiting_confirm`、CLI 语法 `publish <platform> <type> <file>`。 |
| [gitcoffee-os/postbot](https://github.com/gitcoffee-os/postbot) | 1703 stars，MV3 扩展 + CDP，覆盖公众号/小红书/知乎/抖音/B站等，`src/media/publisher/platform/article/weixin.publisher.ts`、`.../moment/xiaohongshu.publisher.ts` 有现成页面驱动实现。 | **当参考实现读**，不 fork。公众号编辑器怎么填、图片怎么传，去看它的 publisher。 |
| [wechatsync/Wechatsync](https://github.com/wechatsync/Wechatsync) | 6652 stars，浏览器扩展，一键同步到 29+ 平台，v2 有 CLI/MCP 桥接。走的是**直调平台内部 Web 接口**。 | 借鉴"上传图片→替换正文链接→更新文章"的顺序。**不采用直调内部接口**，风控比模拟 UI 敏感。 |
| [dreammis/social-auto-upload](https://github.com/dreammis/social-auto-upload) | Python + Playwright + 统一 CLI + Agent Skill，抖音/快手/小红书/视频号/B站，主线四平台成熟。 | **留给视频流那一版**。现在不引入 Python 运行时。 |
| [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) | 已在用的 Go 服务 + REST/MCP。 | 保留，作为小红书的执行端。 |
| Postiz / Mixpost / TryPost | 海外自托管调度器，覆盖 X/LinkedIn/Mastodon 等。 | 不适用：不支持小红书/公众号，且要求各平台开发者应用审核。 |

结论：**不 fork 任何一个，写一个薄壳**。上面的项目当参考实现和未来的适配器来源；薄壳的价值在于"内容格式和状态是本机的、可读的、git 可管的"。

## 五、方案

**A. 本地 Node 服务 + 文件即库 + 零构建面板（选中）**
内容是一篇一个目录，状态在 `meta.json`，面板是原生 HTML/JS，服务是 Node 22 原生 `http`。每个动作都是一个 CLI 子命令，面板只是调用它并把日志流出来。
代价：状态机和重试要自己写；没有现成的富文本编辑器（正文在 md 里改）。

**B. Cloudflare Worker + D1**
和 `board`、`cosmos` 同栈，手机能开。但小红书 MCP 在 `localhost:18060`、Playwright 只能在本机跑，Worker 发不了，得再加一个本机 agent 轮询任务、还要处理鉴权。多一层，调试慢一倍。

**C. 只做 CLI**
半天能跑通。但目标是"白天待在里面"，面板迟早要补，不如一开始就把 CLI 和面板做成同一套动作的两个入口。

选 **A**。理由：执行端（MCP、Playwright）天然只能在本机，把状态也放本机最省事；文件即库让每篇内容可读、可 diff、可 git；面板零构建意味着没有第二套工具链要维护，也方便以后开源给别人跑。

## 六、架构

### 6.1 内容目录 = 事实源

```
workbench/
  bin/wb.mjs                  # CLI 入口
  src/
    cli.mjs                   # 参数解析、子命令分发
    content.mjs               # 目录/状态读写
    build.mjs                 # 源稿 → 三端产出
    publish.mjs               # 发布编排、幂等锁、事件日志
    adapters/
      blog.mjs                # 写 cosmos + build + deploy
      xhs.mjs                 # POST 18060
      wechat.mjs              # Playwright 填草稿
    render/
      md.mjs                  # 极简 md 解析（标题/段落/列表/引用/代码/图片/强调/链接）
      wechat-html.mjs         # 内联样式主题
    server.mjs                # 面板 HTTP + SSE
    web/                      # index.html / app.js / style.css
  content/
    <slug>/
      source.md               # 原始稿，人写，唯一真源
      meta.json               # 状态机 + 事件
      assets/cover.png
      platforms/
        blog.md               # frontmatter + 正文
        xhs.json              # {title, content, tags, images[]}
        wechat.html           # 内联样式
  output/
    <slug>/<platform>-<hash>.json   # 每次发布的原始返回，append-only（git 忽略，不作记忆）
  .wechat-profile/            # Playwright 持久化登录态（git 忽略）
  workbench.config.json       # 路径与端口
```

`workbench.config.json`（可被环境变量覆盖，开源时不硬编码个人路径）：

```json
{
  "port": 7788,
  "cosmosDir": "../blog/cosmos",
  "xhsBaseUrl": "http://localhost:18060",
  "xhsToken": "",
  "wechatProfileDir": ".wechat-profile",
  "author": "苏哲"
}
```

**归属（已确认）**：`workbench/content/<slug>/source.md` 是人和工作台唯一改的地方；`cosmos/src/content/posts/<slug>.md` 是**产物**，`wb publish <slug> blog` 直接覆盖它。`wb new --from` 是「导入并接管」：导入后那篇的正文只在 workbench 侧编辑，不再回 cosmos 里改。为避免误覆盖，博客适配器写盘前比对目标文件与 `lastPublishedHash`，不一致（说明有人在 cosmos 里手改过）时明确提示再写，不静默吞掉。

`meta.json`：

```json
{
  "slug": "victorio",
  "title": "看了一年的 Victorio",
  "createdAt": "2026-11-21T15:00:00+08:00",
  "platforms": {
    "blog":   { "status": "published", "url": "https://cosmos.../posts/victorio/", "lastPublishedHash": "...", "updatedAt": "..." },
    "xhs":    { "status": "published", "noteId": "", "url": "", "lastPublishedHash": "...", "updatedAt": "..." },
    "wechat": { "status": "awaiting_confirm", "draftId": "", "updatedAt": "..." }
  },
  "events": [
    { "at": "...", "platform": "xhs", "action": "publish", "ok": true, "detail": "发布完成" }
  ]
}
```

### 6.2 每平台状态机

```
empty --build--> ready --publish--> publishing --+--> published
                                                 +--> awaiting_confirm（公众号：草稿填好，等人点发表）
                                                 +--> unknown（可能已发出，见 6.5）
                                                 +--> failed(原因)
published --force--> publishing
unknown --confirm--> published | failed
```

- 只有 `ready` 能发布；`published` 再点必须显式 `--force`。
- `failed` 可重试，重试前保留上一条 `lastError`。
- `unknown` **不允许直接重试**，必须 `wb confirm <slug> xhs --url <笔记链接>` 或 `--failed` 收尾；面板上黄灯 + 两个按钮。
- 公众号 `awaiting_confirm` 是终态之一，面板上给「我已发表」按钮回填 URL。
- 小红书 `ready` 的前提是 `assets/` 里至少有一张图（MCP 空图会硬失败 `图片不能为空`），`wb build` 就拦住，不放行到 `ready`。

### 6.3 执行器与面板

- 服务只管三件事：读目录出队列、执行动作、把日志用 SSE 推给前端。
- 只监听 `127.0.0.1`，`POST` 校验 `Origin`/`Host`：否则你随便打开的任何网页都能向 `localhost:7788` 发请求、用你的小红书发内容。
- 小红书一次发布是**分钟级**的浏览器任务（单页超时 300s，每张图上传等 60s，见 `xiaohongshu/publish.go:114,303-307`），所以 HTTP 接口不等结果：立刻返回 `202`，进度和结果走 SSE。
- 动作串行（一个队列，一把锁），因为三个平台共用本机浏览器和 MCP。
- 每个动作落 `output/` 的原始返回 + `meta.json` 的 `events`，面板刷新靠读文件，不靠内存状态。
- 面板路由：`GET /` 队列、`GET /api/items`、`POST /api/items/:slug/publish/:platform`、`GET /api/logs`（SSE）。
- 端口占用、MCP 没起、wrangler 没登录，都在面板上直接显示成红色阻塞项，不让用户去猜。

### 6.4 三个适配器

**blog**：`platforms/blog.md` → `cosmos/src/content/posts/<slug>.md`（覆盖，写前比 hash）；`assets/*` → `cosmos/public/images/`；`cd cosmos && npm run build && npx wrangler deploy`；从输出里解析 `https://...workers.dev` 回填。构建失败时把 stderr 尾部写进 `lastError`，状态置 `failed`。

**发布范围（已确认）**：`wrangler deploy` 发的是 cosmos **当前工作树**，跟手动跑命令一致。不发 `HEAD`、不开临时 worktree、不要求干净。面板上把 cosmos 的 `git status`（多少未提交改动、多少未推送 commit）显示成黄字提醒，不阻断。

**xhs**：先 `GET /health`，再 `GET /api/v1/login/status`；未登录返回二维码路径让人扫。发布前算 `hash(platforms/xhs.json)`，跟 `meta.json` 的 `lastPublishedHash` 比对，命中就拒绝（除非 `--force`）。请求 `POST /api/v1/publish`，`images` 传绝对路径。

**`xhs.json` 是 additive 的（已确认）**：`wb build` 只在它不存在时生成骨架，已存在就原样保留、不覆盖；要重新派生加 `--rebuild-xhs`。原因是小红书文案会手改，每次重生成既毁掉手写文案，又会让 hash 变化、把「已发布」守卫静默缴械。hash 在 publish 成功那一刻锁进 `meta.json`。

`PublishResponse` 只有 `{title, content, images, at_users}`（`~/work/xiaohongshu-mcp/service.go:59-67`），**不返回笔记 id**。`noteId`/`url` 靠 `GET /api/v1/feeds/list`（`routes.go:56`）按标题和时间反查，best-effort，查不到就留空，不影响 `published`。

**wechat**：Playwright `launchPersistentContext(config.wechatProfileDir, { headless: false })` → `https://mp.weixin.qq.com/`。未登录就停住，让人扫码，扫完继续。已登录则：新建图文 → 填标题 → 正文注入 `platforms/wechat.html`（优先 `page.evaluate` 派发带 `text/html` 的 paste 事件，失败则回退到逐段 `insertHTML`）→ 上传封面 → 点「保存」→ 等保存成功提示 → 回填草稿链接 → **不点发表**。选择器全部集中在 `wechat.mjs` 顶部的 `SEL` 常量里，微信改版只改一处。

### 6.5 幂等与防重复

这是整套东西里最不能出错的地方（小红书重复发布是真事故）。

- 每次发布前算内容 hash，**成功记录写进 `meta.json` 的 `platforms.<p>.lastPublishedHash`**（`output/` 被 git 忽略且是 append-only 日志，不能当记忆）。
- `published` 且 hash 未变 → 直接拒绝，提示「这篇已经发过了，要重发加 --force」。
- `unknown` 一律当已发出处理，必须人确认才能再动。
- 面板上「发布」按钮对 `published` 的项要二次确认。
- 跨进程锁：`content/.lock-<platform>` 文件锁。CLI 和面板是并列入口，两个终端同时点小红书是真能重发的。

小红书 MCP 的成功判定是「点发布后 15s 内离开 `/publish/publish` 页面」，否则报 `发布未确认成功：点击发布后未跳转离开发布页（可能校验未过或被拦截）`（`~/work/xiaohongshu-mcp/xiaohongshu/publish.go:459-478`）。这条**不映射成 `failed`，映射成 `unknown`**：笔记可能已经发出去了。

### 6.6 配置与密钥

- 公众号：不存任何 appsecret、不存 cookie 文件到 git（`.wechat-profile/` 进 `.gitignore`）。
- 小红书：`xhsToken` 可为空；非空时带 `Authorization: Bearer`。
- Cloudflare：用本机 `wrangler` 已登录的凭据，工作台不碰 token。

## 七、我的决定（可以推翻）

1. **面板零构建**：原生 HTML/JS + Node `http` + SSE，不引框架、不引打包器。理由是这套东西的价值在链路，不在 UI；以后要好看再换 Astro 也不难。
2. **公众号用独立 Playwright profile**，不接管你日常 Chrome。代价是首次扫码、几周重扫一次；好处是不依赖 Chrome 调试端口，也不会跟你正在用的浏览器抢会话。
3. **公众号只填草稿，绝不自动点发表**。个人号模拟发表的风险不值得省这一次点击。
4. **博客用 `wrangler deploy` 同步部署**，不走 git push。因为 cosmos 没有 CI，同步部署能立刻拿到成败和 URL；git commit 由你决定什么时候做（工作台不自动 commit）。
5. **一稿一目录，slug 即目录名**。slug 冲突时加日期后缀，不覆盖。
6. **不引入数据库**。文件够用，且可 git。
7. **`unknown` 是正式状态**，不是错误分支。宁可多一次人工确认，也不要多一次重复发布。
8. **一次发布一把锁、一个串行队列**，不为并发优化。三个平台共用本机浏览器和 MCP，并发只会互相抢会话。
9. **不做 AI 改写**。`wb build` 只做机械派生：博客就是源稿加 frontmatter，公众号是源稿的排版版，小红书首版是从源稿短段落拼出来的骨架（之后手改，不被覆盖）。改写留给现有 skill，下一版再谈怎么接。
10. **build 是「补齐」而不是「重刷」**：产物文件已存在就跳过（xhs.json 尤其），`--rebuild` 才强制重写。误覆盖比产物过时危险得多。

## 八、留给 builder / 下一版

- 仓库正式名字、LICENSE（倾向 MIT）、README 的开源门面。
- 公众号排版主题：先给一套克制的（16px、行高 1.75、段距 1.5em、主色 #3f3f3f、引用左侧细线），不做花哨装饰。
- 公众号图片：正文里的本地图片需要走后台的上传控件，第一版先支持"封面 + 无内文图"，内文图作为第二个 spike。
- 小红书封面：是否在 `wb build` 里直接调 `xhs-note` 的 `get_layout.py` / `make_cover.py`，还是继续手动生成后放进 `assets/`。第一版手动。
- 面板视觉：第一版能用即可；确定长期用之后按 `frontend-design` 重做一次。

## 九、验收

按顺序，每步都要在终端能看到结果：

0. **Spike（先做）**：用 Playwright 把 victorio 这篇填进公众号草稿箱，只填不发表。验收：标题对、段落层次对、封面在、没有乱码和样式丢失。**这一步不过，公众号降级为"生成可粘贴 HTML"，其余照做。**
1. `wb new victorio --from ../blog/cosmos/src/content/posts/victorio.md` → 建出 `content/victorio/`，`source.md` 就位。
2. `wb build victorio` → `platforms/` 下三份产出，`meta.json` 三端状态 `ready`。
3. `wb publish victorio blog` → `cosmos.example.workers.dev` 上能打开这篇，状态 `published` + URL。
4. `wb publish victorio xhs` → 小红书出现笔记；**再跑一次必须被拒绝**。
5. `wb publish victorio wechat` → 后台草稿箱有草稿，人点发表后 `wb confirm victorio wechat --url ...`。
6. `wb serve` → 面板上三个状态跟 `meta.json` 一致，点按钮能触发同一个动作，日志实时滚；动作立刻返回、不卡住（小红书那步是分钟级）。
7. 断网/关掉 18060/wrangler 未登录三种情况下，面板显示明确的阻塞原因，而不是转圈。
8. 另开一个网页执行 `fetch('http://localhost:7788/api/items/x/publish/xhs',{method:'POST'})` 必须被拒（Origin 校验）。
9. 杀掉守护进程重启后，`published` 状态和 hash 还在（证明记忆在 `meta.json` 而不是内存）。

## 十、风险

| 风险 | 应对 |
|---|---|
| 公众号编辑器是富文本，粘贴 HTML 走形 | 先 spike；选择器与注入逻辑集中在 `wechat.mjs`；失败就降级成"生成可粘贴 HTML + 手动粘" |
| 微信改版 | 选择器常量集中一处；面板显示"公众号适配器可能已失效"而不是静默失败 |
| 登录态过期 | `/api/v1/login/status` 和页面登录检测；过期时给出扫码入口，不假装成功 |
| 小红书重复发布 | 内容 hash + 单飞锁 + `--force` 才允许重发 |
| `wrangler deploy` 凭据过期 | 抓 stderr，原样显示；状态 `failed`，不吞掉 |
| 内容只有一篇，链路验证不充分 | 验收用 victorio；之后每发一篇就是在真实使用中验证 |
