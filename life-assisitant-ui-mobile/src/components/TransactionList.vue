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
 * 与桌面端一致的关键设计（260921 Phase 3.3 起更新）：
 *   1. **类型筛选改服务端**：切段直接写 store 的 txQuery.type（`setTxFilter({type})`
 *      重置第 1 页重拉）；「全部」= 不传 type（**含 transfer**）。
 *      旧的「客户端过滤 + 排除转账」口径已删除。
 *   2. 本月收入 = 已在本地列表里的 income 求和（转账不是 income，天然排除）。
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
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { formatDayLabel, formatMoney, isoToDate } from '@/utils/date'
import { amountColorClass, formatSignedAmount } from '@/utils/money'
import { txDeleteConfirm, TX_REVERSE_CONFIRM, TX_SOURCE_LABEL } from '@/constants/finance'
import Icon from '@/components/icon/Icon.vue'
import IconBox from '@/components/IconBox.vue'
import type { ResolvedCategory } from '@/stores/finance-category'
import type { Transaction, TransactionType } from '@/api/types'

const emit = defineEmits<{
  (e: 'edit', tx: Transaction): void
  (e: 'view', tx: Transaction): void
}>()

/**
 * 外部带入的服务端筛选（挂载时写入 store，卸载时清理，防「看不见的过滤」残留）：
 *   - presetDate：日历「查看全部」的单日筛选（YYYY-MM-DD）
 *   - presetContact：债权债务卡「按该对方看流水」（Phase 4）
 */
const props = withDefaults(
  defineProps<{
    presetDate?: string
    presetContact?: string
  }>(),
  { presetDate: '', presetContact: '' }
)

/** 本次挂载是否由 presetDate / presetContact 设置过筛选（卸载时据此清理） */
let datePresetApplied = false
let contactPresetApplied = false

const financeStore = useFinanceStore()
const catStore = useFinanceCategoryStore()

// ==================== 筛选 ====================
/** 类型切段（服务端筛选：「全部」不传 type，含 transfer） */
const TYPE_OPTIONS: Array<{ value: TransactionType | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
]

function onTypeChange(value: TransactionType | ''): void {
  void financeStore.setTxFilter({ type: value })
}

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
/**
 * 列表 = store 数据原样渲染（类型筛选已改**服务端**，不再客户端过滤；
 * 「全部」含 transfer —— 转账行有自己的渲染路径：Send 图标盒 + 中性金额）。
 */
const list = computed<Transaction[]>(() => financeStore.transactions)

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

/** 本月收入（仅 income 求和；转账不是 income，天然排除出该口径） */
const monthIncome = computed(() => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return financeStore.transactions
    .filter((t) => t.type === 'income' && new Date(t.happened_at).getTime() >= monthStart)
    .reduce((sum, t) => sum + t.amount, 0)
})

/** 来源标签（Phase 4：待报销/借出/借入/退款，中性色小标） */
function sourceLabel(t: Transaction): string {
  return t.source ? (TX_SOURCE_LABEL[t.source] ?? '') : ''
}

// ==================== 行内操作 ====================
/** 账户名兜底（后端 account_name 可能缺省） */
function accountName(t: Transaction): string {
  return t.account_name || t.account_id
}

/**
 * 分类渲染：**按 `category_id` 优先**，快照兜底（05 §3）。
 * 已删分类 → 中性灰；无 id 的历史数据 → 走 category_name + category_emoji。
 */
function catOf(t: Transaction): ResolvedCategory {
  return catStore.resolveCat({
    category_id: t.category_id,
    category_name: t.category_name,
    category_emoji: t.category_emoji,
  })
}

function amountText(t: Transaction): string {
  return formatSignedAmount(t.amount, t.type)
}

function amountClass(t: Transaction): string {
  return amountColorClass(t.type)
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
      ...TX_REVERSE_CONFIRM,
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
      ...txDeleteConfirm(t),
      confirmButtonColor: 'var(--color-danger)',
    })
    await financeStore.removeTransaction(t.id)
  } catch {
    /* 取消 */
  }
}

/** 点击行 → 进详情（不再直接编辑；transfer 现在也能看，不再 return） */
function onRowClick(t: Transaction): void {
  emit('view', t)
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
  // 外部带入的服务端筛选（setTxFilter 内部会按新参数重拉首页）
  if (props.presetDate) {
    datePresetApplied = true
    await financeStore.setTxFilter({ startDate: props.presetDate, endDate: props.presetDate })
  }
  if (props.presetContact) {
    contactPresetApplied = true
    await financeStore.setTxFilter({ contact: props.presetContact })
  }
  if (!props.presetDate && !props.presetContact && financeStore.transactions.length === 0) {
    await financeStore.fetchTransactions()
  }
  // 分类缓存（渲染按 category_id 查图标/色；未加载时走快照兜底）
  // SWR：有缓存立刻渲染 + 后台静默刷新
  void catStore.ensureFresh()
})

onUnmounted(() => {
  // 清掉本次挂载写入的筛选，避免 store 里残留「看不见的过滤」。
  // setTxFilter 会触发一次拉取 —— 组件已卸载，这次请求只为把 store 数据归位。
  if (datePresetApplied) {
    datePresetApplied = false
    void financeStore.setTxFilter({ startDate: '', endDate: '' })
  }
  if (contactPresetApplied) {
    contactPresetApplied = false
    void financeStore.setTxFilter({ contact: '' })
  }
})

defineExpose({ refresh })
</script>

<template>
  <div class="tx-list-wrap">
    <!-- ============ 筛选工具栏（3 行 → 2 行：① 类型独占整行 ② 账户+搜索同行）============ -->
    <div class="tx-toolbar">
      <!-- 类型：服务端筛选（切段重置第 1 页重拉；「全部」不传 type，含转账）-->
      <div class="seg-row">
        <button
          v-for="o in TYPE_OPTIONS"
          :key="o.value || 'all'"
          type="button"
          class="seg-item"
          :class="{ 'is-active': (financeStore.txType || '') === o.value }"
          @click="onTypeChange(o.value)"
        >
          {{ o.label }}
        </button>
      </div>

      <!-- 服务端筛选 chips（可移除） -->
      <div
        v-if="(financeStore.txStartDate && financeStore.txEndDate) || financeStore.txContact"
        class="date-chip-row"
      >
        <span
          v-if="financeStore.txStartDate && financeStore.txEndDate"
          class="date-chip"
        >
          {{ formatDayLabel(financeStore.txStartDate) }}
          <button
            type="button"
            class="date-chip-x"
            aria-label="移除日期筛选"
            @click="financeStore.setTxFilter({ startDate: '', endDate: '' })"
          >
            ×
          </button>
        </span>
        <span v-if="financeStore.txContact" class="date-chip">
          对方：{{ financeStore.txContact }}
          <button
            type="button"
            class="date-chip-x"
            aria-label="移除对方筛选"
            @click="financeStore.setTxFilter({ contact: '' })"
          >
            ×
          </button>
        </span>
      </div>

      <!-- 账户下拉 + 搜索同行 -->
      <div class="filter-row">
        <van-dropdown-menu class="acct-filter" :overlay="false">
          <van-dropdown-item
            v-model="accountIndex"
            :options="accountOptions"
            @change="onAccountChange"
          />
        </van-dropdown-menu>
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
                <!--
                  图标盒走 components/IconBox.vue：**40 档位 / 图标 20**。

                  ⚠️ 这里必须用 40，不能回落到 32：行内文本是两行块
                  （标题 20 + 间距 2 + 元信息 16 = 38px，见 .tx-title/.tx-sub
                  的行高契约），32 的盒比文本块矮 6px，视觉上就是
                  「黄块比右边的类别名矮一截」。40 盒与 38 文本块在
                  `align-items: center` 下上下各差 1px，肉眼齐平。
                  （32 档留给「记一笔」浮层的类别宫格，那里的行高由宫格决定。）
                -->
                <IconBox
                  v-if="t.type !== 'transfer'"
                  :name="catOf(t).icon"
                  :tint="catOf(t).tint"
                  :size="40"
                />
                <IconBox v-else name="Send" tint="accent" :size="40" />

                <div class="tx-body">
                  <div class="tx-title">
                    <template v-if="t.type === 'transfer'">
                      转账：{{ accountName(t) }} → {{ t.to_account_name || '账户' }}
                    </template>
                    <template v-else>
                      {{ catOf(t).name }}
                    </template>
                  </div>
                  <div class="tx-sub">
                    <span class="tx-type-tag" :class="`is-${t.type}`">{{ typeLabel(t) }}</span>
                    <span v-if="sourceLabel(t)" class="tx-source-tag">{{ sourceLabel(t) }}</span>
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
  gap: 8px;
}
.date-chip-row {
  display: flex;
}
.date-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 6px 0 10px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-primary);
  background: var(--color-primary-light);
  border-radius: 999px;
}
.date-chip-x {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.acct-filter {
  /* 账户下拉占固定比例，与搜索框同行（Phase 3.3 两行布局） */
  flex: 0 0 38%;
  min-width: 0;
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
  flex: 1;
  min-width: 0;
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
/**
 * 列表行图标已改用 components/IconBox.vue（40px 盒 + 20px 图标 + 语义 tint）。
 *
 * ⚠️ 历史反模式（已废弃，别再写回来）：`<Icon class="tx-emoji" :size="16">`
 *    然后把 `width/height: 36px` 写在 `.tx-emoji` 上 —— class 是落在真正的
 *    `<svg>` 上的（Icon.vue `inheritAttrs: false` + `v-bind="$attrs"`），
 *    CSS 的 width/height 会**覆盖** svg 的 width/height 属性，于是图标被
 *    整体缩放到 36×36（描边也跟着放大 ~1.5 倍），比宫格里的 16px 图标
 *    大了两倍多。而 `display:inline-flex` 对 SVG 元素不成立，居中也无效。
 *    视觉呈现就是「列表里的图标又大又糊」。盒子必须是 div，图标才是 svg。
 */
.tx-body { flex: 1; min-width: 0; }
/*
 * 行内两行文本的高度契约（图标 / 标题 / 类型·备注 三者对齐的关键）：
 *
 *   标题 20px  +  间距 2px  +  元信息 16px  =  38px 的文本块
 *
 * 两行都**写死行高**，行盒才不随字号与标签 padding 漂移。
 * 之前只有 font-size：标题按 1.5 倍行高算 21px，元信息行里的类型标签
 * （10px 字 + 上下各 1px padding = 17px）比同行的 11px 文字（16.5px）高，
 * 于是元信息行高由标签决定、两行的垂直节奏跟着变 —— 图标盒
 * 居中在这块忽高忽低的文本上，看起来就是「怎么都对不齐」。
 *
 * 行高钉死后，图标盒的档位就有了唯一正确答案：文本块 38px ⇒ 图标盒取
 * 40 档（见 template 里的注释），别再往 32 掉。
 */
.tx-title {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  line-height: 20px;
  color: var(--color-text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  /* 固定行高：所有子项都不许把它撑高（含下面的类型标签） */
  height: 16px;
  font-size: var(--fs-micro);
  line-height: 16px;
  color: var(--color-text-tertiary);
  overflow: hidden;
  white-space: nowrap;
}
.tx-type-tag {
  flex-shrink: 0;
  /* 盒高与 .tx-sub 行高同为 16px ⇒ 不再撑高行盒；文字在盒内垂直居中 */
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 5px;
  font-size: var(--fs-micro);
  line-height: 1;
  border-radius: 4px;
  &.is-expense { background: var(--color-danger-light); color: var(--color-danger-dark); }
  &.is-income { background: var(--color-success-light); color: var(--color-success-dark); }
  &.is-transfer { background: var(--tint-accent-bg); color: var(--tint-accent-fg); }
}
/* 来源标签（Phase 4：待报销/借出/借入/退款）——中性色小标，不用红绿
   （它不是收支，05 §B.4.3 验收：与详情页标签样式一致的中性表达） */
.tx-source-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 5px;
  font-size: var(--fs-micro);
  line-height: 1;
  border-radius: 4px;
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
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
