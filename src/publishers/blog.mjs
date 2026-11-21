import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readDraft } from '../lib/store.mjs'

function run(cmd, args, cwd, log) {
  log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf-8', env: process.env, maxBuffer: 20 * 1024 * 1024 })
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (out) out.split('\n').slice(-40).forEach((l) => log(l))
  if (r.status !== 0) throw new Error(`${cmd} 退出码 ${r.status}：${out.split('\n').slice(-6).join(' | ')}`)
  return out
}

/** 写进 cosmos 仓库 → 构建 → 部署。不碰 git commit。 */
export async function publishBlog({ slug, config, log = () => {} }) {
  const draft = readDraft(slug, 'blog')
  if (!draft) throw new Error('还没有 blog.md，先点「生成」')

  const cosmos = config.cosmosDir
  if (!fs.existsSync(cosmos)) throw new Error(`cosmos 目录不存在：${cosmos}`)
  const target = path.join(cosmos, 'src', 'content', 'posts', `${slug}.md`)
  fs.mkdirSync(path.dirname(target), { recursive: true })

  const dirty = spawnSync('git', ['-C', cosmos, 'status', '--porcelain'], { encoding: 'utf-8' })
  const dirtyFiles = (dirty.stdout || '').trim().split('\n').filter(Boolean)
  if (dirtyFiles.length) log(`cosmos 工作树有 ${dirtyFiles.length} 个未提交改动，按当前工作树部署`)

  const existed = fs.existsSync(target)
  const before = existed ? fs.readFileSync(target, 'utf-8') : null
  if (before === draft.raw) log('cosmos 里内容已一致，跳过写入')
  else {
    fs.writeFileSync(target, draft.raw)
    log(`${existed ? '更新' : '新建'} ${path.relative(cosmos, target)}`)
  }

  run('npm', ['run', 'build'], cosmos, log)
  const out = run('npx', ['wrangler', 'deploy'], cosmos, log)
  const url = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0] || null
  return { target: path.relative(cosmos, target), url, dirty: dirtyFiles.length }
}
