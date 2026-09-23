<script setup lang="ts">
/**
 * 通知设置（移动端 · Phase 5.4）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/notifications.tsx
 * 最后同步：2026-09-18
 *
 * 两块内容对齐桌面端：
 *   1. 通知列表（真实接口 /notifications）+ 未读数 + 单条已读 + 全部已读；
 *   2. 通知偏好开关（后端**暂无**对应端点，仍走本地 localStorage）。
 *
 * 与桌面端的差异：
 *   - 桌面端需要额外发一次探针请求才能区分「加载失败」与「暂无通知」
 *     （因为它的 store 静默吞错）；移动端 store 暴露 error，直接判断即可。
 *   - 列表接入 van-list 上拉加载（移动端是长列表场景）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '@/stores/notification'
import { storage } from '@/utils/storage'
import { formatDateTime } from '@/utils/date'
import { getTint } from '@/utils/tint'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()
const notificationStore = useNotificationStore()

// ==================== 通知偏好（本地存储） ====================
const NOTIF_KEYS = ['task_reminder', 'habit_reminder', 'budget_alert', 'weekly_report'] as const
type NotifKey = (typeof NOTIF_KEYS)[number]

const NOTIF_LABELS: Record<NotifKey, { title: string; desc: string }> = {
  task_reminder: { title: '任务提醒', desc: '任务到期前推送提醒' },
  habit_reminder: { title: '习惯提醒', desc: '每日习惯打卡提醒' },
  budget_alert: { title: '预算预警', desc: '支出超过预算阈值时预警' },
  weekly_report: { title: '周报推送', desc: '每周发送数据总结报告' },
}

const STORAGE_KEY = 'notif_prefs'

function loadPrefs(): Record<NotifKey, boolean> {
  const saved = storage.getJSON<Partial<Record<NotifKey, boolean>>>(STORAGE_KEY, {})
  return {
    task_reminder: saved.task_reminder ?? true,
    habit_reminder: saved.habit_reminder ?? true,
    budget_alert: saved.budget_alert ?? true,
    weekly_report: saved.weekly_report ?? false,
  }
}

const prefs = reactive<Record<NotifKey, boolean>>(loadPrefs())

function onToggle(key: NotifKey, val: boolean): void {
  prefs[key] = val
  storage.setJSON(STORAGE_KEY, { ...prefs })
}

// ==================== 通知列表 ====================
const loading = computed(() => notificationStore.loading)
const hasError = computed(() => !!notificationStore.error)
const items = computed(() => notificationStore.items)
const unread = computed(() => notificationStore.unread)

/**
 * van-list 的 `loading` 必须绑定**可写的 ref**（组件会双向改写它来驱动
 * 「加载中」文案），`finished` 则是单向 prop。首屏已由 fetchList 拉过，
 * 故 `:immediate-check="false"` 关掉挂载时的自动触发，避免重复请求第一页。
 */
const listLoading = ref(false)

/** van-list 的 finished：无更多数据即结束 */
const finished = computed(() => notificationStore.finished)

async function onLoad(): Promise<void> {
  listLoading.value = true
  try {
    await notificationStore.loadMore()
  } finally {
    listLoading.value = false
  }
}

async function onMarkAll(): Promise<void> {
  await notificationStore.markAllRead()
}

function onTapItem(id: string, isRead: boolean): void {
  if (!isRead) void notificationStore.markRead(id)
}

onMounted(() => {
  void notificationStore.fetch()
  void notificationStore.fetchList()
})
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h2 class="sub-title">通知设置</h2>
      <button
        v-if="unread > 0"
        class="sub-right"
        type="button"
        @click="onMarkAll"
      >
        全部已读
      </button>
    </header>

    <main class="sub-body">
      <!-- ====== 通知列表 ====== -->
      <section class="card">
        <div class="notif-head">
          <h3 class="card-title no-margin">通知</h3>
          <span v-if="unread > 0" class="unread-badge" :style="{ background: getTint('danger').bg, color: getTint('danger').fg }">
            {{ unread }} 未读
          </span>
        </div>

        <div v-if="loading" class="skeleton" />
        <div v-else-if="hasError" class="state-error">
          <span>{{ notificationStore.error }}</span>
          <button class="retry-btn" type="button" @click="notificationStore.fetchList()">重试</button>
        </div>
        <div v-else-if="items.length === 0" class="state-empty">
          <Icon name="Inbox" :size="32" class="state-emoji" />
          <p class="state-text">暂无通知</p>
        </div>
        <div v-else class="notif-list">
          <van-list
            v-model:loading="listLoading"
            :finished="finished"
            finished-text="没有更多了"
            :immediate-check="false"
            @load="onLoad"
          >
            <button
              v-for="n in items"
              :key="n.id"
              type="button"
              class="notif-item"
              :class="{ unread: !n.is_read }"
              @click="onTapItem(n.id, n.is_read)"
            >
              <span class="notif-main">
                <span class="notif-title">{{ n.title }}</span>
                <span v-if="n.body" class="notif-body">{{ n.body }}</span>
                <span class="notif-time">{{ formatDateTime(n.created_at) }}</span>
              </span>
              <span v-if="!n.is_read" class="notif-dot" />
            </button>
          </van-list>
        </div>
      </section>

      <!-- ====== 通知偏好 ====== -->
      <section class="card">
        <h3 class="card-title">偏好</h3>
        <div
          v-for="key in NOTIF_KEYS"
          :key="key"
          class="row"
        >
          <span class="row-body">
            <span class="row-label">{{ NOTIF_LABELS[key].title }}</span>
            <span class="row-sub">{{ NOTIF_LABELS[key].desc }}</span>
          </span>
          <van-switch
            :model-value="prefs[key]"
            size="20"
            @update:model-value="(v: boolean) => onToggle(key, v)"
          />
        </div>
        <p class="field-hint">
          偏好设置目前保存在本机（后端暂无对应接口），换设备不会同步。
        </p>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.no-margin { margin: 0; }

.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: var(--space-3);
}
.unread-badge {
  font-size: var(--fs-micro);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

.notif-list { margin: 0 calc(-1 * var(--space-4)); }
.notif-item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px var(--space-4);
  border: 0;
  background: transparent;
  text-align: left;

  & + .notif-item { border-top: 1px solid var(--color-border-light); }
  &:active { background: var(--color-bg-hover); }
  &.unread { background: var(--color-primary-light); }
}
.notif-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.notif-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.notif-body {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  line-height: 1.45;
}
.notif-time {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.notif-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--color-danger);
}
</style>
