<script setup lang="ts">
/**
 * AccountEditSheet —— 新建 / 编辑账户底部弹层（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/AccountManager.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance.go（CreateAccountReq）
 * 最后同步：2026-09-18（Phase 3.6）
 *
 * Phase 3.6 对齐三处（此前与桌面端不一致，会导致同一账户两端长相不同）：
 *   1. **`color` 语义**：桌面端把 `accounts.color` 当作**卡片底色**直接铺
 *      （`<div style={{background: a.color}}>`），存的是 pastel 值
 *      （🏦 #E0F2FF / 💳 #FFF3E0 / 💙 #F0E8FF / 💚 #E8F8F0）。
 *      移动端旧实现存的是深色主色（#014DB2…）再拼 '15' 透明度，
 *      两端读同一条记录 → 一个深蓝一个浅蓝。现统一按桌面端语义存 pastel。
 *   2. **图标选择器**：改用 `ACCOUNT_ICON_KEYS`（14 个，与桌面端同一份唯一真相），
 *      不再只有 4 个类型自带的图标。
 *   3. 余额输入改为支持两位小数（van-stepper 只吃整数，信用卡已用额度/余额常见小数）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ACCOUNT_ICON_KEYS, resolveAccountIcon } from '@/utils/category-dict'
import Icon from '@/components/icon/Icon.vue'
import type { Account, AccountType, CreateAccountReq } from '@/api/types'

interface Props {
  show: boolean
  account: Account | null
  onSave: (data: CreateAccountReq) => Promise<boolean>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
}>()

// ==================== 账户类型预设（与桌面端 ACCOUNT_PRESETS 逐字对齐）====================
interface AccountTypeOption {
  value: AccountType
  label: string
  /** 后端存储值（emoji） */
  icon: string
}

/**
 * 账户类型预设：图标 / 语义底色统一走字典（resolveAccountIcon），
 * 不再硬编码 pastel hex（#E0F2FF 等），避免与桌面端/统计页颜色不一致。
 */
const ACCOUNT_TYPES: AccountTypeOption[] = [
  { value: 'saving', label: '储蓄卡', icon: '🏦' },
  { value: 'credit', label: '信用卡', icon: '💳' },
  { value: 'huabei', label: '花呗', icon: '💙' },
  { value: 'wechat', label: '微信零钱', icon: '💚' },
]

/** 解析后的渲染元信息：图标名 + 语义底色/前景 */
const ACCOUNT_TYPE_UI = ACCOUNT_TYPES.map((t) => {
  const r = resolveAccountIcon(t.icon)
  return { ...t, iconName: r.icon, bg: r.vars.bg, fg: r.vars.fg }
})
function accountTypeUI(value: AccountType) {
  return ACCOUNT_TYPE_UI.find((t) => t.value === value) ?? ACCOUNT_TYPE_UI[0]
}

// ==================== 表单 ====================
const form = reactive<{
  name: string
  type: AccountType
  icon: string
  color: string
  balance: number
}>({
  name: '',
  type: 'saving',
  icon: ACCOUNT_TYPE_UI[0].icon,
  color: ACCOUNT_TYPE_UI[0].bg,
  balance: 0,
})

const nameError = ref('')
const balanceError = ref('')
/** 图标选择器展开态 */
const iconPickerShow = ref(false)
const submitting = ref(false)
const isEdit = computed(() => !!props.account)
const nameMax = 20

/** 当前图标解析（emoji → 语义色，用于预览） */
const currentIcon = computed(() => resolveAccountIcon(form.icon || ACCOUNT_TYPES[0].icon))

watch(
  () => props.show,
  (v) => {
    if (v) resetForm()
  }
)

function resetForm() {
  if (props.account) {
    const a = props.account
    form.name = a.name
    form.type = a.type
    form.icon = a.icon || accountTypeUI(a.type).icon
    form.color = a.color || accountTypeUI(a.type).bg
    form.balance = a.balance
  } else {
    form.name = ''
    form.type = ACCOUNT_TYPES[0].value
    form.icon = ACCOUNT_TYPE_UI[0].icon
    form.color = ACCOUNT_TYPE_UI[0].bg
    form.balance = 0
  }
  iconPickerShow.value = false
  nameError.value = ''
  balanceError.value = ''
}

/** 切类型时带出该类型的默认图标 + 底色（用户随后可再单独换图标） */
function applyType(t: AccountType) {
  const opt = accountTypeUI(t)
  form.type = t
  form.icon = opt.icon
  form.color = opt.bg
}

/** 选中自定义图标（只换图标，不动底色） */
function pickIcon(emoji: string) {
  form.icon = emoji
  iconPickerShow.value = false
}

function close() {
  if (submitting.value) return
  emit('update:show', false)
}

function validate(): boolean {
  let ok = true
  const v = form.name.trim()
  if (!v) {
    nameError.value = '请输入账户名'
    ok = false
  } else if (v.length > nameMax) {
    nameError.value = `账户名不能超过 ${nameMax} 字`
    ok = false
  } else {
    nameError.value = ''
  }
  const bal = Number(form.balance)
  if (Number.isNaN(bal)) {
    balanceError.value = '余额必须是数字'
    ok = false
  } else if (!isEdit.value && bal < 0) {
    balanceError.value = '初始余额不能为负'
    ok = false
  } else {
    balanceError.value = ''
  }
  return ok
}

function onNameInput() {
  if (nameError.value && form.name.trim()) nameError.value = ''
}
function onBalanceInput() {
  if (balanceError.value) balanceError.value = ''
}

/** 提交：校验通过后调父组件传入的 onSave（prop） */
async function handleSave() {
  if (!validate()) return
  submitting.value = true
  try {
    const payload: CreateAccountReq = {
      name: form.name.trim(),
      type: form.type,
      icon: form.icon,
      color: form.color,
      balance: Number(Number(form.balance).toFixed(2)),
    }
    const ok = await props.onSave(payload)
    if (ok) {
      emit('update:show', false)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[AccountEditSheet] save failed', e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留：iOS 上弹层会被页面滚动容器与布局层 chrome 压住
       （即便几何位置完全正确、z-index 已到 2001）。完整说明见
       components/period/PeriodDaySheet.vue 顶部注释。 -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '78%' }"
    round
    closeable
    teleport="body"
    close-icon-position="top-left"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="account-sheet">
      <van-nav-bar
        :title="isEdit ? '编辑账户' : '新建账户'"
        :left-text="submitting ? '' : '取消'"
        :left-arrow="false"
        :border="false"
        @click-left="close"
      >
        <template #right>
          <span
            class="save-btn"
            :class="{ 'is-disabled': submitting || !form.name.trim() }"
            @click="handleSave"
          >
            {{ submitting ? '保存中…' : '保存' }}
          </span>
        </template>
      </van-nav-bar>

      <div class="sheet-body">
        <!-- 账户名 + 图标 -->
        <div class="field-group">
          <div class="name-row">
            <button
              type="button"
              class="icon-trigger"
              :style="{ background: form.color }"
              :disabled="submitting"
              aria-label="选择账户图标"
              @click="iconPickerShow = true"
            >
              <Icon :name="currentIcon.icon" :size="20" :style="{ color: currentIcon.vars.fg }" />
            </button>
            <input
              v-model="form.name"
              type="text"
              class="name-input"
              :class="{ 'has-error': !!nameError }"
              placeholder="账户名（必填）"
              :maxlength="nameMax"
              :disabled="submitting"
              @input="onNameInput"
            >
          </div>
          <div v-if="nameError" class="error-text">{{ nameError }}</div>
        </div>

        <!-- 类型 -->
        <div class="field-group">
          <div class="cell-label">账户类型</div>
          <div class="type-grid">
            <button
              v-for="t in ACCOUNT_TYPE_UI"
              :key="t.value"
              type="button"
              class="type-item"
              :class="{ 'is-active': form.type === t.value }"
              :style="form.type === t.value ? { background: t.bg, borderColor: 'var(--color-primary)' } : {}"
              :disabled="submitting"
              @click="applyType(t.value)"
            >
              <Icon class="type-emoji" :name="t.iconName" :size="20" :style="{ background: t.bg, color: t.fg }" />
              <span class="type-label">{{ t.label }}</span>
            </button>
          </div>
          <div class="hint">切换类型会带出该类型默认图标与底色，不影响已有账户</div>
        </div>

        <!-- 余额 -->
        <div class="field-group">
          <div class="cell-label">{{ isEdit ? '余额' : '初始余额' }}</div>
          <div class="balance-row">
            <span class="currency">¥</span>
            <input
              v-model.number="form.balance"
              type="number"
              class="balance-input"
              :class="{ 'has-error': !!balanceError }"
              placeholder="0.00"
              inputmode="decimal"
              :disabled="submitting"
              @input="onBalanceInput"
            >
          </div>
          <div v-if="balanceError" class="error-text">{{ balanceError }}</div>
          <div class="hint">信用卡 / 花呗 请填已用额度（正数）</div>
        </div>

        <div class="bottom-hint" aria-hidden="true" />
      </div>

      <!-- 图标选择器（14 个，与桌面端同一份 ACCOUNT_ICON_KEYS）
           teleport 必留：父级 .van-popup 自带 overflow-y:auto，嵌套弹层同样会被困住 -->
      <van-popup v-model:show="iconPickerShow" position="bottom" round teleport="body">
        <div class="icon-picker">
          <h4 class="ip-title">选择图标</h4>
          <div class="ip-grid">
            <button
              v-for="k in ACCOUNT_ICON_KEYS"
              :key="k.emoji"
              type="button"
              class="ip-item"
              :class="{ 'is-active': form.icon === k.emoji }"
              :style="form.icon === k.emoji
                ? { background: k.vars.bg, borderColor: 'var(--color-primary)' }
                : {}"
              :aria-label="k.label"
              @click="pickIcon(k.emoji)"
            >
              <Icon class="ip-emoji" :name="k.icon" :size="20" :style="{ background: k.vars.bg, color: k.vars.fg }" />
            </button>
          </div>
          <div class="ip-foot">当前：<Icon :name="currentIcon.icon" :size="16" :style="{ color: currentIcon.vars.fg }" /></div>
        </div>
      </van-popup>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.account-sheet {
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
  padding: 8px 0;
}
.field-group {
  background: var(--color-bg-card);
  margin-bottom: 8px;
  padding-bottom: 4px;
}

/* 名称 + 图标 */
.name-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 10px;
}
.icon-trigger {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.95); }
  &:disabled { opacity: 0.6; }
}
.name-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 10px;
  outline: none;
  &:focus { border-color: var(--color-primary); background: var(--color-bg-card); }
  &.has-error { border-color: var(--color-danger); }
  &::placeholder { font-weight: 400; color: var(--color-text-disabled); }
}
.error-text {
  padding: 0 16px 8px;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
}

.cell-label {
  padding: 14px 16px 8px;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 0 16px 12px;
}
.type-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
  &.is-active { font-weight: 600; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.type-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 22px;
  border-radius: 10px;
  line-height: 1;
}
.type-label {
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
}
.type-item.is-active .type-label { color: var(--color-primary); font-weight: 600; }

.balance-row {
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
.balance-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  /* 数值阶令牌：金额输入用大号数值 */
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
.hint {
  padding: 4px 16px 12px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* 图标选择器 */
.icon-picker {
  padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 0px));
}
.ip-title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 14px;
  text-align: center;
}
.ip-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}
.ip-item {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 0;
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.94); }
  &.is-active { border-color: var(--color-primary); }
}
.ip-emoji { font-size: 20px; line-height: 1; }
.ip-foot {
  margin-top: 14px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  text-align: center;
}

.bottom-hint { height: 24px; }
</style>
