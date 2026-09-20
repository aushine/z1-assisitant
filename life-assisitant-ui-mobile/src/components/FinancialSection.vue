<script lang="ts">
/**
 * 财务的三个子视图。
 * ⚠️ 必须从**普通 script 块**导出：`<script setup>` 不允许 ES module exports，
 *    而父级（record/index.vue）的 FAB 文案与分发需要这个类型。
 */
export type FinanceSub = 'transactions' | 'budget' | 'account'
</script>

<script setup lang="ts">
/**
 * 财务区（记录模块「财务」Tab 的内容）
 *
 * 260919 v1 重构：把原来并列的三个二级 Tab（收支 / 预算 / 账户）压成
 * 一个 Tab + 页内分段控件。
 *
 * 为什么这么做：
 *   - 二级 tab 有**物理上限 6 个**（超了会横滚，且左右滑切 tab 会失效），
 *     而新版本要腾位置给「健康」；
 *   - 预算 / 账户/收支 三者的心智模型是同一件事（钱），拆成三个二级 tab
 *     反而让人在「记录」这个动作里来回横跳。
 *
 * ⚠️ 后端**零改动**：`/accounts` `/transactions` `/budgets` 三组接口保持原样，
 *    这里只是信息架构调整（md/spec-20260919-v1/07 §3 明确要求不要动后端路由）。
 *
 * ⚠️ AccountManager 的 ref 必须绑在**保留下来的那个实例**上：
 *    之前「资产」Tab 被删时 ref 还挂在已删的实例上，导致 FAB 点了没反应。
 */
import { ref } from 'vue'
import TransactionList from '@/components/TransactionList.vue'
import AccountManager from '@/components/AccountManager.vue'
import BudgetList from '@/components/BudgetList.vue'
import type { Transaction } from '@/api/types'

/** 财务的三个子视图 */
const props = withDefaults(
  defineProps<{
    /** 初始子视图（父级用它做 FAB 文案，切换后由 sub-change 回传） */
    defaultSub?: FinanceSub
  }>(),
  { defaultSub: 'transactions' }
)

const emit = defineEmits<{
  (e: 'sub-change', v: FinanceSub): void
  (e: 'edit-transaction', t: Transaction): void
}>()

const sub = ref<FinanceSub>(props.defaultSub)

function switchTo(v: FinanceSub): void {
  if (sub.value === v) return
  sub.value = v
  emit('sub-change', v)
}

const accountManagerRef = ref<InstanceType<typeof AccountManager> | null>(null)
const budgetListRef = ref<InstanceType<typeof BudgetList> | null>(null)

/**
 * 打开「新建」—— 由父级 FAB 调用。
 * ⚠️ 只创建当前可见子视图需要的东西：三个组件各自持有自己的新建抽屉，
 *    这里只做分发，不重复实现。
 */
function openCreate(): void {
  switch (sub.value) {
    case 'budget':
      budgetListRef.value?.openCreate('total')
      break
    case 'account':
      accountManagerRef.value?.openCreateAccount()
      break
    default:
      // 收支：记一笔在父级（TransactionEditSheet 由 record/index.vue 统一持有）
      emit('sub-change', 'transactions')
      break
  }
}

defineExpose({ openCreate, sub })
</script>

<template>
  <div class="fin-section">
    <!-- 分段控件（三级导航，必须做在页内：SubTabBar 只服务二级 tab，
         再用一次会和布局层的常驻选项卡抢视觉层级） -->
    <div class="fin-segment" role="tablist" aria-label="财务视图">
      <button
        type="button"
        role="tab"
        :aria-selected="sub === 'transactions'"
        class="fin-seg-btn"
        :class="{ 'is-on': sub === 'transactions' }"
        @click="switchTo('transactions')"
      >
        收支
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="sub === 'budget'"
        class="fin-seg-btn"
        :class="{ 'is-on': sub === 'budget' }"
        @click="switchTo('budget')"
      >
        预算
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="sub === 'account'"
        class="fin-seg-btn"
        :class="{ 'is-on': sub === 'account' }"
        @click="switchTo('account')"
      >
        账户
      </button>
    </div>

    <!-- ⚠️ v-if 惰性挂载：三个列表各自持有筛选/月份等本地状态，
         同时挂载会互相抢，且一次性打三组接口。 -->
    <TransactionList v-if="sub === 'transactions'" @edit="emit('edit-transaction', $event)" />
    <BudgetList v-if="sub === 'budget'" ref="budgetListRef" />
    <AccountManager v-if="sub === 'account'" ref="accountManagerRef" />
  </div>
</template>

<style lang="scss" scoped>
/* ⚠️ 不写 height：高度由父级 .tab-body 的滚动容器分配，本组件只做内容流。 */
.fin-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.fin-segment {
  display: flex;
  gap: var(--space-2);
  /* 分段控件不跟着内容滚走：它是本区的导航，贴在区顶更好用 */
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--space-1) 0 var(--space-2);
  background: var(--color-bg-app);
}

.fin-seg-btn {
  flex: 1;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  -webkit-tap-highlight-color: transparent;

  &.is-on {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-weight: 600;
  }
}
</style>
