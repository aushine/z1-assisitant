<script setup lang="ts">
/**
 * 账目详情页（移动端 · v2 批次二）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/TransactionDetailDrawer.tsx
 *                    （桌面端是 SideSheet 抽屉；移动端屏幕小，用独立二级页 —— 04 §4）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/finance.go（GET /transactions/:id）
 * 规范：md/spec-20260921-v2/04-账目详情与编辑页.md §2
 *
 * 内容：
 *   - 金额（大字：收入绿 / 支出红 / 转账中性）
 *   - 类型（只读文本，编辑页才可改）/ 分类（转账无此行）/ 账户（转账 A → B）
 *   - 时间 / 备注（空则整行不显示）
 *   - 口径（不计入预算 · 不计入收支，都关时整行不显示）
 *   - 来源（balance_adjust / reimburse / lend / borrow / refund，普通笔不显示）
 *   - 对方（contact 非空才显示，Phase 4）
 *   - 核销进度 + 核销动作（Phase 4 · 05 §B/C/D）：
 *       原笔（settle_of 空）→ 按 source 显示「记报销到账 / 记收回 / 记还回 / 记退款」，
 *         未结清 > 0.005 才显示；进度「已报销/已收回/已还回/已退款 N / M」；
 *       核销笔（settle_of 非空）→ 只显示进度（拉原笔金额做分母），不给核销按钮。
 *       ⚠️ reversed_by 非空（已撤销）→ 核销按钮不显示。
 *   - 记录信息（创建 / 更新，两者相同只说一次）
 *   - 已撤销提示条（reversed_by 非空）+ 隐藏「撤销」
 *   - 编辑（打开 TransactionEditSheet 编辑态；保存后留在本页重新拉取）/
 *     撤销 / 删除（确认文案与列表左滑**同一份常量**）
 *
 * 注意：列表项字段不全（且要能独立刷新），本页必须单独 `GET /transactions/:id`。
 * ⚠️ 转账**不显示「编辑」**：后端 UpdateTransactionReq 不含 type（注释写
 *    「仅 expense/income」），编辑转账走不通（09-schedule §B3，Q6）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { financeApi } from '@/api/finance'
import { ApiError } from '@/api/request'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { formatDateTime, formatMoney } from '@/utils/date'
import { amountColorClass, formatSignedAmount } from '@/utils/money'
import { TX_REVERSE_CONFIRM, TX_SOURCE_LABEL, txDeleteConfirm, txTypeLabel } from '@/constants/finance'
import TransactionEditSheet from '@/components/TransactionEditSheet.vue'
import SettleSheet, { type SettleAction } from '@/components/finance/SettleSheet.vue'
import IconBox from '@/components/IconBox.vue'
import type { Transaction, UpdateTransactionReq } from '@/api/types'

const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const catStore = useFinanceCategoryStore()

const txId = computed(() => String(route.params.id ?? ''))

const tx = ref<Transaction | null>(null)
const loading = ref(true)
const error = ref(false)
/** 404401 TRANSACTION_NOT_FOUND → 文案区分「已不存在」与「加载失败」 */
const notFound = ref(false)

// ==================== 数据加载 ====================
async function fetchTx(): Promise<void> {
  if (!txId.value) return
  loading.value = true
  error.value = false
  notFound.value = false
  try {
    tx.value = await financeApi.getTransaction(txId.value)
  } catch (e) {
    tx.value = null
    if (e instanceof ApiError && e.code === 404401) notFound.value = true
    else error.value = true
    // eslint-disable-next-line no-console
    console.error('[TxDetail] fetchTx failed', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void fetchTx().then(() => fetchSettleInfo())
})

// ==================== 核销（Phase 4 · 05 §B/C/D） ====================
/** 已核销额 / 已核销笔数（settle_of 指向本笔的未删交易求和） */
const settledAmount = ref(0)
const settledCount = ref(0)
/** 核销笔（settle_of 非空）拉原笔做进度分母 */
const originalTx = ref<Transaction | null>(null)

/**
 * 未结清 = 原笔 amount − 已核销额（状态派生 D42，不落字段）。
 * 超额核销显示 0（不显示负数）。
 */
const openAmount = computed(() => Math.max(0, (tx.value?.amount ?? 0) - settledAmount.value))

/**
 * 核销动作按钮：仅**原笔**（settle_of 空）+ 未撤销 + source 匹配时显示。
 *  - 支出 + reimburse → 记报销到账；支出 + lend → 记收回
 *  - 收入 + borrow → 记还回；普通支出（source 空）→ 记退款
 * 未结清 ≤ 0.005（已结清）→ 按钮消失（05 §C.5 验收）。
 */
const settleAction = computed<SettleAction | null>(() => {
  const t = tx.value
  if (!t || t.reversed_by || t.settle_of) return null
  if (t.type === 'expense' && t.source === 'reimburse') {
    return { key: 'reimburse', label: '记报销到账', settleType: 'income', source: 'reimburse' }
  }
  if (t.type === 'expense' && t.source === 'lend') {
    return { key: 'lend', label: '记收回', settleType: 'income', source: 'lend' }
  }
  if (t.type === 'income' && t.source === 'borrow') {
    return { key: 'borrow', label: '记还回', settleType: 'expense', source: 'borrow' }
  }
  if (t.type === 'expense' && !t.source) {
    return { key: 'refund', label: '记退款', settleType: 'income', source: 'refund' }
  }
  return null
})

const settleShow = ref(false)

/** 进度行标签：原笔按来源；核销笔统一「核销进度」 */
const progressLabel = computed(() => {
  const t = tx.value
  if (!t) return ''
  if (t.settle_of) return '核销进度'
  if (t.source === 'reimburse') return '已报销'
  if (t.source === 'lend') return '已收回'
  if (t.source === 'borrow') return '已还回'
  return '已退款'
})

/** 进度行是否显示：核销笔（有原笔数据）或有已核销记录 */
const showProgress = computed(() => {
  const t = tx.value
  if (!t) return false
  if (t.settle_of) return !!originalTx.value
  return settledCount.value > 0
})

const progressText = computed(() => {
  const t = tx.value
  if (!t) return ''
  if (t.settle_of && originalTx.value) {
    return `¥${formatMoney(t.amount)} / ¥${formatMoney(originalTx.value.amount)}`
  }
  return `¥${formatMoney(settledAmount.value)} / ¥${formatMoney(t.amount)}`
})

/**
 * 拉核销信息。
 *
 * ⚠️ 口径自查（写入报告）：核销笔 = `settle_of === 本笔 id` 的未删交易。
 * 后端 GET /transactions 不支持按 settle_of 筛选 ⇒ 用 `contact` 等值筛选
 * （核销笔 contact 强制继承原笔 ⇒ 完备）翻页求和；contact 为空（待报销可
 * 选填）时退化为按子笔 type 翻页（≤5 页 × page_size 100）兜底，
 * 只累加 settle_of 命中的行。
 */
async function fetchSettleInfo(): Promise<void> {
  const t = tx.value
  if (!t) return
  originalTx.value = null
  settledAmount.value = 0
  settledCount.value = 0
  // 核销笔：拉原笔显示进度（原笔可能已删，静默跳过）
  if (t.settle_of) {
    try {
      originalTx.value = await financeApi.getTransaction(t.settle_of)
    } catch {
      originalTx.value = null
    }
    return
  }
  // 非可核销原笔（转账 / balance_adjust 等）无需统计
  const isReimburseOrig = t.type === 'expense' && t.source === 'reimburse'
  const isLendOrig = t.type === 'expense' && t.source === 'lend'
  const isBorrowOrig = t.type === 'income' && t.source === 'borrow'
  const isRefundableOrig = t.type === 'expense' && !t.source
  if (!isReimburseOrig && !isLendOrig && !isBorrowOrig && !isRefundableOrig) return

  const childType = t.source === 'borrow' ? ('expense' as const) : ('income' as const)
  try {
    for (let page = 1; page <= 5; page++) {
      const res = await financeApi.listTransactions(
        t.contact ? { contact: t.contact, page, page_size: 100 } : { type: childType, page, page_size: 100 }
      )
      for (const it of res.items) {
        if (it.settle_of === t.id) {
          settledAmount.value += it.amount
          settledCount.value++
        }
      }
      if (!res.has_more) break
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[TxDetail] fetchSettleInfo failed', e)
  }
}

/** 核销成功：重拉详情 + 核销信息，同时刷新债权债务卡（⚠️ 只刷一个会"还显示欠着"） */
async function onSettled(): Promise<void> {
  await fetchTx()
  await fetchSettleInfo()
  void financeStore.fetchDebts()
}

// ==================== 派生数据 ====================
const isTransfer = computed(() => tx.value?.type === 'transfer')

const amountClass = computed(() => (tx.value ? amountColorClass(tx.value.type) : ''))

const accountLine = computed(() => {
  const t = tx.value
  if (!t) return ''
  return `${t.account_name || t.account_id} → ${t.to_account_name || t.to_account_id || '账户'}`
})

/** 口径行：两个开关都关 → 整行不显示（04 §2.3） */
const caliberText = computed(() => {
  const t = tx.value
  if (!t) return ''
  const parts: string[] = []
  if (t.exclude_budget) parts.push('不计入预算')
  if (t.exclude_stats) parts.push('不计入收支')
  return parts.join(' · ')
})

const sourceLabel = computed(() =>
  tx.value?.source ? (TX_SOURCE_LABEL[tx.value.source] ?? tx.value.source) : ''
)

/** 创建 / 更新时间相同（未编辑过）→ 只说一次 */
const createdUpdatedSame = computed(() => {
  const t = tx.value
  if (!t) return true
  return !t.updated_at || t.updated_at === t.created_at
})

const canEdit = computed(() => !!tx.value && !isTransfer.value)
const canReverse = computed(() => !!tx.value && !isTransfer.value && !tx.value.reversed_by)

// ==================== 操作 ====================
function goBack(): void {
  // 直接进详情页（无历史）时回列表，避免退出到站外
  if (window.history.length > 1) router.back()
  else router.replace('/record')
}

/** 编辑弹层（编辑态：transaction 非空 ⇒ TransactionEditSheet 自动去类型切换） */
const sheetShow = ref(false)

/** 编辑保存：走 store 的 updateTransaction（payload 无 type），成功后留在本页重新拉取 */
async function onTxSave(
  payload: unknown,
  _type: string,
  mode: 'create' | 'update'
): Promise<boolean> {
  if (mode !== 'update' || !tx.value) return false
  const r = await financeStore.updateTransaction(tx.value.id, payload as UpdateTransactionReq)
  if (r !== null) await fetchTx()
  return r !== null
}

/** 撤销：与列表左滑同一份确认常量；成功后重新拉取（reversed_by 会出现） */
async function onReverse(): Promise<void> {
  if (!tx.value) return
  try {
    await showConfirmDialog({
      ...TX_REVERSE_CONFIRM,
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return /* 取消 */
  }
  await financeStore.reverseTransaction(tx.value.id)
  await fetchTx()
}

/** 删除：确认文案与列表左滑逐字一致（同一份 txDeleteConfirm）；成功后返回列表 */
async function onDelete(): Promise<void> {
  if (!tx.value) return
  try {
    await showConfirmDialog({
      ...txDeleteConfirm(tx.value),
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return /* 取消 */
  }
  await financeStore.removeTransaction(tx.value.id)
  goBack()
}
</script>

<template>
  <div class="tx-detail-page">
    <!-- 顶部导航 -->
    <van-nav-bar title="账目详情" left-arrow :border="false" class="detail-nav" @click-left="goBack" />

    <!-- 加载骨架 -->
    <div v-if="loading" class="detail-body">
      <div class="skel-amount" />
      <div class="card">
        <div v-for="i in 4" :key="i" class="skel-row" />
      </div>
    </div>

    <!-- 不存在态（已删除 / id 无效） -->
    <div v-else-if="notFound" class="detail-body">
      <div class="panel-error">
        <span>该记录已不存在</span>
      </div>
      <button type="button" class="ghost-btn" @click="goBack">返回</button>
    </div>

    <!-- 错误态 -->
    <div v-else-if="error || !tx" class="detail-body">
      <div class="panel-error">
        <span>加载失败，请重试</span>
        <button type="button" class="retry-btn" @click="fetchTx">重试</button>
      </div>
      <button type="button" class="ghost-btn" @click="goBack">返回</button>
    </div>

    <!-- 正文 -->
    <div v-else class="detail-body">
      <!-- 已撤销提示条 -->
      <div v-if="tx.reversed_by" class="reversed-banner">该笔已被撤销</div>

      <!-- 金额 + 类型 -->
      <section class="card amount-card">
        <div class="amount" :class="amountClass">{{ formatSignedAmount(tx.amount, tx.type) }}</div>
        <span class="type-tag" :class="`is-${tx.type}`">{{ txTypeLabel(tx.type) }}</span>
      </section>

      <!-- 明细行 -->
      <section class="card">
        <!-- 分类：转账无分类行（04 §2.3）；分类已删时按 id 查不到 → 快照中性灰，不显示「已删除」 -->
        <div v-if="!isTransfer" class="row">
          <span class="row-label">分类</span>
          <span class="row-value is-cat">
            <IconBox :name="catStore.resolveCat(tx).icon" :tint="catStore.resolveCat(tx).tint" :size="24" />
            {{ catStore.resolveCat(tx).name }}
          </span>
        </div>
        <div class="row">
          <span class="row-label">账户</span>
          <!-- 转账：A → B -->
          <span class="row-value">{{ isTransfer ? accountLine : tx.account_name || tx.account_id }}</span>
        </div>
        <!-- 对方（Phase 4）：contact 空值时 JSON 字段整体不出现（§B18）→ 真值判断 -->
        <div v-if="tx.contact" class="row">
          <span class="row-label">对方</span>
          <span class="row-value">{{ tx.contact }}</span>
        </div>
        <div class="row">
          <span class="row-label">时间</span>
          <span class="row-value">{{ formatDateTime(tx.happened_at) }}</span>
        </div>
        <!-- 备注：空则整行不显示 -->
        <div v-if="tx.note" class="row">
          <span class="row-label">备注</span>
          <span class="row-value">{{ tx.note }}</span>
        </div>
        <!-- 口径：两个开关都关时整行不显示 -->
        <div v-if="caliberText" class="row">
          <span class="row-label">口径</span>
          <span class="row-value is-caliber">{{ caliberText }}</span>
        </div>
        <!-- 来源：普通笔（source = ''）不显示 -->
        <div v-if="sourceLabel" class="row">
          <span class="row-label">来源</span>
          <span class="row-value">{{ sourceLabel }}</span>
        </div>
        <!-- 核销进度（Phase 4）：中性色，不用红绿 -->
        <div v-if="showProgress" class="row">
          <span class="row-label">{{ progressLabel }}</span>
          <span class="row-value is-progress">{{ progressText }}</span>
        </div>
      </section>

      <!-- 核销动作（Phase 4）：仅原笔 + 未撤销 + 未结清 > 0.005 才显示 -->
      <button
        v-if="settleAction && openAmount > 0.005"
        type="button"
        class="settle-btn"
        @click="settleShow = true"
      >
        {{ settleAction.label }}
      </button>

      <!-- 记录信息 -->
      <section class="card">
        <div class="row">
          <span class="row-label">创建于</span>
          <span class="row-value">{{ formatDateTime(tx.created_at) }}</span>
        </div>
        <div v-if="!createdUpdatedSame" class="row">
          <span class="row-label">更新于</span>
          <span class="row-value">{{ formatDateTime(tx.updated_at) }}</span>
        </div>
      </section>

      <!-- 操作区 -->
      <div class="action-row">
        <button v-if="canEdit" type="button" class="action-btn is-primary" @click="sheetShow = true">
          编辑
        </button>
        <button v-if="canReverse" type="button" class="action-btn" @click="onReverse">
          撤销
        </button>
        <button type="button" class="action-btn is-danger" @click="onDelete">删除</button>
      </div>
    </div>

    <!-- 编辑浮层（编辑态；保存后留在详情页并重新拉取） -->
    <TransactionEditSheet
      v-model:show="sheetShow"
      :accounts="financeStore.accounts"
      :transaction="tx"
      :on-save="onTxSave"
    />

    <!-- 核销浮层（Phase 4：记报销到账 / 记收回 / 记还回 / 记退款 四动作共用） -->
    <SettleSheet
      v-if="tx && settleAction"
      v-model:show="settleShow"
      :action="settleAction"
      :original="tx"
      :open-amount="openAmount"
      @saved="onSettled"
    />
  </div>
</template>

<style lang="scss" scoped>
/* 顶层二级页：自己管滚动（见 subpage.scss 的 .sub-page 契约），不写 height:100% */
.tx-detail-page {
  min-height: var(--app-height);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
}

.detail-nav {
  background: var(--color-bg-app);
  :deep(.van-nav-bar__title) {
    font-size: var(--fs-body);
    font-weight: 600;
  }
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  padding: var(--space-3) var(--space-4) var(--space-6);
}

.card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
}

/* ==================== 已撤销提示条 ==================== */
.reversed-banner {
  padding: 10px var(--space-3);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  text-align: center;
}

/* ==================== 金额卡 ==================== */
.amount-card {
  text-align: center;
  padding: var(--space-4) var(--space-4);
}
.amount {
  font-size: var(--fs-metric-lg);
  font-weight: 700;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;

  &.is-income { color: var(--color-success); }
  &.is-expense { color: var(--color-danger); }
  &.is-transfer { color: var(--color-text-primary); }
}
.type-tag {
  display: inline-block;
  margin-top: var(--space-2);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--fs-caption-sm);

  &.is-expense { background: var(--color-danger-light); color: var(--color-danger); }
  &.is-income { background: var(--color-success-light); color: var(--color-success); }
  &.is-transfer { background: var(--color-bg-hover); color: var(--color-text-secondary); }
}

/* ==================== 明细行 ==================== */
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 9px 0;

  &:not(:last-child) { border-bottom: 1px solid var(--color-border-light); }
}
.row-label {
  flex-shrink: 0;
  width: 3.5em;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.row-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  word-break: break-word;

  &.is-cat {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  &.is-caliber { color: var(--color-text-secondary); }
  /* 核销进度：中性色（05 §B.4.3：不用红绿 —— 它不是收支） */
  &.is-progress {
    color: var(--color-text-secondary);
    font-family: var(--font-num);
  }
}

/* ==================== 核销按钮 ==================== */
.settle-btn {
  display: block;
  width: 100%;
  height: 46px;
  margin-bottom: var(--space-3);
  border: 0;
  border-radius: var(--radius-base);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.98); background: var(--color-primary-dark); }
}

/* ==================== 操作区 ==================== */
.action-row {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.action-btn {
  flex: 1;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); background: var(--color-bg-hover); }

  &.is-primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #FFFFFF;
    &:active { background: var(--color-primary-dark); }
  }
  &.is-danger {
    border-color: transparent;
    background: var(--color-danger-light);
    color: var(--color-danger);
    &:active { background: var(--color-danger-light); opacity: 0.85; }
  }
}

/* ==================== 错误 / 骨架 ==================== */
.panel-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 0;
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}
.retry-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid currentColor;
  border-radius: 13px;
  background: transparent;
  color: var(--color-primary);
  font-size: var(--fs-caption-sm);
  cursor: pointer;
}
.ghost-btn {
  display: block;
  width: 100%;
  height: 42px;
  margin-top: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  cursor: pointer;
  &:active { background: var(--color-bg-hover); }
}

.skel-amount {
  height: 44px;
  width: 60%;
  margin: var(--space-4) auto var(--space-3);
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  animation: skel-pulse 1.2s ease-in-out infinite;
}
.skel-row {
  height: 16px;
  margin: 14px var(--space-2);
  border-radius: 6px;
  background: var(--color-bg-hover);
  animation: skel-pulse 1.2s ease-in-out infinite;
}
@keyframes skel-pulse {
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
}
</style>
