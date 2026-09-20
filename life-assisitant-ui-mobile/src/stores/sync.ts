/**
 * Sync Store（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/sync.ts
 * 最后同步：2026-09-18（Phase 5.6）
 *
 * 与桌面端的差异（有意）：
 *   桌面端 store 的 fetch 静默吞错并保留初始值 `status: 'synced'` ——
 *   断网时页面会显示「已同步」，这是**误导性**的。桌面端因此不得不在页面里
 *   绕过 store 直接调 syncApi.status 才能拿到错误（见 sync.tsx 的 fetchStatus）。
 *   移动端把 error 收进 store，页面直接用，且**失败时把 status 清为 'error'**
 *   而不是保留 'synced'。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { syncApi } from '@/api/sync'

export interface SyncModuleDetail {
  last_sync?: string | null
  status?: 'synced' | 'pending' | 'error'
  pending_count?: number
}

export interface SyncState {
  lastSyncAt: string | null
  status: 'synced' | 'syncing' | 'pending' | 'error'
  pending: number
  details: Record<string, SyncModuleDetail>
}

export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncState>({
    lastSyncAt: null,
    status: 'synced',
    pending: 0,
    details: {},
  })
  const loading = ref(false)
  /** null 表示无错误；字符串为可直接展示的提示 */
  const error = ref<string | null>(null)
  /** 是否已经成功拉取过一次（区分「初始值」与「真实数据」） */
  const loaded = ref(false)

  const details = computed(() => status.value.details)
  const moduleKeys = computed(() => Object.keys(status.value.details))

  /** 拉取同步状态（错误如实暴露，不保留误导性的 'synced'） */
  async function fetch(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await syncApi.status()
      status.value = {
        lastSyncAt: res.last_sync_at ?? null,
        status: res.status ?? 'synced',
        pending: res.pending ?? 0,
        details: res.details ?? {},
      }
      loaded.value = true
    } catch (e) {
      // 关键：不要把 status 留在 'synced'，否则断网显示「已同步」
      status.value = {
        lastSyncAt: null,
        status: 'error',
        pending: 0,
        details: {},
      }
      error.value = e instanceof Error && e.message ? e.message : '同步状态加载失败，请重试'
    } finally {
      loading.value = false
    }
  }

  /** 立即同步（成功后自动刷新状态；失败置 error 并返回 false） */
  async function syncNow(): Promise<boolean> {
    status.value = { ...status.value, status: 'syncing' }
    try {
      await syncApi.trigger()
      // trigger 后重新拉状态（会覆盖 syncing）
      await fetch()
      return status.value.status === 'synced'
    } catch {
      status.value = { ...status.value, status: 'error' }
      error.value = '同步失败，请稍后重试'
      return false
    }
  }

  function reset(): void {
    status.value = { lastSyncAt: null, status: 'synced', pending: 0, details: {} }
    loading.value = false
    error.value = null
    loaded.value = false
  }

  return { status, loading, error, loaded, details, moduleKeys, fetch, syncNow, reset }
})
