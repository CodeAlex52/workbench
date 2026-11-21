import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, parseBlocks, toWechatHtml, toXhs, toBlog } from './lib/markdown.mjs'
import { contentDir, readSource, readMeta, writeMeta, writeDraft, sha } from './lib/store.mjs'

/** 把 source.md 派生成三份平台稿。补齐，不重刷已手改的稿。 */
export function buildContent(slug, { rebuild = false } = {}) {
  const raw = readSource(slug)
  if (!raw) throw new Error(`找不到 content/${slug}/source.md`)
  const meta = readMeta(slug)
  if (!meta) throw new Error(`找不到 content/${slug}/meta.json`)

  const { data: fm, body } = parseFrontmatter(raw)
  const blocks = parseBlocks(body)
  const coverAbs = path.join(contentDir(slug), 'assets', 'cover.png')
  const hasCover = fs.existsSync(coverAbs)

  const written = []
  const skipped = []

  // ---- 博客 ----
  const blogPath = path.join(contentDir(slug), 'platforms', 'blog.md')
  if (rebuild || !fs.existsSync(blogPath)) {
    writeDraft(slug, 'blog', toBlog(fm, body, meta))
    written.push('blog')
  } else skipped.push('blog')

  // ---- 小红书 ----
  const xhsPath = path.join(contentDir(slug), 'platforms', 'xhs.json')
  if (rebuild || !fs.existsSync(xhsPath)) {
    if (!hasCover) throw new Error('小红书需要封面：缺 content/' + slug + '/assets/cover.png')
    const xhs = toXhs(blocks, { ...fm, ...meta })
    writeDraft(slug, 'xhs', JSON.stringify({ ...xhs, images: ['assets/cover.png'] }, null, 2))
    written.push('xhs')
  } else skipped.push('xhs')

  // ---- 公众号 ----
  const wechatPath = path.join(contentDir(slug), 'platforms', 'wechat.html')
  if (rebuild || !fs.existsSync(wechatPath)) {
    writeDraft(slug, 'wechat', toWechatHtml(blocks, { cover: hasCover ? 'assets/cover.png' : null }))
    written.push('wechat')
  } else skipped.push('wechat')

  // ---- 状态 ----
  const now = new Date().toISOString()
  meta.platforms ??= {}
  for (const p of ['blog', 'xhs', 'wechat']) {
    meta.platforms[p] ??= { status: 'empty', lastPublishedHash: null }
    if (meta.platforms[p].status === 'empty' || meta.platforms[p].status === 'failed') {
      meta.platforms[p].status = 'ready'
    }
  }
  meta.updatedAt = now
  meta.sourceHash = sha(raw)
  writeMeta(slug, meta)

  return { slug, written, skipped, hasCover, sourceHash: meta.sourceHash, platforms: meta.platforms }
}
