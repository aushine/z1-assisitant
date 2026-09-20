/**
 * Finance Store（账户 / 交易 / 预算 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/finance.ts
 *                    life-assisitant-ui-desktop/src/pages/record/**（预算 / 账户区）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance.go
 *                    life-assisitant-api/internal/controller/finance.go
 * 最后同步：2026-09-18（Phase 3.4 / 3.5 / 3.6）
 *
 * Phase 3 新增：
 *   3.4 交易：分页（无限滚动）+ 筛选（类型/账户/关键词）+ 编辑 + 真删除 + 撤销(reverse)
 *   3.5 预算：列表 / 新建 / 编辑 / 删除（后端**有** PATCH /budgets/:id，
 *       方案 §8 里「编辑=删旧建新」的说法已过时；但 period / scope / category
 *       仍不可改，改这两项才需要删旧建新 —— 见 updateBudget 注释）
 *   3.6 账户：总净资产取 `GET /accounts` 的 total_balance（服务端口径）
 *
 * ⚠️ 后端契约要点（易错）：
 *   - `POST /transactions/transfer` 返回**单笔** TransactionResp，不是数组
 *   - `POST /transactions/:id/reverse` **不接收 body**
 *   - `DELETE /transactions|accounts|budgets/:id` 返回 204（无响应体）
 *   - `Budget.scope` 的「总预算」值是 `total`（不是 `overall`）
 *   - `Budget.alert_threshold` 是 **0-1** 小数，不是百分数
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { financeApi } from '@/api/finance'
import type {
  Account,
  Budget,
  CreateAccountReq,
  CreateBudgetReq,
  CreateTransactionReq,
  ListTransactionsQuery,
  ReverseTransactionResp,
  Transaction,
  TransactionType,
  TransferReq,
  UpdateAccountReq,
  UpdateBudgetReq,
  UpdateTransactionReq,
} from '@/api/types'
import { nowISO, toLocalISOString } from '@/utils/date'

/** 交易每页条数（无限滚动） */
const TX_PAGE_SIZE = 20

export const useFinanceStore = defineStore('finance', () => {
  // ==================== state：账户 ====================
  const accounts = ref<Account[]>([])
  /** 服务端净资产（GET /accounts 的 total_balance）。本地求和与之可能有微差，以服务端为准展示 */
  const serverTotalBalance = ref(0)
  const accountsLoading = ref(false)

  // ==================== state：交易 ====================
  const transactions = ref<Transaction[]>([])
  const transactionsLoading = ref(false)
  const txTotal = ref(0)
  const txPage = ref(1)
  const txHasMore = ref(false)
  /** 是否已加载过首页（van-list 区分「首次」与「加载更多」） */
  const txLoadedOnce = ref(false)

  // —— 交易查询维度 ——
  const txType = ref<TransactionType | ''>('')
  const txAccountId = ref('')
  const txKeyword = ref('')
  const txStartDate = ref('')
  const txEndDate = ref('')

  // ==================== state：预算 ====================
  const budgets = ref<Budget[]>([])
  const budgetsLoading = ref(false)

  // ==================== getters ====================
  /** 本地求和（乐观更新期间立即反映；展示优先用 serverTotalBalance） */
  const localTotalBalance = computed(() =>
    accounts.value.reduce((sum, a) => sum + a.balance, 0)
  )
  const totalBalance = computed(() => serverTotalBalance.value)

  const isEmpty = computed(() => !accountsLoading.value && accounts.value.length === 0)
  const isTxEmpty = computed(() => !transactionsLoading.value && transactions.value.length === 0)
  /** van-list 的 finished */
  const txFinished = computed(() => txLoadedOnce.value && !txHasMore.value)
  /** 是否有任一筛选条件（区分空态文案） */
  const txHasFilter = computed(
    () => !!txType.value || !!txAccountId.value || !!txKeyword.value || !!txStartDate.value || !!txEndDate.value
  )

  /** 全部预算合计的已用/额度 */
  const budgetSummary = computed(() => {
    const list = budgets.value
    const amount = list.reduce((s, b) => s + b.amount, 0)
    const used = list.reduce((s, b) => s + b.used, 0)
    return { amount, used, count: list.length }
  })

  function findAccount(id: string): Account | undefined {
    return accounts.value.find((a) => a.id === id)
  }

  // ==================== actions：账户 ====================

  async function fetchAccounts(): Promise<void> {
    accountsLoading.value = true
    try {
      const res = await financeApi.listAccounts()
      accounts.value = res.items
      serverTotalBalance.value = res.total_balance ?? 0
    } catch (e) {
      accounts.value = []
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] fetchAccounts failed', e)
    } finally {
      accountsLoading.value = false
    }
  }

  async function createAccount(data: CreateAccountReq): Promise<Account | null> {
    try {
      const acc = await financeApi.createAccount(data)
      accounts.value.push(acc)
      serverTotalBalance.value += acc.balance ?? 0
      showSuccessToast('账户已创建')
      return acc
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] createAccount failed', e)
      return null
    }
  }

  async function updateAccount(id: string, data: UpdateAccountReq): Promise<Account | null> {
    const idx = accounts.value.findIndex((a) => a.id === id)
    if (idx === -1) {
      try {
        return await financeApi.updateAccount(id, data)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[FinanceStore] updateAccount failed', e)
        return null
      }
    }
    const original = { ...accounts.value[idx] } as Account
    accounts.value[idx] = { ...original, ...data }
    try {
      const real = await financeApi.updateAccount(id, data)
      const cur = accounts.value.findIndex((a) => a.id === id)
      if (cur >= 0) accounts.value[cur] = real
      showSuccessToast('账户已更新')
      return real
    } catch (e) {
      const cur = accounts.value.findIndex((a) => a.id === id)
      if (cur >= 0) accounts.value[cur] = original
      showFailToast('更新失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] updateAccount rolled back', e)
      return null
    }
  }

  async function deleteAccount(id: string): Promise<void> {
    const idx = accounts.value.findIndex((a) => a.id === id)
    if (idx === -1) return
    const original = accounts.value[idx]
    accounts.value.splice(idx, 1)
    serverTotalBalance.value -= original.balance ?? 0
    try {
      await financeApi.deleteAccount(id)
      showSuccessToast('账户已删除')
      // 删除后可能存在关联交易数量变化，重拉一次校正
      await fetchAccounts()
    } catch (e) {
      accounts.value.splice(Math.min(idx, accounts.value.length), 0, original)
      serverTotalBalance.value += original.balance ?? 0
      showFailToast('删除失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] deleteAccount rolled back', e)
    }
  }

  // ==================== actions：交易 ====================

  /** 组装当前交易查询参数 */
  function buildTxParams(targetPage: number): ListTransactionsQuery {
    const params: ListTransactionsQuery = { page: targetPage, page_size: TX_PAGE_SIZE }
    if (txType.value) params.type = txType.value
    if (txAccountId.value) params.account_id = txAccountId.value
    if (txKeyword.value.trim()) params.keyword = txKeyword.value.trim()
    if (txStartDate.value) params.start_date = txStartDate.value
    if (txEndDate.value) params.end_date = txEndDate.value
    return params
  }

  /**
   * 拉取交易首页（按当前 query，page 重置为 1）
   */
  async function fetchTransactions(): Promise<void> {
    transactionsLoading.value = true
    try {
      const res = await financeApi.listTransactions(buildTxParams(1))
      transactions.value = res.items
      txTotal.value = res.total
      txHasMore.value = Boolean(res.has_more)
      txPage.value = 1
      txLoadedOnce.value = true
    } catch (e) {
      transactions.value = []
      txTotal.value = 0
      txHasMore.value = false
      txLoadedOnce.value = true
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] fetchTransactions failed', e)
    } finally {
      transactionsLoading.value = false
    }
  }

  /** 加载下一页（无限滚动） */
  async function loadMoreTransactions(): Promise<void> {
    if (!txHasMore.value || transactionsLoading.value) return
    transactionsLoading.value = true
    const next = txPage.value + 1
    try {
      const res = await financeApi.listTransactions(buildTxParams(next))
      if (res.items.length === 0) {
        txHasMore.value = false
        return
      }
      const seen = new Set(transactions.value.map((t) => t.id))
      transactions.value.push(...res.items.filter((t) => !seen.has(t.id)))
      txTotal.value = res.total
      txHasMore.value = Boolean(res.has_more)
      txPage.value = next
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] loadMoreTransactions failed', e)
    } finally {
      transactionsLoading.value = false
    }
  }

  /** 设置交易筛选（任一维度变化都重置到第 1 页） */
  type TxFilterPatch = Partial<{
    type: TransactionType | ''
    accountId: string
    keyword: string
    startDate: string
    endDate: string
  }>

  async function setTxFilter(patch: TxFilterPatch): Promise<void> {
    if (patch.type !== undefined) txType.value = patch.type
    if (patch.accountId !== undefined) txAccountId.value = patch.accountId
    if (patch.keyword !== undefined) txKeyword.value = patch.keyword.trim()
    if (patch.startDate !== undefined) txStartDate.value = patch.startDate
    if (patch.endDate !== undefined) txEndDate.value = patch.endDate
    await fetchTransactions()
  }

  /** 重置全部交易筛选 */
  async function resetTxFilter(): Promise<void> {
    txType.value = ''
    txAccountId.value = ''
    txKeyword.value = ''
    txStartDate.value = ''
    txEndDate.value = ''
    await fetchTransactions()
  }

  /**
   * 创建交易（支出 / 收入）
   * - 乐观调整本地账户余额 + 插入列表头
   */
  async function createTransaction(data: CreateTransactionReq): Promise<Transaction | null> {
    const acc = accounts.value.find((a) => a.id === data.account_id)
    const originalAcc = acc ? { ...acc } : null
    if (acc) {
      acc.balance = data.type === 'expense' ? acc.balance - data.amount : acc.balance + data.amount
    }
    const optimisticTx: Transaction = {
      id: `tmp_${Date.now()}`,
      type: data.type,
      amount: data.amount,
      category_emoji: data.category_emoji || '📌',
      category_name: data.category_name || '未分类',
      account_id: data.account_id,
      account_name: acc?.name,
      note: data.note,
      // happened_at 是业务时间，按本地时区带偏移输出
      happened_at: data.happened_at || toLocalISOString(),
      created_at: nowISO(),
    }
    transactions.value.unshift(optimisticTx)

    try {
      const real = await financeApi.createTransaction(data)
      const cur = transactions.value.findIndex((t) => t.id === optimisticTx.id)
      if (cur >= 0) transactions.value[cur] = real
      // 余额以服务端为准
      await fetchAccounts()
      showSuccessToast(data.type === 'expense' ? '记账成功' : '收入已记录')
      return real
    } catch (e) {
      if (originalAcc) {
        const cur = accounts.value.findIndex((a) => a.id === originalAcc.id)
        if (cur >= 0) accounts.value[cur] = originalAcc
      }
      const cur = transactions.value.findIndex((t) => t.id === optimisticTx.id)
      if (cur >= 0) transactions.value.splice(cur, 1)
      showFailToast('记账失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] createTransaction rolled back', e)
      return null
    }
  }

  /**
   * 更新交易（Phase 3.4）
   * 金额 / 账户变化会影响余额 → 成功后统一 `fetchAccounts()` 校正。
   */
  async function updateTransaction(id: string, data: UpdateTransactionReq): Promise<Transaction | null> {
    try {
      const real = await financeApi.updateTransaction(id, data)
      const idx = transactions.value.findIndex((t) => t.id === id)
      if (idx >= 0) transactions.value[idx] = real
      await fetchAccounts()
      showSuccessToast('交易已更新')
      return real
    } catch (e) {
      showFailToast('更新失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] updateTransaction failed', e)
      return null
    }
  }

  /**
   * 删除交易（Phase 3.4：真调接口，不再只做本地移除）
   */
  async function removeTransaction(id: string): Promise<boolean> {
    const idx = transactions.value.findIndex((t) => t.id === id)
    const original = idx >= 0 ? transactions.value[idx] : null
    if (idx >= 0) {
      transactions.value.splice(idx, 1)
      txTotal.value = Math.max(0, txTotal.value - 1)
    }
    try {
      await financeApi.removeTransaction(id)
      await fetchAccounts()
      showSuccessToast('交易已删除')
      return true
    } catch (e) {
      if (original) transactions.value.splice(Math.min(idx, transactions.value.length), 0, original)
      txTotal.value += 1
      showFailToast('删除失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] removeTransaction rolled back', e)
      return false
    }
  }

  /**
   * 冲正交易（Phase 3.4）
   * 后端生成一笔反向交易并回滚余额，原交易保留。返回「原交易 + 冲正交易」两笔。
   * ⚠️ 不接收请求体；已冲正过再调返回 400403（由 request 拦截器弹错）。
   */
  async function reverseTransaction(id: string): Promise<ReverseTransactionResp | null> {
    try {
      const res = await financeApi.reverseTransaction(id)
      await Promise.all([fetchAccounts(), fetchTransactions()])
      showSuccessToast('已冲正')
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] reverseTransaction failed', e)
      return null
    }
  }

  /**
   * 转账（A → B）
   * 乐观：A 减 / B 加；失败则回滚
   * ⚠️ 后端返回**单笔** TransactionResp（type='transfer'），不是数组
   */
  async function transfer(data: TransferReq): Promise<Transaction | null> {
    const from = accounts.value.find((a) => a.id === data.from_account_id)
    const to = accounts.value.find((a) => a.id === data.to_account_id)
    if (!from || !to) return null
    const originalFrom = { ...from }
    const originalTo = { ...to }
    from.balance -= data.amount
    to.balance += data.amount

    try {
      const res = await financeApi.transfer(data)
      await fetchAccounts()
      await fetchTransactions()
      showSuccessToast('转账成功')
      return res
    } catch (e) {
      const curFrom = accounts.value.findIndex((a) => a.id === originalFrom.id)
      if (curFrom >= 0) accounts.value[curFrom] = originalFrom
      const curTo = accounts.value.findIndex((a) => a.id === originalTo.id)
      if (curTo >= 0) accounts.value[curTo] = originalTo
      showFailToast('转账失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] transfer rolled back', e)
      return null
    }
  }

  // ==================== actions：预算（Phase 3.5） ====================

  async function fetchBudgets(): Promise<void> {
    budgetsLoading.value = true
    try {
      const res = await financeApi.listBudgets()
      budgets.value = res.items ?? []
    } catch (e) {
      budgets.value = []
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] fetchBudgets failed', e)
    } finally {
      budgetsLoading.value = false
    }
  }

  async function createBudget(data: CreateBudgetReq): Promise<Budget | null> {
    try {
      const b = await financeApi.createBudget(data)
      budgets.value.unshift(b)
      showSuccessToast('预算已创建')
      return b
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] createBudget failed', e)
      return null
    }
  }

  /**
   * 更新预算。
   *
   * ⚠️ 后端 `UpdateBudgetReq` 只接受 name / amount / start_date / end_date /
   * alert_threshold —— **period 与 scope（含 category_emoji/name）不可改**。
   * 若用户改了周期或范围，必须走「删旧建新」（见 replaceBudget）。
   */
  async function updateBudget(id: string, data: UpdateBudgetReq): Promise<Budget | null> {
    try {
      const b = await financeApi.updateBudget(id, data)
      const idx = budgets.value.findIndex((x) => x.id === id)
      if (idx >= 0) budgets.value[idx] = b
      showSuccessToast('预算已更新')
      return b
    } catch (e) {
      showFailToast('更新失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] updateBudget failed', e)
      return null
    }
  }

  async function deleteBudget(id: string): Promise<boolean> {
    const idx = budgets.value.findIndex((b) => b.id === id)
    const original = idx >= 0 ? budgets.value[idx] : null
    if (idx >= 0) budgets.value.splice(idx, 1)
    try {
      await financeApi.removeBudget(id)
      showSuccessToast('预算已删除')
      return true
    } catch (e) {
      if (original) budgets.value.splice(Math.min(idx, budgets.value.length), 0, original)
      showFailToast('删除失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceStore] deleteBudget rolled back', e)
      return false
    }
  }

  /**
   * 改周期 / 改范围 / 改分类时的「删旧建新」（后端不支持就地改这三项）。
   *
   * ⚠️ 顺序是**先建后删**（与桌面端一致）：新建失败时旧预算保留，不会丢数据；
   *    若先删后建，新建失败就变成了「预算凭空消失」。
   *    代价是极端情况下会短暂同时存在两条预算，用户可手动删除其一。
   */
  async function replaceBudget(oldId: string, data: CreateBudgetReq): Promise<Budget | null> {
    const created = await createBudget(data)
    if (!created) return null
    const removed = await deleteBudget(oldId)
    if (!removed) {
      // 新预算已建好，旧预算删除失败 —— 提示用户手动处理，避免静默出现两条
      showFailToast('新预算已创建，但旧预算删除失败，请手动删除')
    }
    return created
  }

  /** 重置 */
  function reset(): void {
    accounts.value = []
    serverTotalBalance.value = 0
    accountsLoading.value = false
    transactions.value = []
    transactionsLoading.value = false
    txTotal.value = 0
    txPage.value = 1
    txHasMore.value = false
    txLoadedOnce.value = false
    txType.value = ''
    txAccountId.value = ''
    txKeyword.value = ''
    txStartDate.value = ''
    txEndDate.value = ''
    budgets.value = []
    budgetsLoading.value = false
  }

  return {
    // state
    accounts,
    serverTotalBalance,
    accountsLoading,
    transactions,
    transactionsLoading,
    txTotal,
    txPage,
    txHasMore,
    txLoadedOnce,
    txType,
    txAccountId,
    txKeyword,
    txStartDate,
    txEndDate,
    budgets,
    budgetsLoading,
    // getters
    localTotalBalance,
    totalBalance,
    isEmpty,
    isTxEmpty,
    txFinished,
    txHasFilter,
    budgetSummary,
    findAccount,
    // actions：账户
    fetchAccounts,
    createAccount,
    updateAccount,
    deleteAccount,
    // actions：交易
    fetchTransactions,
    loadMoreTransactions,
    setTxFilter,
    resetTxFilter,
    createTransaction,
    updateTransaction,
    removeTransaction,
    reverseTransaction,
    transfer,
    // actions：预算
    fetchBudgets,
    createBudget,
    updateBudget,
    deleteBudget,
    replaceBudget,
    reset,
  }
})
