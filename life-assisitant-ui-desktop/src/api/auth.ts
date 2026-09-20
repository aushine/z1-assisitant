import request from './request'
import type {
  LoginReq,
  LoginResp,
  RefreshReq,
  RefreshResp,
  RegisterReq,
  ForgotPasswordReq,
  LogoutReq,
  SessionListResp,
} from './types'

/** 鉴权相关 API */
export const authApi = {
  /** 登录 */
  login(data: LoginReq) {
    return request.post<unknown, LoginResp>('/auth/login', data)
  },

  /** 注册 */
  register(data: RegisterReq) {
    return request.post<unknown, LoginResp>('/auth/register', data)
  },

  /** 刷新 access_token */
  refresh(data: RefreshReq) {
    return request.post<unknown, RefreshResp>('/auth/refresh', data)
  },

  /**
   * 退出登录。
   *
   * 必须带 body：后端 AuthService.Logout 只有在 `refresh_token` 非空
   * 或 `all_devices=true` 时才真正撤销会话，两者都缺就 `return nil` ——
   * 前端看似退出了（本地清了 localStorage），但服务端那条 refresh_token
   * 仍然有效到自然过期，共用电脑 / 令牌泄漏场景等于没登出。
   */
  logout(data?: LogoutReq) {
    return request.post('/auth/logout', data ?? {})
  },

  /** 修改密码 */
  changePassword(data: { old_password: string; new_password: string }) {
    return request.post('/auth/change-password', data)
  },

  /**
   * 我的活跃登录会话（登录设备列表）。
   * 后端挂在会话生命周期组、不挂权限点 —— 任何登录用户都该能管自己的设备。
   */
  listSessions() {
    return request.get<unknown, SessionListResp>('/auth/sessions')
  },

  /**
   * 退出指定的某一台设备（撤销该条 refresh_token）。
   * 归属校验在后端 SQL 的 WHERE 里做，前端传来的 id 不可信也不怕。
   */
  revokeSession(id: string) {
    return request.delete(`/auth/sessions/${id}`)
  },

  /** 忘记密码（v1.1 预留） */
  forgotPassword(data: ForgotPasswordReq) {
    return request.post('/auth/forgot-password', data)
  },
}
