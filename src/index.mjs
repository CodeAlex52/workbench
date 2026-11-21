#!/usr/bin/env node
import { buildContent } from './build.mjs'
import { slugList, readMeta, writeMeta, contentDir } from './lib/store.mjs'
import fs from 'node:fs'
import path from 'node:path'

const [cmd, ...args] = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const positional = args.filter((a) => !a.startsWith('--'))

if (cmd === 'serve') {
  await import('./server.mjs')
} else if (cmd === 'build') {
  const slugs = positional.length ? positional : slugList()
  for (const slug of slugs) {
    const r = buildContent(slug, { rebuild: flag('rebuild') })
    console.log(`${slug}: 生成 ${r.written.join(',') || '无'} · 跳过 ${r.skipped.join(',') || '无'} · 封面 ${r.hasCover ? '有' : '无'}`)
    for (const e of r.errors || []) console.log(`  ! ${e}`)
  }
} else if (cmd === 'new') {
  const slug = positional[0]
  if (!slug) {
    console.error('用法：wb new <slug> --from <file>')
    process.exit(1)
  }
  const fromIdx = args.indexOf('--from')
  const src = fromIdx >= 0 ? args[fromIdx + 1] : null
  const dir = contentDir(slug)
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'platforms'), { recursive: true })
  if (src && fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dir, 'source.md'))
  } else {
    fs.writeFileSync(path.join(dir, 'source.md'), `---\ntitle: ${slug}\npublished: ${new Date().toISOString().slice(0, 10)}\ndescription: \ntags: []\ncategory: \n---\n\n# ${slug}\n\n`)
  }
  const meta = {
    slug,
    title: slug,
    description: '',
    tags: [],
    category: '',
    createdAt: new Date().toISOString(),
    platforms: {
      blog: { status: 'empty', lastPublishedHash: null },
      xhs: { status: 'empty', lastPublishedHash: null },
      wechat: { status: 'empty', lastPublishedHash: null },
    },
  }
  writeMeta(slug, meta)
  console.log(`已建 content/${slug}/，把封面放到 content/${slug}/assets/cover.png`)
} else {
  console.log(`用法：
  node src/index.mjs serve              起面板（默认 http://127.0.0.1:7788）
  node src/index.mjs build <slug>       手动生成三端稿
  node src/index.mjs new <slug> --from <file>`)
}
