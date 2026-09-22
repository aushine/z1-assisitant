import request from './request'
import type {
  Account,
  CreateAccountReq,
  UpdateAccountReq,
  ListAccountsResp,
  Transaction,
  CreateTransactionReq,
  ListTransactionsQuery,
  ListTransactionsResp,
  CalendarResp,
  DebtsResp,
  UpdateTransactionReq,
  TransferReq,
  ReverseTransactionReq,
  ReverseTransactionResp,
  Budget,
  CreateBudgetReq,
  ListBudgetsQuery,
  ListBudgetsResp,
  FinanceCategory,
  CreateCategoryReq,
  PatchCategoryReq,
  ListCategoriesResp,
} from './types'

/**
 * 财务 API（账户 + 交易 + 转账）
 * 规范：md/spec/12-记录.md · 8.3 / 8.4 / 8.5 / 8.6
 */
export const financeApi = {
  // ============ 账户 ============
  /** 账户列表（含 total_balance 汇总） */
  listAccounts() {
    return request.get<unknown, ListAccountsResp>('/accounts')
  },

  /** 单个账户 */
  getAccount(id: string) {
    return request.get<unknown, Account>(`/accounts/${id}`)
  },

  /** 创建账户 */
  createAccount(data: CreateAccountReq) {
    return request.post<unknown, Account>('/accounts', data)
  },

  /** 更新账户 */
  updateAccount(id: string, data: UpdateAccountReq) {
    return request.patch<unknown, Account>(`/accounts/${id}`, data)
  },

  /** 删除（软删除 — 归档） */
  removeAccount(id: string) {
    return request.delete(`/accounts/${id}`)
  },

  // ============ 交易 ============
  /** 交易列表（分页 + 筛选） */
  listTransactions(params?: ListTransactionsQuery) {
    return request.get<unknown, ListTransactionsResp>('/transactions', { params })
  },

  /** 收支日历（GET /finance/calendar，03 §B） */
  getCalendar(month: string) {
    return request.get<unknown, CalendarResp>('/finance/calendar', { params: { month } })
  },

  /** 债权债务（GET /finance/debts，05 §C3；后端聚合，前端不做金额推导） */
  getDebts() {
    return request.get<unknown, DebtsResp>('/finance/debts')
  },

  /** 创建交易（expense / income / transfer） */
  createTransaction(data: CreateTransactionReq) {
    return request.post<unknown, Transaction>('/transactions', data)
  },

  /** 删除交易 */
  removeTransaction(id: string) {
    return request.delete(`/transactions/${id}`)
  },

  /** 撤销交易（生成反向交易，回滚账户余额） */
  reverseTransaction(id: string, data: ReverseTransactionReq) {
    return request.post<unknown, ReverseTransactionResp>(`/transactions/${id}/reverse`, data)
  },

  /** 单笔交易（GET /transactions/:id —— 详情抽屉独立拉取，不复用列表） */
  getTransaction(id: string) {
    return request.get<unknown, Transaction>(`/transactions/${id}`)
  },

  /** 更新交易（PUT /transactions/:id，edit 模式；不带 type） */
  updateTransaction(id: string, data: UpdateTransactionReq) {
    return request.put<unknown, Transaction>(`/transactions/${id}`, data)
  },

  // ============ 转账 ============
  /**
   * 账户间转账
   * 后端路由：POST /transactions/transfer
   * 后端 DTO：TransferReq { from_account_id, to_account_id, amount, happened_at, note }
   * 后端返回：单个 TransactionResp（含两账户的联动记录）
   */
  transfer(data: TransferReq) {
    return request.post<unknown, Transaction>('/transactions/transfer', data)
  },

  // ============ 预算 ============
  /** 预算列表（可选 scope 过滤） */
  listBudgets(params?: ListBudgetsQuery) {
    return request.get<unknown, ListBudgetsResp>('/budgets', { params })
  },

  /** 创建预算 */
  createBudget(data: CreateBudgetReq) {
    return request.post<unknown, Budget>('/budgets', data)
  },

  /** 删除预算 */
  removeBudget(id: string) {
    return request.delete(`/budgets/${id}`)
  },

  // ============ 收支分类（用户级实体） ============
  /** 拉取分类树（含二级）；scope 可省略 = 返回全部（06 §1.1） */
  listCategories(scope?: 'expense' | 'income') {
    return request.get<unknown, ListCategoriesResp>('/finance/categories', {
      params: scope ? { scope } : undefined,
    })
  },

  /** 创建分类（权限 finance:category） */
  createCategory(data: CreateCategoryReq) {
    return request.post<unknown, FinanceCategory>('/finance/categories', data)
  },

  /** 更新分类（权限 finance:category） */
  updateCategory(id: string, data: PatchCategoryReq) {
    return request.patch<unknown, FinanceCategory>(`/finance/categories/${id}`, data)
  },

  /** 删除分类（软删除，权限 finance:category，204 无响应体） */
  removeCategory(id: string) {
    return request.delete(`/finance/categories/${id}`)
  },
}
