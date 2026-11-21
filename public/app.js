const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const PORTALS = [
  { id: 'blog', name: '博客', pfx: '博' },
  { id: 'xhs', name: '小红书', pfx: '红' },
  { id: 'wechat', name: '公众号', pfx: '公' },
]

const STATUS = {
  empty: '未生成',
  ready: '待发布',
  publishing: '发布中',
  published: '已发布',
  awaiting_confirm: '待人工发表',
  unknown: '待核实',
  failed: '失败',
}

const DOT = { published: 'var(--ok)', awaiting_confirm: 'var(--warn)', ready: 'var(--accent)', publishing: 'var(--wait)', failed: 'var(--danger)', unknown: 'var(--warn)' }

let state = null
let current = null
let busy = false

async function api(path, opts) {
  const res = await fetch(path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ---------- 列表 ----------
async function loadState() {
  state = await api('/api/state')
  renderList()
}

function renderList() {
  const list = $('#list')
  if (!state?.contents?.length) {
    list.innerHTML = '<div class="meta-line" style="padding:10px 12px">content/ 下还没有内容</div>'
    return
  }
  list.innerHTML = state.contents
    .map((c) => {
      const dots = PORTALS.map((p) => {
        const st = c.platforms[p.id]?.status || 'empty'
        return `<i style="background:${DOT[st] || 'var(--line)'}"></i>`
      }).join('')
      const active = current?.summary?.slug === c.slug ? ' active' : ''
      return `<button class="item${active}" data-slug="${esc(c.slug)}">
        <div class="t">${esc(c.title)}</div>
        <div class="s">${dots}<span>${esc(c.category || '未分类')}</span></div>
      </button>`
    })
    .join('')
}

// ---------- 详情 ----------
async function open(slug) {
  current = await api(`/api/content/${encodeURIComponent(slug)}`)
  renderDetail()
  renderList()
}

function previewFor(portal) {
  const d = current.drafts
  if (portal === 'blog') {
    if (!d.blog) return null
    return d.blog.replace(/^---[\s\S]*?---\n/, '').trim().slice(0, 380)
  }
  if (portal === 'xhs') {
    if (!d.xhs) return null
    try {
      const j = JSON.parse(d.xhs)
      return `【${j.title}】\n${j.content}\n\n${(j.tags || []).map((t) => `#${t}`).join(' ')}`.slice(0, 380)
    } catch {
      return d.xhs.slice(0, 380)
    }
  }
  if (!d.wechat) return null
  return d.wechat.replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 380)
}

function renderDetail() {
  const { summary, meta } = current
  $('#title').textContent = summary.title
  $('#desc').textContent = summary.description || '还没有描述'
  const seen = new Set()
  const chips = []
  for (const [t, hash] of [[summary.category, false], ...(summary.tags || []).map((x) => [x, true])]) {
    if (!t) continue
    const k = String(t).replace(/\s+/g, '').toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    chips.push(`<span>${hash ? '#' : ''}${esc(t)}</span>`)
  }
  $('#tags').innerHTML = chips.slice(0, 6).join('')

  $('#cards').innerHTML = PORTALS.map((p) => {
    const st = meta.platforms?.[p.id] || { status: 'empty' }
    const status = st.status || 'empty'
    const preview = previewFor(p.id)
    const hasDraft = !!preview
    const publishLabel = p.id === 'wechat' ? '建草稿' : '发布'

    const extra = []
    if (p.id === 'wechat' && st.editorUrl && status === 'awaiting_confirm')
      extra.push(`<a class="link" href="${esc(st.editorUrl)}" target="_blank" rel="noreferrer">打开草稿</a>`)
    if (p.id === 'wechat' && status === 'awaiting_confirm')
      extra.push(`<button class="sm" data-act="confirm" data-portal="wechat">已发表</button>`)
    if (st.url && status === 'published')
      extra.push(`<a class="link" href="${esc(st.url)}" target="_blank" rel="noreferrer">看线上</a>`)

    const metaBits = []
    if (st.appMsgId) metaBits.push(`appMsgId ${st.appMsgId}`)
    if (st.publishedAt) metaBits.push(new Date(st.publishedAt).toLocaleString('zh-CN', { hour12: false }))
    if (st.dirty) metaBits.push(`cosmos 有 ${st.dirty} 个未提交改动`)

    return `<article class="card" data-portal="${p.id}" data-status="${status}">
      <div class="card-top">
        <span class="pfx">${p.pfx}</span>
        <span class="name">${p.name}</span>
        <span class="badge ${status}">${STATUS[status] || status}</span>
      </div>
      <div class="preview ${preview ? '' : 'empty'}">${preview ? esc(preview) : '还没生成草稿'}</div>
      <div class="actions">
        <button data-act="build" data-portal="${p.id}">${hasDraft ? '重生成' : '生成'}</button>
        <button class="primary" data-act="publish" data-portal="${p.id}" ${hasDraft ? '' : 'disabled'}>${publishLabel}</button>
        ${extra.join('')}
      </div>
      ${metaBits.length ? `<div class="meta-line">${esc(metaBits.join(' · '))}</div>` : ''}
    </article>`
  }).join('')
}

// ---------- 动作 ----------
$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('.item')
  if (btn) open(btn.dataset.slug).catch((err) => setLogString(`✗ ${err.message}`))
})

$('#cards').addEventListener('click', async (e) => {
  const btn = e.target.closest('button')
  if (!btn || busy) return
  const portal = btn.dataset.portal
  const act = btn.dataset.act
  const slug = current.summary.slug

  if (act === 'build') {
    busy = true
    setLogString('生成中…')
    try {
      const r = await api(`/api/content/${encodeURIComponent(slug)}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rebuild: btn.textContent === '重生成' }),
      })
      setLogString(`生成 ${r.written.join(', ') || '（无变化）'}\n跳过 ${r.skipped.join(', ') || '（无）'}`)
      await open(slug)
    } catch (err) {
      setLogString(`✗ ${err.message}`)
    } finally {
      busy = false
    }
    return
  }

  if (act === 'confirm') {
    const url = prompt('发表后的文章链接（可留空）') ?? ''
    await api(`/api/confirm/${encodeURIComponent(slug)}/wechat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    await open(slug)
    return
  }

  if (act === 'publish') {
    const label = PORTALS.find((p) => p.id === portal).name
    if (!confirm(`确认把《${current.summary.title}》发到${label}？`)) return
    busy = true
    try {
      const { jobId } = await api(`/api/publish/${encodeURIComponent(slug)}/${portal}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      await poll(jobId)
    } catch (err) {
      setLogString(`✗ ${err.message}`)
    } finally {
      busy = false
    }
  }
})

async function poll(jobId) {
  for (;;) {
    const job = await api(`/api/job/${jobId}`)
    setLog(job)
    if (job.status === 'done' || job.status === 'failed') {
      await loadState()
      if (current) await open(current.summary.slug)
      return job
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
}

function setLog(job) {
  $('#jobstate').textContent = { queued: '排队中', running: '运行中', done: '完成', failed: '失败' }[job.status] || job.status
  $('#jobstate').className = `jobstate ${job.status}`
  const lines = [...job.logs]
  if (job.error) lines.push(`✗ ${job.error}`)
  setLogString(lines.join('\n') || '运行中…')
}

function setLogString(text) {
  const el = $('#logbody')
  el.textContent = text
  el.scrollTop = el.scrollHeight
}

// ---------- 连通性 ----------
$('#btn-health').addEventListener('click', async () => {
  const box = $('#health')
  box.innerHTML = '<div>检查中…</div>'
  try {
    const h = await api('/api/health')
    const rows = []
    if (h.xhs) {
      rows.push(h.xhs.ok
        ? `<div><span class="${h.xhs.loggedIn ? 'ok' : 'bad'}">${h.xhs.loggedIn ? '●' : '○'}</span>小红书 <b>${h.xhs.loggedIn ? esc(h.xhs.name || '已登录') : '未登录'}</b></div>`
        : `<div><span class="bad">●</span>小红书 <b>连不上</b></div>`)
    }
    rows.push(h.cosmos?.exists
      ? `<div><span class="ok">●</span>cosmos <b>${h.cosmos.dirty} 个未提交</b></div>`
      : `<div><span class="bad">●</span>cosmos <b>目录不在</b></div>`)
    if (h.wechat) {
      rows.push(h.wechat.loggedIn
        ? `<div><span class="ok">●</span>公众号 <b>${esc(h.wechat.name || '已登录')}</b></div>`
        : `<div><span class="bad">●</span>公众号 <b>未登录</b></div>`)
    } else {
      rows.push('<div><span style="color:var(--dimmer)">○</span>公众号 <b>未检查</b></div>')
    }
    box.innerHTML = rows.join('')
  } catch (err) {
    box.innerHTML = `<div><span class="bad">●</span>${esc(err.message)}</div>`
  }
})

// ---------- 启动 ----------
loadState()
  .then(() => {
    const first = state.contents?.[0]
    if (first) return open(first.slug)
  })
  .catch((err) => setLogString(`✗ ${err.message}`))
