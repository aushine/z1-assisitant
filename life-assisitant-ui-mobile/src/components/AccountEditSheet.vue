<script setup lang="ts">
/**
 * AccountEditSheet —— 新建 / 编辑账户底部弹层（移动端）
 *
 * spec-20260922-v1 Phase 3 重构（01 §6.1 / §8.3.2、02 §7）：
 *   1. 类型选择改 **3 组宫格**（资金 8 / 信用 5 / 理财 5，分组标题 ACCOUNT_CATEGORIES），
 *      18 项带品牌 logo；needsInstitution 的项带 `›`（点类型即进银行选择器）。
 *   2. 「银行」行仅 needsInstitution 时渲染；loan / deposit 标注「可选」（B10），
 *      saving / credit 必选（未选银行不给提交）；选银行 → 图标自动换该行 logo（D22 最高优先级）。
 *   3. 余额输入动态化：信用类 label「欠款」+ placeholder 提示 + 默认 `−` 前缀辅助；
 *      旧 hint「填已用额度（正数）」已废弃（D14：信用类余额直接存负数）。
 *   4. 类型可改（Q5/§A2）：跨 asset↔credit 行内提示 + **保存时**余额自动取负
 *      （只取一次：以最终类别对比初始类别为准，多次切换不连乘）；跨 investment 仅提示。
 *   5. 图标行 D28：brand 引用（含已选银行）→ 整行只读（隐藏入口非置灰）；
 *      否则可点开 IconPicker（仅 lucide，复用 finance/IconPicker.vue）。
 *   6. Q10/§A3：编辑存量 emoji 账户且未主动换图标 → 保存时顺手换成对应 lucide
 *      （ACCOUNT_ICON_KEYS 既有映射；映射缺的保留 emoji）。
 *
 * ⚠️ v2 共存（05 §A.5）：「不记录收支」开关（仅编辑态）与 record_flow 语义不变 ——
 *    编辑保存默认显式传 true（生成余额调整流水），勾选后传 false；新建不传。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ACCOUNT_ICON_KEYS, resolveAccountIcon } from '@/utils/category-dict'
import {
  ACCOUNT_TYPES,
  ACCOUNT_CATEGORIES,
  accountCategoryOf,
  accountTypeDefOf,
  type AccountCategory,
  type AccountType,
} from '@/constants/account'
import { BANKS } from '@/constants/banks'
import IconBox from '@/components/IconBox.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import IconPicker from '@/components/finance/IconPicker.vue'
import BankPicker from '@/components/finance/BankPicker.vue'
import type { IconName } from '@/components/icon/names'
import type { Account, CreateAccountReq } from '@/api/types'

interface Props {
  show: boolean
  account: Account | null
  onSave: (data: CreateAccountReq & { record_flow?: boolean }) => Promise<boolean>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
}>()

// ==================== 常量 ====================
/** 卡片底色 pastel（沿用 v2 语义：color = 卡片底色，非深色主色） */
const CATEGORY_PASTELS: Record<AccountCategory, string> = {
  asset: '#E0F2FF',
  credit: '#FFF3E0',
  investment: '#E8F8F0',
}
/** 宫格里 lucide 默认图标的语义色（按 L1 大类） */
const CATEGORY_TINTS: Record<AccountCategory, 'success' | 'warning' | 'accent'> = {
  asset: 'success',
  credit: 'warning',
  investment: 'accent',
}
const nameMax = 20

function bankOfCode(code: string) {
  return code ? BANKS.find((b) => b.code === code) : undefined
}
function lucideNameOf(icon: string): IconName {
  return icon.slice('lucide:'.length) as IconName
}

// ==================== 表单状态 ====================
const form = reactive<{
  name: string
  type: AccountType
  icon: string
  color: string
  balance: number
  institution: string
}>({
  name: '',
  type: 'saving',
  icon: accountTypeDefOf('saving')?.icon ?? '💰',
  color: CATEGORY_PASTELS.asset,
  balance: 0,
  institution: '',
})

const nameError = ref('')
const balanceError = ref('')
const bankError = ref('')
const noFlow = ref(false)
const submitting = ref(false)
const isEdit = computed(() => !!props.account)

/** 图标选择器 / 银行选择器展开态 */
const iconPickerShow = ref(false)
const bankPickerShow = ref(false)

/** 打开时的初始类别 / 初始图标（跨类取负与 Q10 判定的基准） */
const initialType = ref<AccountType>('saving')
const initialIcon = ref('')

/** 信用类「默认 − 前缀」辅助态：首次输入正数时一次性取负 */
const negPrefix = ref(false)

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
    form.icon = a.icon || accountTypeDefOf(a.type)?.icon || '💰'
    form.color = a.color || CATEGORY_PASTELS[accountCategoryOf(a.type)]
    form.balance = a.balance
    form.institution = a.institution || ''
  } else {
    form.name = ''
    form.type = 'saving'
    form.icon = accountTypeDefOf('saving')?.icon ?? '💰'
    form.color = CATEGORY_PASTELS.asset
    form.balance = 0
    form.institution = ''
  }
  initialType.value = form.type
  initialIcon.value = form.icon
  iconPickerShow.value = false
  bankPickerShow.value = false
  nameError.value = ''
  balanceError.value = ''
  bankError.value = ''
  noFlow.value = false
  negPrefix.value = false
}

// ==================== 派生态 ====================
const typeDef = computed(() => accountTypeDefOf(form.type))
const currentCategory = computed<AccountCategory>(() => typeDef.value?.category ?? 'asset')
const isCreditCat = computed(() => currentCategory.value === 'credit')
const needsInst = computed(() => !!typeDef.value?.needsInstitution)
/** B10：loan / deposit 机构可选；saving / credit 必选 */
const instOptional = computed(() => form.type === 'loan' || form.type === 'deposit')
const bank = computed(() => bankOfCode(form.institution))
/** 图标引用为 brand:（含已选银行）→ 图标行只读（D28） */
const iconIsBrand = computed(() => form.icon.startsWith('brand:'))

/** 品牌图标加载失败时的文字徽标：银行简称 → 类型名 */
const brandFallbackText = computed(() => bank.value?.short ?? typeDef.value?.label ?? '账')

/** 图标触发器前景色：emoji 走语义色，lucide 用主文字色 */
const isEmojiIcon = computed(() => !iconIsBrand.value && !form.icon.startsWith('lucide:'))
const emojiResolved = computed(() => resolveAccountIcon(form.icon || '💰'))
const triggerFg = computed(() =>
  isEmojiIcon.value ? emojiResolved.value.vars.fg : 'var(--color-text-primary)'
)

const balanceLabel = computed(() =>
  isCreditCat.value ? '欠款' : isEdit.value ? '余额' : '初始余额'
)
/** 信用类 placeholder = 注册表 balanceHint（缺「负数」字的补上） */
const balanceHintText = computed(() => {
  if (!isCreditCat.value) return ''
  const h = typeDef.value?.balanceHint
  if (!h) return '欠款填负数；如有溢缴款可填正数'
  return h.includes('负数') ? h : `${h}（欠款填负数）`
})

/** 跨 L1 改类型的行内提示（Q5/§A2）：asset↔credit 取负；涉 investment 仅提示；同 L1 静默。
 *  ⚠️ 仅编辑态：新建没有「原类别」可比，sign 由 − 前缀辅助 / 用户输入直接决定 */
const crossCategoryHint = computed(() => {
  if (!isEdit.value) return ''
  const initCat = accountCategoryOf(initialType.value)
  const curCat = currentCategory.value
  if (initCat === curCat) return ''
  if (initCat === 'asset' && curCat === 'credit') return '该账户将从资金变为负债，保存时余额将自动取负'
  if (initCat === 'credit' && curCat === 'asset') return '该账户将从负债变为资金，保存时余额将自动取负'
  return '该账户将转为理财，余额按市值理解，不做调整'
})

/** 按 L1 大类分组的类型（宫格 3 组：资金 8 / 信用 5 / 理财 5） */
function typesOf(cat: AccountCategory) {
  return ACCOUNT_TYPES.filter((t) => t.category === cat)
}

// ==================== 交互 ====================
function applyType(t: AccountType) {
  const d = accountTypeDefOf(t)
  if (!d) return
  form.type = t
  form.color = CATEGORY_PASTELS[d.category]
  if (d.needsInstitution) {
    // 同为需要机构的类型：保留已选银行，图标继续用该行 logo；无银行则回类型默认
    const b = bankOfCode(form.institution)
    form.icon = b?.logo ? `brand:${b.logo}` : d.icon
  } else {
    form.institution = ''
    form.icon = d.icon
  }
  // 进入信用类且余额为空/0 → 显示默认 − 前缀辅助（01 §6.1 规则 6）
  negPrefix.value = d.category === 'credit' && !form.balance
}

/** 点类型：needsInstitution 的项带 ›，选中即进银行选择器（01 §6.1 规则 3） */
function onTypeClick(t: (typeof ACCOUNT_TYPES)[number]) {
  if (submitting.value) return
  applyType(t.value)
  if (t.needsInstitution) bankPickerShow.value = true
}

/** 银行选择回写：institution = code；有 logo → 图标自动换 brand:<logo>（D22 最高优先级） */
function onBankSelect(code: string) {
  form.institution = code
  const b = bankOfCode(code)
  form.icon = b?.logo ? `brand:${b.logo}` : typeDef.value?.icon ?? form.icon
  bankError.value = ''
}

/** IconPicker 回写：只换图标引用为 lucide:<Name> */
function onPickIcon(name: IconName) {
  form.icon = `lucide:${name}`
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
  // ⚠️ 余额不做「不能为负」校验（01 §6.1 规则 8：所有 L1 都允许负数）
  const bal = Number(form.balance)
  if (Number.isNaN(bal)) {
    balanceError.value = '余额必须是数字'
    ok = false
  } else {
    balanceError.value = ''
  }
  // saving / credit 必选银行（B10：loan / deposit 可选，不拦）
  if (needsInst.value && !instOptional.value && !form.institution) {
    bankError.value = '请选择银行'
    ok = false
  } else if (bankError.value) {
    bankError.value = ''
  }
  return ok
}

function onNameInput() {
  if (nameError.value && form.name.trim()) nameError.value = ''
}

/**
 * 余额输入：negPrefix 激活时，首次输入正数一次性取负（数字键盘可删，无二次取反按钮）。
 * ⚠️ 这里不是跨类取负 —— 跨类取负只在保存时做一次（见 handleSave）。
 */
function onBalanceInput() {
  if (balanceError.value) balanceError.value = ''
  if (negPrefix.value) {
    if (typeof form.balance === 'number' && form.balance > 0) form.balance = -form.balance
    negPrefix.value = false
  }
}

/** 提交：校验通过后调父组件传入的 onSave（prop） */
async function handleSave() {
  if (!validate()) return
  submitting.value = true
  try {
    let balance = Number(Number(form.balance).toFixed(2))
    // 跨 asset↔credit：保存时余额自动取负（只此一次；以最终类别对比初始类别，不连乘）。
    // ⚠️ 仅编辑态 —— 新建没有「原类别」，符号由 − 前缀辅助 / 用户输入直接决定，
    //    否则会与前缀辅助叠加成双重取反（1942 → −1942 → +1942）
    if (isEdit.value) {
      const initCat = accountCategoryOf(initialType.value)
      const finalCat = currentCategory.value
      const crosses = (c: AccountCategory) => c === 'asset' || c === 'credit'
      if (initCat !== finalCat && crosses(initCat) && crosses(finalCat)) {
        balance = -balance
      }
    }
    // Q10/§A3：编辑存量 emoji 账户且未主动换图标 → 顺手换成对应 lucide（映射缺的保留 emoji）
    let icon = form.icon
    const wasEmoji =
      initialIcon.value &&
      !initialIcon.value.startsWith('brand:') &&
      !initialIcon.value.startsWith('lucide:')
    if (isEdit.value && wasEmoji && icon === initialIcon.value) {
      const hit = ACCOUNT_ICON_KEYS.find((k) => k.emoji === initialIcon.value)
      if (hit) icon = `lucide:${hit.icon}`
    }
    const payload: CreateAccountReq & { record_flow?: boolean } = {
      name: form.name.trim(),
      type: form.type,
      icon,
      color: form.color,
      balance,
      institution: form.institution || '',
    }
    // 仅编辑态携带：默认显式 true（生成余额调整流水）；勾「不记录收支」→ false
    if (isEdit.value) payload.record_flow = !noFlow.value
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
  <!-- ⚠️ teleport="body" 必留：iOS 上弹层会被页面滚动容器与布局层 chrome 压住。
       ⚠️ 不要加 `closeable`：关闭出口只留「取消」+ 点遮罩（项目铁律）。 -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '78%' }"
    round
    teleport="body"
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
        <!-- 账户名 + 图标（D28：brand 引用 → 只读，隐藏「换图标」入口非置灰） -->
        <div class="field-group">
          <div class="name-row">
            <div
              v-if="iconIsBrand"
              class="icon-locked"
              aria-hidden="true"
            >
              <BrandLogo
                :icon="form.icon"
                :fallback-text="brandFallbackText"
                :institution="form.institution"
                :size="44"
              />
            </div>
            <button
              v-else
              type="button"
              class="icon-trigger"
              :style="{ background: form.color }"
              :disabled="submitting"
              aria-label="选择账户图标"
              @click="iconPickerShow = true"
            >
              <BrandLogo
                :icon="form.icon"
                :fallback-text="form.name || '账'"
                :bg="form.color"
                :fg="triggerFg"
                :size="36"
              />
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
          <div v-else-if="iconIsBrand" class="hint">图标由账户类型与银行决定</div>
        </div>

        <!-- 类型：3 组宫格（资金 8 / 信用 5 / 理财 5），有机构的带 › -->
        <div v-for="cat in ACCOUNT_CATEGORIES" :key="cat.key" class="field-group">
          <div class="cell-label">{{ cat.label }}</div>
          <div class="type-grid">
            <button
              v-for="t in typesOf(cat.key)"
              :key="t.value"
              type="button"
              class="type-item"
              :class="{ 'is-active': form.type === t.value }"
              :disabled="submitting"
              @click="onTypeClick(t)"
            >
              <BrandLogo
                v-if="t.icon.startsWith('brand:')"
                :icon="t.icon"
                :fallback-text="t.label"
                :size="40"
              />
              <IconBox
                v-else
                :name="lucideNameOf(t.icon)"
                :tint="CATEGORY_TINTS[cat.key]"
                :size="40"
              />
              <span class="type-label">
                {{ t.label }}
                <span v-if="t.needsInstitution" class="type-more" aria-hidden="true">›</span>
              </span>
            </button>
          </div>
        </div>

        <!-- 跨 L1 改类型的行内提示（Q5/§A2） -->
        <div v-if="crossCategoryHint" class="cross-hint">ⓘ {{ crossCategoryHint }}</div>

        <!-- 银行：仅 needsInstitution 时渲染（01 §6.1 规则 4） -->
        <div v-if="needsInst" class="field-group">
          <button type="button" class="bank-row" :disabled="submitting" @click="bankPickerShow = true">
            <span class="bank-label">
              银行
              <span v-if="instOptional" class="bank-optional">可选</span>
            </span>
            <span v-if="bank?.logo" class="bank-logo">
              <BrandLogo
                :icon="`brand:${bank.logo}`"
                :fallback-text="bank.short"
                :institution="bank.code"
                :size="24"
              />
            </span>
            <span class="bank-value" :class="{ 'is-placeholder': !bank }">
              {{ bank ? bank.short : '不指定' }}
            </span>
            <span class="bank-arrow" aria-hidden="true">›</span>
          </button>
          <div v-if="bankError" class="error-text">{{ bankError }}</div>
          <div v-else-if="!instOptional" class="hint">储蓄卡 / 信用卡需选择银行，图标会换成该行 logo</div>
        </div>

        <!-- 余额：label / placeholder 按 L1 动态（信用类「欠款」+ 默认 − 前缀） -->
        <div class="field-group">
          <div class="cell-label">{{ balanceLabel }}</div>
          <div class="balance-row">
            <span class="currency">¥</span>
            <span v-if="negPrefix" class="neg-prefix" aria-hidden="true">−</span>
            <input
              v-model.number="form.balance"
              type="number"
              class="balance-input"
              :class="{ 'has-error': !!balanceError }"
              :placeholder="isCreditCat ? balanceHintText : '0.00'"
              inputmode="decimal"
              :disabled="submitting"
              @input="onBalanceInput"
            >
          </div>
          <div v-if="balanceError" class="error-text">{{ balanceError }}</div>
          <div v-if="isCreditCat" class="hint">ⓘ {{ balanceHintText }}；如有溢缴款可删掉 − 填正数</div>
          <!-- 不记录收支：仅编辑已有账户显示（05 §A.5.1；新建「初始余额」永不生成流水） -->
          <label v-if="isEdit" class="noflow-row">
            <input v-model="noFlow" type="checkbox" :disabled="submitting">
            <span class="noflow-text">
              不记录收支
              <span class="noflow-sub">只改余额，不生成任何流水</span>
            </span>
          </label>
        </div>

        <div class="bottom-hint" aria-hidden="true" />
      </div>

      <!-- 图标选择器（仅 lucide，D27：品牌 logo 绝不进选择器；复用 v1 组件零改动） -->
      <IconPicker
        v-model:show="iconPickerShow"
        :model-value="form.icon.startsWith('lucide:') ? lucideNameOf(form.icon) : null"
        @select="onPickIcon"
      />

      <!-- 银行选择器（三段式 + 搜索 + 索引条，01 §6.2） -->
      <BankPicker
        v-model:show="bankPickerShow"
        :selected="form.institution"
        @select="onBankSelect"
      />
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
/* brand 图标只读位（D28）：灰底、不可点，不给虚假的可点感 */
.icon-locked {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-hover);
  border-radius: 12px;
}
.icon-trigger {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
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

/* 3 组宫格（01 §6.1：3 列，一屏看全） */
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
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
  &.is-active { border-color: var(--color-primary); font-weight: 600; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.type-label {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
}
.type-item.is-active .type-label { color: var(--color-primary); font-weight: 600; }
/* 有机构 = 点进去还有一个列表（与 v1 分类的 › 语义一致） */
.type-more {
  font-size: var(--fs-body);
  color: var(--color-text-tertiary);
  line-height: 1;
}

/* 跨 L1 提示（Q5） */
.cross-hint {
  margin: 0 16px 8px;
  padding: 8px 12px;
  font-size: var(--fs-caption-sm);
  color: var(--color-warning-dark);
  background: var(--color-bg-card);
  border-radius: var(--radius-base);
}

/* 银行行（仅 needsInstitution 渲染） */
.bank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.bank-label {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}
.bank-optional {
  margin-left: 4px;
  padding: 1px 6px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  background: var(--color-bg-hover);
  border-radius: 999px;
}
.bank-logo {
  flex-shrink: 0;
  display: inline-flex;
}
.bank-value {
  margin-left: auto;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  &.is-placeholder { color: var(--color-text-disabled); font-weight: 400; }
}
.bank-arrow {
  flex-shrink: 0;
  font-size: var(--fs-h4);
  color: var(--color-text-tertiary);
}

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
/* 信用类默认 − 前缀辅助（01 §6.1 规则 6；首次输入正数时一次性落到输入值里） */
.neg-prefix {
  font-size: var(--fs-metric-lg);
  font-weight: 700;
  color: var(--color-text-primary);
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

/* 不记录收支（仅编辑态；整行可点）—— v2 语义原样保留 */
.noflow-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px 2px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  input[type='checkbox'] {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--color-primary);
  }
}
.noflow-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
}
.noflow-sub {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

.bottom-hint { height: 24px; }
</style>
