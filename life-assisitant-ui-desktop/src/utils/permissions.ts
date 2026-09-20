/**
 * 权限检查工具（D-03 权限重构版）
 *
 * 旧版的 ROLE_LEVEL（viewer<editor<admin）等级概念已废弃：
 * editor/viewer 已删除，自定义角色之间没有高低之分，只有权限点集合之差。
 * 唯一的"等级"是 admin —— 后端中间件代码旁路全权限，前端保持一致的直通语义。
 */
import type { RoleCode } from '@/api/types'

export type PermissionPoint = string // "module:action"，如 "user_mgmt:view"

/** 是否管理员（内置超级角色，前端按钮/菜单直通判断） */
export function isAdmin(role: RoleCode | null | undefined): boolean {
  return role === 'admin'
}

/**
 * 模块清单（权限目录顺序，与权限矩阵页 MODULE_NAMES、各端一致）：
 * home / task / habit / mood / finance / stat / timeline / notification /
 * me / period / user_mgmt / role_mgmt
 *
 * period 为记录模块第 5 个维度，2026-09-19 新增，插在 finance 之后。
 */

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
 * 权限点判定：admin 恒 true（与后端 RequirePermission 的 admin 旁路对齐），
 * 其余角色看 permissions 列表（来自 GET /auth/me/permissions）任一命中。
 */
export function matchPermission(
  role: RoleCode | null | undefined,
  permissions: string[],
  codes: string | string[]
): boolean {
  if (isAdmin(role)) return true
  if (!codes || (Array.isArray(codes) && codes.length === 0)) return true
  const list = Array.isArray(codes) ? codes : [codes]
  return list.some((c) => permissions.includes(c))
}
