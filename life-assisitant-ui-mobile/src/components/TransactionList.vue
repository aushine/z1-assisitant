<script setup lang="ts">
/**
 * TransactionList —— 收支交易列表（移动端；D-03 第十六轮起单组件双端对齐）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/TransactionsTab.tsx
 *                    life-assisitant-ui-desktop/src/pages/record/components/TransactionToolbar.tsx
 *                    life-assisitant-ui-desktop/src/pages/record/components/ReverseButton.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/finance.go
 * 最后同步：2026-09-19（第十六轮收支合并：mode prop 退役，组件即完整收支视图）
 *
 * 与桌面端一致的关键设计：
 *   1. **类型筛选是客户端过滤**，不写进 store 的 txQuery.type（服务端参数
 *      留给账户/关键字；口径与桌面端 TransactionsTab 一致）。
 *   2. 列表排除 transfer（转账走账户 Tab 的动作，不是收支流水）。
 *   3. 本月收入 = 已在本地列表里的 income 求和（与桌面端同口径）。
 *
 * 移动端差异（交互层）：
 *   - 表格 → 按日期分组的卡片列表（复用 Phase 0 的 txGroups 分组逻辑）
 *   - 行内按钮 → 左滑（编辑 / 撤销 / 删除）
 *   - 分页 → 底部「加载更多」按钮（与桌面端同款，非无限滚动：
 *     撤销/删除后需要精确重拉，无限滚动容易与乐观更新打架）
 *
 * ⚠️ 撤销（reverse）语义：后端生成一笔反向交易并回滚余额，原交易保留；
 *    已撤销过再调会返回 400403。transfer 不可撤销（桌面端同）。
 */
import { computed, onMounted, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { useFinanceStore } from '@/stores/finance'
import { resolveCategory } from '@/utils/category-dict'
import { formatDayLabel, formatMoney, isoToDate } from '@/utils/date'
import Icon from '@/components/icon/Icon.vue'
import type { Transaction, TransactionType } from '@/api/types'

const emit = defineEmits<{
  (e: 'edit', tx: Transaction): void
}>()

const financeStore = useFinanceStore()

// ==================== 筛选 ====================
/** 客户端类型筛选（仅支出 tab 显示） */
const typeFilter = ref<TransactionType | ''>('')
const TYPE_OPTIONS: Array<{ value: TransactionType | ''; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
]

/** 账户筛选（服务端）与关键词（服务端，带防抖） */
const accountIndex = ref(0)
const accountOptions = computed<Array<{ text: string; value: string }>>(() => [
  { text: '全部账户', value: '' },
  ...financeStore.accounts.map((a) => ({ text: a.name, value: a.id })),
])

const keyword = ref(financeStore.txKeyword)
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput(): void {
  financeStore.txKeyword = keyword.value
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void financeStore.fetchTransactions()
  }, 350)
}

function onSearchClear(): void {
  keyword.value = ''
  financeStore.txKeyword = ''
  void financeStore.fetchTransactions()
}

function onAccountChange(index: number | string): void {
  const i = Number(index)
  financeStore.txAccountId = accountOptions.value[i]?.value ?? ''
  void financeStore.fetchTransactions()
}

// ==================== 列表 ====================
const list = computed<Transaction[]>(() => {
  // 收支混合列表：排除转账，再按客户端类型筛选（全部 / 支出 / 收入）
  return financeStore.transactions.filter(
    (t) => (t.type === 'expense' || t.type === 'income') && (!typeFilter.value || t.type === typeFilter.value)
  )
})

interface TxGroup {
  dateKey: string
  dateLabel: string
  items: Transaction[]
}

const txGroups = computed<TxGroup[]>(() => {
  const map = new Map<string, Transaction[]>()
  for (const t of list.value) {
    const key = isoToDate(t.happened_at)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  const groups: TxGroup[] = []
  for (const [k, items] of map.entries()) {
    groups.push({ dateKey: k, dateLabel: formatDayLabel(k), items })
  }
  return groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
})

/** 本月收入（与桌面端同口径：仅统计已加载的 income 记录） */
const monthIncome = computed(() => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return financeStore.transactions
    .filter((t) => t.type === 'income' && new Date(t.happened_at).getTime() >= monthStart)
    .reduce((sum, t) => sum + t.amount, 0)
})

// ==================== 行内操作 ====================
/** 账户名兜底（后端 account_name 可能缺省） */
function accountName(t: Transaction): string {
  return t.account_name || t.account_id
}

function amountText(t: Transaction): string {
  if (t.type === 'income') return `+¥${formatMoney(t.amount)}`
  if (t.type === 'expense') return `-¥${formatMoney(t.amount)}`
  return `¥${formatMoney(t.amount)}`
}

function amountClass(t: Transaction): string {
  if (t.type === 'income') return 'is-income'
  if (t.type === 'expense') return 'is-expense'
  return 'is-transfer'
}

/** 类型 Tag 文案（支出 tab 才需要区分支出/收入） */
function typeLabel(t: Transaction): string {
  if (t.type === 'expense') return '支出'
  if (t.type === 'income') return '收入'
  return '转账'
}

/** 撤销（仅非 transfer；已撤销过再调后端会 400403，由拦截器提示） */
async function onReverse(t: Transaction): Promise<void> {
  try {
    await showConfirmDialog({
      title: '撤销交易',
      message: '将生成一笔反向交易，原账户余额回滚。确认撤销？',
      confirmButtonText: '确认撤销',
      confirmButtonColor: 'var(--color-danger)',
    })
    await financeStore.reverseTransaction(t.id)
  } catch {
    /* 取消 */
  }
}

async function onDelete(t: Transaction): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除交易',
      message: `确定删除「${t.category_name || typeLabel(t)} ¥${formatMoney(t.amount)}」吗？`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    await financeStore.removeTransaction(t.id)
  } catch {
    /* 取消 */
  }
}

/** 点击行 → 编辑（transfer 不支持编辑，后端 UpdateTransactionReq 无 transfer 字段） */
function onRowClick(t: Transaction): void {
  if (t.type === 'transfer') return
  emit('edit', t)
}

async function loadMore(): Promise<void> {
  await financeStore.loadMoreTransactions()
}

async function refresh(): Promise<void> {
  await financeStore.fetchTransactions()
}

// ==================== 生命周期 ====================
onMounted(async () => {
  // 账户下拉需要账户列表；交易列表只有在未加载时才拉（切 tab 不重复请求）
  if (financeStore.accounts.length === 0) await financeStore.fetchAccounts()
  if (financeStore.transactions.length === 0) await financeStore.fetchTransactions()
})

defineExpose({ refresh })
</script>

<template>
  <div class="tx-list-wrap">
    <!-- ============ 筛选工具栏 ============ -->
    <div class="tx-toolbar">
      <!-- 类型：客户端筛选（全部 / 支出 / 收入）-->
      <div class="seg-row">
        <button
          v-for="o in TYPE_OPTIONS"
          :key="o.value || 'all'"
          type="button"
          class="seg-item"
          :class="{ 'is-active': typeFilter === o.value }"
          @click="typeFilter = o.value"
        >
          {{ o.label }}
        </button>
      </div>

      <div class="filter-row">
        <van-dropdown-menu class="acct-filter" :overlay="false">
          <van-dropdown-item
            v-model="accountIndex"
            :options="accountOptions"
            @change="onAccountChange"
          />
        </van-dropdown-menu>
      </div>

      <div class="search-row">
        <input
          v-model="keyword"
          type="search"
          class="search-input"
          placeholder="搜索备注 / 分类…"
          @input="onSearchInput"
        >
        <button v-if="keyword" type="button" class="search-clear" aria-label="清空" @click="onSearchClear">×</button>
      </div>
    </div>

    <!-- ============ 列表 ============ -->
    <div v-if="financeStore.transactionsLoading && list.length === 0" class="loading-skeleton">
      <div v-for="i in 3" :key="i" class="skel-row" />
    </div>

    <div v-else-if="list.length === 0" class="empty-state sm">
      <Icon class="empty-emoji" name="Banknote" :size="32" aria-hidden="true" />
      <h4 class="empty-title">还没有交易</h4>
      <p v-if="financeStore.txHasFilter" class="empty-desc">当前筛选条件下没有记录</p>
      <p v-else class="empty-desc">点击右下角「＋」记一笔</p>
    </div>

    <div v-else class="tx-groups">
      <div v-for="g in txGroups" :key="g.dateKey" class="tx-group">
        <div class="tx-date">{{ g.dateLabel }}</div>
        <div class="tx-cards">
          <div v-for="t in g.items" :key="t.id" class="tx-swipe">
            <van-swipe-cell>
              <div class="tx-row" @click="onRowClick(t)">
                <Icon
                  v-if="t.type !== 'transfer'"
                  class="tx-emoji"
                  :name="resolveCategory(t.category_emoji).icon"
                  :size="16"
                  :style="{
                    background: resolveCategory(t.category_emoji).vars.bg,
                    color: resolveCategory(t.category_emoji).vars.fg,
                  }"
                />
                <span
                  v-else
                  class="tx-emoji"
                  :style="{ background: 'var(--tint-accent-bg)', color: 'var(--tint-accent-fg)' }"
                >⇄</span>

                <div class="tx-body">
                  <div class="tx-title">
                    <template v-if="t.type === 'transfer'">
                      转账：{{ accountName(t) }} → {{ t.to_account_name || '账户' }}
                    </template>
                    <template v-else>
                      {{ t.category_name || '未分类' }}
                    </template>
                  </div>
                  <div class="tx-sub">
                    <span class="tx-type-tag" :class="`is-${t.type}`">{{ typeLabel(t) }}</span>
                    <span class="tx-acct">{{ accountName(t) }}</span>
                    <span v-if="t.note" class="tx-note">· {{ t.note }}</span>
                  </div>
                </div>

                <div class="tx-amount" :class="amountClass(t)">{{ amountText(t) }}</div>
              </div>

              <!-- 左滑操作 -->
              <template #right>
                <div class="swipe-actions">
                  <button
                    v-if="t.type !== 'transfer'"
                    type="button"
                    class="swipe-btn is-edit"
                    @click="emit('edit', t)"
                  >
                    编辑
                  </button>
                  <button
                    v-if="t.type !== 'transfer'"
                    type="button"
                    class="swipe-btn is-reverse"
                    @click="onReverse(t)"
                  >
                    撤销
                  </button>
                  <button type="button" class="swipe-btn is-delete" @click="onDelete(t)">删除</button>
                </div>
              </template>
            </van-swipe-cell>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 底部：加载更多 / 刷新 ============ -->
    <div class="tx-foot">
      <button
        v-if="financeStore.txHasMore"
        type="button"
        class="foot-btn"
        :disabled="financeStore.transactionsLoading"
        @click="loadMore"
      >
        {{ financeStore.transactionsLoading ? '加载中…' : '加载更多' }}
      </button>
      <button type="button" class="foot-btn is-ghost" :disabled="financeStore.transactionsLoading" @click="refresh">
        <span aria-hidden="true">⟳</span> 刷新
      </button>
      <span v-if="financeStore.txTotal > 0" class="foot-count">共 {{ financeStore.txTotal }} 条</span>
    </div>

    <!-- ============ 汇总卡（本月收入 + 总资产，与桌面端一致）============ -->
    <div class="summary-row">
      <div class="summary-card">
        <div class="sc-label"><Icon name="Banknote" :size="16" /> 本月收入</div>
        <div class="sc-value is-income">+¥{{ formatMoney(monthIncome, true) }}</div>
        <div class="sc-sub">按已加载记录统计</div>
      </div>
      <div class="summary-card">
        <div class="sc-label"><Icon name="Landmark" :size="16" /> 总资产</div>
        <div
          class="sc-value"
          :style="{ color: financeStore.totalBalance < 0 ? 'var(--color-danger)' : 'var(--color-primary)' }"
        >
          ¥{{ formatMoney(financeStore.totalBalance, true) }}
        </div>
        <div class="sc-sub">共 {{ financeStore.accounts.length }} 个账户</div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.tx-list-wrap {
  padding-top: 4px;
}

/* ========== 工具栏 ========== */
.tx-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.seg-row {
  display: flex;
  gap: 6px;
}
.seg-item {
  flex: 1;
  height: 32px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); }
  &.is-active {
    color: var(--color-primary);
    background: var(--color-primary-light);
    border-color: var(--color-primary);
    font-weight: 600;
  }
}
.filter-row {
  display: flex;
}
.acct-filter {
  flex: 1;
  border-radius: 10px;
  overflow: hidden;
  :deep(.van-dropdown-menu__bar) {
    height: 36px;
    background: var(--color-bg-hover);
    box-shadow: none;
  }
  :deep(.van-dropdown-menu__title) {
    font-size: var(--fs-caption-sm);
    color: var(--color-text-secondary);
  }
}
.search-row {
  position: relative;
  display: flex;
  align-items: center;
}
.search-input {
  flex: 1;
  height: 36px;
  padding: 0 34px 0 12px;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-light);
  border-radius: 10px;
  outline: none;
  &::placeholder { color: var(--color-text-disabled); }
  &:focus { border-color: var(--color-primary); }
  &::-webkit-search-cancel-button { display: none; }
}
.search-clear {
  position: absolute;
  right: 6px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-h4);
  color: var(--color-text-tertiary);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-border-light); }
}

/* ========== 分组列表 ========== */
.tx-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tx-date {
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
  margin-bottom: 8px;
  padding-left: 2px;
}
.tx-cards {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-xs);
}
.tx-swipe {
  &:not(:last-child) .tx-row { border-bottom: 1px solid var(--color-border-light); }
}
.tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-bg-card);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-bg-hover); }
}
.tx-emoji {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border-radius: 10px;
  line-height: 1;
}
.tx-body { flex: 1; min-width: 0; }
.tx-title {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  overflow: hidden;
  white-space: nowrap;
}
.tx-type-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  font-size: var(--fs-tab);
  border-radius: 4px;
  &.is-expense { background: var(--color-danger-light); color: var(--color-danger-dark); }
  &.is-income { background: var(--color-success-light); color: var(--color-success-dark); }
  &.is-transfer { background: var(--tint-accent-bg); color: var(--tint-accent-fg); }
}
.tx-acct {
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx-note { overflow: hidden; text-overflow: ellipsis; }
.tx-amount {
  flex-shrink: 0;
  font-size: var(--fs-body);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  &.is-income { color: var(--color-success); }
  &.is-expense { color: var(--color-danger); }
  &.is-transfer { color: var(--color-text-secondary); }
}

.swipe-actions { display: flex; height: 100%; }
.swipe-btn {
  width: 62px;
  height: 100%;
  border: 0;
  padding: 0;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: #FFFFFF;
  cursor: pointer;
  &:active { opacity: 0.85; }
  &.is-edit { background: var(--color-text-tertiary); }
  &.is-reverse { background: var(--color-warning); }
  &.is-delete { background: var(--color-danger); }
}

/* ========== 底部 ========== */
.tx-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 16px;
}
.foot-btn {
  height: 32px;
  padding: 0 16px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: #FFFFFF;
  background: var(--color-primary);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
  &:disabled { opacity: 0.5; }
  &.is-ghost {
    color: var(--color-text-secondary);
    background: var(--color-bg-hover);
  }
}
.foot-count {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

/* ========== 汇总卡 ========== */
.summary-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 16px;
}
.summary-card {
  padding: 14px;
  background: var(--color-bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
}
.sc-label {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}
.sc-value {
  /* 数值阶令牌：与各模块 KPI / 汇总数值统一 */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  line-height: 1.2;
  &.is-income { color: var(--color-success); }
}
.sc-sub {
  margin-top: 4px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

/* ========== 空 / 加载 ========== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 24px;
  text-align: center;
  &.sm { padding: 32px 24px; }
}
.empty-emoji { font-size: 52px; margin-bottom: 10px; opacity: 0.6; }
.empty-title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.empty-desc {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  margin: 0;
}
.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skel-row {
  height: 60px;
  border-radius: 12px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
