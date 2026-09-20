/**
 * Anniversary Store（纪念日 / 倒数日）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/anniversary.go
 * 契约文档：md/spec-20260919-v1/06-个人中心与纪念日.md、07-API规范.md
 *
 * ⚠️ `next_date` / `days_left` 是后端**实时推导**字段（不落库）：
 *    跨月、2 月 29 日、31 日边界全部由后端 utility/anniversary_next.go 处理。
 *    所以任何写操作成功后都要**重拉列表**，前端不要在本地「乐观更新」这两个字段
 *    —— 自己算会与后端不一致（尤其是不重复且已过的倒数日，后端会直接过滤掉）。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { showFailToast } from 'vant'
import { anniversaryApi } from '@/api/anniversary'
import type {
  AnniversaryBrief,
  AnniversaryItem,
  CreateAnniversaryReq,
  PatchAnniversaryReq,
} from '@/api/types'

export type AnniversaryScope = 'upcoming' | 'month' | 'all'

export const useAnniversaryStore = defineStore('anniversary', () => {
  // ==================== state ====================
  /** 管理页列表（按后端返回的排序：置顶 → days_left 升序） */
  const items = ref<AnniversaryItem[]>([])
  /** 首页卡片用的精简版 */
  const upcoming = ref<AnniversaryBrief[]>([])
  const loading = ref(false)
  const saving = ref(false)
  /** 当前列表的 scope，用于写操作后按同一口径重拉 */
  const scope = ref<AnniversaryScope>('all')

  // ==================== actions ====================

  async function fetchList(next: AnniversaryScope = 'all'): Promise<void> {
    scope.value = next
    loading.value = true
    try {
      const res = await anniversaryApi.list({ scope: next })
      items.value = res?.items ?? []
    } catch {
      items.value = []
    } finally {
      loading.value = false
    }
  }

  async function fetchUpcoming(limit = 3): Promise<void> {
    try {
      const res = await anniversaryApi.upcoming(limit)
      upcoming.value = res?.items ?? []
    } catch {
      upcoming.value = []
    }
  }

  /** 写操作后的统一收尾：按当前 scope 重拉（next_date 只能后端给） */
  async function refreshAfterWrite(): Promise<void> {
    await Promise.all([fetchList(scope.value), fetchUpcoming()])
  }

  async function create(data: CreateAnniversaryReq): Promise<boolean> {
    if (saving.value) return false
    saving.value = true
    try {
      await anniversaryApi.create(data)
      await refreshAfterWrite()
      return true
    } catch {
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  async function patch(id: string, data: Omit<PatchAnniversaryReq, 'id'>): Promise<boolean> {
    if (saving.value) return false
    saving.value = true
    try {
      await anniversaryApi.patch(id, data)
      await refreshAfterWrite()
      return true
    } catch {
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  async function remove(id: string): Promise<boolean> {
    if (saving.value) return false
    saving.value = true
    try {
      await anniversaryApi.remove(id)
      await refreshAfterWrite()
      return true
    } catch {
      showFailToast('删除失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  function resetLocal(): void {
    items.value = []
    upcoming.value = []
    loading.value = false
    saving.value = false
    scope.value = 'all'
  }

  return {
    items,
    upcoming,
    loading,
    saving,
    scope,
    fetchList,
    fetchUpcoming,
    create,
    patch,
    remove,
    resetLocal,
  }
})
