<script lang="ts">
/**
 * 核销动作描述（父级按原笔 source + 未结清态推导）。
 * ⚠️ 必须从普通 script 块导出（<script setup> 不允许 ES module exports）。
 */
export interface SettleAction {
  /** reimburse | lend | borrow | refund */
  key: string
  /** 按钮文案，如「记报销到账」 */
  label: string
  /** 生成的流水类型 */
  settleType: 'income' | 'expense'
  /** 生成的流水 source（与原笔一致） */
  source: string
}
</script>

<script setup lang="ts">
/**
 * SettleSheet —— 核销小表单（移动端 · Phase 4 · 05 §B/C/D）
 *
 * 四个动作共用一个组件（从原笔详情页发起，D44/D45）：
 *   待报销 → 记报销到账（income  + source=reimburse + settle_of）
 *   借出   → 记收回      （income  + source=lend      + settle_of）
 *   借入   → 记还回      （expense + source=borrow    + settle_of）
 *   退款   → 记退款      （income  + source=refund    + settle_of）
 *
 * 字段：金额（默认 = 未结清额，可改 → 部分核销 Q13）/ 账户 / 日期时间 / 备注。
 * 写入（05 §B.2.3）：两个口径 flag 全 1（不进统计、不占预算）；contact 从原笔
 * 继承（前端也带上，后端强制继承兜底）；退款继承原支出分类（Q10）。
 *
 * 提交走 financeStore.createTransaction（真实流水驱动余额，D43），
 * 成功后 emit('saved') —— 父级负责重拉详情；⚠️ 核销后要同时刷
 * transactions 与 debts（createTransaction 已刷 transactions + accounts，
 * debts 由父级在 saved 回调里 fetchDebts）。
 */
import { reactive, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { resolveAccountIcon } from '@/utils/category-dict'
import IconBox from '@/components/IconBox.vue'
import DateTimePicker from '@/components/finance/DateTimePicker.vue'
import { formatMoney, todayDate, wallClockISOFrom } from '@/utils/date'
import type { CreateTransactionReq, Transaction } from '@/api/types'

interface Props {
  show: boolean
  action: SettleAction
  /** 原笔（settle_of 指向它；contact 从它继承） */
  original: Transaction
  /** 未结清金额（原笔 amount − 已核销额，父级算好） */
  openAmount: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved'): void
}>()

const financeStore = useFinanceStore()

const form = reactive<{
  amount: number
  account_id: string
  /** YYYY-MM-DD HH:mm */
  happened_at: string
  note: string
}>({
  amount: 0,
  account_id: '',
  happened_at: '',
  note: '',
})

const amountError = ref('')
const submitting = ref(false)
const datePickerShow = ref(false)

/** 本地时刻 HH:mm（默认 = 现在） */
function nowHM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    // 金额默认 = 未结清额（可改，支持部分核销）；账户默认 = 原笔账户；日期 = 现在
    form.amount = Number(props.openAmount.toFixed(2))
    form.account_id = props.original.account_id || financeStore.accounts[0]?.id || ''
    form.happened_at = `${todayDate()} ${nowHM()}`
    form.note = ''
    amountError.value = ''
    datePickerShow.value = false
  }
)

function close() {
  if (submitting.value) return
  emit('update:show', false)
}

function openDatePicker(): void {
  datePickerShow.value = true
}

function validate(): boolean {
  const v = Number(form.amount)
  if (!v || v <= 0) {
    amountError.value = '请输入金额'
    return false
  }
  // 不允许超额核销（未结清不为负，07 §4.3 验收：超额显示 0 不显示负数）
  if (v > props.openAmount + 0.004) {
    amountError.value = `不能超过未结清 ¥${formatMoney(props.openAmount)}`
    return false
  }
  if (!form.account_id) {
    amountError.value = '请选择账户'
    return false
  }
  amountError.value = ''
  return true
}

async function handleSave(): Promise<void> {
  if (!validate()) return
  submitting.value = true
  try {
    const isRefund = props.action.key === 'refund'
    const contactTrimmed = props.original.contact || ''
    const payload: CreateTransactionReq = {
      type: props.action.settleType,
      amount: Number(Number(form.amount).toFixed(2)),
      account_id: form.account_id,
      note: form.note.trim() || undefined,
      // 用户选的日期 + 时分（带本地时区偏移，与记一笔同语义）
      happened_at: wallClockISOFrom(form.happened_at),
      // 两个口径 flag 全 1（05 §B.2.3：不进收支、不占预算）
      exclude_budget: true,
      exclude_stats: true,
      source: props.action.source,
      // contact 从原笔继承（前端带上；后端强制继承兜底）
      contact: contactTrimmed || undefined,
      settle_of: props.original.id,
    }
    // 退款继承原支出分类（05 §D.3 / Q10）
    if (isRefund && props.original.category_id) {
      payload.category_id = props.original.category_id
      payload.category_emoji = props.original.category_emoji
      payload.category_name = props.original.category_name
    }
    const r = await financeStore.createTransaction(payload)
    if (r) {
      emit('update:show', false)
      emit('saved')
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[SettleSheet] save failed', e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（真机不被浮层压住）；关闭出口只留「取消」+ 点遮罩 -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '70%' }"
    round
    teleport="body"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="settle-sheet">
      <van-nav-bar
        :title="action.label"
        :left-text="submitting ? '' : '取消'"
        :left-arrow="false"
        :border="false"
        @click-left="close"
      >
        <template #right>
          <span class="save-btn" :class="{ 'is-disabled': submitting }" @click="handleSave">
            {{ submitting ? '保存中…' : '保存' }}
          </span>
        </template>
      </van-nav-bar>

      <div class="sheet-body">
        <!-- 原笔摘要 -->
        <div class="origin-card">
          <span class="origin-label">原笔</span>
          <span class="origin-value">
            ¥{{ formatMoney(original.amount) }}
            <template v-if="original.contact"> · {{ original.contact }}</template>
          </span>
          <span class="origin-open">未结清 ¥{{ formatMoney(openAmount) }}</span>
        </div>

        <!-- 金额 -->
        <div class="field-group">
          <div class="cell-label">金额</div>
          <div class="amount-row">
            <span class="currency">¥</span>
            <input
              v-model.number="form.amount"
              type="number"
              inputmode="decimal"
              class="amount-input"
              :class="{ 'has-error': !!amountError }"
              placeholder="0.00"
              :disabled="submitting"
            >
          </div>
          <div v-if="amountError" class="error-text">{{ amountError }}</div>
          <div class="hint">默认为未结清额，可改（部分核销）</div>
        </div>

        <!-- 账户 -->
        <div class="field-group">
          <div class="cell-label">账户</div>
          <div class="account-list">
            <button
              v-for="acc in financeStore.accounts"
              :key="acc.id"
              type="button"
              class="account-chip"
              :class="{ 'is-active': form.account_id === acc.id }"
              :disabled="submitting"
              @click="form.account_id = acc.id"
            >
              <IconBox
                :name="resolveAccountIcon(acc.icon).icon"
                :bg="resolveAccountIcon(acc.icon).vars.bg"
                :fg="resolveAccountIcon(acc.icon).vars.fg"
                :size="24"
                :icon-size="14"
              />
              <span class="acc-name">{{ acc.name }}</span>
            </button>
          </div>
        </div>

        <!-- 日期时间 -->
        <div class="field-group">
          <div class="cell-label">日期</div>
          <div class="date-row" role="button" aria-label="选择日期时间" @click="openDatePicker">
            <span class="date-text">{{ form.happened_at }}</span>
            <span class="date-arrow" aria-hidden="true">›</span>
          </div>
        </div>

        <!-- 备注 -->
        <div class="field-group">
          <van-field
            v-model="form.note"
            label=""
            placeholder="备注（选填）"
            maxlength="100"
            :disabled="submitting"
          />
        </div>

        <div class="bottom-hint" aria-hidden="true" />
      </div>

      <DateTimePicker v-model:show="datePickerShow" :value="form.happened_at" title="日期与时间" @confirm="(v: string) => (form.happened_at = v)" />
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.settle-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}

:deep(.van-nav-bar) {
  flex-shrink: 0;
  background: var(--color-bg-card);
}
:deep(.van-nav-bar__title) {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
:deep(.van-nav-bar__text) {
  color: var(--color-text-secondary);
  font-size: var(--fs-body);
}
.save-btn {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-primary);
  padding: 4px 8px;
  cursor: pointer;
  user-select: none;
  &.is-disabled { color: var(--color-text-disabled); cursor: not-allowed; }
}

.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.field-group {
  background: var(--color-bg-card);
  margin-bottom: 8px;
}
.cell-label {
  padding: 14px 16px 8px;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}

/* 原笔摘要 */
.origin-card {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-hover);
}
.origin-label {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.origin-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.origin-open {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
  font-family: var(--font-num);
}

/* 金额 */
.amount-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 16px 4px;
}
.currency {
  font-size: var(--fs-metric);
  font-weight: 700;
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.amount-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  font-size: var(--fs-metric-lg);
  font-weight: 700;
  color: var(--color-text-primary);
  background: transparent;
  border: 0;
  border-bottom: 1.5px solid var(--color-border-light);
  outline: none;
  font-family: var(--font-num);
  &:focus { border-bottom-color: var(--color-primary); }
  &.has-error { border-bottom-color: var(--color-danger); color: var(--color-danger); }
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  &[type=number] { -moz-appearance: textfield; }
}
.error-text {
  padding: 0 16px 8px;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
}
.hint {
  padding: 4px 16px 12px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* 账户 chip（与记一笔同款） */
.account-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px 16px;
}
.account-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.95); }
  &.is-active { font-weight: 600; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}
.acc-name { font-size: var(--fs-caption); color: var(--color-text-primary); }

/* 日期 */
.date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
.date-text {
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  font-family: var(--font-num);
}
.date-arrow {
  font-size: var(--fs-h4);
  color: var(--color-text-tertiary);
}

.bottom-hint { height: 24px; }
</style>
