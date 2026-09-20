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
  TransferReq,
  ReverseTransactionReq,
  ReverseTransactionResp,
  Budget,
  CreateBudgetReq,
  ListBudgetsQuery,
  ListBudgetsResp,
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
}
