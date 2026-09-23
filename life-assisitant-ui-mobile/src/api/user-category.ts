/**
 * 用户分类 API（习惯 / 待办共用 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/api/user-category.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/user_category.go
 * 契约文档：md/spec-20260922-v2/06-数据模型与API.md §3.3
 *
 * 与收支分类（financeApi 的 categories 段）同构，差异只有两点：
 *   1. 用 `domain`（habit | task）取代 `scope`，且**必传**；
 *   2. 一级平铺 —— 没有 parent_id / full_name / 两级树（04 §2.2、§5）。
 *
 * ⚠️ GET 承担懒创建播种：该用户该域若不存在任何 builtin 行（含已删）则播种。
 * ⚠️ DELETE 为软删（204 无响应体），历史习惯/任务照常按 id 渲染「已删除分类」。
 */
import { http } from './request'
import type {
  CreateUserCategoryReq,
  ListUserCategoriesQuery,
  ListUserCategoriesResp,
  UpdateUserCategoryReq,
  UserCategoryItemResp,
} from './types'

export const userCategoryApi = {
  /**
   * 分类列表（GET /user-categories?domain=habit|task）
   * 返回 `{ items, seeded }`，`seeded=true` 表示本次触发了后端懒创建播种。
   */
  list(params: ListUserCategoriesQuery): Promise<ListUserCategoriesResp> {
    return http.get<ListUserCategoriesResp>('/user-categories', { params })
  },

  /**
   * 新建分类（POST /user-categories）
   * - `name` ≤ 10 字；同 user+domain 重名 → 行内错误（拦截器已 toast）
   * - 后端返回带真实 id 的 `{ item }`（id 规则 uc_<domain>_<随机>，前端不造 id）
   */
  create(data: CreateUserCategoryReq): Promise<UserCategoryItemResp> {
    return http.post<UserCategoryItemResp>('/user-categories', data)
  },

  /**
   * 更新分类（PATCH /user-categories/:id）
   * ⚠️ 只允许改 name / icon / emoji / tint，**domain 不可改**（06 §3.3）。
   */
  update(id: string, data: UpdateUserCategoryReq): Promise<UserCategoryItemResp> {
    return http.patch<UserCategoryItemResp>(`/user-categories/${id}`, data)
  },

  /**
   * 删除分类（DELETE /user-categories/:id；204 无响应体）
   * ⚠️ 软删除 —— 只影响选择器平铺，历史习惯/任务仍按 id 显示「已删除分类」。
   */
  remove(id: string): Promise<void> {
    return http.delete<void>(`/user-categories/${id}`)
  },
}
