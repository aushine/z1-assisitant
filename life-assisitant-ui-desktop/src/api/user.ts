import request from './request'
import { storage } from '@/utils/storage'
import type {
  User,
  ListUsersQuery,
  CreateUserReq,
  UpdateUserReq,
  UpdateMeReq,
  DisableUserReq,
  PageResult,
} from './types'

// 与 stores/user.ts 保持一致：当前登录用户缓存在 localStorage 'user' 键
const USER_KEY = 'user'

/** 用户管理 API（admin） */
export const userApi = {
  /** 获取当前登录用户 (后端路由: GET /auth/me) */
  getCurrentUser() {
    return request.get<unknown, User>('/auth/me')
  },

  /**
   * 修改个人资料（PATCH /users/me，认证组内、无需 admin）
   *
   * 此前调用不存在的 PATCH /users/me（404）；中途曾被改成调用 admin 端点
   * PATCH /users/:id，那是坏的 —— 该端点挂 RequireAdmin，editor/viewer 恒 403，
   * 且其 UpdateUserReq.Version 为必填而登录响应里根本没有 version。
   * 后端现已补齐真正的自更新端点：仅允许改 name/email/phone/avatar。
   *
   * version 可选：带则做乐观锁 CAS，不带则后端用当前版本作基准。
   * 这里仅在本地缓存确实有 version 时才发送，避免把 undefined 变成一个假的 0。
   */
  updateProfile(data: Omit<UpdateMeReq, 'version'>) {
    const me = storage.get<User>(USER_KEY)
    if (!me?.id) {
      return Promise.reject(new Error('未登录，无法更新个人资料'))
    }
    return request.patch<unknown, User>('/users/me', {
      ...data,
      ...(typeof me.version === 'number' ? { version: me.version } : {}),
    })
  },

  /**
   * 上传头像（D-03 第八轮：POST /users/me/avatar，multipart field=file）
   * 后端落盘到 storage.upload_dir 并回 { avatar: "/uploads/avatars/<name>" }；
   * 呈现端用 utils/avatar.ts#resolveFileUrl 换算完整 URL。
   *
   * ⚠️ 必须显式把 Content-Type 覆盖成 multipart/form-data（原来的注释「不手动设，
   * axios 会交给浏览器自动带 boundary」是错的，正是它造成了「请选择图片文件」报错）：
   * request.ts 实例默认头是 application/json，而 axios v1 的 transformRequest 对
   * 「Content-Type 含 application/json 的 FormData」会走
   * `JSON.stringify(formDataToJSON(data))`（lib/defaults/index.js:56）——文件被整个
   * 丢成 `{"file":{}}` 这样的 JSON 串发出去，后端 r.GetUploadFile("file") 拿到 nil。
   * 改成 multipart 后 hasJSONContentType=false，transformRequest 原样透传 FormData，
   * 浏览器随后自动补上带 boundary 的正确头。
   */
  uploadAvatar(file: File) {
    const form = new FormData()
    form.append('file', file)
    return request.post<unknown, { avatar: string }>('/users/me/avatar', form, {
      timeout: 60000,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  /** 列表（admin） */
  list(params?: ListUsersQuery) {
    return request.get<unknown, PageResult<User>>('/users', { params })
  },

  /** 创建用户（admin） */
  create(data: CreateUserReq) {
    return request.post<unknown, User>('/users', data)
  },

  /** 更新指定用户（admin） */
  update(id: string, data: UpdateUserReq) {
    return request.patch<unknown, User>(`/users/${id}`, data)
  },

  /** 启用/禁用用户（admin） */
  setStatus(id: string, data: DisableUserReq) {
    return request.patch(`/users/${id}/status`, data)
  },

  /** 软删除用户（admin） */
  remove(id: string) {
    return request.delete(`/users/${id}`)
  },
}
