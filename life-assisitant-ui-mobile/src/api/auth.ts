/**
 * 认证相关 API
 * 路径前缀：/auth
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/router.go（认证段）
 *                    life-assisitant-api/internal/model/dto/auth.go
 * 最后同步：2026-09-18
 *
 * 后端端点：
 *   POST /auth/login            公开
 *   POST /auth/register         公开
 *   POST /auth/refresh          公开
 *   POST /auth/forgot-password  公开
 *   POST /auth/reset-password   公开
 *   GET  /auth/me               已登录
 *   POST /auth/logout           已登录
 *   POST /auth/change-password  权限点 me:password
 */
import { http } from './request'
import type {
  ChangePasswordReq,
  ForgotPasswordReq,
  LoginReq,
  LoginResp,
  LogoutReq,
  RefreshReq,
  RefreshResp,
  RegisterReq,
  RegisterResp,
  ResetPasswordReq,
  User,
} from './types'

export const authApi = {
  /** 登录（device_id 必填，用于 7 天免登录与设备指纹） */
  login(data: LoginReq): Promise<LoginResp> {
    return http.post<LoginResp>('/auth/login', data)
  },

  /** 注册（后端恒落内置 user 角色，不可自选） */
  register(data: RegisterReq): Promise<RegisterResp> {
    return http.post<RegisterResp>('/auth/register', data)
  },

  /**
   * 退出登录
   * 带上 refresh_token 可让后端同时撤销它；all_devices 退出全部设备。
   */
  logout(data: LogoutReq = {}): Promise<{ message: string }> {
    return http.post<{ message: string }>('/auth/logout', data)
  },

  /**
   * 刷新 access_token（rotation：同时返回新 refresh_token）
   * ⚠️ device_id 是后端必填字段，必须透传。
   */
  refresh(data: RefreshReq): Promise<RefreshResp> {
    return http.post<RefreshResp>('/auth/refresh', data)
  },

  /**
   * 当前登录用户
   * ⚠️ 路径是 /auth/me 而**不是** /users/me —— 后者会被后端
   *    GET /users/:id 匹配成 id="me"，直接 404。
   */
  me(): Promise<User> {
    return http.get<User>('/auth/me')
  },

  /** 修改密码（新密码至少 8 位；成功后应强制登出重新登录） */
  changePassword(data: ChangePasswordReq): Promise<{ message: string }> {
    return http.post<{ message: string }>('/auth/change-password', data)
  },

  /** 忘记密码（无论邮箱是否存在都返回同样的提示，防枚举） */
  forgotPassword(data: ForgotPasswordReq): Promise<{ message: string }> {
    return http.post<{ message: string }>('/auth/forgot-password', data)
  },

  /** 重置密码（凭邮件里的 token） */
  resetPassword(data: ResetPasswordReq): Promise<{ message: string }> {
    return http.post<{ message: string }>('/auth/reset-password', data)
  },
}
