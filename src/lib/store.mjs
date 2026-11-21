import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from './markdown.mjs'

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const CONTENT_DIR = path.join(ROOT, 'content')
export const OUTPUT_DIR = path.join(ROOT, 'output')
export const PORTALS = ['blog', 'xhs', 'wechat']

const DEFAULT_CONFIG = {
  port: 7788,
  author: '',
  cosmosDir: '../blog/cosmos',
  xhsBaseUrl: 'http://localhost:18060',
  xhsToken: '',
  vaultDir: '',
  wechatProfileDir: '.wechat-profile',
}

export const resolvePath = (p) => (!p ? '' : path.isAbsolute(p) ? p : path.resolve(ROOT, p))

export function loadConfig() {
  const file = path.join(ROOT, 'workbench.config.json')
  let user = {}
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      user = {}
    }
  }
  const c = { ...DEFAULT_CONFIG, ...user }
  if (process.env.WB_VAULT_DIR) c.vaultDir = process.env.WB_VAULT_DIR
  if (process.env.WB_COSMOS_DIR) c.cosmosDir = process.env.WB_COSMOS_DIR
  if (process.env.PORT) c.port = Number(process.env.PORT)
  return { ...c, cosmosDir: resolvePath(c.cosmosDir), vaultDir: resolvePath(c.vaultDir), wechatProfileDir: resolvePath(c.wechatProfileDir) }
}

// ---------- 内容索引：既有 vault 模式，也有本地目录模式 ----------
const readHead = (file, n = 2048) => {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(n)
    const len = fs.readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, len).toString('utf-8')
  } finally {
    fs.closeSync(fd)
  }
}

const isTrue = (v) => v === true || v === 'true' || v === 'yes'

function scanVault(vault) {
  const out = new Map()
  const walk = (dir, depth) => {
    if (depth > 5) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p, depth + 1)
        continue
      }
      if (!e.name.endsWith('.md')) continue
      let fm = {}
      try {
        fm = parseFrontmatter(readHead(p)).data || {}
      } catch {
        continue
      }
      if (!isTrue(fm.workbench)) continue
      const slug = String(fm.slug || e.name.replace(/\.md$/, ''))
      out.set(slug, { slug, sourcePath: p, dir: path.join(vault, '.workbench', slug), mode: 'vault' })
    }
  }
  walk(vault, 0)
  return out
}

function scanContent() {
  const out = new Map()
  if (!fs.existsSync(CONTENT_DIR)) return out
  for (const name of fs.readdirSync(CONTENT_DIR)) {
    const dir = path.join(CONTENT_DIR, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const source = path.join(dir, 'source.md')
    if (!fs.existsSync(source)) continue
    out.set(name, { slug: name, sourcePath: source, dir, mode: 'content' })
  }
  return out
}

let cache = { at: 0, key: '', map: new Map() }

export function index(force = false) {
  const cfg = loadConfig()
  const key = `${cfg.vaultDir}|${cfg.port}`
  if (!force && cache.map && cache.key === key && Date.now() - cache.at < 3000) return cache.map
  const useVault = cfg.vaultDir && fs.existsSync(cfg.vaultDir)
  const map = useVault ? scanVault(cfg.vaultDir) : scanContent()
  cache = { at: Date.now(), key, map }
  return map
}

export const slugList = () => [...index().keys()]

export function paths(slug) {
  const e = index().get(slug)
  if (!e) return null
  let assets
  if (e.mode === 'vault') {
    const noteDir = path.dirname(e.sourcePath)
    const sub = path.join(noteDir, 'assets')
    assets = fs.existsSync(sub) ? sub : noteDir
  } else {
    assets = path.join(e.dir, 'assets')
  }
  return { ...e, noteDir: path.dirname(e.sourcePath), assets, platforms: path.join(e.dir, 'platforms'), metaPath: path.join(e.dir, 'meta.json') }
}

export const contentDir = (slug) => paths(slug)?.dir || path.join(CONTENT_DIR, slug)

export const readSource = (slug) => {
  const p = paths(slug)
  return p && fs.existsSync(p.sourcePath) ? fs.readFileSync(p.sourcePath, 'utf-8') : null
}

export function readMeta(slug) {
  const p = paths(slug)
  if (!p) return null
  if (fs.existsSync(p.metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(p.metaPath, 'utf-8'))
    } catch {
      return null
    }
  }
  // vault 模式第一次进来：从 frontmatter 生成
  const raw = readSource(slug) || ''
  const fm = parseFrontmatter(raw).data || {}
  return {
    slug,
    title: fm.title || slug,
    description: fm.description || '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    category: fm.category || '',
    createdAt: new Date().toISOString(),
    platforms: {
      blog: { status: 'empty', lastPublishedHash: null },
      xhs: { status: 'empty', lastPublishedHash: null },
      wechat: { status: 'empty', lastPublishedHash: null },
    },
  }
}

export function writeMeta(slug, meta) {
  const p = paths(slug)
  if (!p) throw new Error(`没有 ${slug}`)
  fs.mkdirSync(p.dir, { recursive: true })
  fs.writeFileSync(p.metaPath, JSON.stringify(meta, null, 2) + '\n')
}

const draftName = (portal) => (portal === 'blog' ? 'blog.md' : portal === 'xhs' ? 'xhs.json' : 'wechat.html')

export function readDraft(slug, portal) {
  const p = paths(slug)
  if (!p) return null
  const file = path.join(p.platforms, draftName(portal))
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf-8')
  if (portal === 'xhs') {
    try {
      return { raw, json: JSON.parse(raw) }
    } catch {
      return { raw, json: null }
    }
  }
  return { raw }
}

export function writeDraft(slug, portal, text) {
  const p = paths(slug)
  if (!p) throw new Error(`没有 ${slug}`)
  fs.mkdirSync(p.platforms, { recursive: true })
  const file = path.join(p.platforms, draftName(portal))
  fs.writeFileSync(file, text)
  return file
}

/** 封面：assets/ 下的 cover.*，或笔记同目录的 cover.* 与「封面.*」，或 frontmatter 指定 */
export function findCover(slug) {
  const p = paths(slug)
  if (!p) return null
  const fm = parseFrontmatter(readSource(slug) || '').data || {}
  const named = [fm.cover, fm.image, fm.封面, 'cover.png', 'cover.jpg', 'cover.jpeg', '封面.png', '封面.jpg'].filter(Boolean)
  const dirs = [p.assets, p.noteDir]
  for (const name of named) {
    for (const d of dirs) {
      const f = path.isAbsolute(name) ? name : path.join(d, name)
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f
    }
  }
  return null
}

export const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

export function appendOutput(slug, portal, payload) {
  const dir = path.join(OUTPUT_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${portal}-${payload.hash || 'nohash'}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  return file
}

export function summarize(slug) {
  const meta = readMeta(slug)
  if (!meta) return null
  const platforms = {}
  for (const p of PORTALS) platforms[p] = { status: 'empty', ...(meta.platforms?.[p] || {}) }
  return {
    slug,
    title: meta.title || slug,
    description: meta.description || '',
    tags: meta.tags || [],
    category: meta.category || '',
    updatedAt: meta.updatedAt || meta.createdAt || null,
    hasCover: !!findCover(slug),
    platforms,
  }
}
