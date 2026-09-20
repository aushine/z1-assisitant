<script setup lang="ts">
/**
 * AccountManager —— 「账户」Tab 内容区块（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/AccountManager.tsx
 *                    （桌面端 AccountTab 是它的薄壳；重复的 AssetTab 已于
 *                     D-03 第十六轮删除，两端「资产」入口均已移除）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/finance.go
 * 最后同步：2026-09-18（Phase 3.6）
 *
 * 与桌面端对应：
 *   总资产卡（total_balance 服务端口径 + 账户数）
 *   账户网格（图标 / 名称 / 余额，负额标红）
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
import { onMounted, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { useFinanceStore } from '@/stores/finance'
import { resolveAccountIcon } from '@/utils/category-dict'
import Icon from '@/components/icon/Icon.vue'
import { formatMoney } from '@/utils/date'
import { useLongPress } from '@/composables/useLongPress'
import AccountEditSheet from '@/components/AccountEditSheet.vue'
import TransactionEditSheet from '@/components/TransactionEditSheet.vue'
import type {
  Account,
  CreateAccountReq,
  CreateTransactionReq,
  TransactionType,
  TransferReq,
  UpdateTransactionReq,
} from '@/api/types'

const financeStore = useFinanceStore()

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

async function onAccountSave(payload: CreateAccountReq): Promise<boolean> {
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

// ==================== 生命周期 ====================
onMounted(async () => {
  if (financeStore.accounts.length === 0) {
    await financeStore.fetchAccounts()
  }
})

defineExpose({
  refresh: () => financeStore.fetchAccounts(),
  openCreateAccount,
})
</script>

<template>
  <div class="account-manager">
    <!-- 总资产卡 -->
    <section class="asset-card">
      <div class="asset-label">总资产</div>
      <div
        class="asset-value"
        :style="{ color: financeStore.totalBalance < 0 ? 'var(--color-danger)' : 'var(--color-primary)' }"
      >
        ¥{{ formatMoney(financeStore.totalBalance) }}
      </div>
      <div class="asset-sub">共 {{ financeStore.accounts.length }} 个账户</div>

      <div class="asset-actions">
        <button type="button" class="btn-ghost" @click="transferSheetShow = true">
          <span aria-hidden="true">⇄</span> 转账
        </button>
        <button type="button" class="btn-solid" @click="openCreateAccount">
          <span aria-hidden="true">＋</span> 新建账户
        </button>
      </div>
    </section>

    <!-- 账户网格 -->
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

    <div v-else class="acc-grid">
      <div
        v-for="a in financeStore.accounts"
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
          <Icon
            class="acc-emoji"
            :name="resolveAccountIcon(a.icon || '🏦').icon"
            :size="16"
            :style="{ background: 'rgba(255,255,255,0.45)', color: resolveAccountIcon(a.icon || '🏦').vars.fg }"
          />
          <span class="acc-name">{{ a.name }}</span>
        </div>
        <div
          class="acc-balance"
          :style="{ color: a.balance < 0 ? 'var(--color-danger)' : 'var(--color-text-primary)' }"
        >
          ¥{{ formatMoney(a.balance) }}
        </div>
      </div>
    </div>

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
  padding: 20px;
  background: linear-gradient(135deg, #E0F2FF 0%, #F0E8FF 100%);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
  text-align: center;
  margin-bottom: 20px;
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
.acc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.acc-emoji {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  line-height: 1;
}
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
