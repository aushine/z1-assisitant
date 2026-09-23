<script setup lang="ts">
/**
 * AccountManager —— 「账户」Tab 内容区块（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/AccountManager.tsx
 *                    （桌面端 AccountTab 是它的薄壳；重复的 AssetTab 已于
 *                     D-03 第十六轮删除，两端「资产」入口均已移除）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/finance.go
 * 最后同步：2026-09-22（spec-20260922-v2 · 01 #26：账户卡「查看流水 ›」）
 *
 * 与桌面端对应：
 *   总资产卡（total_balance 服务端口径 + 账户数）
 *   账户网格（图标 / 名称 / 余额，负额标红；卡上「查看流水 ›」→ 07 清单 #26）
 *   新建账户 + 转账
 *
 * ⚠️ 2026-09-19：移动端原「资产」「账户」两个 Tab 都渲染本组件（内容完全一样），
 *    已删掉「资产」，本组件现在只服务「账户」Tab。能力一个没少 ——
 *    看总资产、管账户、转账都在这里。
 *
 * 移动端差异（交互层）：
 *   - 桌面端账户卡 hover 出编辑/删除按钮 → 移动端**点击卡片编辑**、
 *     **长按卡片删除**（网格里左滑与页面滚动抢手势，与 Phase 0 的 B4 结论一致）
 *   - 错误态：store 静默吞错，这里额外探测一次真实接口区分「失败」与「空」（E02）
 */
import { computed, onMounted, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { useFinanceStore } from '@/stores/finance'
import { resolveAccountIcon } from '@/utils/category-dict'
import Icon from '@/components/icon/Icon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import MoneyText from '@/components/finance/MoneyText.vue'
import { useLongPress } from '@/composables/useLongPress'
import { TX_SOURCE_LABEL } from '@/constants/finance'
import { ACCOUNT_CATEGORIES, accountCategoryOf, type AccountCategory } from '@/constants/account'
import AccountEditSheet from '@/components/AccountEditSheet.vue'
import TransactionEditSheet from '@/components/TransactionEditSheet.vue'
import type {
  Account,
  CreateAccountReq,
  CreateTransactionReq,
  DebtItem,
  TransactionType,
  TransferReq,
  UpdateTransactionReq,
} from '@/api/types'

const emit = defineEmits<{
  /** 债权债务卡点行 → 跳流水页并按该对方筛选（Phase 4 · D50） */
  (e: 'view-contact', contact: string): void
  /** 账户卡「查看流水 ›」→ 跳流水页注入 account_id（spec-20260922-v2 01 §1.3；移动端删账户下拉后的唯一账户入口） */
  (e: 'view-account', accountId: string): void
}>()

const financeStore = useFinanceStore()

// ==================== 净资产归并（spec-20260922-v1 Phase 4 · 01 §5） ====================
/** 服务端 ListAccounts 同循环归并的 L1 小计；debts 保留负数原值 */
const balanceSummary = computed(() => financeStore.balanceSummary)
const netWorth = computed(() => balanceSummary.value.netWorth)

/** 账户按 L1 大类分组（资金/信用/理财；空组不渲染） */
const groupedAccounts = computed(() => {
  const groups: { key: AccountCategory; label: string; items: Account[] }[] = []
  for (const c of ACCOUNT_CATEGORIES) {
    const items = financeStore.accounts.filter((a) => accountCategoryOf(a.type) === c.key)
    if (items.length > 0) groups.push({ key: c.key, label: c.label, items })
  }
  return groups
})

/**
 * 账户图标底色：账户卡本身是用户自定义的彩色底（`a.color`），
 * 图标盒要压在其上，故用半透明白而不是 tint（会被卡片底色吃掉）。
 */
const ACCOUNT_ICON_BG = 'rgba(255, 255, 255, 0.45)'

// ==================== 账户 CRUD ====================
const accountSheetShow = ref(false)
const editingAccount = ref<Account | null>(null)

function openCreateAccount(): void {
  editingAccount.value = null
  accountSheetShow.value = true
}

function openEditAccount(a: Account): void {
  // 长按删除后紧跟的 click 要丢弃，否则会立刻弹出编辑弹层
  if (accountLongPress.consumeClick()) return
  editingAccount.value = a
  accountSheetShow.value = true
}

/** 账户保存载荷：CreateAccountReq + 编辑态才带的 record_flow（Phase 3.4 余额调整） */
type AccountSavePayload = CreateAccountReq & { record_flow?: boolean }

async function onAccountSave(payload: AccountSavePayload): Promise<boolean> {
  if (editingAccount.value) {
    const r = await financeStore.updateAccount(editingAccount.value.id, payload)
    return r !== null
  }
  const r = await financeStore.createAccount(payload)
  return r !== null
}

/**
 * 账户卡处在网格里（页面会纵向滚动），左滑会与滚动抢手势，故用长按删除。
 * 全网格共用一个长按实例：一个时刻只有一个手指在按，回调靠 pendingAccount 取目标。
 */
const pendingAccount = ref<Account | null>(null)
const accountLongPress = useLongPress(() => {
  const target = pendingAccount.value
  if (target) void onDeleteAccount(target)
})

function onAccountTouchStart(a: Account, e: TouchEvent): void {
  pendingAccount.value = a
  accountLongPress.handlers.onTouchstart(e)
}

async function onDeleteAccount(a: Account): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除账户',
      message: `确定删除「${a.name}」吗？有关联交易的账户将无法删除。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    await financeStore.deleteAccount(a.id)
  } catch {
    /* 取消 */
  }
}

// ==================== 转账 ====================
const transferSheetShow = ref(false)

async function onTransferSave(
  payload: CreateTransactionReq | TransferReq | UpdateTransactionReq,
  type: TransactionType,
  _mode: 'create' | 'update'
): Promise<boolean> {
  if (type !== 'transfer') return false
  const r = await financeStore.transfer(payload as TransferReq)
  return r !== null
}

// ==================== 债权债务（Phase 4 · 05 §C.3） ====================
/** GET /finance/debts（后端聚合 D51：前端聚合会被分页截断） */
const debts = computed(() => financeStore.debts)
/** 两组都空 → 整卡不渲染（05 §C.3：不显示"暂无"噪音） */
const hasDebts = computed(
  () => !!debts.value && (debts.value.owed_to_me.length > 0 || debts.value.i_owe.length > 0)
)

/** 性质标签（kinds ⊆ reimburse / lend / borrow，中性色小标） */
function kindLabels(item: DebtItem): string {
  return item.kinds.map((k) => TX_SOURCE_LABEL[k] ?? k).join(' / ')
}

function onViewContact(contact: string): void {
  emit('view-contact', contact)
}

// ==================== 生命周期 ====================
onMounted(async () => {
  if (financeStore.accounts.length === 0) {
    await financeStore.fetchAccounts()
  }
  // 债权债务卡（进账户区即拉；核销后由详情页 fetchDebts 刷新）
  void financeStore.fetchDebts()
})

defineExpose({
  refresh: () => financeStore.fetchAccounts(),
  openCreateAccount,
})
</script>

<template>
  <div class="account-manager">
    <!-- 净资产卡（spec-20260922-v1 Phase 4：总资产 → 净资产；三组小计；负债取绝对值） -->
    <section class="asset-card">
      <!--
        金额遮罩开关（03 §2.3）：净资产卡右上角 = 全站**唯一**开关入口。
        ⚠️ 点击不弹 toast（§3.1，= 05 反馈规范的首个应用点）：小眼睛自身就是状态反馈。
        热区靠负边距扩到 ≥44×44，图标 18px 三级色（不抢净资产数字的视觉权重）。
        aria-label 用「金额已隐藏」而非动作词：读屏用户在遮罩态首先要知道的是**当前状态**。
      -->
      <button
        type="button"
        class="mask-toggle"
        :aria-label="financeStore.masked ? '金额已隐藏' : '隐藏金额'"
        @click="financeStore.toggleMasked()"
      >
        <Icon :name="financeStore.masked ? 'EyeOff' : 'Eye'" :size="18" aria-hidden="true" />
      </button>

      <div class="asset-label">净资产</div>
      <!-- ⚠️ 颜色绑在**外层容器**（继承），不能绑到 MoneyText 根元素上：
           内联 color 会盖过组件内的遮罩中性色 → 正负泄露（见 MoneyText 头注释） -->
      <div
        class="asset-value"
        :style="{ color: netWorth < 0 ? 'var(--color-danger)' : 'var(--color-primary)' }"
      >
        <MoneyText :value="netWorth" />
      </div>
      <div class="asset-sub">共 {{ financeStore.accounts.length }} 个账户</div>

      <div class="asset-breakdown">
        <span class="asset-part">资金 <MoneyText :value="balanceSummary.assets" /></span>
        <span class="asset-part">理财 <MoneyText :value="balanceSummary.investments" /></span>
        <span
          v-if="balanceSummary.debts < 0"
          class="asset-part is-debt"
        >负债 <MoneyText :value="Math.abs(balanceSummary.debts)" /></span>
      </div>

      <div class="asset-actions">
        <button type="button" class="btn-ghost" @click="transferSheetShow = true">
          <span aria-hidden="true">⇄</span> 转账
        </button>
        <button type="button" class="btn-solid" @click="openCreateAccount">
          <span aria-hidden="true">＋</span> 新建账户
        </button>
      </div>
    </section>

    <!-- 债权债务卡（Phase 4）：空组不渲染；两组都空整卡不渲染；全中性色（Q14 不并入总资产） -->
    <section v-if="hasDebts && debts" class="debts-card">
      <div class="debts-head">
        <h4 class="debts-title">债权债务</h4>
        <span class="debts-net">净 <MoneyText :value="debts.net" /></span>
      </div>

      <template v-if="debts.owed_to_me.length > 0">
        <div class="debts-group-label">
          别人欠我
          <span class="debts-group-sum"><MoneyText :value="debts.owed_to_me.reduce((s, d) => s + d.open, 0)" /></span>
        </div>
        <button
          v-for="d in debts.owed_to_me"
          :key="`ome-${d.contact}`"
          type="button"
          class="debts-row"
          @click="onViewContact(d.contact)"
        >
          <span class="debts-contact">{{ d.contact }}</span>
          <span class="debts-kinds">{{ kindLabels(d) }}</span>
          <span class="debts-open"><MoneyText :value="d.open" /></span>
          <span class="debts-arrow" aria-hidden="true">›</span>
        </button>
      </template>

      <template v-if="debts.i_owe.length > 0">
        <div class="debts-group-label">
          我欠别人
          <span class="debts-group-sum"><MoneyText :value="debts.i_owe.reduce((s, d) => s + d.open, 0)" /></span>
        </div>
        <button
          v-for="d in debts.i_owe"
          :key="`iowe-${d.contact}`"
          type="button"
          class="debts-row"
          @click="onViewContact(d.contact)"
        >
          <span class="debts-contact">{{ d.contact }}</span>
          <span class="debts-kinds">{{ kindLabels(d) }}</span>
          <span class="debts-open"><MoneyText :value="d.open" /></span>
          <span class="debts-arrow" aria-hidden="true">›</span>
        </button>
      </template>
    </section>

    <!-- 账户网格（spec-20260922-v1 Phase 4：按 L1 大类分组，空组不渲染） -->
    <div class="section-head">
      <h4 class="section-title">账户</h4>
      <span class="section-hint">点击编辑 · 长按删除</span>
    </div>

    <div v-if="financeStore.accountsLoading && financeStore.accounts.length === 0" class="acc-grid">
      <div v-for="i in 4" :key="i" class="acc-skel" />
    </div>

    <div v-else-if="financeStore.accounts.length === 0" class="empty-state sm">
      <Icon class="empty-emoji" name="Landmark" :size="32" aria-hidden="true" />
      <h4 class="empty-title">还没有账户</h4>
      <p class="empty-desc">点击「新建账户」开始</p>
    </div>

    <template v-else>
      <section v-for="g in groupedAccounts" :key="g.key" class="acc-group">
        <div class="acc-group-label">{{ g.label }}</div>
        <div class="acc-grid">
          <div
            v-for="a in g.items"
            :key="a.id"
            class="acc-card"
            :style="{ background: a.color || 'var(--color-bg-hover)' }"
            @click="openEditAccount(a)"
            @touchstart="(e: TouchEvent) => onAccountTouchStart(a, e)"
            @touchmove="accountLongPress.handlers.onTouchmove"
            @touchend="accountLongPress.handlers.onTouchend"
            @touchcancel="accountLongPress.handlers.onTouchcancel"
            @contextmenu="accountLongPress.handlers.onContextmenu"
          >
            <div class="acc-head">
              <!-- 图标通道统一走 BrandLogo（spec-20260922-v1 Phase 3）：
                   brand: → 品牌 logo（白托底）；lucide / emoji → IconBox（bg/fg 透传，
                   底色是卡片彩色背景上的半透明白，故用 bg/fg 而不是 tint）。 -->
              <BrandLogo
                :icon="a.icon || '💰'"
                :institution="a.institution"
                :fallback-text="a.name"
                :bg="ACCOUNT_ICON_BG"
                :fg="resolveAccountIcon(a.icon || '💰').vars.fg"
                :size="32"
              />
              <span class="acc-name">{{ a.name }}</span>
            </div>
            <div
              class="acc-balance"
              :style="{ color: a.balance < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }"
            >
              <MoneyText :value="a.balance" />
            </div>
            <!--
              查看流水入口（07 #26）：移动端账户下拉已删（D2），这里是账户筛选的**发起点**。
              ⚠️ 必须 .stop 掉 click **和** touchstart —— 前者防冒泡触发卡片的「点击编辑」，
                 后者防触发卡片的长按删除计时（44px 最小热区，见样式）。
            -->
            <button
              type="button"
              class="acc-flow"
              @click.stop="emit('view-account', a.id)"
              @touchstart.stop
            >
              查看流水 ›
            </button>
          </div>
        </div>
      </section>
    </template>

    <!-- 新建 / 编辑账户 -->
    <AccountEditSheet
      v-model:show="accountSheetShow"
      :account="editingAccount"
      :on-save="onAccountSave"
    />

    <!-- 转账（复用交易弹层，默认 transfer，与桌面端一致） -->
    <TransactionEditSheet
      v-model:show="transferSheetShow"
      :accounts="financeStore.accounts"
      default-type="transfer"
      :on-save="onTransferSave"
    />
  </div>
</template>

<style lang="scss" scoped>
.account-manager {
  padding-top: 4px;
}

/* ========== 总资产卡 ========== */
.asset-card {
  position: relative; /* 遮罩开关的定位锚点（03 §2.3） */
  padding: 20px;
  background: linear-gradient(135deg, #E0F2FF 0%, #F0E8FF 100%);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
  text-align: center;
  margin-bottom: 20px;
}
/* 金额遮罩开关：视觉 18px 图标，热区 44×44（负边距扩，不撑大卡片） */
.mask-toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: rgba(255, 255, 255, 0.6); }
}
.asset-label {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}
.asset-value {
  font-size: 30px;
  font-weight: 700;
  font-family: var(--font-num);
  line-height: 1.15;
}
.asset-sub {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  margin-top: 4px;
}
/* 三组小计（净资产卡）：负债显示绝对值 + 「负债」标签（不用大红，01 §5） */
.asset-breakdown {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 10px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.asset-part.is-debt {
  color: var(--color-text-tertiary);
}
.asset-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 16px;
}

.btn-ghost,
.btn-solid {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 16px;
  font-size: var(--fs-caption);
  font-weight: 600;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
}
.btn-ghost {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.75);
}
.btn-solid {
  color: #FFFFFF;
  background: var(--color-primary);
}

/* ========== 债权债务卡（Phase 4 · 全中性色，Q14 不并入总资产）========== */
.debts-card {
  padding: 16px;
  margin-bottom: 20px;
  background: var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
}
.debts-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.debts-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.debts-net {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  font-family: var(--font-num);
}
.debts-group-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px 2px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);

  &:not(:first-child) { border-top: 1px solid var(--color-border-light); margin-top: 6px; }
}
.debts-group-sum {
  font-family: var(--font-num);
  color: var(--color-text-secondary);
}
.debts-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 2px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }

  &:not(:last-of-type) { border-bottom: 1px solid var(--color-border-light); }
}
.debts-contact {
  flex-shrink: 0;
  max-width: 40%;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debts-kinds {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debts-open {
  flex-shrink: 0;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}
.debts-arrow {
  flex-shrink: 0;
  font-size: var(--fs-h4);
  color: var(--color-text-tertiary);
}

/* ========== 网格 ========== */
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.section-hint {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ========== 分组（资金/信用/理财；空组不渲染） ========== */
.acc-group {
  margin-bottom: 14px;
}
.acc-group-label {
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-text-tertiary);
  padding: 0 2px 8px;
}

.acc-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.acc-card {
  padding: 14px 12px;
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.98); }
}
/* 查看流水入口（07 #26）：负边距扩热区到 ≈40px 高，视觉只有一行小字 */
.acc-flow {
  display: block;
  width: fit-content;
  margin: 2px -6px -6px auto;
  padding: 10px 6px;
  border: 0;
  background: transparent;
  font-size: var(--fs-micro);
  color: var(--color-text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.acc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
/* 账户图标盒已改用 components/IconBox.vue（32px 盒 + 16px 图标）。
   ⚠️ 旧写法 `<Icon class="acc-emoji" :size="16">` + CSS `width/height: 28px`
   是同一个反模式：class 落在 <svg> 上，CSS 覆盖 svg 的尺寸属性 → 图标被
   放大到 28px 且描边跟着变粗。详见 components/TransactionList.vue 的注释。 */
.acc-name {
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acc-balance {
  /* 数值阶令牌（原为 17px，与其它模块的 KPI 数值不一致） */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  line-height: 1.2;
}
.acc-skel {
  height: 84px;
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

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
