import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  ROOT, loadConfig, slugList, readSource, readMeta, writeMeta, readDraft, sha, summarize, contentDir, appendOutput,
} from './lib/store.mjs'
import { buildContent } from './build.mjs'
import { publishBlog } from './publishers/blog.mjs'
import { publishXhs, checkXhs } from './publishers/xhs.mjs'
import { getMeta as getWechatMeta, closeContext as closeWechat, inlineImages, createDraft } from './publishers/wechat.mjs'

const config = loadConfig()
const PUBLIC = path.join(ROOT, 'public')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }

// ---------- jobs：全局串行，一次只发一个平台 ----------
const jobs = new Map()
let chain = Promise.resolve()
const now = () => new Date().toISOString()

function enqueue(job, task) {
  chain = chain.then(async () => {
    job.status = 'running'
    job.startedAt = now()
    try {
      const result = await task((line) => {
        job.logs.push(line)
        console.log(`[${job.id}] ${line}`)
      })
      job.status = 'done'
      job.result = result
    } catch (e) {
      job.status = 'failed'
      job.error = String(e?.message || e)
      job.logs.push(`✗ ${job.error}`)
      // 失败也要落盘，否则内容会永远卡在 publishing
      if (!e?.rejected && job.kind === 'publish' && job.slug && job.portal) {
        try {
          const m = readMeta(job.slug)
          if (m?.platforms?.[job.portal]) {
            m.platforms[job.portal] = {
              ...m.platforms[job.portal],
              status: 'failed',
              error: job.error.slice(0, 300),
              failedAt: now(),
              pendingHash: null,
            }
            m.updatedAt = now()
            writeMeta(job.slug, m)
          }
        } catch {}
      }
    } finally {
      job.finishedAt = now()
    }
  })
  return job
}

const newJob = (kind, slug, portal) => {
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const job = { id, kind, slug, portal, status: 'queued', logs: [], createdAt: now() }
  jobs.set(id, job)
  if (jobs.size > 40) jobs.delete(jobs.keys().next().value)
  return job
}

// ---------- 发布 ----------
async function publish(slug, portal, opts = {}, log) {
  const meta = readMeta(slug)
  if (!meta) throw new Error(`没有 ${slug}`)
  meta.platforms ??= {}
  meta.platforms[portal] ??= { status: 'empty', lastPublishedHash: null }
  const viewUrl = `https://mp.weixin.qq.com/s/${slug}`
  let patch = {}
  let evidence = null

  if (portal === 'blog') {
    const blogDraft = readDraft(slug, 'blog')
    meta.platforms.blog.status = 'publishing'
    writeMeta(slug, meta)
    const r = await publishBlog({ slug, config, log })
    evidence = r
    patch = {
      status: 'published',
      publishedAt: now(),
      url: r.url,
      dirty: r.dirty,
      lastPublishedHash: sha(blogDraft?.raw || ''),
    }
  } else if (portal === 'xhs') {
    const draft = readDraft(slug, 'xhs')
    const hash = sha(draft?.raw || '')
    const prev = meta.platforms.xhs || {}
    // 幂等判断必须抢在把 status 改成 publishing 之前，否则判断永远不成立
    if (!opts.force && prev.status === 'published' && prev.lastPublishedHash === hash) {
      const e = new Error('这篇已经发过且内容没变，要重发请用「强制重发」')
      e.rejected = true
      throw e
    }
    meta.platforms.xhs.status = 'publishing'
    meta.platforms.xhs.pendingHash = hash
    writeMeta(slug, meta)
    const r = await publishXhs({ slug, meta, config, force: opts.force, log })
    evidence = r.result
    patch = { status: 'published', publishedAt: now(), lastPublishedHash: r.hash, url: r.noteUrl, pendingHash: null }
  } else if (portal === 'wechat') {
    const draft = readDraft(slug, 'wechat')
    if (!draft) throw new Error('还没有 wechat.html，先点「生成」')
    meta.platforms.wechat.status = 'publishing'
    writeMeta(slug, meta)
    const profileDir = config.wechatProfileDir || path.join(ROOT, '.wechat-profile')
    const wm = await getWechatMeta(profileDir)
    if (!wm) throw new Error('公众号后台未登录：先跑 `npm run serve` 后点「扫码登录」，或手动打开 mp.weixin.qq.com 登录')
    log(`已登录公众号：${wm.nickName || wm.userName}`)
    const html = await inlineImages(profileDir, draft.raw, contentDir(slug), log)
    const xhsMeta = readMeta(slug)
    const r = await createDraft(profileDir, {
      title: (xhsMeta.title || slug).slice(0, 64),
      author: xhsMeta.author || config.author || '',
      digest: (xhsMeta.description || '').slice(0, 120),
      content: html,
      sourceUrl: '',
      showCoverPic: true,
    })
    log(`草稿已建：appMsgId=${r.appMsgId}`)
    await closeWechat()
    patch = { status: 'awaiting_confirm', appMsgId: r.appMsgId, editorUrl: r.editorUrl, publishedAt: null, lastPublishedHash: sha(draft.raw) }
  } else {
    throw new Error(`未知平台 ${portal}`)
  }

  appendOutput(slug, portal, { at: now(), result: evidence, patch })
  const fresh = readMeta(slug)
  fresh.platforms[portal] = { ...fresh.platforms[portal], ...patch }
  fresh.updatedAt = now()
  writeMeta(slug, fresh)
  return { platform: portal, ...patch, url: viewUrl }
}

// ---------- HTTP ----------
const json = (res, code, obj) => {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

const readBody = (req) =>
  new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {})
      } catch {
        resolve({})
      }
    })
  })

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const p = url.pathname
  const host = req.headers.host || ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return json(res, 403, { error: '只接受本机访问' })

  try {
    if (p === '/api/state') {
      const contents = slugList().map(summarize).filter(Boolean)
      const mode = config.vaultDir && fs.existsSync(config.vaultDir) ? 'vault' : 'content'
      return json(res, 200, {
        mode,
        source: mode === 'vault' ? config.vaultDir : path.join(ROOT, 'content'),
        contents,
        config: { port: config.port, author: config.author, cosmosDir: config.cosmosDir, xhsBaseUrl: config.xhsBaseUrl },
      })
    }

    if (p.startsWith('/api/content/') && req.method === 'GET') {
      const slug = decodeURIComponent(p.split('/')[3])
      const meta = readMeta(slug)
      if (!meta) return json(res, 404, { error: '没有这篇' })
      return json(res, 200, {
        summary: summarize(slug),
        meta,
        source: readSource(slug),
        drafts: { blog: readDraft(slug, 'blog')?.raw ?? null, xhs: readDraft(slug, 'xhs')?.raw ?? null, wechat: readDraft(slug, 'wechat')?.raw ?? null },
      })
    }

    if (p.match(/^\/api\/content\/[^/]+\/build$/) && req.method === 'POST') {
      const slug = decodeURIComponent(p.split('/')[3])
      const body = await readBody(req)
      const r = buildContent(slug, { rebuild: !!body.rebuild })
      return json(res, 200, r)
    }

    if (p.match(/^\/api\/publish\/[^/]+\/[^/]+$/) && req.method === 'POST') {
      const [, , , slug, portal] = p.split('/')
      const body = await readBody(req)
      const job = newJob('publish', decodeURIComponent(slug), decodeURIComponent(portal))
      enqueue(job, async (log) => publish(decodeURIComponent(slug), decodeURIComponent(portal), body, log))
      return json(res, 202, { jobId: job.id })
    }

    if (p === '/api/health') {
      const out = { xhs: null, wechat: null, cosmos: null, error: null }
      try {
        const h = await checkXhs(config)
        out.xhs = { ok: true, loggedIn: h.loggedIn, name: h.name }
      } catch (e) {
        out.xhs = { ok: false, error: String(e.message || e) }
      }
      const profileDir = config.wechatProfileDir || path.join(ROOT, '.wechat-profile')
      if (url.searchParams.get('wechat') === '1') {
        try {
          const wm = await getWechatMeta(profileDir)
          out.wechat = wm ? { ok: true, loggedIn: true, name: wm.nickName || wm.userName } : { ok: true, loggedIn: false }
        } catch (e) {
          out.wechat = { ok: false, error: String(e.message || e) }
        }
      }
      const dirty = spawnSync('git', ['-C', config.cosmosDir, 'status', '--porcelain'], { encoding: 'utf-8' })
      out.cosmos = { exists: fs.existsSync(config.cosmosDir), dirty: (dirty.stdout || '').trim().split('\n').filter(Boolean).length }
      return json(res, 200, out)
    }

    if (p === '/api/wechat/login' && req.method === 'POST') {
      const profileDir = config.wechatProfileDir || path.join(ROOT, '.wechat-profile')
      const job = newJob('login', '-', 'wechat')
      enqueue(job, async (log) => {
        const { getContext } = await import('./publishers/wechat.mjs')
        const ctx = await getContext(profileDir)
        const page = await ctx.newPage()
        await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' }).catch(() => {})
        log('浏览器已打开，请扫码登录；登录后关掉这个标签页即可')
        await new Promise((r) => setTimeout(r, 120_000))
        const wm = await getWechatMeta(profileDir)
        await page.close().catch(() => {})
        return { loggedIn: !!wm, name: wm?.nickName || null }
      })
      return json(res, 202, { jobId: job.id })
    }

    if (p.match(/^\/api\/confirm\/[^/]+\/wechat$/) && req.method === 'POST') {
      const slug = decodeURIComponent(p.split('/')[3])
      const body = await readBody(req)
      const meta = readMeta(slug)
      meta.platforms.wechat = { ...meta.platforms.wechat, status: 'published', publishedAt: now(), url: body.url || null }
      writeMeta(slug, meta)
      return json(res, 200, { ok: true, platforms: meta.platforms })
    }

    if (p === '/api/jobs') return json(res, 200, { jobs: [...jobs.values()].reverse().slice(0, 20) })
    if (p.startsWith('/api/job/')) {
      const job = jobs.get(p.split('/')[3])
      return job ? json(res, 200, job) : json(res, 404, { error: '没有这个任务' })
    }

    if (req.method === 'GET') return serveStatic(res, p)
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(res, 500, { error: String(e?.message || e) })
  }
})

const port = Number(process.env.PORT || config.port || 7788)
server.listen(port, '127.0.0.1', () => {
  console.log(`工作台：http://127.0.0.1:${port}`)
  console.log(`内容目录：${path.join(ROOT, 'content')}`)
})
