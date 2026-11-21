// 公众号：走后台网页会话（cookie + token），不碰官方 API，因此不需要 AppSecret，
// 也不需要出口 IP 白名单。图片走 filetransfer 换 mmbiz 图床。
// 接口形态与字段名来自 xihe-lab/wechat-mcp-mcp-server（Apache-2.0）的互操作性调研，已实测通过。
import fs from 'node:fs'
import path from 'node:path'

const MP = 'https://mp.weixin.qq.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const RET_MESSAGES = {
  '-6': '需要输入验证码，请手动打开公众号后台编辑器完成验证后重试',
  '-8': '需要输入验证码，请手动打开公众号后台编辑器完成验证后重试',
  '-1': '系统错误，请注意备份内容后重试',
  '-2': '参数错误，请注意备份内容后重试',
  '-5': '服务错误，请注意备份内容后重试',
  '-99': '内容超出字数限制（去标签正文 ≤2 万字）',
  '-206': '服务负荷过大，请稍后重试',
  '200003': '登录态超时，请重新扫码登录',
  '412': '图文中含非法外链',
  '62752': '可能含有具备安全风险的链接',
  '64507': '内容不能包含外部链接（非微信域名的 <a> 需降级为纯文本）',
  '64562': '请勿插入非微信域名的链接',
  '64702': '标题超出 64 字',
  '64703': '摘要超出 120 字',
  '64705': '内容超出字数限制（去标签正文 ≤2 万字）',
  '10806': '正文不能有违规内容',
  '220001': '素材管理存储数量已达上限',
  '220002': '图片库已达存储上限',
}

let context = null
let launching = null

export async function getContext(profileDir) {
  if (context) return context
  if (launching) return launching
  launching = (async () => {
    const { chromium } = await import('playwright-core')
    fs.mkdirSync(profileDir, { recursive: true })
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        channel: process.env.WECHAT_BROWSER_CHANNEL || 'chrome',
        headless: process.env.WECHAT_HEADLESS === 'true',
        viewport: { width: 1280, height: 900 },
        args: ['--disable-blink-features=AutomationControlled'],
      })
      return context
    } catch (e) {
      const msg = String(e?.message || e)
      if (/channel|chrome|browserType/i.test(msg)) {
        throw new Error(`无法启动 Chrome：${msg}。请确认本机装了 Google Chrome，或用 WECHAT_BROWSER_CHANNEL 指定 msedge`)
      }
      throw new Error(`浏览器启动失败：${msg}`)
    } finally {
      launching = null
    }
  })()
  return launching
}

export async function closeContext() {
  if (context) {
    await context.close().catch(() => {})
    context = null
  }
}

export function extractMeta(html) {
  const token = html.match(/\bt:\s*["']([^"']+)["']\s*\|\|/)?.[1]
  if (!token) return null
  return {
    token,
    ticket: html.match(/ticket:\s*["']([^"']+)["']/)?.[1] || '',
    userName: html.match(/user_name:\s*["']([^"']+)["']/)?.[1] || '',
    nickName: html.match(/nick_name:\s*["']([^"']+)["']/)?.[1] || '',
    svrTime: Number(html.match(/time:\s*["'](\d+)["']/)?.[1] || Math.floor(Date.now() / 1000)),
  }
}

export async function getMeta(profileDir) {
  const ctx = await getContext(profileDir)
  const resp = await ctx.request.get(MP + '/', { maxRedirects: 5, headers: { 'User-Agent': UA } })
  return extractMeta(await resp.text())
}

const headers = (meta) => ({
  Origin: MP,
  Referer: `${MP}/cgi-bin/home?t=home/lang=zh_CN&token=${meta?.token || ''}`,
  'User-Agent': UA,
})

export async function uploadImage(profileDir, filePath) {
  const ctx = await getContext(profileDir)
  const meta = await getMeta(profileDir)
  if (!meta) throw new Error('NEED_LOGIN: 公众号后台未登录')
  const stat = fs.statSync(filePath)
  if (stat.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB')
  const name = path.basename(filePath)
  const mime = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  const seq = Date.now()
  const url =
    `${MP}/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1` +
    `&ticket_id=${encodeURIComponent(meta.userName)}&ticket=${encodeURIComponent(meta.ticket)}&svr_time=${meta.svrTime}` +
    `&token=${encodeURIComponent(meta.token)}&lang=zh_CN&seq=${seq}&t=${Math.random()}`
  const resp = await ctx.request.post(url, {
    headers: headers(meta),
    multipart: {
      type: mime,
      id: String(seq),
      name,
      lastModifiedDate: new Date().toString(),
      size: String(stat.size),
      file: { name, mimeType: mime, buffer: fs.readFileSync(filePath) },
    },
    maxRedirects: 0,
  })
  const text = await resp.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`filetransfer 返回非 JSON（HTTP ${resp.status()}）：${text.slice(0, 160)}`)
  }
  const cdn = json.cdn_url
  const err = json.base_resp?.err_msg
  if (!cdn || (err && err !== 'ok')) throw new Error(`图片上传失败：${err || text.slice(0, 160)}`)
  return cdn
}

function buildForm(meta, p) {
  const f = new URLSearchParams()
  const set = (k, v) => f.set(k, v ?? '')
  set('token', meta.token)
  set('lang', 'zh_CN')
  set('f', 'json')
  set('ajax', '1')
  set('random', String(Math.random()))
  set('AppMsgId', '')
  set('count', '1')
  set('data_seq', '0')
  set('operate_from', 'Chrome')
  set('isnew', '0')
  set('ad_video_transition0', '')
  set('can_reward0', '0')
  set('related_video0', '')
  set('is_video_recommend0', '-1')
  set('title0', p.title)
  set('author0', p.author)
  set('writerid0', '0')
  set('fileid0', '')
  set('digest0', p.digest)
  set('auto_gen_digest0', p.digest ? '0' : '1')
  set('content0', p.content)
  set('sourceurl0', p.sourceUrl)
  set('need_open_comment0', '1')
  set('only_fans_can_comment0', '0')
  for (const k of ['cdn_url0', 'cdn_235_1_url0', 'cdn_1_1_url0', 'cdn_url_back0', 'crop_list0', 'music_id0', 'video_id0', 'voteid0', 'voteismlt0', 'supervoteid0', 'cardid0', 'cardquantity0', 'cardlimit0', 'vid_type0', 'shortvideofileid0', 'releasefirst0', 'platform0', 'reprint_permit_type0', 'allow_reprint0', 'allow_reprint_modify0', 'original_article_type0', 'ori_white_list0', 'free_content0', 'ad_id0', 'guide_words0', 'share_copyright_url0', 'source_article_type0', 'reprint_recommend_title0', 'reprint_recommend_content0', 'share_video_id0', 'share_voice_id0', 'insert_ad_mode0']) set(k, '')
  set('show_cover_pic0', p.showCoverPic ? '1' : '0')
  set('copyright_type0', '0')
  set('fee0', '0')
  set('is_share_copyright0', '0')
  set('share_page_type0', '0')
  set('share_imageinfo0', '{"list":[]}')
  set('dot0', '{}')
  set('categories_list0', '[]')
  return f
}

export async function createDraft(profileDir, payload) {
  const ctx = await getContext(profileDir)
  const meta = await getMeta(profileDir)
  if (!meta) throw new Error('NEED_LOGIN: 公众号后台未登录')
  const form = buildForm(meta, payload)
  const url = `${MP}/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${meta.token}&lang=zh_CN`
  const resp = await ctx.request.post(url, {
    headers: { ...headers(meta), 'Content-Type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
    maxRedirects: 0,
  })
  const text = await resp.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`operate_appmsg 返回非 JSON（HTTP ${resp.status()}）：${text.slice(0, 160)}`)
  }
  const ret = json.ret ?? json.base_resp?.ret
  if (typeof ret === 'number' && ret !== 0) {
    const hint = RET_MESSAGES[String(ret)] || `错误码 ${ret}`
    throw new Error(`创建草稿失败：${hint}`)
  }
  const appMsgId = String(json.appMsgId ?? json.AppMsgId ?? '')
  if (!appMsgId) throw new Error(`创建草稿未返回 appMsgId：${text.slice(0, 200)}`)
  return { appMsgId, editorUrl: editorUrl(appMsgId, meta.token), nickName: meta.nickName }
}

export const editorUrl = (appMsgId, token) =>
  `${MP}/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${appMsgId}&token=${token}&lang=zh_CN`

/** 正文里的本地图片先换图床，再建草稿 */
export async function inlineImages(profileDir, html, baseDir, log = () => {}) {
  const srcs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
  const local = [...new Set(srcs.filter((s) => !/^(https?:|data:)/i.test(s) && !/mmbiz\.(qpic|qlogo)\.cn/i.test(s)))]
  let out = html
  for (const src of local) {
    const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src)
    if (!fs.existsSync(abs)) {
      log(`图片不存在，跳过：${src}`)
      continue
    }
    const url = await uploadImage(profileDir, abs)
    out = out.split(src).join(url)
    log(`已上图床：${path.basename(abs)}`)
  }
  return out
}
