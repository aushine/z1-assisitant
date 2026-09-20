import { create } from 'zustand'
import { authApi } from '@/api/auth'
import { userApi } from '@/api/user'
import { permissionApi } from '@/api/permission'
import { storage } from '@/utils/storage'
import { matchPermission } from '@/utils/permissions'
import type { User, LoginReq } from '@/api/types'

const TOKEN_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'
const USER_KEY = 'user'
const DEVICE_KEY = 'device_id'
const PERMS_KEY = 'user_permissions' // D-03：当前用户权限点缓存（"module:action"）

function getDeviceId(): string {
  let id = storage.getString(DEVICE_KEY)
  if (!id) {
    id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    storage.setString(DEVICE_KEY, id)
  }
  return id
}

interface UserStore {
  // state
  accessToken: string
  refreshToken: string
  user: User | null
  /** D-03：当前用户有效权限点（"module:action"）；admin 由代码直通不必在此体现 */
  permissions: string[]
  // actions
  login: (payload: LoginReq) => Promise<void>
  refreshAccessToken: () => Promise<boolean>
  fetchCurrentUser: () => Promise<void>
  /** 拉取我的权限点（登录成功 / 应用恢复 / 角色变更后调用） */
  fetchPermissions: () => Promise<void>
  /** 退出当前设备：撤销本条 refresh_token 后清空本地 */
  logout: () => Promise<void>
  /** 退出所有设备：撤销该用户全部 refresh_token（后端能力，此前前端零调用） */
  logoutAllDevices: () => Promise<void>
  resetLocal: () => void
}

export const useUserStore = create<UserStore>((set) => ({
  accessToken: storage.getString(TOKEN_KEY) || '',
  refreshToken: storage.getString(REFRESH_KEY) || '',
  user: storage.get<User>(USER_KEY),
  permissions: storage.get<string[]>(PERMS_KEY) ?? [],

  async login(payload) {
    const data = await authApi.login({
      ...payload,
      device_id: payload.device_id || getDeviceId(),
    })
    set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
    })
    storage.setString(TOKEN_KEY, data.access_token)
    if (payload.remember) {
      storage.setString(REFRESH_KEY, data.refresh_token)
    } else {
      storage.remove(REFRESH_KEY)
    }
    storage.set(USER_KEY, data.user)
    // D-03：登录成功后立刻拉权限点（await 保证进入主界面时菜单已就绪；
    // fetchPermissions 内部静默容错，不会因权限接口抖动卡住登录）
    await useUserStore.getState().fetchPermissions()
  },

  async refreshAccessToken() {
    const rt = useUserStore.getState().refreshToken
    if (!rt) return false
    try {
      const res = await authApi.refresh({ refresh_token: rt, device_id: getDeviceId() })
      set({ accessToken: res.access_token })
      storage.setString(TOKEN_KEY, res.access_token)
      return true
    } catch {
      return false
    }
  },

  async fetchCurrentUser() {
    try {
      const fresh = await userApi.getCurrentUser()
      set({ user: fresh })
      storage.set(USER_KEY, fresh)
    } catch {
      // 静默失败
    }
    // 用户信息刷新时同步刷新权限点（角色可能已被管理员变更）
    await useUserStore.getState().fetchPermissions()
  },

  async fetchPermissions() {
    try {
      const res = await permissionApi.myPermissions()
      set({ permissions: res.permissions ?? [] })
      storage.set(PERMS_KEY, res.permissions ?? [])
    } catch {
      // 静默失败：保留上次缓存，UI 退化为按 role 判定
    }
  },

  async logout() {
    // refreshToken 在 state 里常驻（login 时无论 remember 与否都会写进 state，
    // remember 只决定要不要落 localStorage），所以这里一般能拿到。
    // 之前调 authApi.logout() 不带 body → 后端收到空 req 直接 return nil，
    // 服务端那条 refresh_token 还能用满 7 天，「退出登录」形同虚设。
    const rt = useUserStore.getState().refreshToken
    try {
      await authApi.logout(rt ? { refresh_token: rt } : {})
    } catch {
      // ignore：网络失败也必须把本地清干净，不能因此退不出去
    }
    useUserStore.getState().resetLocal()
  },

  async logoutAllDevices() {
    try {
      await authApi.logout({ all_devices: true })
    } catch {
      // ignore（同上）
    }
    useUserStore.getState().resetLocal()
  },

  resetLocal() {
    set({ accessToken: '', refreshToken: '', user: null, permissions: [] })
    storage.clear([TOKEN_KEY, REFRESH_KEY, USER_KEY, PERMS_KEY])
  },
}))

// ---- Selectors (useMemo-friendly) ----

export function useIsLoggedIn() {
  return useUserStore((s) => !!s.accessToken && !!s.user)
}

export function useIsAdmin() {
  return useUserStore((s) => s.user?.role === 'admin')
}

export function useUserRole() {
  return useUserStore((s) => s.user?.role ?? null)
}

/** 当前用户权限点列表（admin 也返回其真实矩阵，判权请用 useHasPermission） */
export function usePermissions() {
  return useUserStore((s) => s.permissions)
}

/**
 * 权限点判定 hook（D-03）：admin 直通 + 任一命中。
 * 用法：const canViewUsers = useHasPermission('user_mgmt:view')
 *      const canBatch = useHasPermission(['task:complete', 'task:delete'])
 */
export function useHasPermission(codes: string | string[]): boolean {
  return useUserStore((s) => matchPermission(s.user?.role, s.permissions, codes))
}

export function useDisplayName() {
  return useUserStore((s) => s.user?.name || s.user?.username || '未登录')
}

export function useInitials() {
  return useUserStore((s) => {
    const n = s.user?.name || s.user?.username || ''
    return n ? n.slice(0, 1).toUpperCase() : '?'
  })
}

export function useAccessToken() {
  return useUserStore((s) => s.accessToken)
}

export function useUser() {
  return useUserStore((s) => s.user)
}
