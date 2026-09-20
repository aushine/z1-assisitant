// ============================================================================
// Axios 实例 + 拦截器
// 规范见：md/spec/04-API规范.md / 06-错误码.md
// ============================================================================
import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { Toast } from '@douyinfe/semi-ui'
import type { ApiErr } from './types'

// ---------------------------------------------------------------------------
// 全局状态：防止 token 过期时重复处理
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 全局状态：防止 token 过期时重复处理
// These are scaffolding for a future token-refresh queue; suppress TS6133.
// ---------------------------------------------------------------------------
// @ts-ignore TS6133
let _isRefreshing = false
let isRedirecting = false
// @ts-ignore TS6133
let refreshSubscribers: Array<(token: string) => void> = []

// 通知所有等待的请求
// @ts-ignore TS6133
function _onTokenRefreshed(newToken: string) {
  refreshSubscribers.forEach((callback) => callback(newToken))
  refreshSubscribers = []
}

// 添加等待 token 刷新的请求
// @ts-ignore TS6133
function _addRefreshSubscriber(callback: (token: string) => void) {
  refreshSubscribers.push(callback)
}

// 防止重复弹窗的标记
let hasShownAuthError = false

// ---------------------------------------------------------------------------
// ApiError —— 业务错误封装，前端可用 instanceof 判断 + 取出错误码
// ---------------------------------------------------------------------------
export class ApiError extends Error {
  public readonly code: number
  public readonly errorCode: string
  public readonly details?: Record<string, unknown>

  constructor(code: number, errorCode: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.errorCode = errorCode
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// localStorage key 常量（与 stores/user.ts 保持一致）
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'

// 用于在拦截器中惰性获取 Pinia store，避免循环依赖
let _getUserStore: (() => any) | null = null
let _routerPush: ((path: string) => void) | null = null

/** 由 main.ts 注入依赖，避免拦截器顶层 import 引发循环 */
export function bindRequestHelpers(deps: {
  getUserStore: () => any
  routerPush: (path: string) => void
}) {
  _getUserStore = deps.getUserStore
  _routerPush = deps.routerPush
}

// ---------------------------------------------------------------------------
// 设备指纹（持久化到 localStorage）
// ---------------------------------------------------------------------------
function getDeviceId(): string {
  const KEY = 'device_id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(KEY, id)
  }
  return id
}

// ---------------------------------------------------------------------------
// Axios 实例
// ---------------------------------------------------------------------------
const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/z1/api/v1',
  timeout: 15000,
  withCredentials: false, // 桌面端 localStorage 存 token，无需 cookie
  headers: {
    'Content-Type': 'application/json',
    'X-Client-Platform': 'web',
    'X-Client-Version': '1.0.0',
  },
})

// ---------------------------------------------------------------------------
// 请求拦截器 —— 自动注入 JWT / Device-Id / Request-Id
// ---------------------------------------------------------------------------
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    if (config.headers) {
      config.headers['X-Device-Id'] = getDeviceId()
      // 简单 request-id 生成
      config.headers['X-Request-Id'] = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ---------------------------------------------------------------------------
// 响应拦截器 —— 业务码处理 + 错误统一 message + 401 自动跳登录
// ---------------------------------------------------------------------------
const AUTH_ERROR_CODES = new Set([401001, 401002, 401003, 401004, 401005, 401006, 401009])

request.interceptors.response.use(
  async (response: AxiosResponse) => {
    const body = response.data

    // HTTP 204 No Content（删除等操作成功，无响应体）— 直接视为成功
    if (response.status === 204 || body === '' || body == null) {
      return null
    }

    // 后端约定成功时 code === 0
    if (body && body.code === 0) {
      return body.data
    }

    // 未登录 / token 失效 → 跳登录页
    if (body && AUTH_ERROR_CODES.has(body.code)) {
      const err = body as ApiErr
      
      // 如果正在处理登录跳转，直接拒绝，不重复弹窗
      if (isRedirecting) {
        return Promise.reject(new ApiError(err.code, err.error, err.message, err.details))
      }
      
      isRedirecting = true
      
      const userStore = _getUserStore?.()
      userStore?.logout?.()
      _routerPush?.('/login')
      
      // 只弹一次窗
      if (!hasShownAuthError) {
        hasShownAuthError = true
        Toast.error(err.message || '登录已过期，请重新登录')
        // 3秒后重置标记，允许下次登录过期时再次提示
        setTimeout(() => { hasShownAuthError = false }, 3000)
      }
      
      // 重置跳转标记
      setTimeout(() => { isRedirecting = false }, 1000)
      
      return Promise.reject(new ApiError(err.code, err.error, err.message, err.details))
    }

    // 业务错误
    // 后端在 details.cause 附带真实底层错误（DB / 校验等），一并外显，便于排障
    const err = (body || {}) as ApiErr
    const cause = (err.details as { cause?: string } | undefined)?.cause
    const shown = [err.message || '操作失败', cause].filter(Boolean).join('：')
    Toast.error(shown)
    return Promise.reject(
      new ApiError(err.code || -1, err.error || 'UNKNOWN', shown, err.details)
    )
  },
  (error: AxiosError<ApiErr>) => {
    if (error.code === 'ECONNABORTED') {
      Toast.error('请求超时，请稍后重试')
    } else if (error.message === 'Network Error') {
      Toast.error('网络异常，请检查网络')
    } else if (error.response?.status === 401) {
      // 如果正在处理登录跳转，直接拒绝，不重复处理
      if (isRedirecting) {
        return Promise.reject(error)
      }
      
      isRedirecting = true
      
      const userStore = _getUserStore?.()
      userStore?.logout?.()
      _routerPush?.('/login')
      
      // 只弹一次窗
      if (!hasShownAuthError) {
        hasShownAuthError = true
        Toast.error('登录已过期，请重新登录')
        setTimeout(() => { hasShownAuthError = false }, 3000)
      }
      
      setTimeout(() => { isRedirecting = false }, 1000)
    } else if (error.response?.status === 403) {
      Toast.error('无访问权限')
    } else if (error.response?.status && error.response.status >= 500) {
      Toast.error('服务异常，请稍后重试')
    } else {
      Toast.error(error.message || '请求失败')
    }
    return Promise.reject(error)
  }
)

export default request

// 暴露常量供其他模块使用
export { TOKEN_KEY, REFRESH_KEY }
