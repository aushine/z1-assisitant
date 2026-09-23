// ============================================================================
// 用户分类 API —— 习惯 / 待办（spec-20260922-v2/06 §3）
//
// SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/api/user-category.ts
//
// ⚠️ 与收支分类（`/finance/categories`，两级树）是**两套实体**：
//    这里一级平铺、按 domain=habit|task 分域；创建 / 更新返回 `{item}`
//    包裹（与财务控制器同口径），删除 204 无响应体（request 拦截器解包）。
// ============================================================================
import request from './request'
import type {
  CreateUserCategoryReq,
  ListUserCategoriesQuery,
  ListUserCategoriesResp,
  UpdateUserCategoryReq,
  UserCategoryItemResp,
} from './types'

export const userCategoryApi = {
  /** 按域拉取分类列表（06 §3.1）。seeded = 后端本次是否懒播种 */
  list(params: ListUserCategoriesQuery) {
    return request.get<unknown, ListUserCategoriesResp>('/user-categories', { params })
  },

  /** 创建分类（06 §3.2）。id 由后端生成（uc_<domain>_<random>），返回 {item} */
  create(data: CreateUserCategoryReq) {
    return request.post<unknown, UserCategoryItemResp>('/user-categories', data)
  },

  /** 更新分类（06 §3.3，PATCH /:id）。domain 不可改，返回 {item} */
  update(id: string, data: UpdateUserCategoryReq) {
    return request.patch<unknown, UserCategoryItemResp>(`/user-categories/${id}`, data)
  },

  /** 删除分类（软删除，204 无响应体） */
  remove(id: string) {
    return request.delete(`/user-categories/${id}`)
  },
}
