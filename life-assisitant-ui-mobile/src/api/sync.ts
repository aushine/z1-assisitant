/**
 * 同步 API
 * 路径前缀：/sync
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/sync_feedback.go
 * 最后同步：2026-09-18
 *
 * 权限点：POST /sync 需 home:sync；GET /sync/status 属会话诊断，对已登录用户开放。
 */
import { http } from './request'
import type { SyncStatusResp, SyncTriggerResp } from './types'

export const syncApi = {
  /** 同步状态（GET /sync/status） */
  status(): Promise<SyncStatusResp> {
    return http.get<SyncStatusResp>('/sync/status')
  },

  /** 触发一次同步（POST /sync，home:sync） */
  trigger(): Promise<SyncTriggerResp> {
    return http.post<SyncTriggerResp>('/sync')
  },
}
