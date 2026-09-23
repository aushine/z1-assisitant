/**
 * MoneyText —— 金额展示**单一出口**（桌面端 · spec-20260922-v2 · 03 §4 / D14）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/finance/MoneyText.vue
 * （同一契约：遮罩文案 / 中性色 / aria-label；两端遮罩开关共享 `ls:finance:masked`）
 *
 * 为什么收口成组件：格式化工具已有 5 个、展示点 16+ 处，逐点写 `if (masked)`
 * ⇒ 未来任何新增金额展示点都会**漏遮**（无报错的静默泄漏）。
 * 遮罩判断只允许存在这一处；展示点一律 `<MoneyText value={x} />`。
 *
 * 遮罩态规格（03 §2.1，改这里 = 改隐私承诺）：
 *   - 文案 `¥ ••••`（固定 4 点，宽度稳定 ⇒ 切换不跳版）
 *   - 颜色**中性**（盖 `--color-text-primary`）——残留红/绿会泄露「这是负数」
 *   - aria-label「金额已隐藏」：读屏**绝不**念真值；未遮时不设 label（避免重复读）
 * ⚠️ 父级禁止把 color 直接写在 <MoneyText> 上（本组件遮罩态自带内联中性色会**覆盖**掉
 *    父级传下来的同层级内联色 —— 这是刻意的，但会让父级以为配色失效）；颜色请写在
 *    **外层容器**上，靠继承传递，遮罩态再被本组件覆盖。
 */
import { useFinanceStore } from '@/stores/finance'
import { formatAmountPlain, formatSignedAmount, type MoneyType } from '@/utils/money'

/** 取整展示（大额 KPI；与移动端 formatMoney(v, true) 同形状） */
function formatInteger(amount: number): string {
  return `¥ ${amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}

export function MoneyText({
  value,
  signed = '',
  integer = false,
}: {
  value: number
  /** 传入则带 +/− 前缀（收入 `+ ¥` / 支出 `− ¥`(U+2212) / 转账无符号）；缺省 = 普通 `¥ 12.34` */
  signed?: MoneyType | ''
  /** 取整（桌面无小数位场景，如首页 KPI） */
  integer?: boolean
}) {
  // ⚠️ 逐字段 selector：整个 store 订阅会让每次 fetch 都重渲染所有金额
  const masked = useFinanceStore((s) => s.masked)

  const text = masked
    ? '¥ ••••'
    : signed
      ? formatSignedAmount(value, signed)
      : integer
        ? formatInteger(value)
        : formatAmountPlain(value)

  return (
    <span
      style={{
        // 遮罩态中性色：内联样式是唯一能盖过父级内联色 + class 的手段（无 !important 需求）
        color: masked ? 'var(--color-text-primary)' : undefined,
        fontVariantNumeric: 'tabular-nums',
      }}
      aria-label={masked ? '金额已隐藏' : undefined}
    >
      {text}
    </span>
  )
}

export default MoneyText
