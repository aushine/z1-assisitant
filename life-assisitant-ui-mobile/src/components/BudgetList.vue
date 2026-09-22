<script setup lang="ts">
/**
 * BudgetList —— 预算区块（总预算 + 分类预算，移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/BudgetTab.tsx
 *                    life-assisitant-ui-desktop/src/pages/record/components/CategoryBudgetItem.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance.go
 * 最后同步：2026-09-18（Phase 3.5）
 *
 * ⚠️ 与桌面端注释不同的一处事实修正：
 *   桌面端 BudgetTab 注释称「后端无 updateBudget 端点，故编辑=删旧建新」，
 *   但后端 **有** `PATCH /budgets/:id`（`UpdateBudgetReq`）。
 *   该 DTO 只接受 name / amount / start_date / end_date / alert_threshold
 *   —— **period / scope / category 不可改**。
 *   因此移动端策略：
 *     仅改名称/金额/阈值/日期 → `updateBudget`（就地更新，保留 id 与已用额）
 *     改了周期或范围/分类     → `replaceBudget`（新建新的 + 删旧，删旧放最后，
 *                               新建失败则旧预算保留，不丢数据）
 *
 * 其它契约要点：
 *   - 预算范围的「总额」值是 `total`（不是 desktop types 里写的 'overall'，
 *     写错会被后端 400505 BUDGET_SCOPE_INVALID 拒掉）
 *   - `alert_threshold` 是 **0-1 小数**（0.8 = 80%），UI 上按百分数展示/输入
 *   - 分类预算的 `name` 与 `category_name` 同为分类名（与桌面端一致）
 */
import { computed, onMounted, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { formatMoney } from '@/utils/date'
import type {
  Budget,
  BudgetPeriod,
  BudgetScope,
  CreateBudgetReq,
  FinanceCategory,
  UpdateBudgetReq,
} from '@/api/types'

const financeStore = useFinanceStore()
const catStore = useFinanceCategoryStore()

// ==================== 分组 ====================
/** 总预算：scope 为 total（或历史数据里缺省） */
const overallBudgets = computed(() =>
  financeStore.budgets.filter((b) => !b.scope || b.scope === 'total')
)
/** 分类预算 */
const categoryBudgets = computed(() => financeStore.budgets.filter((b) => b.scope === 'category'))

// ==================== 状态判定（与桌面端 budgetStatus / barColor 一致）====================
type BudgetStatus = 'over' | 'warn' | 'ok'

function budgetStatus(b: Budget): BudgetStatus {
  if (b.amount <= 0) return 'ok'
  const pct = b.used / b.amount
  if (pct >= 1) return 'over'
  if (pct >= (b.alert_threshold ?? 0.8)) return 'warn'
  return 'ok'
}

function barColor(b: Budget): string {
  const s = budgetStatus(b)
  if (s === 'over') return 'var(--color-danger)'
  if (s === 'warn') return 'var(--color-warning)'
  return 'var(--color-success)'
}

function pctOf(b: Budget): number {
  return b.amount > 0 ? Math.min(100, Math.round((b.used / b.amount) * 100)) : 0
}

// ==================== 弹层 ====================
const sheetShow = ref(false)
const editingBudget = ref<Budget | null>(null)
const submitting = ref(false)

const PERIODS: Array<{ value: BudgetPeriod; label: string }> = [
  { value: 'monthly', label: '每月' },
  { value: 'weekly', label: '每周' },
  { value: 'yearly', label: '每年' },
]

const form = ref<{
  scope: BudgetScope
  name: string
  category_id: string
  category_name: string
  category_emoji: string
  amount: number
  period: BudgetPeriod
  /** UI 上是百分数 0-100 */
  alertPct: number
}>({
  scope: 'total',
  name: '',
  category_id: '',
  category_name: '',
  category_emoji: '',
  amount: 0,
  period: 'monthly',
  alertPct: 80,
})

const formError = ref('')

/** 预算行上的分类图标 / 名（按 budget.category_id 查） */
function catOf(b: Budget) {
  return catStore.resolveCat({
    category_id: b.category_id,
    category_name: b.category_name,
    category_emoji: b.category_emoji,
  })
}

/**
 * 当前周期的起止日期。
 * ⚠️ 与桌面端一致：**恒取当月**（桌面端 openCreateBudget 无论 period 选什么都写本月范围）。
 *    两端共用同一份后端数据，此处保持一致以免同一预算在两端显示不同窗口。
 */
function currentMonthRange(): { start_date: string; end_date: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const lastDay = new Date(y, m + 1, 0).getDate()
  const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start_date: start, end_date: end }
}

function openCreate(scope: BudgetScope): void {
  editingBudget.value = null
  formError.value = ''
  form.value = {
    scope,
    name: '',
    category_id: '',
    category_name: '',
    category_emoji: '',
    amount: 0,
    period: 'monthly',
    alertPct: 80,
  }
  if (scope === 'category') void catStore.ensureFresh()
  sheetShow.value = true
}

function openEdit(b: Budget): void {
  editingBudget.value = b
  formError.value = ''
  form.value = {
    scope: b.scope ?? 'total',
    name: b.name,
    category_id: b.category_id ?? '',
    category_name: b.category_name ?? '',
    category_emoji: b.category_emoji ?? '',
    amount: b.amount,
    period: b.period,
    alertPct: Math.round((b.alert_threshold ?? 0.8) * 100),
  }
  if ((b.scope ?? 'total') === 'category') void catStore.ensureFresh()
  sheetShow.value = true
}

/** 分类选择器回填（只给一级）；预算名与一级分类名保持一致 */
function selectCategory(c: FinanceCategory): void {
  form.value.category_id = c.id
  form.value.category_name = c.full_name || c.name
  form.value.category_emoji = c.emoji ?? ''
  form.value.name = c.name
  formError.value = ''
}

function closeSheet(): void {
  if (submitting.value) return
  sheetShow.value = false
}

function validate(): boolean {
  const f = form.value
  if (f.scope === 'category' && !f.category_id) {
    formError.value = '请选择分类'
    return false
  }
  if (f.scope === 'total' && !f.name.trim()) {
    formError.value = '请输入预算名称'
    return false
  }
  if (!f.amount || f.amount <= 0) {
    formError.value = '预算金额必须大于 0'
    return false
  }
  formError.value = ''
  return true
}

/** 提交（新建 / 编辑共用） */
async function submitBudget(): Promise<void> {
  if (!validate()) return
  const f = form.value
  const range = currentMonthRange()
  const payload: CreateBudgetReq = {
    name: f.name.trim(),
    period: f.period,
    amount: Number(f.amount),
    scope: f.scope,
    alert_threshold: Number((f.alertPct / 100).toFixed(2)),
    start_date: range.start_date,
    end_date: range.end_date,
    ...(f.scope === 'category'
      ? { category_id: f.category_id, category_name: f.category_name, category_emoji: f.category_emoji }
      : {}),
  }

  submitting.value = true
  try {
    if (editingBudget.value) {
      const old = editingBudget.value
      // ⚠️ 周期 / 范围不可就地改（后端 UpdateBudgetReq 无这两项）→ 仍走「删旧建新」；
      //    分类自 260921 起 UpdateBudgetReq 已支持，可**就地改**（06 §3 第 2 条）。
      const structureChanged =
        (old.period !== f.period) ||
        ((old.scope ?? 'total') !== f.scope)

      if (structureChanged) {
        const created = await financeStore.replaceBudget(old.id, payload)
        if (created) sheetShow.value = false
      } else {
        const patch: UpdateBudgetReq = {
          name: payload.name,
          amount: payload.amount,
          start_date: payload.start_date,
          end_date: payload.end_date,
          alert_threshold: payload.alert_threshold,
          ...(f.scope === 'category'
            ? { category_id: f.category_id, category_name: f.category_name, category_emoji: f.category_emoji }
            : {}),
        }
        const updated = await financeStore.updateBudget(old.id, patch)
        if (updated) sheetShow.value = false
      }
    } else {
      const created = await financeStore.createBudget(payload)
      if (created) sheetShow.value = false
    }
  } finally {
    submitting.value = false
  }
}

async function onDelete(b: Budget): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除预算',
      message: `确定删除「${b.name}」吗？`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    await financeStore.deleteBudget(b.id)
  } catch {
    /* 取消 */
  }
}

// ==================== 生命周期 ====================
onMounted(async () => {
  await financeStore.fetchBudgets()
  // 分类缓存：预算行与分类选择器按 category_id 查（未加载时快照兜底）；SWR 不阻塞首屏
  void catStore.ensureFresh()
})

defineExpose({
  refresh: () => financeStore.fetchBudgets(),
  /** 供记录页 FAB 调用 */
  openCreate,
})
</script>

<template>
  <div class="budget-list">
    <!-- ============ 总预算 ============ -->
    <div class="budget-block">
      <div class="block-head">
        <h4 class="block-title"><Icon name="Target" :size="20" /> 总预算</h4>
        <button type="button" class="btn-ghost" @click="openCreate('total')">
          <span aria-hidden="true">＋</span> 新建总预算
        </button>
      </div>

      <div v-if="financeStore.budgetsLoading && overallBudgets.length === 0" class="budget-skeleton">
        <div v-for="i in 2" :key="i" class="skel-card" />
      </div>

      <div v-else-if="overallBudgets.length === 0" class="empty-state sm">
        <Icon class="empty-emoji" name="BarChart3" :size="32" aria-hidden="true" />
        <h4 class="empty-title">还没有总预算</h4>
        <p class="empty-desc">设置一个总额度，超支时会提醒你</p>
      </div>

      <div v-else class="budget-items">
        <div v-for="b in overallBudgets" :key="b.id" class="budget-item">
          <div class="bi-head">
            <span class="bi-name">{{ b.name }}</span>
            <div class="bi-amounts">
              <span class="bi-used" :style="{ color: barColor(b) }">¥{{ formatMoney(b.used, true) }}</span>
              <span class="bi-total"> / ¥{{ formatMoney(b.amount, true) }}</span>
              <span v-if="budgetStatus(b) === 'over'" class="tag is-over">已超支</span>
              <span v-else-if="budgetStatus(b) === 'warn'" class="tag is-warn">接近预算</span>
            </div>
          </div>
          <div class="bi-bar">
            <div class="bi-bar-fill" :style="{ width: pctOf(b) + '%', background: barColor(b) }" />
          </div>
          <div class="bi-foot">
            <span class="bi-pct" :style="{ color: barColor(b) }">{{ pctOf(b) }}%</span>
            <div class="bi-actions">
              <button type="button" class="icon-btn" aria-label="编辑" @click="openEdit(b)"><Icon name="Pencil" :size="16" /></button>
              <button type="button" class="icon-btn" aria-label="删除" @click="onDelete(b)"><Icon name="Trash2" :size="16" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 分类预算 ============ -->
    <div class="budget-block">
      <div class="block-head">
        <h4 class="block-title"><Icon name="PieChart" :size="20" /> 分类预算</h4>
        <button type="button" class="btn-ghost" @click="openCreate('category')">
          <span aria-hidden="true">＋</span> 新建分类预算
        </button>
      </div>

      <div v-if="financeStore.budgetsLoading && categoryBudgets.length === 0" class="budget-skeleton">
        <div v-for="i in 2" :key="i" class="skel-card" />
      </div>

      <div v-else-if="categoryBudgets.length === 0" class="empty-state sm">
        <Icon class="empty-emoji" name="PieChart" :size="32" aria-hidden="true" />
        <h4 class="empty-title">还没有分类预算</h4>
        <p class="empty-desc">按消费类别设定预算上限</p>
      </div>

      <div v-else class="budget-items">
        <div v-for="b in categoryBudgets" :key="b.id" class="budget-item">
          <div class="bi-head">
            <span class="bi-name">
              <span
                class="bi-cat"
                :style="{ background: catOf(b).vars.bg, color: catOf(b).vars.fg }"
              >
                <Icon :name="catOf(b).icon" :size="14" />
              </span>
              {{ catOf(b).name }}
            </span>
            <div class="bi-amounts">
              <span class="bi-used" :style="{ color: barColor(b) }">¥{{ formatMoney(b.used, true) }}</span>
              <span class="bi-total"> / ¥{{ formatMoney(b.amount, true) }}</span>
              <span v-if="budgetStatus(b) === 'over'" class="tag is-over">已超支</span>
              <span v-else-if="budgetStatus(b) === 'warn'" class="tag is-warn">接近预算</span>
            </div>
          </div>
          <div class="bi-bar">
            <div class="bi-bar-fill" :style="{ width: pctOf(b) + '%', background: barColor(b) }" />
          </div>
          <div class="bi-foot">
            <span class="bi-pct" :style="{ color: barColor(b) }">{{ pctOf(b) }}%</span>
            <div class="bi-actions">
              <button type="button" class="icon-btn" aria-label="编辑" @click="openEdit(b)"><Icon name="Pencil" :size="16" /></button>
              <button type="button" class="icon-btn" aria-label="删除" @click="onDelete(b)"><Icon name="Trash2" :size="16" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 新建 / 编辑弹层 ============ -->
    <!-- ⚠️ teleport="body" 必留：本组件挂在记录页的 main.tab-body（滚动容器）里，
         iOS 上弹层会被布局层 chrome 压住。完整说明见 period/PeriodDaySheet.vue
         ⚠️ 不要加 `closeable`：Vant 的关闭叉叉固定在弹层左上角，与 nav-bar 的「取消」
         并排出现两个关闭入口（260921 点名去掉的「灰色叉叉」）。 -->
    <van-popup
      v-model:show="sheetShow"
      position="bottom"
      :style="{ height: '76%' }"
      round
      teleport="body"
      :close-on-click-overlay="!submitting"
    >
      <div class="budget-sheet">
        <van-nav-bar
          :title="editingBudget ? '编辑预算' : (form.scope === 'category' ? '新建分类预算' : '新建总预算')"
          :left-text="submitting ? '' : '取消'"
          :left-arrow="false"
          :border="false"
          @click-left="closeSheet"
        >
          <template #right>
            <span class="save-btn" :class="{ 'is-disabled': submitting }" @click="submitBudget">
              {{ submitting ? '保存中…' : (editingBudget ? '保存' : '创建') }}
            </span>
          </template>
        </van-nav-bar>

        <div class="sheet-body">
          <!-- 分类选择（仅分类预算）：一级宫格内联，点一级直接选中、永不弹窗 -->
          <div v-if="form.scope === 'category'" class="field-group">
            <div class="cell-label">分类</div>
            <CategoryPicker
              v-model="form.category_id"
              scope="expense"
              :root-only="true"
              @select="selectCategory"
            />
          </div>

          <!-- 名称（仅总预算） -->
          <div v-else class="field-group">
            <div class="cell-label">预算名称</div>
            <van-field
              v-model="form.name"
              label=""
              placeholder="例如：7月总预算"
              maxlength="20"
              :disabled="submitting"
              clearable
              @update:model-value="formError = ''"
            />
          </div>

          <!-- 金额 -->
          <div class="field-group">
            <div class="cell-label">预算金额（元）</div>
            <div class="amount-row">
              <span class="currency">¥</span>
              <input
                v-model.number="form.amount"
                type="number"
                class="amount-input"
                placeholder="0.00"
                inputmode="decimal"
                :disabled="submitting"
                @input="formError = ''"
              >
            </div>
          </div>

          <!-- 周期 -->
          <div class="field-group">
            <div class="cell-label">周期</div>
            <div class="seg-row">
              <button
                v-for="p in PERIODS"
                :key="p.value"
                type="button"
                class="seg-item"
                :class="{ 'is-active': form.period === p.value }"
                :disabled="submitting"
                @click="form.period = p.value"
              >
                {{ p.label }}
              </button>
            </div>
          </div>

          <!-- 预警阈值 -->
          <div class="field-group">
            <div class="cell-label">
              预警阈值
              <span class="cell-label-hint">达到该比例时提醒 · 当前 {{ form.alertPct }}%</span>
            </div>
            <div class="slider-wrap">
              <van-slider
                v-model="form.alertPct"
                :min="0"
                :max="100"
                :step="5"
                bar-height="6px"
                active-color="var(--color-primary)"
                :disabled="submitting"
              />
              <span class="slider-value">{{ form.alertPct }}%</span>
            </div>
          </div>

          <div v-if="formError" class="form-error">{{ formError }}</div>

          <div class="bottom-hint" aria-hidden="true" />
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style lang="scss" scoped>
.budget-list {
  padding-top: 4px;
}
.budget-block {
  margin-bottom: 24px;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.block-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
}

.budget-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.budget-item {
  padding: 14px;
  background: var(--color-bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
}
.bi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.bi-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bi-cat {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: var(--fs-caption);
  border-radius: 6px;
  line-height: 1;
}
.bi-amounts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-family: var(--font-num);
  font-size: var(--fs-caption-sm);
}
.bi-used { font-weight: 700; }
.bi-total { color: var(--color-text-tertiary); }
.tag {
  margin-left: 4px;
  padding: 1px 6px;
  font-size: var(--fs-tab);
  border-radius: 999px;
  font-family: var(--font-body, inherit);
  &.is-over { background: var(--color-danger-light); color: var(--color-danger-dark); }
  &.is-warn { background: var(--color-warning-light); color: var(--color-warning-dark); }
}

.bi-bar {
  height: 6px;
  background: var(--color-border-light);
  border-radius: 999px;
  overflow: hidden;
}
.bi-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width var(--duration-normal) var(--ease-default);
}
.bi-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.bi-pct {
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  font-family: var(--font-num);
}
.bi-actions {
  display: flex;
  gap: 4px;
}
.icon-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: var(--color-bg-hover);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.92); }
}

.budget-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skel-card {
  height: 96px;
  border-radius: 14px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

/* ========== 空态 ========== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  text-align: center;
  background: var(--color-bg-card);
  border-radius: 14px;
  &.sm { padding: 28px 24px; }
}
.empty-emoji { margin-bottom: 8px; opacity: 0.6; }
.empty-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.empty-desc {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  margin: 0;
}

/* ========== 弹层 ========== */
.budget-sheet {
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
.cell-label-hint {
  margin-left: 8px;
  font-size: var(--fs-micro);
  font-weight: 400;
  color: var(--color-text-disabled);
}

.amount-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 16px 16px;
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
  font-size: var(--fs-h1);
  font-weight: 700;
  color: var(--color-text-primary);
  background: transparent;
  border: 0;
  border-bottom: 1.5px solid var(--color-border-light);
  outline: none;
  font-family: var(--font-num);
  &:focus { border-bottom-color: var(--color-primary); }
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  &[type=number] { -moz-appearance: textfield; }
}

.seg-row {
  display: flex;
  gap: 8px;
  padding: 0 16px 16px;
}
.seg-item {
  flex: 1;
  height: 38px;
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); }
  &.is-active {
    color: var(--color-primary);
    background: var(--color-primary-light);
    border-color: var(--color-primary);
    font-weight: 600;
  }
  &:disabled { opacity: 0.5; }
}

.slider-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 16px 20px;
  :deep(.van-slider) { flex: 1; }
}
.slider-value {
  flex-shrink: 0;
  width: 44px;
  text-align: right;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-primary);
  font-family: var(--font-num);
}

.form-error {
  margin: 0 16px 12px;
  padding: 10px 12px;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger-dark);
  background: var(--color-danger-light);
  border-radius: 10px;
}

.bottom-hint { height: 24px; }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
