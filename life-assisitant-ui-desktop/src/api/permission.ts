import request from './request'
import type { Permission, MyPermissionsResp, PermissionMatrixResp, UpdatePermissionMatrixReq } from './types'

/** 权限管理 API（D-03：11 模块 × 实际功能权限点） */
export const permissionApi = {
  /** 全部权限点目录（37 条，渲染 label 用）。任何登录用户可读 */
  list() {
    return request.get<unknown, Permission[]>('/permissions')
  },

  /** 我的有效权限（GET /auth/me/permissions），store 拉权限点用 */
  myPermissions() {
    return request.get<unknown, MyPermissionsResp>('/auth/me/permissions')
  },

  /**
   * 获取角色权限矩阵（GET /roles/:code/permissions）
   * 返回 { role, version, updated_at, matrix }（matrix: module -> actions）。权限点：role_mgmt:view
   */
  getRolePermissions(roleCode: string) {
    return request.get<unknown, PermissionMatrixResp>(`/roles/${roleCode}/permissions`)
  },

  /**
   * 覆盖设置角色权限矩阵（PUT /roles/:code/permissions，带乐观锁 version）
   * 后端约束：admin 矩阵锁定（400022）；未知权限点拒绝（400023）；版本冲突（409001）
   * 权限点：role_mgmt:grant
   */
  updateRolePermissions(roleCode: string, data: UpdatePermissionMatrixReq) {
    return request.put(`/roles/${roleCode}/permissions`, data)
  },
}
