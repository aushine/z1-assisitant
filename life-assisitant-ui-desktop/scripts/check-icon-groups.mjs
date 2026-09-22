/**
 * 两端图标注册表 / 图标分组一致性校验（04 §6）
 *
 * 用法：`node scripts/check-icon-groups.mjs`（或 npm run check:icon-groups）
 *
 * 校验内容：
 *   1. 本端 `src/constants/icon-groups.ts` 的 ICON_GROUPS 序列化后算出 SHA256；
 *   2. 读取对端仓库（-mobile ↔ -desktop）同名文件，算 SHA256 并比对 —— 必须相同；
 *   3. ICON_GROUPS 的每个值都必须存在于本端 ICONS 注册表（否则用户选中即失联）；
 *   4. 两端 ICONS 名字集合与顺序必须逐字一致（04 §6 要求）。
 *
 * 退出码：0 = 全部通过；1 = 存在不一致（可用于 CI gate）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const peerName = basename(root).endsWith('-mobile')
  ? basename(root).replace(/-mobile$/, '-desktop')
  : basename(root).replace(/-desktop$/, '-mobile')
const peerRoot = resolve(root, '..', peerName)

const GROUPS_REL = 'src/constants/icon-groups.ts'
const NAMES_REL = 'src/components/icon/names.ts'

/** 取出 `marker` 之后第一个配平的 `{...}` 块 */
function readBlock(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`未找到标记：${marker}`)
  const start = src.indexOf('{', at)
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start + 1, i)
    }
  }
  throw new Error(`花括号不配平：${marker}`)
}

/** 解析 ICON_GROUPS → [ [组名, [图标名...]], ... ] */
function parseGroups(src) {
  const body = readBlock(src, 'export const ICON_GROUPS')
  const out = []
  const re = /'([^']+)'\s*:\s*\[([^\]]*)\]/g
  let m
  while ((m = re.exec(body)) !== null) {
    const key = m[1]
    const values = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
    out.push([key, values])
  }
  return out
}

/** 解析 ICONS → 有序名字数组 */
function parseIconNames(src) {
  const body = readBlock(src, 'export const ICONS')
  return body
    .split(',')
    .map((s) => s.replace(/\/\/.*$/gm, '').trim())
    .filter((s) => /^[A-Za-z][A-Za-z0-9]*$/.test(s))
}

/** 稳定序列化：组名与组内图标名按顺序拼接 */
function serialize(groups) {
  return groups.map(([k, v]) => `${k}\t${v.join(',')}`).join('\n')
}

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

function analyze(label, repoRoot) {
  const groupsPath = resolve(repoRoot, GROUPS_REL)
  const namesPath = resolve(repoRoot, NAMES_REL)
  if (!existsSync(groupsPath)) return { label, ok: false, err: `缺少 ${groupsPath}` }
  const groups = parseGroups(readFileSync(groupsPath, 'utf8'))
  const icons = parseIconNames(readFileSync(namesPath, 'utf8'))
  const iconSet = new Set(icons)
  const missing = []
  for (const [g, list] of groups) for (const n of list) if (!iconSet.has(n)) missing.push(`${g}: ${n}`)
  const st = serialize(groups)
  return {
    label,
    ok: true,
    repoRoot,
    groupCount: groups.length,
    iconCount: icons.length,
    totalEntries: groups.reduce((a, [, v]) => a + v.length, 0),
    missing,
    hash: sha(st),
    icons,
  }
}

const local = analyze('本端', root)
const peer = existsSync(peerRoot) ? analyze('对端', peerRoot) : { label: '对端', ok: false, err: `缺少对端仓库 ${peerRoot}` }

let failed = false
const fail = (msg) => {
  failed = true
  console.error(`✗ ${msg}`)
}
const pass = (msg) => console.log(`✓ ${msg}`)

for (const r of [local, peer]) {
  if (!r.ok) fail(`${r.label}：${r.err}`)
}

if (local.ok) {
  if (local.groupCount !== 14) fail(`本端分组数 = ${local.groupCount}（期望 14）`)
  if (local.missing.length) fail(`本端 ICON_GROUPS 引用了不在 ICONS 里的名字：\n    ${local.missing.join('\n    ')}`)
  pass(`本端 ICON_GROUPS：${local.groupCount} 组 / ${local.totalEntries} 条 / ICONS ${local.iconCount} 个`)
  console.log(`  SHA256(本端) = ${local.hash}`)
}

if (local.ok && peer.ok) {
  console.log(`  SHA256(对端) = ${peer.hash}`)
  if (local.hash === peer.hash) pass('两端 ICON_GROUPS SHA256 一致')
  else fail('两端 ICON_GROUPS SHA256 不一致（分组或图标名不逐字相同）')

  const sameIcons = local.icons.length === peer.icons.length && local.icons.every((n, i) => n === peer.icons[i])
  if (sameIcons) pass(`两端 ICONS 逐字一致（${local.icons.length} 个）`)
  else {
    const lset = new Set(local.icons)
    const pset = new Set(peer.icons)
    const onlyLocal = local.icons.filter((n) => !pset.has(n))
    const onlyPeer = peer.icons.filter((n) => !lset.has(n))
    fail(`两端 ICONS 不一致：本端 ${local.icons.length} / 对端 ${peer.icons.length}` +
      (onlyLocal.length ? `；仅本端有 ${onlyLocal.join(', ')}` : '') +
      (onlyPeer.length ? `；仅对端有 ${onlyPeer.join(', ')}` : ''))
  }
}

if (failed) {
  console.error('\n图标一致性校验失败')
  process.exit(1)
}
console.log('\n图标一致性校验通过')
