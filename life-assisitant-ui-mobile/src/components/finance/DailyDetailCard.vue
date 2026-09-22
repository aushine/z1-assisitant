<script setup lang="ts">
/**
 * DailyDetailCard —— 收支日历的「当日明细」卡（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/finance/CalendarView.tsx（右栏）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance.go（CalendarDay / TransactionResp）
 * 规范：md/spec-20260921-v2/03-流水与日历.md §B
 *
 * ⚠️ **内联在月历下方**（移动端上下堆叠；桌面端是左右两栏），不做弹层。
 *
 * ⚠️ 单日查询的区间语义（09-schedule §B14，文档原文写反了）：
 *    后端把 `end_date` 解析后 **+1 天**（`impl/finance.go:370-371`）⇒
 *    入参 `end_date` 本身是**右闭**（含当天全天）。
 *    查「某一天」必须 `start_date === end_date`；按老文档传 X+1 会多含次日一整天。
 *
 * 合计（收入/支出）不在本组件求和 —— 列表只取 3 笔（spec：最多 3 笔），
 * 求和会漏；由父级（CalendarView）从月历数据 `days[].income/expense` 传入，
 * 笔数用响应的 `total`（服务端口径，与合计一致）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { financeApi } from '@/api/finance'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { formatMonthDayWeekday, todayDate } from '@/utils/date'
import { amountColorClass, formatSignedAmount } from '@/utils/money'
import IconBox from '@/components/IconBox.vue'
import type { ResolvedCategory } from '@/stores/finance-category'
import type { Transaction } from '@/api/types'

const props = defineProps<{
  /** YYYY-MM-DD */
  date: string
  /** 当日收入合计（父级从月历数据传入；无记录 = 0） */
  income: number
  /** 当日支出合计 */
  expense: number
}>()

const emit = defineEmits<{
  (e: 'view', tx: Transaction): void
  (e: 'view-all', date: string): void
  (e: 'create-at', date: string): void
}>()

const catStore = useFinanceCategoryStore()

const items = ref<Transaction[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref(false)

/** 最多展示 3 笔（spec §B：小屏取舍，全量走「查看全部」） */
const MAX_SHOW = 3

async function load(): Promise<void> {
  if (!props.date) return
  loading.value = true
  error.value = false
  try {
    // ⚠️ start_date === end_date（右闭语义，见文件头）
    const res = await financeApi.listTransactions({
      start_date: props.date,
      end_date: props.date,
      page: 1,
      page_size: MAX_SHOW,
    })
    items.value = res.items ?? []
    total.value = res.total ?? 0
  } catch (e) {
    items.value = []
    total.value = 0
    error.value = true
    // eslint-disable-next-line no-console
    console.error('[DailyDetailCard] load failed', e)
  } finally {
    loading.value = false
  }
}

/** 换天就重拉；写账后父级会切 selectedDate 触发这里 */
watch(() => props.date, load)
onMounted(load)

defineExpose({ refresh: load })

// ==================== 渲染辅助 ====================
const isToday = computed(() => props.date === todayDate())

const headerLabel = computed(() => {
  const base = formatMonthDayWeekday(props.date)
  return isToday.value ? `今天 · ${base}` : base
})

/** 分类渲染：按 category_id 优先、快照兜底（05 §3，与列表同口径） */
function catOf(t: Transaction): ResolvedCategory {
  return catStore.resolveCat({
    category_id: t.category_id,
    category_name: t.category_name,
    category_emoji: t.category_emoji,
  })
}

function titleOf(t: Transaction): string {
  if (t.type === 'transfer') return `转账：${t.account_name || t.account_id} → ${t.to_account_name || '账户'}`
  return catOf(t).name
}
</script>

<template>
  <section class="cal-card day-card">
    <!-- 头部：日期 + 笔数 -->
    <div class="day-head">
      <span class="day-title">{{ headerLabel }}</span>
      <span class="day-count">{{ total }} 笔</span>
    </div>

    <!-- 合计行（来自月历数据，与格子口径一致） -->
    <div class="day-sum">
      <span class="is-income">收入 {{ formatSignedAmount(props.income, 'income') }}</span>
      <span class="is-expense">支出 {{ formatSignedAmount(props.expense, 'expense') }}</span>
    </div>

    <!-- 明细列表 -->
    <div v-if="loading" class="day-loading">加载中…</div>
    <div v-else-if="error" class="day-error">
      <span>加载失败</span>
      <button type="button" class="day-retry" @click="load">重试</button>
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="day-empty">
        <span class="day-empty-text">这天没有记录</span>
        <button type="button" class="day-create" @click="emit('create-at', props.date)">记一笔</button>
      </div>
      <div v-else class="day-list">
        <div
          v-for="t in items"
          :key="t.id"
          class="day-row"
          @click="emit('view', t)"
        >
          <IconBox
            v-if="t.type !== 'transfer'"
            :name="catOf(t).icon"
            :tint="catOf(t).tint"
            :size="32"
          />
          <IconBox v-else name="Send" tint="accent" :size="32" />
          <span class="day-row-title">{{ titleOf(t) }}</span>
          <span class="day-row-amt" :class="amountColorClass(t.type)">
            {{ formatSignedAmount(t.amount, t.type) }}
          </span>
        </div>
      </div>

      <!-- 查看全部：切到流水视图并带上该日筛选（由父级实现） -->
      <button v-if="total > MAX_SHOW || items.length > 0" type="button" class="day-all" @click="emit('view-all', props.date)">
        查看全部 ›
      </button>
    </template>
  </section>
</template>

<style lang="scss" scoped>
/* 布局与排版来自共享层 styles/_calendar.scss（.cal-card 同款卡片底）；
   ⚠️ @use 必须位于其它规则之前 */
@use '@/styles/calendar';

.day-card {
  /* 当日明细紧跟月历，不留额外间隙（.cal-card 自带 margin-bottom，抵掉） */
  margin-bottom: 0;
}

.day-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 var(--space-2);
  margin-bottom: var(--space-2);
}
.day-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.day-count {
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}

.day-sum {
  display: flex;
  gap: var(--space-4);
  padding: 8px 10px;
  margin: 0 var(--space-2) var(--space-2);
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  font-size: var(--fs-caption-sm);
  font-family: var(--font-num);

  .is-income { color: var(--color-success); }
  .is-expense { color: var(--color-danger); }
}

.day-list {
  display: flex;
  flex-direction: column;
}
.day-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px var(--space-2);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-bg-hover); }
  &:not(:last-child) { border-bottom: 1px solid var(--color-border-light); }
}
.day-row-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.day-row-amt {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  &.is-income { color: var(--color-success); }
  &.is-expense { color: var(--color-danger); }
  &.is-transfer { color: var(--color-text-secondary); }
}

.day-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 0 10px;
}
.day-empty-text {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.day-create {
  height: 30px;
  padding: 0 16px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-primary);
  background: var(--color-primary-light);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
}

.day-loading,
.day-error {
  padding: 16px 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.day-error { color: var(--color-danger-dark); }
.day-retry {
  height: 26px;
  padding: 0 12px;
  margin-left: 8px;
  border: 1px solid currentColor;
  border-radius: 13px;
  background: transparent;
  color: inherit;
  font-size: var(--fs-micro);
  cursor: pointer;
}

.day-all {
  display: block;
  width: 100%;
  margin-top: var(--space-2);
  padding: 8px 0 2px;
  border: 0;
  background: transparent;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
</style>
