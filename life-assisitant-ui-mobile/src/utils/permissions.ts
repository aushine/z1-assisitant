/**
 * 权限检查工具（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/permissions.ts
 * 最后同步：2026-09-18
 *
 * 旧版的 ROLE_LEVEL（viewer < editor < admin）等级概念已废弃：
 * editor/viewer 在后端 260917 迁移中删除，自定义角色之间没有高低之分，
 * 只有权限点集合之差。唯一的「等级」是 admin —— 后端中间件代码旁路全权限
 * （见 internal/middleware/rbac.go），前端保持一致的直通语义。
 *
 * 权限点格式：`${module}:${action}`，如 "user_mgmt:view"、"task:complete"。
 * 模块清单：home / task / habit / mood / finance / stat / timeline /
 *          notification / me / period / user_mgmt / role_mgmt
 */
import type { RoleCode } from '@/api/types'

/** 权限点字符串，"module:action" */
export type PermissionPoint = string

/** 后台内置超级角色编码（与后端 model.RoleAdmin 对齐） */
export const ROLE_ADMIN: RoleCode = 'admin'

/** 内置普通角色编码（与后端 model.RoleUser 对齐） */
export const ROLE_USER: RoleCode = 'user'

/**
 * 系统管理入口所需的权限点（任一命中即可见）
 *
 * 权限点与后端 router.go 的中间件声明**逐条对齐**（api/internal/controller/router.go
 * 197~244 行），每个常量对应一个真实存在的受保护端点：
 *
 *   user_mgmt:view        GET    /users、/users/:id、/users/:id/permissions
 *   user_mgmt:create      POST   /users
 *   user_mgmt:update      PATCH  /users/:id、/users/:id/status
 *   user_mgmt:delete      DELETE /users/:id
 *   user_mgmt:assign_role PUT    /users/:id/role   ← 注意归在 user_mgmt 下，不是 role_mgmt
 *   role_mgmt:view        GET    /roles、/roles/:code、/roles/:code/permissions
 *   role_mgmt:create      POST   /roles
 *   role_mgmt:update      PATCH  /roles/:code
 *   role_mgmt:delete      DELETE /roles/:code
 *   role_mgmt:grant       PUT    /roles/:code/permissions
 *
 * 页面里判断按钮显隐时务必用对应端点的那一个常量 ——
 * 用错粒度会出现「按钮能点但接口 403」或「有权限却看不到入口」。
 */
export const USER_MGMT_VIEW: PermissionPoint = 'user_mgmt:view'
export const USER_MGMT_CREATE: PermissionPoint = 'user_mgmt:create'
export const USER_MGMT_UPDATE: PermissionPoint = 'user_mgmt:update'
export const USER_MGMT_DELETE: PermissionPoint = 'user_mgmt:delete'
/** 分配角色。⚠️ 模块前缀是 user_mgmt，不是 role_mgmt */
export const USER_MGMT_ASSIGN_ROLE: PermissionPoint = 'user_mgmt:assign_role'

export const ROLE_MGMT_VIEW: PermissionPoint = 'role_mgmt:view'
export const ROLE_MGMT_CREATE: PermissionPoint = 'role_mgmt:create'
export const ROLE_MGMT_UPDATE: PermissionPoint = 'role_mgmt:update'
export const ROLE_MGMT_DELETE: PermissionPoint = 'role_mgmt:delete'
/** 勾选并保存权限矩阵（PUT /roles/:code/permissions） */
export const ROLE_MGMT_GRANT: PermissionPoint = 'role_mgmt:grant'

/**
 * 经期模块权限点（记录模块第 5 个维度，2026-09-19 新增）
 *
 *   period:view    GET    /period/overview、/calendar、/days、/days/:date、
 *                        /cycles、/settings、/report
 *   period:write   PUT/DELETE /period/days/:date、PATCH /period/settings、POST /period/setup
 *   period:manage  PATCH  /period/cycles/:id（人工修正）、POST /period/reset（重置）
 *
 * ⚠️ 命名对齐既有 `mood:view` 的 `view` 动作名（初版设计的 `period:read` 已废弃）。
 * ⚠️ 设置页与经期 Tab **共用**这三个点，**不为设置入口单独造按钮级权限**。
 */
export const PERIOD_VIEW: PermissionPoint = 'period:view'
export const PERIOD_WRITE: PermissionPoint = 'period:write'
export const PERIOD_MANAGE: PermissionPoint = 'period:manage'

/**
 * 健康模块权限点（2026-09-19 新增，记录模块「健康」Tab）
 *
 *   health:view    GET  /health/overview、/calendar、/days、/days/:date、/settings
 *   health:write   PUT/DELETE /health/days/:date、PATCH /health/settings、POST /health/setup
 *   health:manage  （预留）批量修正 / 重置健康数据
 *
 * ⚠️ 健康 Tab 是「经期 Tab 的父集」：经期相关接口仍在 period:* 下，
 *    健康浮层写经期块时后端同时写 period_days 与 health_days，前端只要
 *    health:view 即可进入健康 Tab；只有独立用旧经期页才需要 period:view。
 */
export const HEALTH_VIEW: PermissionPoint = 'health:view'
export const HEALTH_WRITE: PermissionPoint = 'health:write'
export const HEALTH_MANAGE: PermissionPoint = 'health:manage'

/**
 * 纪念日 / 倒数日权限点（2026-09-19 新增，「我的 → 纪念日」）
 *
 *   anniversary:view   GET    /anniversaries、/anniversaries/upcoming
 *   anniversary:write  POST/PATCH/DELETE /anniversaries
 */
export const ANNIVERSARY_VIEW: PermissionPoint = 'anniversary:view'
export const ANNIVERSARY_WRITE: PermissionPoint = 'anniversary:write'

/**
 * 是否管理员（内置超级角色，前端按钮/菜单直通判断）。
 * 与后端 `role == model.RoleAdmin` 的旁路语义一致。
 */
export function isAdmin(role: RoleCode | null | undefined): boolean {
  return role === ROLE_ADMIN
}

/**
 * 权限点判定：admin 恒 true（与后端 RequirePermission 的 admin 旁路对齐），
 * 其余角色看 permissions 列表（来自 GET /auth/me/permissions）任一命中。
 *
 * @param role        当前用户角色编码
 * @param permissions 当前用户权限点列表
 * @param codes       需要的权限点，单个或数组（数组为「任一命中即通过」）
 */
export function matchPermission(
  role: RoleCode | null | undefined,
  permissions: readonly string[] | null | undefined,
  codes: string | readonly string[] | null | undefined
): boolean {
  if (isAdmin(role)) return true
  // 未声明权限要求 → 放行（与后端「路由未挂 RequirePermission 即开放」一致）
  if (!codes) return true
  const list = Array.isArray(codes) ? codes : [codes as string]
  if (list.length === 0) return true
  const owned = permissions ?? []
  return list.some((c) => owned.includes(c))
}

/**
 * 批量判定：全部命中才算通过（用于需要同时具备多个权限的复合操作）。
 */
export function matchAllPermissions(
  role: RoleCode | null | undefined,
  permissions: readonly string[] | null | undefined,
  codes: readonly string[]
): boolean {
  if (isAdmin(role)) return true
  const owned = permissions ?? []
  return codes.every((c) => owned.includes(c))
}

/**
 * 是否可见「系统管理」入口。
 * 与桌面端侧边栏分组的显隐条件一致：user_mgmt:view 或 role_mgmt:view 任一命中。
 */
export function canAccessSystem(
  role: RoleCode | null | undefined,
  permissions: readonly string[] | null | undefined
): boolean {
  return matchPermission(role, permissions, [USER_MGMT_VIEW, ROLE_MGMT_VIEW])
}

/**
 * 把权限点按模块聚合成 matrix（module -> actions）。
 * 用于在没有后端 matrix 时从扁平 permissions 反推（如本地缓存恢复）。
 */
export function toMatrix(permissions: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const p of permissions) {
    const idx = p.indexOf(':')
    if (idx <= 0) continue
    const module = p.slice(0, idx)
    const action = p.slice(idx + 1)
    ;(out[module] ??= []).push(action)
  }
  return out
}
