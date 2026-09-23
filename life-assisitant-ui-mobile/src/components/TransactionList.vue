<script setup lang="ts">
/**
 * TransactionList —— 收支交易列表（移动端；D-03 第十六轮起单组件双端对齐）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/TransactionsTab.tsx
 *                    life-assisitant-ui-desktop/src/pages/record/components/TransactionToolbar.tsx
 *                    life-assisitant-ui-desktop/src/pages/record/components/ReverseButton.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/finance.go
 * 最后同步：2026-09-22（spec-20260922-v2 · 01：筛选 3 行 → 常态 1 行 + 顶部数据块）
 *
 * spec-20260922-v2 · 01 的改动（本文件）：
 *   - ❌ 删 `.seg-row` 分段控件 → 类型并入原账户下拉位置的 **van-dropdown-menu**（01 §1.2）
 *   - ❌ 删账户下拉（移动端 D2：能力降级为「账户页 → 查看流水」注入的 chip）
 *     ⚠️ 桌面端**保留**账户下拉（Q10 方案 B —— 不是同一个问题，不照抄）
 *   - ✅ 账户 chip 复用 `.date-chip` 样式，与日期/对方 chip 同一容器（01 §1.3）
 *   - ✅ 顶部 `<SummaryCards>`（列表之前、视图第一块；四个数全走 /finance/summary，修 S2）
 *   - ❌ 删底部 `.summary-row` 与 `monthIncome` computed（"按已加载记录统计"随之下线）
 *
 * 与桌面端一致的关键设计：
 *   1. **类型筛选是服务端**：下拉变更写 store（`setTxFilter({type})` 重置第 1 页重拉）；
 *      「全部」= 不传 type（**含 transfer**）。
 *   2. 下拉选中态与 `financeStore.txType` 用 **computed 双向映射**，不用独立 ref
 *      （01 §1.5 注 4：旧的 `accountIndex` 独立 ref 就是脱节教训）。
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
import { formatDayLabel, isoToDate } from '@/utils/date'
import { amountColorClass, formatSignedAmount } from '@/utils/money'
import { txDeleteConfirm, TX_REVERSE_CONFIRM, TX_SOURCE_LABEL } from '@/constants/finance'
import Icon from '@/components/icon/Icon.vue'
import IconBox from '@/components/IconBox.vue'
import SummaryCards from '@/components/finance/SummaryCards.vue'
import type { ResolvedCategory } from '@/stores/finance-category'
import type { Transaction, TransactionType } from '@/api/types'

const emit = defineEmits<{
  (e: 'edit', tx: Transaction): void
  (e: 'view', tx: Transaction): void
  /** 数据块「未设预算 · 去设置 ›」→ 由 FinancialSection 切到预算视图（01 §2.8 / Q3） */
  (e: 'goto-budget'): void
}>()

/**
 * 外部带入的服务端筛选（挂载时写入 store，卸载时清理，防「看不见的过滤」残留）：
 *   - presetDate：日历「查看全部」的单日筛选（YYYY-MM-DD）
 *   - presetContact：债权债务卡「按该对方看流水」（Phase 4）
 *   - presetAccountId：账户卡「查看流水 ›」注入的账户筛选（spec-20260922-v2 01 §1.3）
 */
const props = withDefaults(
  defineProps<{
    presetDate?: string
    presetContact?: string
    presetAccountId?: string
  }>(),
  { presetDate: '', presetContact: '', presetAccountId: '' }
)

/** 本次挂载是否由 preset* 设置过筛选（卸载时据此清理） */
let datePresetApplied = false
let contactPresetApplied = false
let accountPresetApplied = false

const financeStore = useFinanceStore()
const catStore = useFinanceCategoryStore()

// ==================== 筛选 ====================
/**
 * 类型下拉选项（服务端筛选：「全部」不传 type，含 transfer）。
 * ⚠️ 01 §1.5 注 3：下拉 options 由 TYPE_OPTIONS 驱动，**不要再写一份**。
 */
const TYPE_OPTIONS: Array<{ value: TransactionType | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
]
const typeOptions = TYPE_OPTIONS.map((o) => ({ text: o.label, value: o.value as TransactionType | '' }))

/**
 * 下拉选中态 ↔ store.txType 双向映射（01 §1.5 注 4）。
 * ⚠️ 用可写 computed 而不是独立 ref —— 独立 ref 会与 store 脱节（旧 `accountIndex` 的教训），
 *    set 走 `setTxFilter` 顺带完成「重置第 1 页重拉」。
 */
const typeFilter = computed<TransactionType | ''>({
  get: () => financeStore.txType,
  set: (v) => {
    void financeStore.setTxFilter({ type: v })
  },
})

/** 账户 chip 展示名（chip 是唯一账户筛选入口；store 未加载时用 id 兜底） */
const accountChipName = computed(() => {
  const id = financeStore.txAccountId
  if (!id) return ''
  return financeStore.findAccount(id)?.name || id
})

/** 关键词（服务端，带防抖） */
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
  // 账户 chip 的展示名需要账户列表（查看流水入口从账户页来，正常已加载；兜底拉一次）
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
  if (props.presetAccountId) {
    accountPresetApplied = true
    await financeStore.setTxFilter({ accountId: props.presetAccountId })
  }
  if (
    !props.presetDate &&
    !props.presetContact &&
    !props.presetAccountId &&
    financeStore.transactions.length === 0
  ) {
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
  if (accountPresetApplied) {
    accountPresetApplied = false
    void financeStore.setTxFilter({ accountId: '' })
  }
})

defineExpose({ refresh })
</script>

<template>
  <div class="tx-list-wrap">
    <!-- ============ 顶部数据块（流水视图第一块，01 §2；四个数全走 /finance/summary）============ -->
    <SummaryCards @goto-budget="emit('goto-budget')" />

    <!-- ============ 筛选工具栏（3 行 → 常态 1 行：类型下拉 + 搜索；chip 仅在有筛选时出现）============ -->
    <div class="tx-toolbar">
      <!-- 类型下拉（占原账户下拉的 38% 槽位）+ 搜索 同行 -->
      <div class="filter-row">
        <van-dropdown-menu class="type-filter" :overlay="false">
          <van-dropdown-item v-model="typeFilter" :options="typeOptions" />
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

      <!-- 服务端筛选 chips（可移除；仅在被注入时存在 ⇒ 常态不占行，01 §1.3） -->
      <div
        v-if="(financeStore.txStartDate && financeStore.txEndDate) || financeStore.txContact || financeStore.txAccountId"
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
        <!-- 账户 chip：移动端删掉账户下拉后的**唯一**账户筛选入口（从账户页「查看流水」注入） -->
        <span v-if="financeStore.txAccountId" class="date-chip">
          账户：{{ accountChipName }}
          <button
            type="button"
            class="date-chip-x"
            aria-label="移除账户筛选"
            @click="financeStore.setTxFilter({ accountId: '' })"
          >
            ×
          </button>
        </span>
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
.filter-row {
  display: flex;
  gap: 8px;
}
/* chip 行（日期/对方/账户三种并行；01 验收：互不挤占） */
.date-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
.type-filter {
  /* 类型下拉占固定比例（原账户下拉的槽位，视觉重量不变，01 §1.2），与搜索框同行 */
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
