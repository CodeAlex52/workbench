import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const CONTENT_DIR = path.join(ROOT, 'content')
export const OUTPUT_DIR = path.join(ROOT, 'output')
export const PORTALS = ['blog', 'xhs', 'wechat']

const DEFAULT_CONFIG = {
  port: 7788,
  author: 'YourName',
  cosmosDir: '~/Desktop/vibecoding/blog/cosmos',
  xhsBaseUrl: 'http://localhost:18060',
  xhsToken: '',
}

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
  return { ...DEFAULT_CONFIG, ...user }
}

export const slugList = () =>
  fs.existsSync(CONTENT_DIR)
    ? fs.readdirSync(CONTENT_DIR).filter((d) => fs.statSync(path.join(CONTENT_DIR, d)).isDirectory())
    : []

export const contentDir = (slug) => path.join(CONTENT_DIR, slug)

export function readSource(slug) {
  const file = path.join(contentDir(slug), 'source.md')
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf-8')
}

export function readMeta(slug) {
  const file = path.join(contentDir(slug), 'meta.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

export function writeMeta(slug, meta) {
  fs.writeFileSync(path.join(contentDir(slug), 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
}

export function readDraft(slug, portal) {
  const file = path.join(contentDir(slug), 'platforms', portal === 'blog' ? 'blog.md' : portal === 'xhs' ? 'xhs.json' : 'wechat.html')
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
  const file = path.join(contentDir(slug), 'platforms', portal === 'blog' ? 'blog.md' : portal === 'xhs' ? 'xhs.json' : 'wechat.html')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

export const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16)

export function appendOutput(slug, portal, payload) {
  const dir = path.join(OUTPUT_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${portal}-${payload.hash || 'nohash'}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  return file
}

/** 列表页要的东西：标题 + 三端状态 + 有无封面 */
export function summarize(slug) {
  const meta = readMeta(slug)
  if (!meta) return null
  const platforms = {}
  for (const p of PORTALS) {
    platforms[p] = { status: 'empty', ...(meta.platforms?.[p] || {}) }
  }
  return {
    slug,
    title: meta.title || slug,
    description: meta.description || '',
    tags: meta.tags || [],
    category: meta.category || '',
    updatedAt: meta.updatedAt || meta.createdAt || null,
    hasCover: fs.existsSync(path.join(contentDir(slug), 'assets', 'cover.png')),
    platforms,
  }
}
