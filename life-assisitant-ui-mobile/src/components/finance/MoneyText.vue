<!--
  MoneyText —— 金额展示**单一出口**（spec-20260922-v2 · 03 §4 / D14）

  为什么收口成组件：格式化工具已有 5 个、展示点 16+ 处，逐点写 `if (masked)`
  ⇒ 未来任何新增金额展示点都会**漏遮**（无报错的静默泄漏）。
  遮罩判断只允许存在这一处；展示点一律 `<MoneyText :value="x" />`。

  遮罩态规格（03 §2.1，改这里=改隐私承诺）：
    - 文案 `¥ ••••`（固定 4 点，宽度稳定 ⇒ 切换不跳版）
    - 颜色**中性**（组件内盖 `--color-text-primary`）——残留红/绿会泄露「这是负数」
    - aria-label「金额已隐藏」：读屏**绝不**念真值；未遮时不设 label（避免重复读）
  ⚠️ 父级禁止给本组件根元素直接绑 `:style="{ color }"` —— 内联样式会盖过中性色
     造成正负泄漏；颜色请绑在**外层容器**上（继承会被组件内的遮罩类打败）。
  ⚠️ 刻意**不提供**默认插槽：插槽内容会绕过 `text` 计算直出真值 = 泄漏口。
     需要自定义格式（如「万」缩写）时，先把值换算成 number 再传 `:value`。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney } from '@/utils/date'
import { formatSignedAmount } from '@/utils/money'
import type { TransactionType } from '@/api/types'

const props = withDefaults(
  defineProps<{
    value: number
    /** 传入则带 +/− 前缀（收入 `+` / 支出 `−`(U+2212) / 转账无符号）；缺省 = 普通 ¥ */
    signed?: TransactionType | ''
    /** 取整（大额展示，如首页月度收支） */
    integer?: boolean
  }>(),
  { signed: '', integer: false }
)

const finance = useFinanceStore()

const text = computed(() => {
  if (finance.masked) return '¥ ••••'
  if (props.signed) return formatSignedAmount(props.value, props.signed)
  return `¥${formatMoney(props.value, props.integer)}`
})
</script>

<template>
  <span class="money-text" :class="{ 'is-masked': finance.masked }" :aria-label="finance.masked ? '金额已隐藏' : undefined">{{ text }}</span>
</template>

<style scoped lang="scss">
.money-text {
  font-variant-numeric: tabular-nums;
}
/* 遮罩态中性色：必须盖过任何继承来的红/绿（正负泄露红线） */
.money-text.is-masked {
  color: var(--color-text-primary);
}
</style>
