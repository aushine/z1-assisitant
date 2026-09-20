import { create } from 'zustand'
import { notificationApi } from '@/api/notification'
import type { Notification } from '@/api/types'

/**
 * 通知 Store
 * 后端已落库（internal/controller/notification.go）：
 * - GET /notifications?page=&page_size= → PageResult<Notification>（created_at 倒序，含 has_more）
 * - GET /notifications/unread-count → { count }
 * - POST /notifications/mark-read → { affected }（全部已读）
 * - POST /notifications/:id/read → { affected: 1 }（单条已读）
 */
interface NotificationState {
  unread: number
  items: Notification[]
  total: number
  hasMore: boolean
  loading: boolean

  /** 拉取未读数（MainLayout 轮询用） */
  fetch: () => Promise<void>
  /** 拉取通知列表（第 1 页起） */
  fetchList: (page?: number, pageSize?: number) => Promise<void>
  /** 追加下一页（load more） */
  loadMore: () => Promise<void>
  /** 全部已读 */
  markAllRead: () => Promise<void>
  /** 单条已读（乐观更新 items + unread） */
  markRead: (id: string) => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: 0,
  items: [],
  total: 0,
  hasMore: false,
  loading: false,

  async fetch() {
    try {
      const res = await notificationApi.unreadCount()
      set({ unread: res.count })
    } catch {
      // 静默失败 — 通知是辅助功能
    }
  },

  async fetchList(page = 1, pageSize = 20) {
    set({ loading: true })
    try {
      const res = await notificationApi.list({ page, page_size: pageSize })
      set({
        items: res.items || [],
        total: res.total,
        hasMore: res.has_more,
      })
    } catch {
      set({ items: [], total: 0, hasMore: false })
    } finally {
      set({ loading: false })
    }
  },

  async loadMore() {
    const { items, loading, hasMore } = get()
    if (loading || !hasMore) return
    const nextPage = Math.floor(items.length / 20) + 1
    set({ loading: true })
    try {
      const res = await notificationApi.list({ page: nextPage, page_size: 20 })
      set({
        items: [...items, ...(res.items || [])],
        total: res.total,
        hasMore: res.has_more,
      })
    } catch {
      // 静默
    } finally {
      set({ loading: false })
    }
  },

  async markAllRead() {
    try {
      await notificationApi.markRead()
      set({ unread: 0, items: get().items.map((n) => ({ ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() })) })
    } catch {
      // 静默
    }
  },

  async markRead(id) {
    const { items, unread } = get()
    const target = items.find((n) => n.id === id)
    if (!target || target.is_read) return
    // 乐观更新
    set({
      items: items.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)),
      unread: Math.max(0, unread - 1),
    })
    try {
      await notificationApi.markReadById(id)
    } catch {
      // 回滚
      set({ items: get().items.map((n) => (n.id === id ? { ...n, is_read: false, read_at: undefined } : n)), unread: unread })
    }
  },
}))
