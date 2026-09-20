/**
 * 权限点 API
 * 路径前缀：/permissions + /auth/me/permissions + /users/:id/permissions
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/permission.go
 *                    life-assisitant-api/internal/controller/router.go
 * 最后同步：2026-09-18
 *
 * ⚠️ 修掉的既有缺陷：原 `getRolePermissions()` 声明返回 `string[]`，
 *    但后端 GET /roles/:code/permissions 实际返回 dto.PermissionMatrixResp
 *    （{ role, version, updated_at, matrix }）。取矩阵请改用 roleApi.getMatrix()。
 */
import { http } from './request'
import type { MyPermissionsResp, Permission } from './types'

export const permissionApi = {
  /**
   * 全部权限点目录（GET /permissions）
   * 属会话生命周期接口，任何已登录用户可读 —— 用于把 matrix 里的
   * `module:action` 渲染成中文 label。
   */
  list(): Promise<Permission[]> {
    return http.get<Permission[]>('/permissions')
  },

  /**
   * 我的有效权限（GET /auth/me/permissions）
   * 前端据此渲染菜单/按钮显隐；admin 返回全量。
   */
  myPermissions(): Promise<MyPermissionsResp> {
    return http.get<MyPermissionsResp>('/auth/me/permissions')
  },
}
