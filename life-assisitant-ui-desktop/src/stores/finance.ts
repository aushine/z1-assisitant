import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { feedback } from '@/utils/feedback'
import { financeApi } from '@/api/finance'
import type {
  Account,
  CreateAccountReq,
  UpdateAccountReq,
  Transaction,
  CreateTransactionReq,
  UpdateTransactionReq,
  TransferReq,
  ListTransactionsQuery,
  Budget,
  CreateBudgetReq,
  BudgetScope,
  DebtItem,
  DebtsResp,
  FinanceSummaryPeriod,
  FinanceSummaryResp,
} from '@/api/types'
// 数据块偏好 key 与容错读写（spec-20260922-v2 01 §2.5/§2.7；两端同值 = 同机同源）
import {
  FINANCE_MASK_KEY,
  SUMMARY_CARD_LEFT_KEY,
  SUMMARY_CARD_RIGHT_KEY,
  SUMMARY_PERIOD_KEY,
  lsGet,
  lsSet,
} from '@/constants/finance'

interface FinanceStore {
  accounts: Account[]
  totalBalance: number
  transactions: Transaction[]
  txTotal: number
  txLoading: boolean
  txQuery: ListTransactionsQuery
  txHasMore: boolean
  accountsEmpty: boolean
  txEmpty: boolean
  hasTxFilter: boolean
  budgets: Budget[]
  // ===== v4 债权债务（GET /finance/debts）=====
  debts: DebtsResp | null
  debtsLoading: boolean
  // ===== 数据块（spec-20260922-v2 · 01 §2；周期/两态 = localStorage 设备偏好，D10/D11）=====
  summary: FinanceSummaryResp | null
  summaryLoading: boolean
  summaryError: boolean
  summaryPeriod: FinanceSummaryPeriod
  summaryCardLeft: 'income' | 'expense'
  summaryCardRight: 'budget' | 'net'
  // ===== 金额隐私遮罩（spec-20260922-v2 · 03；设备偏好，D11 不入库）=====
  /** 真 = 全站金额显示为 `¥ ••••`；展示点一律走 <MoneyText>（单一出口，D14） */
  masked: boolean
  /** 小眼睛开关（03 §3.1：切换**不弹 toast**） */
  toggleMasked: () => void
  fetchAccounts: () => Promise<void>
  fetchDebts: () => Promise<void>
  fetchSummary: () => Promise<void>
  setSummaryPeriod: (p: FinanceSummaryPeriod) => void
  cycleSummaryPeriod: () => void
  flipSummaryCardLeft: () => void
  flipSummaryCardRight: () => void
  createAccount: (data: CreateAccountReq) => Promise<Account | null>
  updateAccount: (id: string, data: UpdateAccountReq) => Promise<Account | null>
  removeAccount: (id: string) => Promise<boolean>
  fetchTransactions: (opts?: { append?: boolean }) => Promise<void>
  setTxQuery: (patch: Partial<ListTransactionsQuery>) => void
  setTxPage: (page: number) => Promise<void>
  loadMore: () => Promise<void>
  createTransaction: (data: CreateTransactionReq) => Promise<Transaction | null>
  updateTransaction: (id: string, data: UpdateTransactionReq) => Promise<Transaction | null>
  removeTransaction: (id: string) => Promise<boolean>
  reverseTransaction: (id: string, note?: string) => Promise<boolean>
  transfer: (data: TransferReq) => Promise<boolean>
  fetchBudgets: (scope?: BudgetScope) => Promise<void>
  createBudget: (data: CreateBudgetReq) => Promise<Budget | null>
  removeBudget: (id: string) => Promise<boolean>
}

function deriveFinance(accounts: Account[], transactions: Transaction[], txLoading: boolean, txQuery: ListTransactionsQuery) {
  return {
    accountsEmpty: accounts.length === 0,
    txEmpty: !txLoading && transactions.length === 0,
    hasTxFilter: !!txQuery.type || !!txQuery.account_id || !!txQuery.keyword || !!txQuery.start_date || !!txQuery.end_date || !!txQuery.contact,
  }
}

/** 交易查询默认值（page_size 固定单页大小，分页走 setTxPage / loadMore） */
const DEFAULT_TX_QUERY: ListTransactionsQuery = {
  type: undefined,
  account_id: undefined,
  keyword: undefined,
  contact: undefined,
  start_date: undefined,
  end_date: undefined,
  page: 1,
  page_size: 50,
}

/** DebtItem 排序：未结清额降序（后端聚合顺序不稳定，展示层统一排） */
function sortDebts(res: DebtsResp): DebtsResp {
  const byOpen = (a: DebtItem, b: DebtItem) => b.open - a.open
  // ⚠️ 后端空分组序列化为 null（Go nil slice → JSON null）。不兜底的话
  //    展开运算符 `[...null]` 直接 TypeError（曾被 fetchDebts 的 try 吞掉，
  //    表现为「有数据也不显示债权债务卡」）。与移动端 store 同一条归一化规则。
  res.owed_to_me = [...(res.owed_to_me ?? [])].sort(byOpen)
  res.i_owe = [...(res.i_owe ?? [])].sort(byOpen)
  res.net = res.net ?? 0
  return res
}

export const useFinanceStore = create<FinanceStore>((set, get) => ({
  accounts: [],
  totalBalance: 0,
  transactions: [],
  txTotal: 0,
  txLoading: false,
  txHasMore: false,
  budgets: [],
  debts: null,
  debtsLoading: false,
  txQuery: { ...DEFAULT_TX_QUERY },
  ...deriveFinance([], [], false, { ...DEFAULT_TX_QUERY }),
  // 数据块：非法存量值回退默认（month / income / budget）；偏好读失败=回默认
  summary: null,
  summaryLoading: false,
  summaryError: false,
  summaryPeriod: (() => {
    const v = lsGet(SUMMARY_PERIOD_KEY)
    return v === 'week' || v === 'year' ? v : 'month'
  })(),
  summaryCardLeft: lsGet(SUMMARY_CARD_LEFT_KEY) === 'expense' ? 'expense' : 'income',
  summaryCardRight: lsGet(SUMMARY_CARD_RIGHT_KEY) === 'net' ? 'net' : 'budget',
  // ⚠️ 在 store 定义期读 localStorage（而非组件挂载后）：首帧即遮罩态，
  //    否则会闪一下真值 = 隐私泄漏红线（03 §4.2）。与移动端 store 同构。
  masked: lsGet(FINANCE_MASK_KEY) === '1',

  async fetchAccounts() {
    try {
      const res = await financeApi.listAccounts()
      set({
        accounts: res.items,
        totalBalance: res.total_balance,
        ...deriveFinance(res.items, get().transactions, get().txLoading, get().txQuery),
      })
    } catch {
      set({
        accounts: [],
        totalBalance: 0,
        ...deriveFinance([], get().transactions, get().txLoading, get().txQuery),
      })
    }
  },

  /** 债权债务（v4）。失败置 null（卡片整卡不渲染，等同「两组都空」） */
  async fetchDebts() {
    set({ debtsLoading: true })
    try {
      const res = await financeApi.getDebts()
      set({ debts: sortDebts(res), debtsLoading: false })
    } catch {
      set({ debts: null, debtsLoading: false })
    }
  },

  // ==================== 数据块（spec-20260922-v2 · 01 §2，与移动端 store 同构） ====================

  /** 拉取当前周期服务端汇总；失败只置 summaryError（块上有重试态），**不弹 toast**（01 §2.8） */
  async fetchSummary() {
    set({ summaryLoading: true, summaryError: false })
    try {
      const res = await financeApi.getSummary(get().summaryPeriod)
      set({ summary: res, summaryLoading: false })
    } catch {
      set({ summary: null, summaryError: true, summaryLoading: false })
    }
  },

  setSummaryPeriod(p) {
    if (p === get().summaryPeriod) return
    set({ summaryPeriod: p })
    lsSet(SUMMARY_PERIOD_KEY, p)
    void get().fetchSummary()
  },

  /** 周期字点击：月 → 周 → 年 循环（01 §2.2 热区②，顺序写死勿改） */
  cycleSummaryPeriod() {
    const cur = get().summaryPeriod
    const next: FinanceSummaryPeriod = cur === 'month' ? 'week' : cur === 'week' ? 'year' : 'month'
    get().setSummaryPeriod(next)
  },

  flipSummaryCardLeft() {
    const face = get().summaryCardLeft === 'income' ? 'expense' : 'income'
    set({ summaryCardLeft: face })
    lsSet(SUMMARY_CARD_LEFT_KEY, face)
  },

  flipSummaryCardRight() {
    const face = get().summaryCardRight === 'budget' ? 'net' : 'budget'
    set({ summaryCardRight: face })
    lsSet(SUMMARY_CARD_RIGHT_KEY, face)
  },

  // ==================== 金额遮罩（spec-20260922-v2 · 03） ====================

  /** 切换遮罩并持久化（'1' 才算开；写失败仅丢偏好，不影响本次会话） */
  toggleMasked() {
    const next = !get().masked
    set({ masked: next })
    lsSet(FINANCE_MASK_KEY, next ? '1' : '0')
  },

  async createAccount(data) {
    try {
      const acc = await financeApi.createAccount(data)
      const { accounts, totalBalance } = get()
      const newAccounts = [acc, ...accounts]
      set({
        accounts: newAccounts,
        totalBalance: totalBalance + (acc.balance || 0),
        ...deriveFinance(newAccounts, get().transactions, get().txLoading, get().txQuery),
      })
      return acc
    } catch {
      return null
    }
  },

  async updateAccount(id, data) {
    const { accounts } = get()
    const idx = accounts.findIndex((a) => a.id === id)
    if (idx < 0) {
      try {
        return await financeApi.updateAccount(id, data)
      } catch {
        return null
      }
    }
    const snapshot = accounts[idx]
    const oldBalance = snapshot.balance
    const newBalance = data.balance ?? oldBalance
    const newAccounts = [...accounts]
    newAccounts[idx] = { ...snapshot, ...data, balance: newBalance }
    const newTotal = get().totalBalance + newBalance - oldBalance
    set({
      accounts: newAccounts,
      totalBalance: newTotal,
      ...deriveFinance(newAccounts, get().transactions, get().txLoading, get().txQuery),
    })
    try {
      const fresh = await financeApi.updateAccount(id, data)
      const freshAccounts = [...get().accounts]
      freshAccounts[idx] = fresh
      set({
        accounts: freshAccounts,
        totalBalance: get().totalBalance + fresh.balance - newBalance,
        ...deriveFinance(freshAccounts, get().transactions, get().txLoading, get().txQuery),
      })
      return fresh
    } catch {
      const rollbackAccounts = [...get().accounts]
      rollbackAccounts[idx] = snapshot
      set({
        accounts: rollbackAccounts,
        totalBalance: get().totalBalance - (newBalance - oldBalance),
        ...deriveFinance(rollbackAccounts, get().transactions, get().txLoading, get().txQuery),
      })
      return null
    }
  },

  async removeAccount(id) {
    const { accounts } = get()
    const idx = accounts.findIndex((a) => a.id === id)
    if (idx < 0) return false
    const snapshot = accounts[idx]
    const newAccounts = [...accounts]
    newAccounts.splice(idx, 1)
    set({
      accounts: newAccounts,
      totalBalance: get().totalBalance - snapshot.balance,
      ...deriveFinance(newAccounts, get().transactions, get().txLoading, get().txQuery),
    })
    try {
      await financeApi.removeAccount(id)
      feedback.destructiveDone('账户已删除')
      return true
    } catch {
      const rollbackAccounts = [...get().accounts]
      rollbackAccounts.splice(idx, 0, snapshot)
      set({
        accounts: rollbackAccounts,
        totalBalance: get().totalBalance + snapshot.balance,
        ...deriveFinance(rollbackAccounts, get().transactions, get().txLoading, get().txQuery),
      })
      return false
    }
  },

  async fetchTransactions(opts?: { append?: boolean }) {
    set({ txLoading: true })
    try {
      const { txQuery, transactions } = get()
      const res = await financeApi.listTransactions({
        type: txQuery.type,
        account_id: txQuery.account_id,
        keyword: txQuery.keyword,
        contact: txQuery.contact,
        start_date: txQuery.start_date,
        end_date: txQuery.end_date,
        page: txQuery.page,
        page_size: txQuery.page_size,
      })
      const items = opts?.append ? [...transactions, ...(res.items || [])] : (res.items || [])
      set({
        transactions: items,
        txTotal: res.total,
        txHasMore: res.has_more,
        txLoading: false,
        ...deriveFinance(get().accounts, items, false, get().txQuery),
      })
    } catch {
      set({
        transactions: opts?.append ? get().transactions : [],
        txTotal: get().txTotal,
        txHasMore: false,
        txLoading: false,
        ...deriveFinance(get().accounts, get().transactions, false, get().txQuery),
      })
    }
  },

  setTxQuery(patch) {
    const { txQuery } = get()
    const newQuery = { ...txQuery, ...patch, page: 1 }
    set({ txQuery: newQuery, ...deriveFinance(get().accounts, get().transactions, get().txLoading, newQuery) })
  },

  async setTxPage(page) {
    const { txQuery } = get()
    const newQuery = { ...txQuery, page }
    set({ txQuery: newQuery, ...deriveFinance(get().accounts, get().transactions, get().txLoading, newQuery) })
    await get().fetchTransactions()
  },

  async loadMore() {
    const { txQuery, txHasMore, txLoading } = get()
    if (txLoading || !txHasMore) return
    const newQuery = { ...txQuery, page: (txQuery.page ?? 1) + 1 }
    set({ txQuery: newQuery, ...deriveFinance(get().accounts, get().transactions, get().txLoading, newQuery) })
    await get().fetchTransactions({ append: true })
  },

  async createTransaction(data) {
    const { accounts } = get()
    const acc = accounts.find((a) => a.id === data.account_id)
    const toAcc = data.to_account_id
      ? accounts.find((a) => a.id === data.to_account_id)
      : null

    const placeholder: Transaction = {
      id: `tmp_${Date.now()}`,
      type: data.type,
      amount: data.amount,
      category_id: data.category_id ?? null,
      category_emoji: data.category_emoji || (data.type === 'transfer' ? '🔄' : ''),
      category_name: data.category_name || (data.type === 'transfer' ? '转账' : ''),
      account_id: data.account_id,
      account_name: acc?.name,
      to_account_id: data.to_account_id,
      to_account_name: toAcc?.name,
      note: data.note,
      happened_at: data.happened_at || new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    const newTx = [placeholder, ...get().transactions]
    let newTotal = get().txTotal + 1
    set({ transactions: newTx, txTotal: newTotal })

    // optimistic balance
    const snapshotAcc = acc ? { ...acc } : null
    const snapshotTo = toAcc ? { ...toAcc } : null
    const newAccounts = [...accounts]
    if (acc) {
      if (data.type === 'expense') newAccounts.find((a) => a.id === acc.id)!.balance -= data.amount
      else if (data.type === 'income') newAccounts.find((a) => a.id === acc.id)!.balance += data.amount
      else if (data.type === 'transfer') newAccounts.find((a) => a.id === acc.id)!.balance -= data.amount
    }
    if (toAcc && data.type === 'transfer') {
      newAccounts.find((a) => a.id === toAcc.id)!.balance += data.amount
    }
    let newTotalBalance = get().totalBalance
    if (acc) {
      if (data.type === 'expense') newTotalBalance -= data.amount
      else if (data.type === 'income') newTotalBalance += data.amount
    }
    set({
      accounts: newAccounts,
      totalBalance: newTotalBalance,
      ...deriveFinance(newAccounts, newTx, get().txLoading, get().txQuery),
    })

    try {
      let fresh: Transaction
      if (data.type === 'transfer') {
        // Transfer uses the dedicated /transactions/transfer endpoint
        // Backend returns a single TransactionResp (with updated balances for both accounts)
        fresh = await financeApi.transfer({
          from_account_id: data.account_id,
          to_account_id: data.to_account_id!,
          amount: data.amount,
          note: data.note,
          happened_at: data.happened_at,
        })
      } else {
        fresh = await financeApi.createTransaction(data)
      }
      const currentTx = [...get().transactions]
      const idx = currentTx.findIndex((t) => t.id === placeholder.id)
      if (idx >= 0) currentTx[idx] = fresh
      set({ transactions: currentTx })
      get().fetchAccounts()
      // v4：核销笔/借入借出/待报销等会改变债权债务 → 创建成功后同时刷新
      //（只刷一个会出现「卡片还显示欠着」）
      if (data.source || data.settle_of) void get().fetchDebts()
      void get().fetchSummary() // 01 验收：记一笔后数据块立即更新
      return fresh
    } catch {
      const currentTx = [...get().transactions]
      const idx = currentTx.findIndex((t) => t.id === placeholder.id)
      if (idx >= 0) currentTx.splice(idx, 1)
      // rollback accounts
      const rollbackAccounts = [...get().accounts]
      if (snapshotAcc) {
        const i = rollbackAccounts.findIndex((a) => a.id === snapshotAcc.id)
        if (i >= 0) rollbackAccounts[i] = snapshotAcc
      }
      if (snapshotTo) {
        const i = rollbackAccounts.findIndex((a) => a.id === snapshotTo.id)
        if (i >= 0) rollbackAccounts[i] = snapshotTo
      }
      set({
        transactions: currentTx,
        txTotal: Math.max(0, get().txTotal - 1),
        accounts: rollbackAccounts,
        ...deriveFinance(rollbackAccounts, currentTx, get().txLoading, get().txQuery),
      })
      return null
    }
  },

  async removeTransaction(id) {
    const { transactions } = get()
    const idx = transactions.findIndex((t) => t.id === id)
    if (idx < 0) return false
    const snapshot = transactions[idx]
    const newTx = [...transactions]
    newTx.splice(idx, 1)
    set({
      transactions: newTx,
      txTotal: Math.max(0, get().txTotal - 1),
      ...deriveFinance(get().accounts, newTx, get().txLoading, get().txQuery),
    })
    try {
      await financeApi.removeTransaction(id)
      get().fetchAccounts()
      // 被删的可能是核销笔或原笔 → 债权债务联动刷新
      void get().fetchDebts()
      void get().fetchSummary()
      feedback.destructiveDone('交易已删除')
      return true
    } catch {
      const rollbackTx = [...get().transactions]
      rollbackTx.splice(idx, 0, snapshot)
      set({
        transactions: rollbackTx,
        txTotal: get().txTotal + 1,
        ...deriveFinance(get().accounts, rollbackTx, get().txLoading, get().txQuery),
      })
      return false
    }
  },

  async reverseTransaction(id: string, note?: string) {
    try {
      await financeApi.reverseTransaction(id, { note })
      await get().fetchTransactions()
      await get().fetchAccounts()
      void get().fetchDebts()
      void get().fetchSummary()
      feedback.destructiveDone('交易已撤销')
      return true
    } catch {
      Toast.error('撤销失败')
      return false
    }
  },

  async updateTransaction(id: string, data: UpdateTransactionReq) {
    try {
      const updated = await financeApi.updateTransaction(id, data)
      await get().fetchTransactions()
      await get().fetchAccounts()
      void get().fetchSummary()
      return updated
    } catch {
      Toast.error('保存失败')
      return null
    }
  },

  async transfer(data) {
    const { accounts } = get()
    const from = accounts.find((a) => a.id === data.from_account_id)
    const to = accounts.find((a) => a.id === data.to_account_id)
    const snapFrom = from ? { ...from } : null
    const snapTo = to ? { ...to } : null

    const newAccounts = [...accounts]
    if (from) newAccounts.find((a) => a.id === from.id)!.balance -= data.amount
    if (to) newAccounts.find((a) => a.id === to.id)!.balance += data.amount
    set({
      accounts: newAccounts,
      ...deriveFinance(newAccounts, get().transactions, get().txLoading, get().txQuery),
    })

    try {
      await financeApi.transfer(data)
      get().fetchAccounts()
      void get().fetchSummary()
      return true
    } catch {
      const rollbackAccounts = [...get().accounts]
      if (snapFrom) {
        const i = rollbackAccounts.findIndex((a) => a.id === snapFrom.id)
        if (i >= 0) rollbackAccounts[i] = snapFrom
      }
      if (snapTo) {
        const i = rollbackAccounts.findIndex((a) => a.id === snapTo.id)
        if (i >= 0) rollbackAccounts[i] = snapTo
      }
      set({
        accounts: rollbackAccounts,
        ...deriveFinance(rollbackAccounts, get().transactions, get().txLoading, get().txQuery),
      })
      return false
    }
  },

  async fetchBudgets(scope?: BudgetScope) {
    try {
      const res = await financeApi.listBudgets(scope ? { scope } : undefined)
      set({ budgets: res.items || [] })
    } catch {
      // Budget API may not exist yet; graceful fallback
      set({ budgets: [] })
    }
  },

  async createBudget(data) {
    try {
      const budget = await financeApi.createBudget(data)
      const { budgets } = get()
      set({ budgets: [budget, ...budgets] })
      void get().fetchSummary() // 预算面数字（amount/used/remaining/count）跟着变
      return budget
    } catch {
      Toast.error('预算功能暂不可用')
      return null
    }
  },

  async removeBudget(id) {
    const { budgets } = get()
    const idx = budgets.findIndex((b) => b.id === id)
    if (idx < 0) return false
    const snapshot = budgets[idx]
    const newBudgets = [...budgets]
    newBudgets.splice(idx, 1)
    set({ budgets: newBudgets })
    try {
      await financeApi.removeBudget(id)
      void get().fetchSummary()
      feedback.destructiveDone('预算已删除')
      return true
    } catch {
      const rollback = [...get().budgets]
      rollback.splice(idx, 0, snapshot)
      set({ budgets: rollback })
      Toast.error('删除失败')
      return false
    }
  },
}))
