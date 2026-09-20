/**
 * 角色管理 API
 * 路径前缀：/roles + /users/:id/role
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/role.go
 *                    life-assisitant-api/internal/model/dto/user.go（角色段）
 * 最后同步：2026-09-18
 *
 * ⚠️ 权限点：role_mgmt:view / create / update / delete / grant，
 *    分配角色走 user_mgmt:assign_role（注意不是 role_mgmt）。
 *
 * ⚠️ 刻意**不包装** `GET /roles/:code`（Phase 7 按 §9「零已实现但无调用」清理）：
 *    权限页一次性 `list()` 拿到全部角色（含 user_count），按 code 单查是多余往返。
 */
import { http } from './request'
import type {
  CreateRoleReq,
  PermissionMatrixResp,
  Role,
  RoleCode,
  UpdatePermissionMatrixReq,
  UpdateRoleReq,
} from './types'

export const roleApi = {
  /**
   * 角色列表（GET /roles，role_mgmt:view）
   * 后端直接返回数组（不是 {items}），含内置 admin/user 与全部自定义角色。
   */
  list(): Promise<Role[]> {
    return http.get<Role[]>('/roles')
  },

  /**
   * 新建自定义角色（POST /roles，role_mgmt:create）
   * 初始矩阵为空，需在权限页勾选后保存。
   */
  create(data: CreateRoleReq): Promise<Role> {
    return http.post<Role>('/roles', data)
  },

  /** 更新角色元信息（PATCH /roles/:code，role_mgmt:update；编码不可变） */
  update(code: RoleCode, data: UpdateRoleReq): Promise<Role> {
    return http.patch<Role>(`/roles/${code}`, data)
  },

  /** 删除自定义角色（DELETE /roles/:code，role_mgmt:delete；内置角色 400020，仍有人 409003） */
  remove(code: RoleCode): Promise<void> {
    return http.delete<void>(`/roles/${code}`)
  },

  /**
   * 角色权限矩阵（GET /roles/:code/permissions，role_mgmt:view）
   * 返回 { role, version, updated_at, matrix }；admin 返回全量只读矩阵。
   */
  getMatrix(code: RoleCode): Promise<PermissionMatrixResp> {
    return http.get<PermissionMatrixResp>(`/roles/${code}/permissions`)
  },

  /**
   * 覆盖设置角色权限矩阵（PUT /roles/:code/permissions，role_mgmt:grant）
   * 必带 version 乐观锁；冲突返回 409001 VERSION_CONFLICT。
   */
  updateMatrix(code: RoleCode, data: UpdatePermissionMatrixReq): Promise<{ message: string }> {
    return http.put<{ message: string }>(`/roles/${code}/permissions`, data)
  },

  /**
   * 给用户分配角色（PUT /users/:id/role，user_mgmt:assign_role）
   * body 仅需 { role }，用户 id 走路径。
   */
  assignRole(userId: string, role: RoleCode): Promise<{ message: string }> {
    return http.put<{ message: string }>(`/users/${userId}/role`, { role })
  },
}
