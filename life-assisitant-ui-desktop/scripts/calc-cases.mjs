// 金额表达式 13 条用例表（02 §3，两端共用同一张表）
// 运行：node scripts/calc-cases.mjs
// 做法：用工程内 esbuild 把 src/utils/calc.ts 打成 ESM 临时文件再 import，
//       保证测的是「真源码」而不是复制品。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'

const tmp = mkdtempSync(join(tmpdir(), 'calc-cases-'))
const outfile = join(tmp, 'calc.mjs')
await build({
  entryPoints: [join(root, 'src/utils/calc.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  logLevel: 'silent',
})
const { evalAmountExpr, centsToAmount } = await import(pathToFileURL(outfile).href)

/** [输入, 期望有效, 期望金额(元字符串), 期望 rounded]
 *  ⚠️ `199÷3`：02 §3 原文写 63.33 是笔误（真值 199/3 = 66.333… → 舍入 66.33）；
 *     与移动端已对齐为 66.33（见仓库根 _calc_out.txt 移动端跑表输出）。 */
const CASES = [
  ['199÷3', true, '66.33', true],
  ['3×63.33', true, '189.99', false],
  ['0.1+0.2', true, '0.30', false],
  ['1+2×3', true, '9.00', false],
  ['100−30+5', true, '75.00', false],
  ['199+', true, '199.00', false],
  ['.5', true, '0.50', false],
  ['1.2.3', true, '1.23', false],
  ['007', true, '7.00', false],
  ['199999999.99+1', false, null, null],
  ['1÷0', false, null, null],
  ['199.999', true, '200.00', true],
  ['63.33', true, '63.33', false],
]

let pass = 0
let fail = 0
const rows = []
for (const [input, wantValid, wantAmt, wantRounded] of CASES) {
  const r = evalAmountExpr(input)
  const amt = r.valid ? centsToAmount(r.cents) : null
  const ok = r.valid === wantValid && amt === wantAmt && (!wantValid || r.rounded === wantRounded)
  if (ok) pass++
  else fail++
  rows.push(
    `${ok ? 'PASS' : 'FAIL'}  ${input.padEnd(18)} → valid=${r.valid} amount=${amt ?? '—'} rounded=${r.rounded}` +
      (ok ? '' : `  (期望 valid=${wantValid} amount=${wantAmt ?? '—'} rounded=${wantRounded ?? '—'})`)
  )
}

console.log('=== 金额表达式 13 条用例（02 §3）===')
console.log(rows.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)

rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
