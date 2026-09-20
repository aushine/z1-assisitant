import { create } from 'zustand'
import { syncApi } from '@/api/sync'

interface SyncDetails {
  [module: string]: {
    last_sync: string | null
    status: 'synced' | 'pending' | 'error'
    pending_count: number
  }
}

interface SyncStatus {
  lastSyncAt: string | null
  status: 'synced' | 'syncing' | 'pending' | 'error'
  pending: number
  details: SyncDetails
}

interface SyncState {
  status: SyncStatus
  loading: boolean
  /**
   * 上次拉取是否失败（M8）。
   * 原 fetch 的 catch 是空的，失败后 status 仍是初始的 'synced' ——
   * 断网时会把「未知」显示成「已同步」，常驻指示器上撒谎比不显示更糟。
   */
  error: boolean
  fetch: () => Promise<void>
  syncNow: () => Promise<void>
}

const initialStatus: SyncStatus = {
  lastSyncAt: null,
  status: 'synced',
  pending: 0,
  details: {},
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: initialStatus,
  loading: false,
  error: false,

  async fetch() {
    set({ loading: true, error: false })
    try {
      const res = await syncApi.status()
      set({
        status: {
          lastSyncAt: res.last_sync_at ?? null,
          status: res.status ?? 'synced',
          pending: res.pending ?? 0,
          details: res.details ?? {},
        },
      })
    } catch {
      // 不吞错：置 error 让消费方显示「状态未知」而不是陈旧的「已同步」
      set({ error: true })
    } finally {
      set({ loading: false })
    }
  },

  async syncNow() {
    set({ status: { ...get().status, status: 'syncing' } })
    try {
      await syncApi.trigger()
      await get().fetch()
    } catch {
      set({ status: { ...get().status, status: 'error' } })
    }
  },
}))
