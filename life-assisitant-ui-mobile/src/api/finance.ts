/**
 * 财务模块 API
 * 路径前缀：/accounts + /transactions + /budgets
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/finance.go
 *                    life-assisitant-api/internal/model/dto/finance.go
 * 最后同步：2026-09-18
 *
 * ⚠️ 修掉的既有缺陷：
 *   - `getAccount()` 打的 GET /accounts/:id 后端**不存在**该路由（只有
 *     /accounts 与 /accounts/total），已删除。
 *   - `transfer()` 原声明返回 `{ transactions: Transaction[] }`，后端实际
 *     返回**单个** TransactionResp，已修正。
 *   - `reverseTransaction()` 原传 body `{note}`，后端 controller 根本不解析
 *     body（service 只收 id），已去掉 body。
 *   - `listBudgets()` 的 scope 原写 'overall'，后端只认 'total'/'category'，
 *     传 'overall' 会 400505，已修正。
 *   - `updateBudget()` 原声明收 `Partial<CreateBudgetReq>`，后端
 *     UpdateBudgetReq **不接受** period/scope/category_*，已收紧。
 *
 * ⚠️ 刻意**不包装**的两个既有端点（Phase 7 按 §9「零已实现但无调用」清理）：
 *   - `GET /accounts/total`  —— 与 `GET /accounts` 的 `total_balance` 字段同源，
 *     两端（桌面端 + 移动端 finance store）都用后者，前者纯冗余。
 *   - `GET /transactions/:id` —— 列表已带全字段，编辑弹层直接用列表项；
 *     单独取单笔没有 UI 场景。桌面端同样未调用。
 *   若将来需要「按 id 拉最新」的场景，按上面注释的路径重新加回即可。
 */
import { http } from './request'
import type {
  Account,
  Budget,
  CreateAccountReq,
  CreateBudgetReq,
  CreateTransactionReq,
  ListAccountsResp,
  ListBudgetsQuery,
  ListBudgetsResp,
  ListTransactionsQuery,
  ListTransactionsResp,
  ReverseTransactionResp,
  Transaction,
  TransferReq,
  UpdateAccountReq,
  UpdateBudgetReq,
  UpdateTransactionReq,
} from './types'

/** @deprecated 用 ListAccountsResp（types.ts 里已有同构定义） */
export type { ListAccountsResp }

/** @deprecated 用 ListTransactionsQuery */
export type ListTransactionsParams = ListTransactionsQuery

export const financeApi = {
  // ==================== 账户（finance:view / finance:account） ====================

  /**
   * 列出账户（GET /accounts）
   * 裸 struct：{ items, total_balance, total }，不分页。
   */
  listAccounts(): Promise<ListAccountsResp> {
    return http.get<ListAccountsResp>('/accounts')
  },

  /** 创建账户（POST /accounts） */
  createAccount(data: CreateAccountReq): Promise<Account> {
    return http.post<Account>('/accounts', data)
  },

  /** 更新账户（PATCH /accounts/:id；balance 是直接覆盖不是增量） */
  updateAccount(id: string, data: UpdateAccountReq): Promise<Account> {
    return http.patch<Account>(`/accounts/${id}`, data)
  },

  /** 删除账户（DELETE /accounts/:id；有交易关联时返回 400305） */
  deleteAccount(id: string): Promise<void> {
    return http.delete<void>(`/accounts/${id}`)
  },

  // ==================== 交易（finance:view / record / tx_manage） ====================

  /** 交易列表（GET /transactions，走 response.Page 含分页四件套） */
  listTransactions(params: ListTransactionsQuery = {}): Promise<ListTransactionsResp> {
    return http.get<ListTransactionsResp>('/transactions', { params })
  },

  /** 创建交易（POST /transactions；transfer 请走 transfer()） */
  createTransaction(data: CreateTransactionReq): Promise<Transaction> {
    return http.post<Transaction>('/transactions', data)
  },

  /** 更新交易（PATCH /transactions/:id；仅 expense / income） */
  updateTransaction(id: string, data: UpdateTransactionReq): Promise<Transaction> {
    return http.patch<Transaction>(`/transactions/${id}`, data)
  },

  /**
   * 转账（POST /transactions/transfer）
   * 事务内：建 transfer 交易 + 扣 from 余额 + 加 to 余额。
   * 返回**单笔** TransactionResp（type = 'transfer'）。
   */
  transfer(data: TransferReq): Promise<Transaction> {
    return http.post<Transaction>('/transactions/transfer', data)
  },

  /** 删除交易（DELETE /transactions/:id；204 无响应体） */
  removeTransaction(id: string): Promise<void> {
    return http.delete<void>(`/transactions/${id}`)
  },

  /**
   * 冲正交易（POST /transactions/:id/reverse）
   * 生成一笔反向交易并回滚余额，原交易保留。**不接收请求体**。
   * 已冲正过再调返回 400403。
   */
  reverseTransaction(id: string): Promise<ReverseTransactionResp> {
    return http.post<ReverseTransactionResp>(`/transactions/${id}/reverse`)
  },

  // ==================== 预算（finance:view / finance:budget） ====================

  /** 预算列表（GET /budgets；裸 struct，不分页） */
  listBudgets(params: ListBudgetsQuery = {}): Promise<ListBudgetsResp> {
    return http.get<ListBudgetsResp>('/budgets', { params })
  },

  /** 创建预算（POST /budgets；scope=category 时必须带 category_emoji + category_name） */
  createBudget(data: CreateBudgetReq): Promise<Budget> {
    return http.post<Budget>('/budgets', data)
  },

  /**
   * 更新预算（PATCH /budgets/:id）
   * ⚠️ 后端 UpdateBudgetReq 只接受 name / amount / start_date / end_date /
   *    alert_threshold —— period 与 scope 不可改，要改只能删旧建新。
   */
  updateBudget(id: string, data: UpdateBudgetReq): Promise<Budget> {
    return http.patch<Budget>(`/budgets/${id}`, data)
  },

  /** 删除预算（DELETE /budgets/:id；204 无响应体） */
  removeBudget(id: string): Promise<void> {
    return http.delete<void>(`/budgets/${id}`)
  },
}
