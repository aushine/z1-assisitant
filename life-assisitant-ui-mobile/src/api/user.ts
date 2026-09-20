/**
 * 用户相关 API
 * 路径前缀：/users
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/router.go
 *                    life-assisitant-api/internal/model/dto/user.go
 * 最后同步：2026-09-18
 *
 * ⚠️ 修掉的既有缺陷：
 *   - `getCurrentUser()` 原来打 `/users/me`，该路径不存在（会被 GET /users/:id
 *     当成 id="me" 匹配 → 404）。当前用户一律走 `authApi.me()` → GET /auth/me。
 *   - `updatePreferences()` 打的 `/users/me/preferences` 后端**没有**这个端点，已删除。
 *   - `uploadAvatar()` 原来读 `{url}`，后端实际返回 `{avatar: url}`，已修正。
 *
 * ⚠️ 刻意**不包装**的两个既有端点（Phase 7 按 §9「零已实现但无调用」清理）：
 *   - `GET /users/:id`            —— 用户卡列表已带全字段，编辑弹层直接用列表项
 *     （并携带其 `version` 做乐观锁基准，另拉一次反而可能拿到与列表不一致的版本）。
 *   - `GET /users/:id/permissions` —— 「查看某人的有效权限」目前无对应 UI；
 *     桌面端也未调用。要做这个功能时按上面路径加回。
 */
import { http } from './request'
import { authApi } from './auth'
import type {
  CreateUserReq,
  ListUsersQuery,
  PagedResponse,
  UpdateMeReq,
  UpdateUserReq,
  UpdateUserStatusReq,
  User,
} from './types'

export const userApi = {
  // ==================== 当前用户（me:profile） ====================

  /** 获取当前登录用户信息（GET /auth/me） */
  getCurrentUser(): Promise<User> {
    return authApi.me()
  },

  /** 更新当前用户资料（PATCH /users/me；version 可选，缺省走服务端 CAS） */
  updateProfile(data: UpdateMeReq): Promise<User> {
    return http.patch<User>('/users/me', data)
  },

  /**
   * 上传头像（POST /users/me/avatar）
   * multipart 字段名固定为 `file`，限制 jpg/png/webp/gif 且 ≤5MB。
   * 返回 { avatar: '/uploads/avatars/xxx.png' }。
   */
  uploadAvatar(file: File): Promise<{ avatar: string }> {
    const form = new FormData()
    form.append('file', file)
    return http.post<{ avatar: string }>('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // ==================== 用户管理（user_mgmt:*） ====================

  /** 用户列表（GET /users，走 response.Page 含分页四件套） */
  list(params: ListUsersQuery = {}): Promise<PagedResponse<User>> {
    return http.get<PagedResponse<User>>('/users', { params })
  },

  /**
   * 创建用户（POST /users）
   * 后端统一初始密码 123456 并置 pwd_reset_required，前端不传密码。
   */
  create(data: CreateUserReq): Promise<{ id: string; message: string }> {
    return http.post<{ id: string; message: string }>('/users', data)
  },

  /** 更新指定用户（PATCH /users/:id；version 必填，乐观锁冲突返回 409001） */
  update(id: string, data: UpdateUserReq): Promise<User> {
    return http.patch<User>(`/users/${id}`, data)
  },

  /** 启用/禁用用户（PATCH /users/:id/status；version 必填） */
  setStatus(id: string, data: UpdateUserStatusReq): Promise<{ message: string }> {
    return http.patch<{ message: string }>(`/users/${id}/status`, data)
  },

  /** 软删除用户（DELETE /users/:id，204 无响应体） */
  remove(id: string): Promise<void> {
    return http.delete<void>(`/users/${id}`)
  },
}
