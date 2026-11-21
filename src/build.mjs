import path from 'node:path'
import { parseFrontmatter, parseBlocks, toWechatHtml, toXhs, toBlog } from './lib/markdown.mjs'
import { paths, readSource, readMeta, writeMeta, writeDraft, readDraft, sha, findCover } from './lib/store.mjs'

/** 把 source.md 派生成三份平台稿。补齐，不重刷已手改的稿。某端失败不影响其它端。 */
export function buildContent(slug, { rebuild = false } = {}) {
  const raw = readSource(slug)
  if (!raw) throw new Error(`找不到 ${slug} 的源文件`)
  const meta = readMeta(slug)
  if (!meta) throw new Error(`读不出 ${slug} 的 meta`)

  const { data: fm, body } = parseFrontmatter(raw)
  const blocks = parseBlocks(body)
  const cover = findCover(slug)

  const written = []
  const skipped = []
  const errors = []
  const failedPortals = new Set()
  const need = (portal) => rebuild || !readDraft(slug, portal)

  if (need('blog')) {
    writeDraft(slug, 'blog', toBlog(fm, body, meta))
    written.push('blog')
  } else skipped.push('blog')

  if (need('xhs')) {
    try {
      if (!cover) throw new Error('缺封面：在笔记目录放 cover.png，或用 frontmatter 的 cover 字段指定')
      const xhs = toXhs(blocks, { ...fm, ...meta })
      writeDraft(slug, 'xhs', JSON.stringify({ ...xhs, images: [cover] }, null, 2))
      written.push('xhs')
    } catch (e) {
      errors.push(`小红书：${e.message}`)
      failedPortals.add('xhs')
    }
  } else skipped.push('xhs')

  if (need('wechat')) {
    writeDraft(slug, 'wechat', toWechatHtml(blocks, { cover }))
    written.push('wechat')
  } else skipped.push('wechat')

  meta.platforms ??= {}
  for (const p of ['blog', 'xhs', 'wechat']) {
    meta.platforms[p] ??= { status: 'empty', lastPublishedHash: null }
    if (!failedPortals.has(p) && (meta.platforms[p].status === 'empty' || meta.platforms[p].status === 'failed')) {
      meta.platforms[p].status = 'ready'
    }
  }
  meta.updatedAt = new Date().toISOString()
  meta.sourceHash = sha(raw)
  writeMeta(slug, meta)

  return { slug, written, skipped, errors, hasCover: !!cover, sourceHash: meta.sourceHash, platforms: meta.platforms, dir: paths(slug)?.platforms }
}
