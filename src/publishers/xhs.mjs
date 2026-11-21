import path from 'node:path'
import { readDraft, contentDir, sha } from '../lib/store.mjs'

const headers = (config) => {
  const h = { 'Content-Type': 'application/json' }
  if (config.xhsToken) h.Authorization = `Bearer ${config.xhsToken}`
  return h
}

async function call(config, method, p, body) {
  const url = config.xhsBaseUrl.replace(/\/$/, '') + p
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000)
  try {
    const res = await fetch(url, {
      method,
      headers: headers(config),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`小红书服务返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
    }
    if (!res.ok) throw new Error(`小红书服务 HTTP ${res.status}：${json.error || text.slice(0, 200)}`)
    return json
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('小红书发布超时（10 分钟）')
    if (/fetch failed|ECONNREFUSED/i.test(String(e.message))) {
      throw new Error(`连不上小红书服务 ${config.xhsBaseUrl}，先启动 xiaohongshu-mcp`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function checkXhs(config) {
  const health = await call(config, 'GET', '/health', null)
  const login = await call(config, 'GET', '/api/v1/login/status', null)
  const loggedIn = login?.data?.is_logged_in ?? login?.data?.logged_in ?? false
  const name = login?.data?.nickname || login?.data?.username || login?.data?.username_nickname || ''
  return { health, loggedIn, name }
}

/** 交给已跑通的小红书服务发布。内容哈希相同且已发布时拒绝重复，除非 force。 */
export async function publishXhs({ slug, meta, config, force = false, log = () => {} }) {
  const draft = readDraft(slug, 'xhs')
  if (!draft?.json) throw new Error('还没有 xhs.json，先点「生成」')
  const payload = draft.json
  const hash = sha(draft.raw)
  const st = meta.platforms?.xhs || {}

  if (!force && st.status !== 'failed' && st.lastPublishedHash === hash) {
    throw new Error('这篇小红书已经发过且内容没变。要重发请用「强制重发」')
  }
  if (!payload.images?.length) throw new Error('小红书必须有封面图')

  const { loggedIn } = await checkXhs(config)
  if (!loggedIn) throw new Error('小红书未登录，先在 18060 服务上扫码登录')

  const images = payload.images.map((p) => (path.isAbsolute(p) ? p : path.join(contentDir(slug), p)))
  log(`标题：${payload.title}`)
  log(`正文 ${payload.content.length} 字，${images.length} 张图，${payload.tags?.length || 0} 个话题`)

  const res = await call(config, 'POST', '/api/v1/publish', {
    title: payload.title,
    content: payload.content,
    images,
    tags: payload.tags || [],
  })
  if (res.success === false) throw new Error(res.error || '小红书返回失败')
  log(`发布完成${res.status ? '：' + res.status : ''}`)

  return { hash, result: res, noteUrl: res.note_url || res.data?.note_url || null }
}
