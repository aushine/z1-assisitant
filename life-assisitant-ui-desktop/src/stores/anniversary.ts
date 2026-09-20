/**
 * Anniversary Store（纪念日 / 倒数日，桌面端 zustand）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/stores/anniversary.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/anniversary.go
 *
 * ⚠️ `next_date` / `days_left` 是后端**实时推导**字段（不落库）：
 *    跨月、2 月 29 日、31 日边界全部由后端 utility/anniversary_next.go 处理。
 *    所以任何写操作成功后都要**重拉列表**，前端不要自己做「乐观更新」。
 */
import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { anniversaryApi } from '@/api/anniversary'
import type {
  AnniversaryBrief,
  AnniversaryItem,
  CreateAnniversaryReq,
  PatchAnniversaryReq,
} from '@/api/types'

export type AnniversaryScope = 'upcoming' | 'month' | 'all'

interface AnniversaryState {
  /** 管理页列表（按后端排序：置顶 → days_left 升序） */
  items: AnniversaryItem[]
  /** 首页卡片用的精简版 */
  upcoming: AnniversaryBrief[]
  loading: boolean
  saving: boolean
  /** 当前列表口径，写操作后按同一口径重拉 */
  scope: AnniversaryScope

  fetchList: (scope?: AnniversaryScope) => Promise<void>
  fetchUpcoming: (limit?: number) => Promise<void>
  create: (data: CreateAnniversaryReq) => Promise<boolean>
  patch: (id: string, data: Omit<PatchAnniversaryReq, 'id'>) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  resetLocal: () => void
}

export const useAnniversaryStore = create<AnniversaryState>((set, get) => ({
  items: [],
  upcoming: [],
  loading: false,
  saving: false,
  scope: 'all',

  async fetchList(scope = 'all') {
    set({ loading: true, scope })
    try {
      const res = await anniversaryApi.list({ scope })
      set({ items: res?.items ?? [] })
    } catch {
      set({ items: [] })
    } finally {
      set({ loading: false })
    }
  },

  async fetchUpcoming(limit = 3) {
    try {
      const res = await anniversaryApi.upcoming(limit)
      set({ upcoming: res?.items ?? [] })
    } catch {
      set({ upcoming: [] })
    }
  },

  async create(data) {
    if (get().saving) return false
    set({ saving: true })
    try {
      await anniversaryApi.create(data)
      await Promise.all([get().fetchList(get().scope), get().fetchUpcoming()])
      return true
    } catch {
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async patch(id, data) {
    if (get().saving) return false
    set({ saving: true })
    try {
      await anniversaryApi.patch(id, data)
      await Promise.all([get().fetchList(get().scope), get().fetchUpcoming()])
      return true
    } catch {
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async remove(id) {
    if (get().saving) return false
    set({ saving: true })
    try {
      await anniversaryApi.remove(id)
      await Promise.all([get().fetchList(get().scope), get().fetchUpcoming()])
      return true
    } catch {
      Toast.error('删除失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  resetLocal() {
    set({ items: [], upcoming: [], loading: false, saving: false, scope: 'all' })
  },
}))
