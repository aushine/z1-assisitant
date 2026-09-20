import request from './request'
import type { Role, AssignRoleReq, CreateRoleReq, UpdateRoleReq } from './types'

/** 角色管理 API（D-03：内置 admin/user + 自定义角色 CRUD） */
export const roleApi = {
  /** 角色列表（不分页）。权限点：role_mgmt:view */
  list() {
    return request.get<unknown, Role[]>('/roles')
  },

  /** 新建自定义角色（POST /roles）。权限点：role_mgmt:create */
  create(data: CreateRoleReq) {
    return request.post<unknown, Role>('/roles', data)
  },

  /** 更新角色名称/描述（PATCH /roles/:code）。权限点：role_mgmt:update */
  update(code: string, data: UpdateRoleReq) {
    return request.patch<unknown, Role>(`/roles/${code}`, data)
  },

  /** 删除自定义角色（DELETE /roles/:code；内置或有用户占用会被后端拒绝）。权限点：role_mgmt:delete */
  remove(code: string) {
    return request.delete<unknown, void>(`/roles/${code}`)
  },

  /**
   * 给用户分配角色（PUT /users/:id/role）
   * 请求体：{ role }。权限点：user_mgmt:assign_role
   */
  assignRole(userId: string, data: AssignRoleReq) {
    return request.put(`/users/${userId}/role`, data)
  },
}
