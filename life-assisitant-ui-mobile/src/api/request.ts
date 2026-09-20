/**
 * Axios 实例 + 拦截器（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/api/request.ts
 * 最后同步：2026-09-18
 *
 * 移动端相对桌面端的**增量优势**（保留，勿退化）：
 *   - token 静默刷新 + 并发队列合并（桌面端只有脚手架，未实现）
 *   - 401006 等不可恢复的 refresh 失败直接登出，不做无谓重试
 *
 * 本次修正的缺陷：
 *   - **HTTP 204 未处理**：后端删除类接口用 response.NoContent() 返回 204，
 *     响应体为空字符串。旧实现里 `res?.code` 为 undefined → 落到
 *     INTERNAL_ERROR 分支 → 每次删除都弹「服务器内部错误」并在业务层
 *     reject，实际后端已删成功。这是一颗静默地雷，现已修复。
 *   - 鉴权失败码集合从「只有 401004/401005」扩到后端认证段全集，
 *     并把码表抽到 `constants/auth-codes.ts`（唯一真相）。
 *   - `X-Request-Id` 缺失：后端 RequestId 中间件优先取该头并用它做全链路
 *     日志关联，移动端没发就每请求都由后端另生成，排障时对不上号。
 *   - `withCredentials` 由 true 改 false：后端从不 SetCookie（已 grep 确认），
 *     refresh_token 走响应体。带 credentials 反而会在跨域部署时被
 *     CORS 拦掉（GoFrame CORSDefault 未开 Allow-Credentials）。
 */
import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { showToast, showFailToast, showSuccessToast } from 'vant'
import router from '@/router'
import { useUserStore } from '@/stores/user'
import { AUTH_FAILURE_CODES, ErrorCode, REFRESHABLE_CODES } from '@/constants/auth-codes'
import { getDeviceId } from '@/utils/device'
import type { ApiResponse } from './types'

/** 业务错误类（统一 reject 用） */
export class ApiError extends Error {
  public readonly code: number
  public readonly errorCode: string
  public readonly details?: Record<string, unknown>
  public readonly httpStatus?: number

  constructor(opts: {
    code: number
    errorCode: string
    message: string
    details?: Record<string, unknown>
    httpStatus?: number
  }) {
    super(opts.message)
    this.name = 'ApiError'
    this.code = opts.code
    this.errorCode = opts.errorCode
    this.details = opts.details
    this.httpStatus = opts.httpStatus
  }

  /** 从后端 details.cause 取底层原因（DB / 校验），用于排障外显 */
  get cause(): string | undefined {
    const c = this.details?.cause
    return typeof c === 'string' ? c : undefined
  }
}

/** 创建 axios 实例 */
const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/z1/api/v1',
  timeout: 15000,
  withCredentials: false,
  headers: {
    'Content-Type': 'application/json',
  },
})

/** 标记是否正在刷新 token，避免并发请求触发多次刷新 */
let isRefreshing = false
/** 等待 token 刷新的请求队列 */
let pendingRequests: Array<(token: string) => void> = []
/** 防止并发爆发时重复弹「登录已过期」 */
let isRedirectingToLogin = false

/**
 * 设备 ID 的实现已收口到 `@/utils/device`（此前本文件与 stores/user.ts
 * 各存一份，存在存储键/格式分叉的风险）。这里再导出，保持既有调用点不变。
 */
export { getDeviceId }

/** 统一跳登录（去重，避免多请求各弹一次） */
function redirectToLogin(message = '登录已过期，请重新登录'): void {
  const userStore = useUserStore()
  userStore.clearAuth()
  if (isRedirectingToLogin) return
  isRedirectingToLogin = true
  showFailToast(message)
  const current = router.currentRoute.value
  router
    .replace({
      name: 'Login',
      query: current.name === 'Login' ? {} : { redirect: current.fullPath },
    })
    .finally(() => {
      // 留一点时间窗，避免同一批并发请求各自弹窗
      window.setTimeout(() => {
        isRedirectingToLogin = false
      }, 800)
    })
}

// ==================== 请求拦截器 ====================
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const userStore = useUserStore()
    // 1. JWT 注入
    if (userStore.accessToken) {
      config.headers.set('Authorization', `Bearer ${userStore.accessToken}`)
    }
    // 2. 公共头（后端 CORS 白名单：Content-Type / Authorization /
    //    X-Device-Id / X-Request-Id / X-Client-Version / X-Client-Platform）
    config.headers.set('X-Client-Platform', 'mobile')
    config.headers.set('X-Client-Version', '0.1.0')
    config.headers.set('X-Device-Id', getDeviceId())
    // 3. 请求 ID：后端 RequestId 中间件优先复用该值做全链路日志关联
    config.headers.set('X-Request-Id', `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    return config
  },
  (error) => Promise.reject(error)
)

// ==================== 响应拦截器 ====================
request.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    // Blob 响应（CSV 导出等文件下载）直接透传
    if (response.config.responseType === 'blob') {
      return response.data as unknown as AxiosResponse
    }

    // ⚠️ HTTP 204 No Content（后端 response.NoContent()，用于删除类接口）
    // 响应体为空字符串，没有任何 code 可读 —— 必须先行判定为成功，
    // 否则会被后面的 `code ?? INTERNAL_ERROR` 兜成假错误。
    if (response.status === 204) {
      return null as unknown as AxiosResponse
    }

    const raw = response.data as ApiResponse | string | null
    if (raw === null || raw === undefined || raw === '') {
      return null as unknown as AxiosResponse
    }
    const res = raw as ApiResponse
    const code = res.code ?? ErrorCode.INTERNAL_ERROR

    // 成功
    if (code === ErrorCode.SUCCESS) {
      return res.data as unknown as AxiosResponse
    }

    // 可刷新的鉴权失败 → 静默刷新后重试原请求
    if (REFRESHABLE_CODES.has(code)) {
      return handleTokenExpired(response.config)
    }

    // 不可恢复的鉴权失败（refresh 撤销 / 账号删除 / 设备不匹配）→ 直接登出
    if (AUTH_FAILURE_CODES.has(code)) {
      redirectToLogin(res.message || '登录已失效，请重新登录')
      return Promise.reject(
        new ApiError({
          code,
          errorCode: res.error || 'AUTH_ERROR',
          message: res.message || '登录已失效',
          details: res.details,
          httpStatus: response.status,
        })
      )
    }

    // 权限不足：单独文案，便于用户理解是「没权限」而非「操作失败」
    if (
      code === ErrorCode.PERMISSION_DENIED ||
      code === ErrorCode.ROLE_INSUFFICIENT ||
      code === ErrorCode.ADMIN_REQUIRED ||
      code === ErrorCode.USER_HAS_NO_PERMISSION
    ) {
      showFailToast(res.message || '无访问权限')
      return Promise.reject(
        new ApiError({
          code,
          errorCode: res.error || 'PERMISSION_DENIED',
          message: res.message || '无访问权限',
          details: res.details,
          httpStatus: response.status,
        })
      )
    }

    // 业务错误：toast + reject
    // 后端在 details.cause 附带真实底层错误（DB / 校验），一并外显便于排障
    const cause = (res.details as { cause?: string } | undefined)?.cause
    const shown = [res.message || '操作失败', cause].filter(Boolean).join('：')
    showFailToast(shown)
    return Promise.reject(
      new ApiError({
        code,
        errorCode: res.error || 'BUSINESS_ERROR',
        message: shown,
        details: res.details,
        httpStatus: response.status,
      })
    )
  },
  (error: AxiosError<ApiResponse>) => {
    // HTTP 层错误
    if (error.code === 'ECONNABORTED') {
      showFailToast('请求超时，请稍后重试')
    } else if (error.message === 'Network Error') {
      showFailToast('网络异常，请检查网络')
    } else if (error.response?.status === 401) {
      redirectToLogin()
    } else if (error.response?.status === 403) {
      showFailToast('无访问权限')
    } else if (error.response?.status === 429) {
      showFailToast('操作太频繁，请稍后重试')
    } else if (error.response?.status && error.response.status >= 500) {
      showFailToast('服务异常，请稍后重试')
    } else {
      showFailToast(error.response?.data?.message || '服务异常')
    }
    return Promise.reject(
      new ApiError({
        code: error.response?.data?.code ?? ErrorCode.INTERNAL_ERROR,
        errorCode: error.response?.data?.error || 'HTTP_ERROR',
        message: error.response?.data?.message || error.message || '服务异常',
        details: error.response?.data?.details,
        httpStatus: error.response?.status,
      })
    )
  }
)

/**
 * 处理 access_token 过期：调用 /auth/refresh 重试原请求。
 * 多个并发请求会合并为一次刷新（isRefreshing + pendingRequests 队列）。
 *
 * 返回类型是 `Promise<any>` 而非 `Promise<unknown>`：本文件的响应拦截器采用
 * 「就地脱壳」写法（成功时直接 `return res.data`），因此拦截器的实际返回值
 * 已不是 AxiosResponse。`unknown` 无法满足 AxiosInterceptorFulfilled 的签名
 * （会报 TS2345），这里按事实标 `any`，调用方的类型安全由 `http` 包装层的
 * 泛型保证（见文件末尾）。
 */
async function handleTokenExpired(originalConfig: AxiosRequestConfig | undefined): Promise<any> {
  if (!originalConfig) {
    return Promise.reject(new Error('No config to retry'))
  }

  const userStore = useUserStore()

  // 如果正在刷新，加入队列等待
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      pendingRequests.push((newToken: string) => {
        if (originalConfig.headers) {
          const headers = originalConfig.headers as Record<string, string>
          headers.Authorization = `Bearer ${newToken}`
        }
        resolve(request(originalConfig))
      })
      // 刷新失败时队列会被清空，这里的 Promise 会永久 pending，
      // 用超时兜底避免内存泄漏 + 业务层永远等不到结果。
      window.setTimeout(() => reject(new Error('Token refresh timeout')), 15000)
    })
  }

  isRefreshing = true
  try {
    const newToken = await userStore.refreshAccessToken()
    // 通知队列里的请求用新 token 重试
    const queue = pendingRequests
    pendingRequests = []
    queue.forEach((cb) => cb(newToken))
    // 重试当前请求
    if (originalConfig.headers) {
      const headers = originalConfig.headers as Record<string, string>
      headers.Authorization = `Bearer ${newToken}`
    }
    return request(originalConfig)
  } catch (e) {
    // 刷新失败 → 跳登录
    pendingRequests = []
    redirectToLogin()
    return Promise.reject(e)
  } finally {
    isRefreshing = false
  }
}

/** 通用业务方法：暴露给业务层用 */
export const http = {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return request.get(url, config) as unknown as Promise<T>
  },
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return request.post(url, data, config) as unknown as Promise<T>
  },
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return request.patch(url, data, config) as unknown as Promise<T>
  },
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return request.put(url, data, config) as unknown as Promise<T>
  },
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return request.delete(url, config) as unknown as Promise<T>
  },
  /** 全局成功提示（业务层也可单独用 Vant 的 showSuccessToast） */
  successToast: (msg: string) => showSuccessToast(msg),
  /** 全局失败提示 */
  failToast: (msg: string) => showFailToast(msg),
  /** 全局普通提示 */
  toast: (msg: string) => showToast(msg),
}

export default request
