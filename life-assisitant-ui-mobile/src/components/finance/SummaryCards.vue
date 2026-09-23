<!--
  流水页顶部数据块（spec-20260922-v2 · 01 §2）

  两卡各两面（块主体点击翻面，副行永远显示另一面 ⇒ 不点击也能看到两个数）：
    左块：本月收入 ⇄ 本月支出
    右块：剩余预算 ⇄ 月结余（标题里的周期字「月/周/年」= 独立热区，点击 月→周→年 循环）

  四个数**全部来自服务端** GET /finance/summary（修 S2「按已加载记录统计」、S3「预算混算」）。
  周期与两态存 localStorage（`constants/finance.ts` 三把 key，D10/D11），两端同源。

  边界态（01 §2.8，逐条对应模板分支）：
    - 加载中 / 首次未有数据 → 骨架块（--color-bg-hover 占位，无 spinner、无副行）
    - 请求失败 → 主值 `—` + 副行「加载失败 · 点击重试」，**不弹 toast**
    - 无 scope=total 预算 → 预算面主值 `—` + 副行「未设预算 · 去设置 ›」（emit goto-budget），**不显示 ¥0**
    - 结余为负 → danger；收入 success / 支出 danger（记账惯例，utils/money.ts 同一套符号）
-->
<template>
  <div class="summary-cards">
    <!-- ==================== 左块：收入 ⇄ 支出 ==================== -->
    <div class="sum-card" @click="onLeftBody">
      <template v-if="phase === 'data'">
        <div class="sum-title">
          <span>{{ periodPrefix }}{{ leftFace === 'income' ? '收入' : '支出' }}</span>
          <!-- R6：原用 van-icon name="replay"（环箭，视觉像刷新）→ 改 ArrowLeftRight（双向箭头，表意“切换”） -->
          <Icon name="ArrowLeftRight" :size="14" class="sum-flip" />
        </div>
        <!-- 正负色 class 挂**父容器**（继承）；MoneyText 遮罩态的中性色会盖过继承
             ⇒ 遮罩时不泄露「这是负数」。切勿把 color 直接绑到 MoneyText 上。 -->
        <div class="sum-main" :class="leftFace === 'income' ? 'is-up' : 'is-down'">
          <MoneyText :value="leftMainValue" :signed="leftFace" />
        </div>
        <div class="sum-sub">{{ leftFace === 'income' ? '支出 ' : '收入 ' }}<MoneyText :value="leftSubValue" /></div>
      </template>
      <div v-else-if="phase === 'error'" class="sum-fill">
        <div class="sum-title"><span>数据</span></div>
        <div class="sum-main">—</div>
        <div class="sum-sub">加载失败 · 点击重试</div>
      </div>
      <div v-else class="sum-fill sk-wrap">
        <span class="sk sk-title" /><span class="sk sk-main" />
      </div>
    </div>

    <!-- ==================== 右块：剩余预算 ⇄ 月结余 ==================== -->
    <div class="sum-card" @click="onRightBody">
      <template v-if="phase === 'data'">
        <div class="sum-title">
          <template v-if="store.summaryCardRight === 'budget'">
            <span>剩余预算 ·</span>
            <span class="sum-period" @click.stop="store.cycleSummaryPeriod()">{{ periodShort }}</span>
          </template>
          <template v-else>
            <span class="sum-period" @click.stop="store.cycleSummaryPeriod()">{{ periodShort }}</span>
            <span>结余</span>
          </template>
          <!-- R6：replay → ArrowLeftRight（同左卡） -->
          <Icon name="ArrowLeftRight" :size="14" class="sum-flip" />
        </div>
        <div class="sum-main" :class="rightMainClass">
          <template v-if="rightMainValue === null">—</template>
          <MoneyText v-else :value="rightMainValue" :signed="rightSigned" />
        </div>
        <div
          class="sum-sub"
          :class="{ 'is-action': rightSubAction }"
          @click.stop="rightSubAction ? emit('goto-budget') : undefined"
        >
          <template v-if="rightSubValue === null">{{ rightSubText }}</template>
          <template v-else>{{ rightSubPrefix }}<MoneyText :value="rightSubValue" /></template>
        </div>
      </template>
      <div v-else-if="phase === 'error'" class="sum-fill">
        <div class="sum-title">
          <span>数据 ·</span>
          <span class="sum-period" @click.stop="store.cycleSummaryPeriod()">{{ periodShort }}</span>
        </div>
        <div class="sum-main">—</div>
        <div class="sum-sub">加载失败 · 点击重试</div>
      </div>
      <div v-else class="sum-fill sk-wrap">
        <span class="sk sk-title" /><span class="sk sk-main" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import MoneyText from '@/components/finance/MoneyText.vue'
import Icon from '@/components/icon/Icon.vue'

const emit = defineEmits<{ (e: 'goto-budget'): void }>()

const store = useFinanceStore()

/** 进视图就拉一次（数字常新；翻面/切周期的刷新由 store 动作自己触发） */
onMounted(() => {
  void store.fetchSummary()
})

/* ==================== 三态：骨架 / 错误 / 数据（01 §2.8） ==================== */
const phase = computed<'skeleton' | 'error' | 'data'>(() => {
  if (store.summaryLoading || !store.summary) return store.summaryError ? 'error' : 'skeleton'
  return 'data'
})

/* ==================== 周期文案 ==================== */
const periodShort = computed(() =>
  store.summaryPeriod === 'week' ? '周' : store.summaryPeriod === 'year' ? '年' : '月'
)
const periodPrefix = computed(() => `今${periodShort.value}`)

/* ==================== 左块 ==================== */
/** 当前面：income = 收入面 / expense = 支出面 */
const leftFace = computed<'income' | 'expense'>(() =>
  store.summaryCardLeft === 'income' ? 'income' : 'expense'
)
/** 主值（绝对值真值；+¥绿 / −¥红 由 MoneyText 的 signed 负责，遮罩态自动中性化） */
const leftMainValue = computed(() => {
  const s = store.summary
  if (!s) return 0
  return leftFace.value === 'income' ? s.income : s.expense
})
/** 副行 = 另一面（不点击也两数可见；一律无符号 ¥，主值才带符号） */
const leftSubValue = computed(() => {
  const s = store.summary
  if (!s) return 0
  return leftFace.value === 'income' ? s.expense : s.income
})

/* ==================== 右块 ==================== */
/** 主值：null = 无 total 预算（渲染 `—`，不显示 ¥0，Q3）；一律取绝对值 */
const rightMainValue = computed<number | null>(() => {
  const s = store.summary
  if (!s) return null
  if (store.summaryCardRight === 'budget') {
    return s.budget.count === 0 ? null : Math.abs(s.budget.remaining)
  }
  return Math.abs(s.net)
})
/** 主值符号：预算面只在负数带 −；结余面正 + / 负 −（U+2212，与 utils/money.ts 同约定） */
const rightSigned = computed<'' | 'income' | 'expense'>(() => {
  const s = store.summary
  if (!s) return ''
  if (store.summaryCardRight === 'budget') {
    return s.budget.count > 0 && s.budget.remaining < 0 ? 'expense' : ''
  }
  return s.net >= 0 ? 'income' : 'expense'
})
const rightMainClass = computed(() => {
  const s = store.summary
  if (!s) return ''
  if (store.summaryCardRight === 'budget') {
    return s.budget.count > 0 && s.budget.remaining < 0 ? 'is-down' : ''
  }
  return s.net >= 0 ? 'is-up' : 'is-down'
})
const rightSubAction = computed(() => {
  const s = store.summary
  return store.summaryCardRight === 'budget' && !!s && s.budget.count === 0
})
/** 副行带数字时的前缀（值走 MoneyText） */
const rightSubPrefix = computed(() =>
  store.summaryCardRight === 'budget' ? `${periodShort.value}结余 ` : '剩余预算 '
)
/** 副行数值：null = 副行不是数字（动作文案或 `—`） */
const rightSubValue = computed<number | null>(() => {
  const s = store.summary
  if (!s) return null
  if (store.summaryCardRight === 'budget') return s.budget.count === 0 ? null : s.net
  return s.budget.count === 0 ? null : s.budget.remaining
})
/** 副行纯文案（仅 rightSubValue === null 时渲染） */
const rightSubText = computed(() => {
  if (rightSubValue.value !== null) return ''
  return store.summaryCardRight === 'budget' ? '未设预算 · 去设置 ›' : '剩余预算 —'
})

/* ==================== 热区（01 §2.2） ==================== */
/** 失败态下点块体 = 重试，而不是翻面（重试成功自然回到数据态） */
function onLeftBody() {
  if (phase.value === 'error') {
    void store.fetchSummary()
    return
  }
  if (phase.value === 'data') store.flipSummaryCardLeft()
}
function onRightBody() {
  if (phase.value === 'error') {
    void store.fetchSummary()
    return
  }
  if (phase.value === 'data') store.flipSummaryCardRight()
}
</script>

<style scoped lang="scss">
/* 两卡等高 ≈76px（标题16 + 主值26 + 副行16 + 上下 padding 9×2），间距 8px（01 §2.6） */
.summary-cards {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.sum-card {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 76px;
  padding: 9px 12px;
  border-radius: 12px;
  background: var(--color-bg-card);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
  transition: background 0.15s;

  &:active {
    background: var(--color-bg-hover);
  }
}

.sum-fill {
  height: 100%;
}

.sum-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* 翻面提示图标（热区①）：2026-09-24 R6 由 replay 改为 ArrowLeftRight */
.sum-flip {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

/* 周期字（热区②）：primary + 下划虚线 = 可点 */
.sum-period {
  color: var(--color-primary);
  border-bottom: 1px dashed var(--color-primary);
  line-height: 14px;
  padding: 0 1px;

  &:active {
    opacity: 0.6;
  }
}

.sum-main {
  font-size: 20px;
  font-weight: 600;
  line-height: 26px;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.is-up {
    color: var(--color-success);
  }
  &.is-down {
    color: var(--color-danger);
  }
}

.sum-sub {
  font-size: 11px;
  line-height: 16px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.is-action {
    color: var(--color-primary);
  }
}

/* ==================== 骨架（01 §2.8：不做 spinner） ==================== */
.sk-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.sk {
  display: block;
  border-radius: var(--radius-sm);
  background: var(--color-bg-hover);
}

.sk-title {
  width: 44%;
  height: 12px;
}

.sk-main {
  width: 64%;
  height: 20px;
}
</style>
