<script setup lang="ts">
/**
 * TransactionEditSheet —— 交易新建 / 编辑 / 转账底部弹层（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/TransactionEditDrawer.tsx
 *                    （defaultType / accounts / onSubmit 三件套）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance.go
 * 最后同步：2026-09-21（Phase 3 记一笔 + Phase 4 性质/对方）
 *
 * Phase 3 新增：
 *   - **金额计算键盘**（02 §1）：金额框 readonly + inputmode=none，接入 AmountPad
 *     （新增时自动弹、编辑时不弹，D5）；求值语义 utils/calc.ts（左到右、分上整数运算）。
 *   - **日期时间**（02 §B）：4 列滚轮（年/月/日/HH:mm，日列联动含闰年）；
 *     ⚠️ 三处「时间被吃掉」修复：编辑回填完整时分、三个提交点用 wallClockISOFrom
 *     （用户选的时分，不再吃掉成"此刻"）。
 *   - **口径开关**（05 §A）：「更多选项」折叠区（默认收起，「已开启 N 项」）；
 *     可见性 支出=两个 / 收入=只「不计入收支」/ 转账=都不显示；
 *     ⚠️ 切类型时把被隐藏的开关重置 false（不带着看不见的 true 提交）。
 *
 * Phase 4 新增：
 *   - **性质单选 chip + 对方输入**（05 §B.3）：支出 3 项 / 收入 2 项 / 转账不显示；
 *     选「待报销/借出/借入」自动勾上可见的口径开关（可见、可取消，Q11）；
 *     对方候选 = localStorage 最近输入 ≤5（Q12，不做通讯录）；
 *     借出/借入不填对方不能提交（行内报错）。
 *   - 提交映射：待报销/借出 → type='expense' + source；借入 → type='income' +
 *     source='borrow'；**都不是 transfer、无 to_account_id**；settle_of 本阶段不传。
 *   - ⚠️ 编辑模式不显示「性质/对方」（PATCH /transactions/:id 不接受 source/settle_of，
 *     只放开 exclude_* 指针与 contact —— 编辑已有 source 笔不改性质）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { resolveAccountIcon } from '@/utils/category-dict'
import Icon from '@/components/icon/Icon.vue'
import IconBox from '@/components/IconBox.vue'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import AmountPad from '@/components/finance/AmountPad.vue'
import DateTimePicker from '@/components/finance/DateTimePicker.vue'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { formatDateTime, todayDate, wallClockISOFrom } from '@/utils/date'
import { evalAmountExpr, formatCents } from '@/utils/calc'
import type {
  Account,
  CreateTransactionReq,
  FinanceCategory,
  FinanceCategoryScope,
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
  /**
   * 新建模式下的默认日期（`YYYY-MM-DD`），缺省 = 今天。
   * 日历「长按某天补录」用它把日期预填到该天（03 §5 / D36）。
   */
  defaultDate?: string
  onSave: (
    data: CreateTransactionReq | TransferReq | UpdateTransactionReq,
    type: TransactionType,
    mode: 'create' | 'update'
  ) => Promise<boolean>
}

const props = withDefaults(defineProps<Props>(), {
  transaction: null,
  defaultType: 'expense',
  defaultDate: '',
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

// ==================== 类别（分类树 · CategoryPicker）====================
const categoryStore = useFinanceCategoryStore()

/** 当前记账方向对应的分类树（transfer 无分类） */
const catScope = computed<FinanceCategoryScope>(() => (form.type === 'income' ? 'income' : 'expense'))

/**
 * 已选分类的渲染信息（按 id 优先、快照兜底，见 05 §3）。
 * ⚠️ 不再用 emoji+name 比对判定选中 —— 统一按 `category_id`。
 */
const selectedCat = computed(() =>
  categoryStore.resolveCat({
    category_id: form.category_id,
    category_name: form.category_name,
    category_emoji: form.category_emoji,
  })
)

/**
 * 「类别」标签右侧的已选摘要（05 §1.3）：
 * - 未选任何分类 → **留空**（不显示"请选择"这类噪音）；
 * - 已选 → 完整名（如 `餐饮-三餐`）；已删除 → 追「（已删除）」，**不强制用户改**。
 */
const catSummary = computed(() => {
  if (!form.category_id && !form.category_name) return ''
  return selectedCat.value.deleted ? `${selectedCat.value.name}（已删除）` : selectedCat.value.name
})

/** 选择器回填：写 id + 快照名/emoji（向后兼容老后端） */
function selectCategory(c: FinanceCategory): void {
  form.category_id = c.id
  form.category_name = c.full_name || c.name
  form.category_emoji = c.emoji ?? ''
}

/**
 * SWR：有缓存立即返回（下面直接用旧分类渲染）+ 后台静默刷新；
 * 只有真·冷启动才 await 一次全量。
 *
 * ⚠️ 不能按 scope 单拉 —— 旧实现只请求一侧会把另一侧清空，而下面
 *    `applyDefaultCategory` / `matchCategoryByName` 拿到结果后就要读
 *    `rootsOf(scope)`，另一侧为空会直接导致「默认分类选不上 / 匹配不到」。
 */
async function ensureCategories(): Promise<void> {
  await categoryStore.ensureFresh()
}

/** 新建交易：默认选中该方向下的一级首项（「只记大类」） */
async function applyDefaultCategory(scope: FinanceCategoryScope): Promise<void> {
  if (form.category_id) return
  await ensureCategories()
  const root = categoryStore.rootsOf(scope)[0]
  if (root) selectCategory(root)
}

/**
 * 历史数据兜底（05 §1.3）：编辑一笔 `category_id` 为空的旧交易时，
 * 按 `category_name` 尽力匹配到已有分类；匹配不到则保留快照、不强制用户改。
 */
async function matchCategoryByName(scope: FinanceCategoryScope, fullName: string): Promise<void> {
  await ensureCategories()
  const nodes: FinanceCategory[] = []
  for (const root of categoryStore.rootsOf(scope)) {
    nodes.push(root, ...(root.children ?? []))
  }
  const hit = nodes.find((n) => n.full_name === fullName || n.name === fullName)
  if (hit) selectCategory(hit)
}

// ==================== 表单 ====================
/** 本地时刻 `HH:mm`（新增默认 = 现在，精确到分） */
function nowHM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const form = reactive<{
  type: TransactionType
  amount: number
  category_id: string
  category_emoji: string
  category_name: string
  account_id: string
  to_account_id: string
  note: string
  /** `YYYY-MM-DD HH:mm`（本地墙钟；提交时经 wallClockISOFrom 带偏移） */
  happened_at: string
  /** 不计入预算（05 §A） */
  exclude_budget: boolean
  /** 不计入收支（05 §A） */
  exclude_stats: boolean
}>({
  type: 'expense',
  amount: 0,
  category_id: '',
  category_emoji: '',
  category_name: '',
  account_id: '',
  to_account_id: '',
  note: '',
  happened_at: `${todayDate()} ${nowHM()}`,
  exclude_budget: false,
  exclude_stats: false,
})

/** 性质（Phase 4 · 05 §B.3）：普通 / 待报销 / 借出 / 借入 */
type TxNature = 'normal' | 'reimburse' | 'lend' | 'borrow'
const NATURE_LABELS: Record<TxNature, string> = {
  normal: '普通',
  reimburse: '待报销',
  lend: '借出',
  borrow: '借入',
}

const amountError = ref('')
const accountError = ref('')
const contactError = ref('')
const submitting = ref(false)

const isTransfer = computed(() => form.type === 'transfer')
const hasAccounts = computed(() => props.accounts.length > 0)
/** 编辑模式 */
const isEdit = computed(() => !!props.transaction)
/** 编辑模式下类型不可改（后端 UpdateTransactionReq 无 type 字段） */
const typeLocked = computed(() => isEdit.value)

// ==================== 金额计算键盘（02 §1）====================
const amountExpr = ref('')
const padShow = ref(false)

/**
 * 求值并采纳（键盘「完成」与「键盘外点击」同路径，02 §1.6 #12）。
 * 无效（÷0 / 超限）→ 行内提示、不写回、键盘不收起（#10）。
 */
function adoptPad(close: boolean): void {
  const r = evalAmountExpr(amountExpr.value)
  if (!r.valid) {
    amountError.value = /÷\s*0(?!.*\d)/.test(amountExpr.value) ? '除数不能为 0' : '算式无效'
    return
  }
  form.amount = r.cents / 100
  amountExpr.value = r.cents === 0 ? '' : formatCents(r.cents)
  amountError.value = ''
  if (close) padShow.value = false
}

/** 点「完成」：求值 + 写回 + 收键盘（无效则留在原地提示） */
function onPadComplete(): void {
  adoptPad(true)
}

/** 键盘外点击：与「完成」同路径（求值 → 写回 → 收键盘） */
function onBodyClick(): void {
  if (padShow.value) adoptPad(true)
}

function onNoteFocus(): void {
  if (padShow.value) adoptPad(true)
}

// ==================== 日期时间（02 §B）====================
const datePickerShow = ref(false)

function openDatePicker(): void {
  if (padShow.value) adoptPad(true) // ⚠️ 先收起金额键盘（02 §B.1.3）
  datePickerShow.value = true
}

function onDateConfirm(v: string): void {
  form.happened_at = v
}

// ==================== 口径开关 + 性质（05 §A/§B）====================
const moreOpen = ref(false)

/** 「不计入预算」可见性：仅支出（收入显示是误导；转账天然不计） */
const showBudgetToggle = computed(() => form.type === 'expense')
/** 「不计入收支」可见性：支出 / 收入；转账不显示 */
const showStatsToggle = computed(() => form.type !== 'transfer')

/** 性质可选项：支出 3 项 / 收入 2 项 / 转账不显示（05 §B.3.1） */
const nature = ref<TxNature>('normal')
const natureOptions = computed<TxNature[]>(() => {
  if (form.type === 'expense') return ['normal', 'reimburse', 'lend']
  if (form.type === 'income') return ['normal', 'borrow']
  return []
})
/** 性质非普通时才显示「对方」输入 */
const contactVal = ref('')

/** 选「待报销/借出/借入」→ 自动勾上**可见的**口径开关（可见、可取消，Q11） */
function onSelectNature(n: TxNature): void {
  nature.value = n
  if (n !== 'normal') {
    if (showBudgetToggle.value) form.exclude_budget = true
    if (showStatsToggle.value) form.exclude_stats = true
  }
}

/** 折叠区标题右侧「已开启 N 项」（N = 0 时不显示） */
const moreCount = computed(() => {
  let n = 0
  if (showBudgetToggle.value && form.exclude_budget) n++
  if (showStatsToggle.value && form.exclude_stats) n++
  if (!isEdit.value && !isTransfer.value && nature.value !== 'normal') n++
  return n
})

// —— 对方：最近输入候选 ≤5（Q12 · localStorage，不做通讯录）——
const RECENT_CONTACTS_KEY = 'finance_recent_contacts'
const recentContacts = ref<string[]>(loadRecentContacts())

function loadRecentContacts(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CONTACTS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function recordRecentContact(name: string): void {
  const v = name.trim()
  if (!v) return
  recentContacts.value = [v, ...recentContacts.value.filter((c) => c !== v)].slice(0, 5)
  try {
    localStorage.setItem(RECENT_CONTACTS_KEY, JSON.stringify(recentContacts.value))
  } catch {
    /* 存储不可用时静默跳过（候选只是便利功能） */
  }
}

/** 输入 ≥1 字时出现的候选 chips（含所输字串的最近联系人，≤5） */
const contactCandidates = computed(() => {
  const q = contactVal.value.trim().toLowerCase()
  if (!q) return []
  const cur = contactVal.value.trim()
  return recentContacts.value.filter((c) => c !== cur && c.toLowerCase().includes(q)).slice(0, 5)
})

watch(
  () => props.show,
  (v) => {
    if (v) resetForm()
    else {
      // ⚠️ 浮层关闭必须同时收起键盘与日期弹层（02 §1.7）
      padShow.value = false
      datePickerShow.value = false
    }
  },
)

function resetForm() {
  const tx = props.transaction
  if (tx) {
    // 编辑：回填
    form.type = tx.type
    form.amount = tx.amount
    // ⚠️ 金额框回填最终金额（02 §1.6 #14：算式不落库，D4）
    amountExpr.value = formatCents(Math.round(tx.amount * 100))
    form.category_id = tx.category_id || ''
    form.category_emoji = tx.category_emoji || ''
    form.category_name = tx.category_name || ''
    form.account_id = tx.account_id
    form.to_account_id = tx.to_account_id || ''
    form.note = tx.note || ''
    // ⚠️ happened_at 完整回填（02 §B.3 #1）：slice(0,10) 会把原时分吃掉，
    //    用户一编辑保存，时间就被静默改成"此刻"
    form.happened_at = tx.happened_at ? formatDateTime(tx.happened_at) : `${todayDate()} ${nowHM()}`
    form.exclude_budget = !!tx.exclude_budget
    form.exclude_stats = !!tx.exclude_stats
    // 性质 / 对方不可在编辑里改（PATCH 不接受 source/settle_of）
    nature.value = 'normal'
    contactVal.value = ''
    // category_id 为空的历史数据：按 name 尽力匹配（匹配不到就显示快照，不强制改）
    if (!form.category_id && form.category_name && tx.type !== 'transfer') {
      void matchCategoryByName(tx.type, form.category_name)
    }
    // 编辑时不自动弹键盘（D5），且不聚焦
    padShow.value = false
  } else {
    const t = props.defaultType
    form.type = t
    form.amount = 0
    amountExpr.value = ''
    form.category_id = ''
    form.category_emoji = ''
    form.category_name = ''
    form.exclude_budget = false
    form.exclude_stats = false
    nature.value = 'normal'
    contactVal.value = ''
    if (t !== 'transfer') {
      // 等分类树就绪后默认选中一级首项
      void applyDefaultCategory(t === 'income' ? 'income' : 'expense')
    }
    form.account_id = props.accounts[0]?.id || ''
    form.to_account_id = props.accounts[1]?.id || ''
    form.note = ''
    // 日历「长按补录」带来的预填日期（props.defaultDate，空 = 今天）+ 现在的时分
    form.happened_at = `${props.defaultDate || todayDate()} ${nowHM()}`
    // 新增时自动弹键盘（D5；转账同样只能用自绘键盘输入金额）
    padShow.value = true
  }
  moreOpen.value = false
  amountError.value = ''
  accountError.value = ''
  contactError.value = ''
}

function close() {
  if (submitting.value) return
  emit('update:show', false)
}

/**
 * 切换类型时重置类别 / 账户默认值；
 * ⚠️ 同时把**被隐藏**的口径开关与非法「性质」重置（05 §A.2 / §B.3.1：
 * 否则会带着一个看不见的 true / lend 提交 —— 最隐蔽的数据污染）。
 * 仍在显示的开关不重置（用户可能只是改主意）。
 */
function onTypeChange(t: TransactionType) {
  if (typeLocked.value) return
  form.type = t
  form.category_id = ''
  form.category_emoji = ''
  form.category_name = ''
  if (t === 'transfer') {
    // 转账：两个开关都不显示、性质不显示 → 全部重置
    form.exclude_budget = false
    form.exclude_stats = false
    nature.value = 'normal'
    if (form.account_id === form.to_account_id && props.accounts.length >= 2) {
      form.to_account_id = props.accounts.find((a) => a.id !== form.account_id)?.id || ''
    }
  } else {
    if (t === 'income') {
      // 收入：不显示「不计入预算」；性质只允许 普通/借入
      form.exclude_budget = false
      if (nature.value === 'lend' || nature.value === 'reimburse') nature.value = 'normal'
    } else if (t === 'expense') {
      // 支出：性质不允许借入
      if (nature.value === 'borrow') nature.value = 'normal'
    }
    void applyDefaultCategory(t === 'income' ? 'income' : 'expense')
  }
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
  // 借出 / 借入不填对方不能提交（行内报错，05 §B.3.3）
  if (!isEdit.value && !isTransfer.value && (nature.value === 'lend' || nature.value === 'borrow') && !contactVal.value.trim()) {
    contactError.value = '借出/借入需填写对方'
    ok = false
  } else {
    contactError.value = ''
  }
  return ok
}

/** 提交：校验通过后调父组件传入的 onSave */
async function handleSave() {
  // 键盘还开着 → 先求值写回（与「完成」同路径），无效则被 validate 拦住
  if (padShow.value) adoptPad(false)
  if (!validate()) return
  submitting.value = true
  try {
    // ⚠️ 用用户选的日期 + 时分（02 §B.3 #2）：三个提交点统一走 wallClockISOFrom，
    //    补 :00 秒 + 本地时区偏移（补记「昨天 18:30」不再被写成"昨天此刻"）
    const isoHappened = wallClockISOFrom(form.happened_at)
    let ok = false

    if (isEdit.value) {
      // 编辑：只发可改字段（无 type / 无 transfer 双方 / 无 source·settle_of）
      const payload: UpdateTransactionReq = {
        amount: Number(form.amount),
        account_id: form.account_id,
        happened_at: isoHappened,
        note: form.note.trim() || undefined,
        category_id: form.category_id || undefined,
        category_emoji: form.category_emoji || undefined,
        category_name: form.category_name || undefined,
      }
      // 口径开关是指针语义（缺省不改）；只发当前类型**可见**的开关
      if (showBudgetToggle.value) payload.exclude_budget = form.exclude_budget
      if (showStatsToggle.value) payload.exclude_stats = form.exclude_stats
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
      // 性质 → 统一模型映射（05 §B.2.3）：待报销/借出是支出、借入是收入；
      // ⚠️ 都不是 transfer、没有 to_account_id；settle_of 普通录入不传。
      const src =
        nature.value === 'reimburse'
          ? 'reimburse'
          : nature.value === 'lend'
            ? 'lend'
            : nature.value === 'borrow'
              ? 'borrow'
              : ''
      const contactTrimmed = contactVal.value.trim()
      const payload: CreateTransactionReq = {
        type: form.type,
        amount: Number(form.amount),
        category_id: form.category_id || undefined,
        category_emoji: form.category_emoji,
        category_name: form.category_name,
        account_id: form.account_id,
        note: form.note.trim() || undefined,
        happened_at: isoHappened,
        exclude_budget: form.exclude_budget,
        exclude_stats: form.exclude_stats,
        source: src || undefined,
        contact: nature.value !== 'normal' && contactTrimmed ? contactTrimmed : undefined,
      }
      ok = await props.onSave(payload, form.type, 'create')
      if (ok && nature.value !== 'normal' && contactTrimmed) {
        recordRecentContact(contactTrimmed)
      }
    }

    if (ok) emit('update:show', false)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[TransactionEditSheet] save failed', e)
  } finally {
    submitting.value = false
  }
}

function onAccountChange() {
  if (accountError.value) accountError.value = ''
}

function onContactInput() {
  if (contactError.value && contactVal.value.trim()) contactError.value = ''
}

/** 标题（编辑态带类型：编辑支出 / 编辑收入 / 编辑转账） */
const TX_TYPE_LABEL: Record<TransactionType, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
}
const sheetTitle = computed(() => {
  if (isEdit.value) return `编辑${TX_TYPE_LABEL[form.type]}`
  return isTransfer.value ? '转账' : '记一笔'
})
</script>

<template>
  <!--
    ⚠️ teleport="body" 必留（iOS 弹层层叠坑，说明见 components/period/PeriodDaySheet.vue）
    ⚠️ 不要加 `closeable` / `close-icon-position`：Vant 的关闭叉叉固定在弹层左上角，
       会和 nav-bar 的「取消」并排出现两个关闭入口（260921 点名去掉的「灰色叉叉」就是它）。
       关闭出口 = nav-bar「取消」+ 点遮罩（close-on-click-overlay）。
  -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '90%' }"
    round
    teleport="body"
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

      <!-- 键盘展开时给内容容器预留底部空白（02 §1.7；不 scrollIntoView） -->
      <div
        class="sheet-body"
        :style="padShow ? { paddingBottom: 'calc(var(--amount-pad-h) + env(safe-area-inset-bottom, 0px))' } : undefined"
        @click="onBodyClick"
      >
        <!-- 无账户时提示 -->
        <div v-if="!hasAccounts" class="no-account">
          <Icon class="empty-emoji" name="Landmark" :size="32" aria-hidden="true" />
          <h3>还没有账户</h3>
          <p>请先在「账户」区创建账户</p>
        </div>

        <template v-else>
          <!-- 1. 类型选择（编辑态隐藏：类型不可改，由标题表达；新增态保留 tabs） -->
          <div v-if="!isEdit" class="field-group">
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
          </div>

          <!-- 2. 金额：readonly + inputmode=none（02 §1.2 防系统键盘；disabled 会丢点击）
               ⚠️ @click 必须 .stop：否则同一次点击冒泡到 .sheet-body 的 onBodyClick
               （求值 + 收键盘），刚置起的 padShow 会被立刻按回去 —— 键盘关了再也打不开 -->
          <div class="field-group amount-card">
            <div class="amount-wrap">
              <span class="currency">¥</span>
              <input
                :value="amountExpr"
                type="text"
                inputmode="none"
                readonly
                autocomplete="off"
                class="amount-input"
                :class="{ 'has-error': !!amountError }"
                placeholder="0.00"
                :disabled="submitting"
                @click.stop="padShow = true"
              >
            </div>
            <div v-if="amountError" class="error-text">{{ amountError }}</div>
          </div>

          <!-- 3. 类别（仅 expense / income）：一级宫格内联常驻；点「有二级」的一级弹一层二级弹窗 -->
          <div v-if="!isTransfer" class="field-group">
            <div class="cell-label cat-label-row">
              <span>类别</span>
              <span v-if="catSummary" class="cat-summary">{{ catSummary }}</span>
            </div>
            <CategoryPicker
              v-model="form.category_id"
              :scope="catScope"
              @select="selectCategory"
            />
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
                <!-- 账户 chip 图标盒：与类别宫格的二级格同参数（24 盒 / 14 图标） -->
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
                <!-- 账户 chip 图标盒：与类别宫格的二级格同参数（24 盒 / 14 图标） -->
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
                <!-- 账户 chip 图标盒：与类别宫格的二级格同参数（24 盒 / 14 图标） -->
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

          <div v-if="accountError" class="error-text error-account">{{ accountError }}</div>

          <!-- 5. 备注（仍用系统键盘：聚焦时先收起自绘键盘，02 §1.2） -->
          <div class="field-group">
            <van-field
              v-model="form.note"
              label=""
              placeholder="备注（选填）"
              maxlength="100"
              :disabled="submitting"
              @focus="onNoteFocus"
            />
          </div>

          <!-- 6. 日期：一行可点摘要（点击弹 4 列滚轮，02 §B.1.1） -->
          <div class="field-group">
            <div class="cell-label">日期</div>
            <div class="date-row" role="button" aria-label="选择日期时间" @click="openDatePicker">
              <span class="date-text">{{ form.happened_at }}</span>
              <span class="date-arrow" aria-hidden="true">›</span>
            </div>
          </div>

          <!-- 7. 更多选项（默认收起；右侧「已开启 N 项」；05 §A.3 / §B.3） -->
          <div v-if="!isTransfer" class="field-group more-group">
            <button type="button" class="more-head" @click="moreOpen = !moreOpen">
              <span class="more-label">更多选项</span>
              <span v-if="moreCount > 0" class="more-count">已开启 {{ moreCount }} 项</span>
              <span class="more-arrow" :class="{ 'is-open': moreOpen }" aria-hidden="true">⌄</span>
            </button>
            <!-- 行内 max-height 过渡（≤200ms；不用 van-collapse，05 §A.3） -->
            <div class="more-body" :class="{ 'is-open': moreOpen }">
              <!-- 性质（仅新增态：PATCH 不接受 source） -->
              <template v-if="!isEdit">
                <div class="more-row">
                  <span class="more-row-label">性质</span>
                  <div class="nature-chips">
                    <button
                      v-for="n in natureOptions"
                      :key="n"
                      type="button"
                      class="nature-chip"
                      :class="{ 'is-active': nature === n }"
                      :disabled="submitting"
                      @click="onSelectNature(n)"
                    >
                      {{ NATURE_LABELS[n] }}
                    </button>
                  </div>
                </div>
                <!-- 对方：仅性质非普通时出现（借出/借入必填、待报销选填） -->
                <div v-if="nature !== 'normal'" class="more-row">
                  <span class="more-row-label">对方</span>
                  <div class="contact-wrap">
                    <input
                      v-model="contactVal"
                      type="text"
                      class="contact-input"
                      :class="{ 'has-error': !!contactError }"
                      :placeholder="nature === 'reimburse' ? '报销对象（选填）' : '对方名字（必填）'"
                      maxlength="20"
                      :disabled="submitting"
                      @input="onContactInput"
                    >
                    <!-- 最近输入候选（≤5，Q12） -->
                    <div v-if="contactCandidates.length" class="contact-candidates">
                      <button
                        v-for="c in contactCandidates"
                        :key="c"
                        type="button"
                        class="contact-cand"
                        :disabled="submitting"
                        @click="contactVal = c"
                      >
                        {{ c }}
                      </button>
                    </div>
                    <div v-if="contactError" class="error-text is-left">{{ contactError }}</div>
                  </div>
                </div>
              </template>

              <!-- 口径开关（可见性：支出=两个 / 收入=只「不计入收支」） -->
              <label v-if="showBudgetToggle" class="toggle-row">
                <input v-model="form.exclude_budget" type="checkbox" :disabled="submitting">
                <span class="toggle-text">
                  不计入预算
                  <span class="toggle-sub">这笔支出不占用任何预算额度</span>
                </span>
              </label>
              <label v-if="showStatsToggle" class="toggle-row">
                <input v-model="form.exclude_stats" type="checkbox" :disabled="submitting">
                <span class="toggle-text">
                  不计入收支
                  <span class="toggle-sub">不计入月度收支与分类占比</span>
                </span>
              </label>
            </div>
          </div>
        </template>

        <div class="bottom-hint" aria-hidden="true" />
      </div>

      <!-- 自绘计算键盘：absolute 贴浮层底部（不用 fixed，02 §1.7）；
           顶部箭头点击 / 下拉拖拽收起 → 与「完成」同采纳路径（02 §1.6 #12） -->
      <AmountPad
        v-if="padShow && hasAccounts"
        v-model:expr="amountExpr"
        @complete="onPadComplete"
        @close="onPadComplete"
      />

      <!-- 日期时间滚轮（teleport=body 在组件内部；打开时已先收起键盘） -->
      <DateTimePicker v-model:show="datePickerShow" :value="form.happened_at" title="日期与时间" @confirm="onDateConfirm" />
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.tx-sheet {
  position: relative;
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

/* 金额大输入（readonly：光标不显示，符合「这不是个文本框」的观感） */
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
  cursor: text;
  &::placeholder { color: var(--color-text-disabled); }
  &.has-error { color: var(--color-danger); }
}

.error-text {
  margin-top: 8px;
  padding: 0 16px;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
  text-align: center;

  &.is-left { text-align: left; padding: 4px 0 0; margin-top: 4px; }
}
.error-account { text-align: left; padding: 4px 16px 0; }

/* 类别（一级宫格由 CategoryPicker 内联渲染；标签右侧补已选完整名） */
.cat-label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.cat-summary {
  min-width: 0;
  font-weight: 500;
  color: var(--color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
/* 账户 chip 图标盒已改用 components/IconBox.vue（24 盒 / 14 图标）。
   ⚠️ 旧写法 `<Icon class="acc-emoji" :size="16">` + CSS `width/height: 24px`
   会把 <svg> 整体拉成 24px（描边跟着变粗）——详见 components/TransactionList.vue。 */
.acc-name { font-size: var(--fs-caption); color: var(--color-text-primary); }
.account-chip.is-active .acc-name { color: inherit; }

/* 日期（一行摘要 + ›，点击弹滚轮） */
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

/* ========== 更多选项折叠区（05 §A.3：行内 max-height 过渡，不用 van-collapse）========== */
.more-group { padding-bottom: 4px; }
.more-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
.more-label {
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
}
.more-count {
  flex: 1;
  text-align: right;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
}
.more-arrow {
  flex-shrink: 0;
  font-size: var(--fs-body);
  color: var(--color-text-tertiary);
  transition: transform 0.15s ease;
  &.is-open { transform: rotate(180deg); }
}
.more-body {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.18s ease;

  &.is-open { max-height: 320px; }
}
.more-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 16px;
}
.more-row-label {
  flex-shrink: 0;
  width: 3em;
  padding-top: 6px;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.nature-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.nature-chip {
  height: 30px;
  padding: 0 14px;
  border: 1.5px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-bg-card);
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-weight: 600;
  }
  &:disabled { opacity: 0.5; }
}
.contact-wrap {
  flex: 1;
  min-width: 0;
}
.contact-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 10px;
  outline: none;
  &:focus { border-color: var(--color-primary); background: var(--color-bg-card); }
  &.has-error { border-color: var(--color-danger); }
  &::placeholder { color: var(--color-text-disabled); }
}
.contact-candidates {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.contact-cand {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg-hover);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-border-light); }
}
/* 口径开关（整行可点：label 包住控件，05 §A.3） */
.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px 12px;
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
.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
}
.toggle-sub {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

.bottom-hint { height: 24px; }
</style>
