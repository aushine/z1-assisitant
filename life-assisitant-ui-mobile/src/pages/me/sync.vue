<script setup lang="ts">
/**
 * 同步状态（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/sync.tsx
 * 最后同步：2026-09-18（Phase 5.6）
 *
 * 桌面端为了拿真实错误，页面里绕过 store 直接调 syncApi.status（见其注释）；
 * 移动端的 sync store 已把 error 收进 store，页面直接用即可 —— 行为等价、
 * 少一次重复请求。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, showSuccessToast, showToast } from 'vant'
import { useSyncStore } from '@/stores/sync'
import { useUserStore } from '@/stores/user'
import { formatRelativeTime } from '@/utils/date'
import { getTint } from '@/utils/tint'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()
const syncStore = useSyncStore()
const userStore = useUserStore()

/** 同步状态 → 展示文案与 tint */
const STATUS_META: Record<string, { label: string; tint: 'success' | 'warning' | 'danger' | 'primary' }> = {
  synced: { label: '已同步', tint: 'success' },
  syncing: { label: '同步中', tint: 'primary' },
  pending: { label: '待同步', tint: 'warning' },
  error: { label: '同步失败', tint: 'danger' },
}

const cur = computed(() => STATUS_META[syncStore.status.status] ?? STATUS_META.synced)
const curTint = computed(() => getTint(cur.value.tint))

/**
 * 相对时间：空值显示「从未」。
 * utils/date 的 formatRelativeTime 对空值返回空串（它要兼顾列表场景），
 * 而同步状态页需要明确表达「从未同步过」。
 */
function relTime(iso?: string | null): string {
  return formatRelativeTime(iso) || '从未'
}

/** 详情行：模块名 + 最后同步 + 状态 + 待处理数 */
const detailRows = computed(() =>
  Object.entries(syncStore.status.details).map(([key, val]) => ({
    key,
    module: key,
    lastSync: relTime(val.last_sync),
    status: val.status ?? 'synced',
    pending: val.pending_count ?? 0,
  }))
)

function statusTint(s: string) {
  return getTint(STATUS_META[s]?.tint ?? 'neutral')
}
function statusLabel(s: string): string {
  return STATUS_META[s]?.label ?? s
}

async function onSync(): Promise<void> {
  showToast({ message: '开始同步…', duration: 1500 })
  const ok = await syncStore.syncNow()
  if (ok) showSuccessToast('同步完成')
  else showFailToast('同步失败，请重试')
}

onMounted(() => {
  void syncStore.fetch()
})
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h2 class="sub-title">同步状态</h2>
    </header>

    <main class="sub-body">
      <!-- 错误态 -->
      <section v-if="syncStore.error" class="card">
        <div class="state-error">
          <span>{{ syncStore.error }}</span>
          <button class="retry-btn" type="button" @click="syncStore.fetch()">重试</button>
        </div>
      </section>

      <template v-else>
        <!-- 总览 -->
        <section class="card">
          <div class="sync-head">
            <div>
              <div class="sync-label">最后同步</div>
              <div class="sync-value">{{ relTime(syncStore.status.lastSyncAt) }}</div>
            </div>
            <span
              class="badge"
              :style="{ background: curTint.bg, color: curTint.fg }"
            >
              {{ cur.label }}
            </span>
          </div>

          <div v-if="syncStore.status.pending > 0" class="pending-hint">
            <Icon name="Hourglass" :size="16" />
            <span>有 {{ syncStore.status.pending }} 条数据待同步</span>
          </div>

          <div class="account-line">
            <span class="row-sub">同步账号：{{ userStore.user?.email || userStore.user?.username || '-' }}</span>
          </div>

          <button
            class="btn btn-primary"
            type="button"
            :disabled="syncStore.loading || syncStore.status.status === 'syncing'"
            @click="onSync"
          >
            {{ syncStore.status.status === 'syncing' ? '同步中…' : '立即同步' }}
          </button>
        </section>

        <!-- 模块详情 -->
        <section class="card">
          <h3 class="card-title">模块详情</h3>
          <div v-if="syncStore.loading" class="skeleton" />
          <div v-else-if="detailRows.length === 0" class="state-empty">
            <Icon name="Package" :size="32" class="state-emoji" />
            <p class="state-text">暂无模块同步信息</p>
          </div>
          <div v-else>
            <div v-for="r in detailRows" :key="r.key" class="row">
              <span class="row-body">
                <span class="row-label">{{ r.module }}</span>
                <span class="row-sub">最后同步：{{ r.lastSync }}</span>
              </span>
              <span class="row-right">
                <span
                  class="badge"
                  :style="{ background: statusTint(r.status).bg, color: statusTint(r.status).fg }"
                >
                  {{ statusLabel(r.status) }}
                </span>
                <span v-if="r.pending > 0" class="row-sub pending-num">待处理 {{ r.pending }}</span>
              </span>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.sync-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: var(--space-4);
}
.sync-label {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.sync-value {
  margin-top: 4px;
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--color-text-primary);
  font-family: var(--font-num);
}
.pending-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  margin-bottom: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
  font-size: var(--fs-caption-sm);
}
.account-line {
  margin-bottom: var(--space-4);
}
.row-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.pending-num { margin-top: 0; }
</style>
