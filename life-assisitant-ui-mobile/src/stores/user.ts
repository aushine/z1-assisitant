/**
 * User Store
 * - 当前用户 + token + 记住密码
 * - 持久化到 localStorage（access_token / refresh_token / user / remember_account）
 * - 详见 spec/40-前端架构.md §6.2
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { authApi } from '@/api/auth'
import type { LoginResult, RegisterReq, User } from '@/api/types'
import { storage } from '@/utils/storage'
import { getDeviceId } from '@/utils/device'
import {
  matchPermission,
  ROLE_MGMT_VIEW,
  USER_MGMT_VIEW,
} from '@/utils/permissions'

const STORAGE_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  user: 'current_user',
  permissions: 'current_permissions',
  remember: 'remember_account',
  rememberedUsername: 'remembered_username',
  rememberedPassword: 'remembered_password',
} as const

/** 安全解析 JSON，失败回退到默认值 */
function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const useUserStore = defineStore('user', () => {
  // ====== state ======
  const accessToken = ref<string>(storage.get(STORAGE_KEYS.accessToken) || '')
  const refreshToken = ref<string>(storage.get(STORAGE_KEYS.refreshToken) || '')
  const user = ref<User | null>(safeJsonParse<User | null>(storage.get(STORAGE_KEYS.user), null))
  /** 权限点列表（缓存自 GET /auth/me/permissions，供路由守卫与按钮显隐离线判定） */
  const permissions = ref<string[]>(safeJsonParse<string[]>(storage.get(STORAGE_KEYS.permissions), []))
  const remember = ref<boolean>(storage.get(STORAGE_KEYS.remember) === '1')

  // ====== getters ======
  const isLoggedIn = computed(() => !!accessToken.value && !!user.value)
  /**
   * 是否内置管理员。与后端 `role == model.RoleAdmin` 的旁路语义一致 ——
   * admin 在前端同样直通全部权限判定，不再逐点查表。
   */
  const isAdmin = computed(() => user.value?.role === 'admin')
  /** 当前角色编码（自定义角色为动态字符串） */
  const roleCode = computed(() => user.value?.role ?? null)
  /** 当前用户权限点列表（来自 GET /auth/me/permissions） */
  const permissionList = computed(() => permissions.value)
  /** 是否可见「系统管理」入口（user_mgmt:view 或 role_mgmt:view） */
  const canAccessSystem = computed(() => matchPermissionByCurrent([USER_MGMT_VIEW, ROLE_MGMT_VIEW]))
  /** @deprecated 语义已收窄为 canAccessSystem，保留以免路由守卫断裂 */
  const canAccessAdmin = canAccessSystem

  /**
   * 权限点判定（模板/守卫通用）：admin 恒 true，其余看 permissions 列表。
   * @param codes 单个权限点或数组（数组为「任一命中即通过」）
   */
  function hasPermission(codes: string | readonly string[] | null | undefined): boolean {
    return matchPermission(roleCode.value, permissions.value, codes)
  }

  /** 内部用：以当前登录态做 matchPermission */
  function matchPermissionByCurrent(codes: readonly string[]): boolean {
    return matchPermission(roleCode.value, permissions.value, codes)
  }

  // ====== actions ======

  /**
   * 登录
   * @param username 账号
   * @param password 密码
   * @param remember 是否记住密码（7 天免登录，实际是持久化 refresh_token）
   */
  async function login(username: string, password: string, rememberMe: boolean): Promise<void> {
    // 调用登录 API（即使失败也应该清掉旧 token）
    const result: LoginResult = await authApi.login({
      username,
      password,
      remember: rememberMe,
      device_id: getDeviceId(),
    })
    saveLoginResult(result, rememberMe, username, password)
    // 登录后立刻拉一次权限点：路由守卫与系统管理入口依赖它，
    // 失败不能阻断登录（缺权限时按最小可见处理即可）。
    await fetchPermissions().catch(() => undefined)
  }

  /**
   * 注册并直接登录。
   *
   * 后端 POST /auth/register 返回的 RegisterResp 与 LoginResp 同构
   * （access_token / refresh_token / expires_in / user），注册成功即视为已登录，
   * 因此复用 saveLoginResult 落地，无需再让用户手输一次密码。
   *
   * ⚠️ 注册一律落内置 `user` 角色（后端强制），前端**不传** role ——
   *    历史上前端可自选角色等于开放提权漏洞。
   */
  async function register(payload: Omit<RegisterReq, 'device_id'>): Promise<void> {
    const result = await authApi.register({
      ...payload,
      device_id: getDeviceId(),
    })
    // 注册不走「记住密码」：不把用户刚设的密码写进本地
    saveLoginResult(result, false)
    await fetchPermissions().catch(() => undefined)
  }

  /** 持久化登录结果 */
  function saveLoginResult(
    result: LoginResult,
    rememberMe: boolean,
    rememberedUsername?: string,
    rememberedPassword?: string
  ): void {
    accessToken.value = result.access_token
    refreshToken.value = result.refresh_token
    user.value = result.user
    remember.value = rememberMe

    storage.set(STORAGE_KEYS.accessToken, result.access_token)
    storage.set(STORAGE_KEYS.refreshToken, result.refresh_token)
    storage.set(STORAGE_KEYS.user, JSON.stringify(result.user))
    storage.set(STORAGE_KEYS.remember, rememberMe ? '1' : '0')

    // "记住密码"：保存账号到 localStorage（出于隐私考虑不保存明文密码，
    // 真实生产应放 httpOnly cookie；这里仅持久化用户名）
    if (rememberMe) {
      if (rememberedUsername) storage.set(STORAGE_KEYS.rememberedUsername, rememberedUsername)
    } else {
      storage.remove(STORAGE_KEYS.rememberedUsername)
      storage.remove(STORAGE_KEYS.rememberedPassword)
    }
    // 兼容旧实现：保留密码字段（仅在勾选时）
    if (rememberMe && rememberedPassword) {
      storage.set(STORAGE_KEYS.rememberedPassword, rememberedPassword)
    }
  }

  /** 静默刷新 access_token（rotation：后端同时下发新 refresh_token，必须一并落库） */
  async function refreshAccessToken(): Promise<string> {
    if (!refreshToken.value) {
      throw new Error('No refresh token')
    }
    const res = await authApi.refresh({
      refresh_token: refreshToken.value,
      // ⚠️ device_id 是后端必填字段（v:"required"），漏传会直接 400
      device_id: getDeviceId(),
    })
    accessToken.value = res.access_token
    storage.set(STORAGE_KEYS.accessToken, res.access_token)
    // ⚠️ 后端用 rotation 策略：旧 refresh_token 在刷新后即失效，
    // 不落库新的会导致「刷新成功一次、下次必挂」。
    if (res.refresh_token) {
      refreshToken.value = res.refresh_token
      storage.set(STORAGE_KEYS.refreshToken, res.refresh_token)
    }
    return res.access_token
  }

  /** 拉取最新的当前用户信息 */
  async function fetchCurrentUser(): Promise<User> {
    const u = await userApiGet()
    user.value = u
    storage.set(STORAGE_KEYS.user, JSON.stringify(u))
    return u
  }

  /**
   * 局部合并当前用户字段并落库。
   *
   * 用途：接口只返回变化的字段时（如 POST /users/me/avatar 只回 `{avatar}`），
   * 直接在组件里 `user.value = {...user.value, avatar}` 会绕过持久化，
   * 刷新页面就丢。统一走这里，保证 store 与 localStorage 一致。
   */
  function patchUser(patch: Partial<User>): void {
    if (!user.value) return
    user.value = { ...user.value, ...patch }
    storage.set(STORAGE_KEYS.user, JSON.stringify(user.value))
  }

  /**
   * 拉取我的有效权限点（GET /auth/me/permissions）。
   * admin 由后端直接返回全量，前端 isAdmin 也做了旁路，双保险。
   */
  async function fetchPermissions(): Promise<string[]> {
    const res = await permissionApiMyPermissions()
    permissions.value = res.permissions ?? []
    storage.set(STORAGE_KEYS.permissions, JSON.stringify(permissions.value))
    // 后端顺带返回 role，可校正本地缓存的 user.role（如管理员改了自己的角色）
    if (user.value && res.role && user.value.role !== res.role) {
      user.value = { ...user.value, role: res.role }
      storage.set(STORAGE_KEYS.user, JSON.stringify(user.value))
    }
    return permissions.value
  }

  /** 退出登录 */
  async function logout(): Promise<void> {
    try {
      // 带上 refresh_token 让后端一并撤销，否则该 token 在有效期内仍可用
      await authApi.logout({ refresh_token: refreshToken.value || undefined })
    } catch {
      // 忽略错误，继续清本地状态
    }
    clearAuth()
  }

  /** 仅清本地状态（不发请求） */
  function clearAuth(): void {
    accessToken.value = ''
    refreshToken.value = ''
    user.value = null
    permissions.value = []
    storage.remove(STORAGE_KEYS.accessToken)
    storage.remove(STORAGE_KEYS.refreshToken)
    storage.remove(STORAGE_KEYS.user)
    storage.remove(STORAGE_KEYS.permissions)
    // 注意：remember + rememberedUsername 保留（用户偏好），仅清密码
    storage.remove(STORAGE_KEYS.rememberedPassword)
  }

  /**
   * 应用启动时恢复登录态
   * - 有 token 但没 user 时尝试拉一次 /auth/me
   * - 失败（401）则尝试 refresh 后再拉一次，仍失败才清 token
   * - 权限点为空时补拉（老版本缓存里没有这个 key）
   */
  async function hydrate(): Promise<void> {
    if (!accessToken.value) return
    if (!user.value) {
      try {
        await fetchCurrentUser()
      } catch {
        try {
          await refreshAccessToken()
          await fetchCurrentUser()
        } catch {
          clearAuth()
          return
        }
      }
    }
    if (permissions.value.length === 0) {
      await fetchPermissions().catch(() => undefined)
    }
  }

  /** 获取上次记住的账号（用于登录页回显） */
  function getRememberedAccount(): { username: string; password: string } {
    return {
      username: storage.get(STORAGE_KEYS.rememberedUsername) || '',
      password: storage.get(STORAGE_KEYS.rememberedPassword) || '',
    }
  }

  return {
    // state
    accessToken,
    refreshToken,
    user,
    permissions,
    remember,
    // getters
    isLoggedIn,
    isAdmin,
    roleCode,
    permissionList,
    canAccessSystem,
    canAccessAdmin,
    hasPermission,
    // actions
    login,
    register,
    refreshAccessToken,
    fetchCurrentUser,
    patchUser,
    fetchPermissions,
    logout,
    clearAuth,
    hydrate,
    getRememberedAccount,
  }
})

/** 延迟 import 避免循环依赖 */
async function userApiGet() {
  const mod = await import('@/api/user')
  return mod.userApi.getCurrentUser()
}

/** 延迟 import 避免循环依赖（permission api → request → user store） */
async function permissionApiMyPermissions() {
  const mod = await import('@/api/permission')
  return mod.permissionApi.myPermissions()
}
