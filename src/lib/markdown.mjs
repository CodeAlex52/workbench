// 极简 Markdown 解析：只覆盖我们内容里真实出现的语法，不做通用实现。
// 支持：frontmatter（--- ... ---）、h1-h3、段落、无序列表、引用、粗体、行内代码。

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: text }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    let value = raw.trim()
    if (/^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    } else if (/^["'].*["']$/.test(value)) {
      value = value.slice(1, -1)
    } else if (value === 'true' || value === 'false') {
      value = value === 'true'
    }
    data[key] = value
  }
  return { data, body: m[2] }
}

/** 把正文切成块。返回 [{type, text, items?}] */
export function parseBlocks(body) {
  const blocks = []
  const lines = body.split(/\r?\n/)
  let buf = []
  let list = null

  const flushParagraph = () => {
    const text = buf.join(' ').trim()
    if (text) blocks.push({ type: 'p', text })
    buf = []
  }
  const flushList = () => {
    if (list && list.length) blocks.push({ type: 'ul', items: list })
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flushParagraph()
      flushList()
      blocks.push({ type: `h${h[1].length}`, text: h[2].trim() })
      continue
    }
    const li = line.match(/^[-*]\s+(.*)$/)
    if (li) {
      flushParagraph()
      if (!list) list = []
      list.push(li[1].trim())
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'quote', text: quote[1].trim() })
      continue
    }
    flushList()
    buf.push(line.trim())
  }
  flushParagraph()
  flushList()
  return blocks
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')

/**
 * 公众号 HTML。
 * 红线（来自 wechat-mp-mcp-server 的 lint）：不能有 <ul>/<li>（编辑器不渲染），
 * 不能有裸 <br>（换行会丢），非微信域名 <a> 必须降级成纯文本。
 */
export function toWechatHtml(blocks, { cover } = {}) {
  const p = (html) => `<p style="margin:0 0 16px;line-height:1.75;font-size:16px;color:#333;">${html}</p>`
  const parts = []
  if (cover) parts.push(`<p style="margin:0 0 20px;"><img src="${esc(cover)}" style="width:100%;display:block;border-radius:6px;"></p>`)
  for (const b of blocks) {
    if (b.type === 'h1' || b.type === 'h2') {
      parts.push(`<h2 style="font-size:18px;font-weight:600;margin:30px 0 14px;padding-left:10px;border-left:3px solid #333;line-height:1.5;">${inline(b.text)}</h2>`)
    } else if (b.type === 'h3') {
      parts.push(`<h3 style="font-size:16px;font-weight:600;margin:24px 0 12px;line-height:1.5;">${inline(b.text)}</h3>`)
    } else if (b.type === 'ul') {
      for (const item of b.items) parts.push(p(`• ${inline(item)}`))
    } else if (b.type === 'quote') {
      parts.push(`<p style="margin:0 0 16px;padding:12px 14px;background:#f6f6f6;border-left:3px solid #ccc;line-height:1.75;font-size:15px;color:#555;">${inline(b.text)}</p>`)
    } else {
      parts.push(p(inline(b.text)))
    }
  }
  return parts.join('\n')
}

/** 小红书：纯文本，标题 ≤20 字，正文 ≤1000 字，tags ≤5 */
export function toXhs(blocks, meta) {
  const title = String(meta.title || '').slice(0, 20)
  const lines = []
  for (const b of blocks) {
    if (b.type === 'h1' || b.type === 'h2') {
      lines.push(`【${b.text}】`)
    } else if (b.type === 'h3') {
      lines.push(b.text)
    } else if (b.type === 'ul') {
      for (const item of b.items) lines.push(`· ${item}`)
    } else if (b.type === 'quote') {
      lines.push(`「${b.text}」`)
    } else {
      lines.push(b.text)
    }
  }
  let content = lines.join('\n\n').replace(/\*\*|`/g, '')
  if (content.length > 1000) content = content.slice(0, 997) + '…'
  const rawTags = Array.isArray(meta.tags) ? meta.tags : []
  const seen = new Set()
  const tags = [...rawTags, meta.category]
    .filter(Boolean)
    .filter((t) => {
      const k = String(t).replace(/\s+/g, '').toLowerCase()
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 5)
  return { title, content, tags }
}

/** 博客：直接把 frontmatter + 正文原样交给 cosmos，只统一 slug 与标题 */
export function toBlog(frontmatter, body, meta) {
  const fm = { ...frontmatter }
  delete fm.workbench
  delete fm.cover
  fm.title = meta.title || fm.title
  fm.slug = meta.slug
  fm.description = fm.description || meta.description || ''
  const head = Object.entries(fm)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`))
    .join('\n')
  return `---\n${head}\n---\n${body.replace(/^\n+/, '\n')}`
}
