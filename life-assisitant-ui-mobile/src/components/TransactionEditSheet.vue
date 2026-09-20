<script setup lang="ts">
/**
 * TransactionEditSheet —— 交易新建 / 编辑 / 转账底部弹层（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/TransactionEditDrawer.tsx
 *                    （defaultType / accounts / onSubmit 三件套）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance.go
 * 最后同步：2026-09-18（Phase 3.4）
 *
 * Phase 3.4 新增：
 *   - **编辑模式**：传 `transaction` 即进入编辑（后端 `PATCH /transactions/:id`）
 *     ⚠️ `UpdateTransactionReq` 只接受 amount / category_emoji / category_name /
 *        account_id / happened_at / note —— **type 与转账双方不可改**，
 *        所以编辑模式锁定类型切换；transfer 类型直接不允许编辑（由父级拦截）。
 *   - `defaultType`：父级可指定打开时的类型（账户区的「转账」按钮传 transfer）。
 *   - 类别列表改查 `utils/category-dict` 的 EXPENSE_CATEGORIES / INCOME_CATEGORIES
 *     —— 旧实现自带的 emoji（🛍 / 🎮 / 📌）与字典/后端存储值（🛍️ / 🎬 / 📦）不一致，
 *     会导致「记完一笔，列表里的分类图标与预算页对不上」。
 *
 * ⚠️ happened_at 语义（保留 Phase 0 的修复）：
 *   用户只选日期，时间取当前时刻，且必须带**本地时区偏移**
 *   —— 旧实现把 UTC 时分秒拼到本地日期上再标 Z，东八区整体偏 8 小时。
 */
import { computed, reactive, ref, watch } from 'vue'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, resolveAccountIcon } from '@/utils/category-dict'
import Icon from '@/components/icon/Icon.vue'
import { todayDate, todayWallClockISO } from '@/utils/date'
import type {
  Account,
  CreateTransactionReq,
  Transaction,
  TransactionType,
  TransferReq,
  UpdateTransactionReq,
} from '@/api/types'

interface Props {
  show: boolean
  accounts: Account[]
  /** 编辑模式：传入待编辑交易（transfer 不支持编辑，父级应拦截） */
  transaction?: Transaction | null
  /** 新建模式下的默认类型 */
  defaultType?: TransactionType
  onSave: (
    data: CreateTransactionReq | TransferReq | UpdateTransactionReq,
    type: TransactionType,
    mode: 'create' | 'update'
  ) => Promise<boolean>
}

const props = withDefaults(defineProps<Props>(), {
  transaction: null,
  defaultType: 'expense',
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
}>()

// ==================== 类型 radio ====================
const TYPES: Array<{ value: TransactionType; label: string }> = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
]

// ==================== 类别（唯一真相：category-dict）====================
/** 支出 / 收入分类，emoji 即后端存储值 */
const CATEGORY_OPTIONS = computed(() => {
  const src = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  return src.map((c) => ({ emoji: c.emoji, icon: c.icon, vars: c.vars, name: c.label, for: form.type }))
})

// ==================== 表单 ====================
const form = reactive<{
  type: TransactionType
  amount: number
  category_emoji: string
  category_name: string
  account_id: string
  to_account_id: string
  note: string
  happened_at: string // YYYY-MM-DD
}>({
  type: 'expense',
  amount: 0,
  category_emoji: EXPENSE_CATEGORIES[0].emoji,
  category_name: EXPENSE_CATEGORIES[0].label,
  account_id: '',
  to_account_id: '',
  note: '',
  happened_at: todayDate(),
})

const amountError = ref('')
const accountError = ref('')
const submitting = ref(false)

const isTransfer = computed(() => form.type === 'transfer')
const hasAccounts = computed(() => props.accounts.length > 0)
/** 编辑模式 */
const isEdit = computed(() => !!props.transaction)
/** 编辑模式下类型不可改（后端 UpdateTransactionReq 无 type 字段） */
const typeLocked = computed(() => isEdit.value)

watch(
  () => props.show,
  (v) => {
    if (v) resetForm()
  }
)

/** 取某类型的首个分类 */
function firstCategoryOf(type: 'expense' | 'income') {
  const src = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  return src[0]
}

function resetForm() {
  const tx = props.transaction
  if (tx) {
    // 编辑：回填
    form.type = tx.type
    form.amount = tx.amount
    form.category_emoji = tx.category_emoji || ''
    form.category_name = tx.category_name || ''
    form.account_id = tx.account_id
    form.to_account_id = tx.to_account_id || ''
    form.note = tx.note || ''
    // happened_at 是 ISO datetime → 截出本地日期部分
    form.happened_at = tx.happened_at ? tx.happened_at.slice(0, 10) : todayDate()
  } else {
    const t = props.defaultType
    form.type = t
    form.amount = 0
    if (t === 'transfer') {
      form.category_emoji = ''
      form.category_name = ''
    } else {
      const c = firstCategoryOf(t === 'income' ? 'income' : 'expense')
      form.category_emoji = c.emoji
      form.category_name = c.label
    }
    form.account_id = props.accounts[0]?.id || ''
    form.to_account_id = props.accounts[1]?.id || ''
    form.note = ''
    form.happened_at = todayDate()
  }
  amountError.value = ''
  accountError.value = ''
}

function close() {
  if (submitting.value) return
  emit('update:show', false)
}

/** 切换类型时重置类别 / 账户默认值 */
function onTypeChange(t: TransactionType) {
  if (typeLocked.value) return
  form.type = t
  if (t === 'transfer') {
    form.category_emoji = ''
    form.category_name = ''
    if (form.account_id === form.to_account_id && props.accounts.length >= 2) {
      form.to_account_id = props.accounts.find((a) => a.id !== form.account_id)?.id || ''
    }
  } else {
    const c = firstCategoryOf(t === 'income' ? 'income' : 'expense')
    form.category_emoji = c.emoji
    form.category_name = c.label
  }
}

function selectCategory(c: { emoji: string; name: string }) {
  form.category_emoji = c.emoji
  form.category_name = c.name
}

function validate(): boolean {
  let ok = true
  if (!form.amount || form.amount <= 0) {
    amountError.value = '请输入金额'
    ok = false
  } else {
    amountError.value = ''
  }
  if (!form.account_id) {
    accountError.value = '请选择账户'
    ok = false
  } else if (isTransfer.value && !form.to_account_id) {
    accountError.value = '请选择目标账户'
    ok = false
  } else if (isTransfer.value && form.to_account_id === form.account_id) {
    accountError.value = '转入转出不能相同'
    ok = false
  } else {
    accountError.value = ''
  }
  return ok
}

/** 提交：校验通过后调父组件传入的 onSave */
async function handleSave() {
  if (!validate()) return
  submitting.value = true
  try {
    // 用户只选了日期，时间取当前时刻，并带上本地时区偏移
    const isoHappened = todayWallClockISO(form.happened_at)
    let ok = false

    if (isEdit.value) {
      // 编辑：只发可改字段（无 type / 无 transfer 双方）
      const payload: UpdateTransactionReq = {
        amount: Number(form.amount),
        account_id: form.account_id,
        happened_at: isoHappened,
        note: form.note.trim() || undefined,
        category_emoji: form.category_emoji || undefined,
        category_name: form.category_name || undefined,
      }
      ok = await props.onSave(payload, form.type, 'update')
    } else if (isTransfer.value) {
      const payload: TransferReq = {
        from_account_id: form.account_id,
        to_account_id: form.to_account_id,
        amount: Number(form.amount),
        note: form.note.trim() || undefined,
        happened_at: isoHappened,
      }
      ok = await props.onSave(payload, 'transfer', 'create')
    } else {
      const payload: CreateTransactionReq = {
        type: form.type,
        amount: Number(form.amount),
        category_emoji: form.category_emoji,
        category_name: form.category_name,
        account_id: form.account_id,
        note: form.note.trim() || undefined,
        happened_at: isoHappened,
      }
      ok = await props.onSave(payload, form.type, 'create')
    }

    if (ok) emit('update:show', false)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[TransactionEditSheet] save failed', e)
  } finally {
    submitting.value = false
  }
}

function onAmountInput() {
  if (amountError.value && form.amount > 0) amountError.value = ''
}
function onAccountChange() {
  if (accountError.value) accountError.value = ''
}

/** 标题 */
const sheetTitle = computed(() => {
  if (isEdit.value) return '编辑交易'
  return isTransfer.value ? '转账' : '记一笔'
})
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（iOS 弹层层叠坑，说明见 components/period/PeriodDaySheet.vue） -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '90%' }"
    round
    closeable
    teleport="body"
    close-icon-position="top-left"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="tx-sheet">
      <van-nav-bar
        :title="sheetTitle"
        :left-text="submitting ? '' : '取消'"
        :left-arrow="false"
        :border="false"
        @click-left="close"
      >
        <template #right>
          <span
            class="save-btn"
            :class="{ 'is-disabled': submitting || !form.amount }"
            @click="handleSave"
          >
            {{ submitting ? '保存中…' : '保存' }}
          </span>
        </template>
      </van-nav-bar>

      <div class="sheet-body">
        <!-- 无账户时提示 -->
        <div v-if="!hasAccounts" class="no-account">
          <Icon class="empty-emoji" name="Landmark" :size="32" aria-hidden="true" />
          <h3>还没有账户</h3>
          <p>请先在「账户」区创建账户</p>
        </div>

        <template v-else>
          <!-- 1. 类型选择（编辑模式锁定） -->
          <div class="field-group">
            <van-tabs
              :active="form.type"
              :animated="false"
              :swipeable="false"
              :line-width="20"
              :line-height="3"
              title-active-color="#014DB2"
              title-inactive-color="#6B7280"
              color="#014DB2"
              @change="(n: string | number) => onTypeChange(n as TransactionType)"
            >
              <van-tab
                v-for="t in TYPES"
                :key="t.value"
                :title="t.label"
                :name="t.value"
                :disabled="typeLocked && t.value !== form.type"
              />
            </van-tabs>
            <div v-if="typeLocked" class="lock-hint">编辑时不可更改交易类型</div>
          </div>

          <!-- 2. 金额 -->
          <div class="field-group amount-card">
            <div class="amount-wrap">
              <span class="currency">¥</span>
              <input
                v-model.number="form.amount"
                type="number"
                class="amount-input"
                :class="{ 'has-error': !!amountError }"
                placeholder="0.00"
                inputmode="decimal"
                :disabled="submitting"
                @input="onAmountInput"
              >
            </div>
            <div v-if="amountError" class="error-text">{{ amountError }}</div>
          </div>

          <!-- 3. 类别（仅 expense / income） -->
          <div v-if="!isTransfer" class="field-group">
            <div class="cell-label">类别</div>
            <div class="cat-grid">
              <button
                v-for="c in CATEGORY_OPTIONS"
                :key="c.emoji + c.name"
                type="button"
                class="cat-item"
                :class="{ 'is-active': form.category_emoji === c.emoji && form.category_name === c.name }"
                :disabled="submitting"
                @click="selectCategory(c)"
              >
                <Icon class="cat-emoji" :name="c.icon" :size="20" :style="{ color: c.vars.fg }" />
                <span class="cat-name">{{ c.name }}</span>
              </button>
            </div>
          </div>

          <!-- 4. 账户 / 转账 -->
          <div v-if="!isTransfer" class="field-group">
            <div class="cell-label">账户</div>
            <div class="account-list">
              <button
                v-for="acc in accounts"
                :key="acc.id"
                type="button"
                class="account-chip"
                  :class="{ 'is-active': form.account_id === acc.id }"
                  :style="form.account_id === acc.id
                    ? { background: resolveAccountIcon(acc.icon).vars.bg, borderColor: resolveAccountIcon(acc.icon).vars.fg }
                    : {}"
                  :disabled="submitting"
                  @click="onAccountChange(); form.account_id = acc.id"
              >
                <Icon
                  class="acc-emoji"
                  :name="resolveAccountIcon(acc.icon).icon"
                  :size="16"
                  :style="{ background: resolveAccountIcon(acc.icon).vars.bg, color: resolveAccountIcon(acc.icon).vars.fg }"
                />
                <span class="acc-name">{{ acc.name }}</span>
              </button>
            </div>
          </div>

          <div v-else class="field-group">
            <div class="cell-label">从</div>
            <div class="account-list">
              <button
                v-for="acc in accounts"
                :key="acc.id"
                type="button"
                class="account-chip"
                :class="{ 'is-active': form.account_id === acc.id }"
                :disabled="submitting"
                @click="form.account_id = acc.id"
              >
                <Icon
                  class="acc-emoji"
                  :name="resolveAccountIcon(acc.icon).icon"
                  :size="16"
                  :style="{ background: resolveAccountIcon(acc.icon).vars.bg, color: resolveAccountIcon(acc.icon).vars.fg }"
                />
                <span class="acc-name">{{ acc.name }}</span>
              </button>
            </div>
            <div class="cell-label">到</div>
            <div class="account-list">
              <button
                v-for="acc in accounts"
                :key="'to-' + acc.id"
                type="button"
                class="account-chip"
                :class="{ 'is-active': form.to_account_id === acc.id }"
                :disabled="submitting || acc.id === form.account_id"
                @click="form.to_account_id = acc.id"
              >
                <Icon
                  class="acc-emoji"
                  :name="resolveAccountIcon(acc.icon).icon"
                  :size="16"
                  :style="{ background: resolveAccountIcon(acc.icon).vars.bg, color: resolveAccountIcon(acc.icon).vars.fg }"
                />
                <span class="acc-name">{{ acc.name }}</span>
              </button>
            </div>
          </div>

          <div v-if="accountError" class="error-text error-account">{{ accountError }}</div>

          <!-- 5. 备注 -->
          <div class="field-group">
            <van-field
              v-model="form.note"
              label=""
              placeholder="备注（选填）"
              maxlength="100"
              :disabled="submitting"
            />
          </div>

          <!-- 6. 日期 -->
          <div class="field-group">
            <div class="cell-label">日期</div>
            <div class="date-row">
              <span class="date-text">{{ form.happened_at }}</span>
              <input
                v-model="form.happened_at"
                type="date"
                class="date-input"
                :disabled="submitting"
              >
            </div>
          </div>
        </template>

        <div class="bottom-hint" aria-hidden="true" />
      </div>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.tx-sheet {
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
.lock-hint {
  padding: 6px 16px 10px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

.no-account {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 24px;
  text-align: center;
  h3 {
    font-size: var(--fs-h4);
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 6px;
  }
  p {
    font-size: var(--fs-caption);
    color: var(--color-text-tertiary);
    margin: 0;
  }
}
.empty-emoji { margin-bottom: 16px; opacity: 0.6; }

/* 金额大输入 */
.amount-card {
  padding: 24px 16px;
  text-align: center;
}
.amount-wrap {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
}
.currency {
  /* 数值阶令牌：与本 sheet 的金额主展示（--fs-metric-xl）配套 */
  font-size: var(--fs-metric-lg);
  font-weight: 700;
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.amount-input {
  width: 70%;
  max-width: 280px;
  font-size: var(--fs-metric-xl);
  font-weight: 700;
  text-align: center;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--color-text-primary);
  font-family: var(--font-num);
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  &[type=number] { -moz-appearance: textfield; }
  &::placeholder { color: var(--color-text-disabled); }
  &.has-error { color: var(--color-danger); }
}

.error-text {
  margin-top: 8px;
  padding: 0 16px;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
  text-align: center;
}
.error-account { text-align: left; padding: 4px 16px 0; }

/* 类别 grid */
.cat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 0 16px 16px;
}
.cat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.95); }
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.cat-emoji { display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
.cat-name { font-size: var(--fs-micro); color: var(--color-text-primary); }
.cat-item.is-active .cat-name { color: var(--color-primary); font-weight: 600; }

/* 账户 chip */
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
.acc-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  line-height: 1;
}
.acc-name { font-size: var(--fs-caption); color: var(--color-text-primary); }
.account-chip.is-active .acc-name { color: inherit; }

/* 日期 */
.date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 16px;
}
.date-text {
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  font-family: var(--font-num);
}
.date-input {
  font-size: var(--fs-caption);
  color: var(--color-primary);
  background: var(--color-primary-light);
  border: 0;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-family: var(--font-num);
}

.bottom-hint { height: 24px; }
</style>
