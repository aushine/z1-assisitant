/**
 * Notification Store（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/notification.ts
 * 最后同步：2026-09-18（Phase 5.4）
 *
 * 与桌面端的差异（有意）：
 *   - 桌面端 store 的 fetchList 会**静默吞错**，导致「接口挂了」和「暂无通知」
 *     在 UI 上完全一样，页面不得不另开一个探针请求去判错（见桌面端
 *     notifications.tsx 里那段 notificationApi.list().then/catch）。
 *     移动端把错误**如实暴露**为 error 状态，页面直接用，不再需要探针。
 *   - 分页：移动端是列表页，需要 hasMore / loadMore。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { notificationApi } from '@/api/notification'
import type { Notification } from '@/api/types'

export const useNotificationStore = defineStore('notification', () => {
  // ==================== state ====================
  const unread = ref(0)
  const items = ref<Notification[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  /** null 表示无错误；字符串为可直接展示的提示 */
  const error = ref<string | null>(null)

  const page = ref(1)
  const pageSize = 20
  const hasMore = ref(false)

  // ==================== getters ====================
  const isEmpty = computed(() => items.value.length === 0)
  const finished = computed(() => !hasMore.value)

  // ==================== actions ====================

  /** 拉取未读数（静默失败：通知是辅助功能，不该因为未读数挂掉就报错） */
  async function fetch(): Promise<void> {
    try {
      const res = await notificationApi.unreadCount()
      unread.value = res.count
    } catch {
      /* 静默 */
    }
  }

  /** 拉取第一页通知列表（错误如实暴露） */
  async function fetchList(): Promise<void> {
    loading.value = true
    error.value = null
    page.value = 1
    try {
      const res = await notificationApi.list({ page: 1, page_size: pageSize })
      items.value = res.items
      hasMore.value = res.has_more
    } catch (e) {
      items.value = []
      hasMore.value = false
      error.value = e instanceof Error && e.message ? e.message : '通知加载失败，请重试'
    } finally {
      loading.value = false
    }
  }

  /** 加载下一页（van-list 的 @load 会调用；结束条件由 finished 表达） */
  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const next = page.value + 1
      const res = await notificationApi.list({ page: next, page_size: pageSize })
      items.value = [...items.value, ...res.items]
      page.value = next
      hasMore.value = res.has_more
    } catch {
      // 加载更多失败：停止继续加载，不清空已有数据
      hasMore.value = false
    } finally {
      loadingMore.value = false
    }
  }

  /** 单条标记已读（乐观更新） */
  async function markRead(id: string): Promise<void> {
    const target = items.value.find((n) => n.id === id)
    if (!target || target.is_read) return
    target.is_read = true
    unread.value = Math.max(0, unread.value - 1)
    try {
      await notificationApi.markReadByID(id)
    } catch {
      // 回滚
      target.is_read = false
      unread.value += 1
    }
  }

  /** 全部标记已读（乐观更新） */
  async function markAllRead(): Promise<void> {
    const snapshot = items.value.map((n) => n.is_read)
    const prevUnread = unread.value
    items.value.forEach((n) => (n.is_read = true))
    unread.value = 0
    try {
      await notificationApi.markRead()
    } catch {
      items.value.forEach((n, i) => (n.is_read = snapshot[i]))
      unread.value = prevUnread
    }
  }

  function reset(): void {
    unread.value = 0
    items.value = []
    loading.value = false
    loadingMore.value = false
    error.value = null
    page.value = 1
    hasMore.value = false
  }

  return {
    // state
    unread,
    items,
    loading,
    loadingMore,
    error,
    page,
    // getters
    isEmpty,
    finished,
    // actions
    fetch,
    fetchList,
    loadMore,
    markRead,
    markAllRead,
    reset,
  }
})
