<script setup lang="ts">
/**
 * 任务详情页（移动端 · Phase 2.5）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/task/detail.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/task.go
 *                    （GET /tasks/:id 是唯一返回完整 subtasks 的端点）
 * 最后同步：2026-09-18
 *
 * 内容：
 *   - 标题 + 完成勾选 + 状态/优先级/截止/提醒/重复 meta
 *   - 描述区、子任务区（进度条 + 逐项勾选）
 *   - 任务信息区（创建时间 / 完成时间 / 子任务计数）
 *   - 编辑（复用 TaskEditSheet）/ 删除
 *
 * 注意：列表接口 `GET /tasks` **不带** `subtasks` 数组（只有 subtasks_count），
 * 所以本页必须单独 `GET /tasks/:id`，不能只从 store 取。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showFailToast } from 'vant'
import { storeToRefs } from 'pinia'
import { taskApi } from '@/api/task'
import { useTaskStore } from '@/stores/task'
import { getTaskPriority, getTaskStatus } from '@/utils/task-dict'
import { getTaskCategory } from '@/utils/category-dict'
import { formatDateTime } from '@/utils/date'
import TaskEditSheet from '@/components/TaskEditSheet.vue'
import Icon from '@/components/icon/Icon.vue'
import type { CreateTaskReq, Task } from '@/api/types'

const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const { tasks } = storeToRefs(store)

const taskId = computed(() => String(route.params.id ?? ''))

const task = ref<Task | null>(null)
const loading = ref(true)
const error = ref('')

// ==================== 数据加载 ====================
async function fetchTask(): Promise<void> {
  if (!taskId.value) return
  loading.value = true
  error.value = ''
  try {
    task.value = await taskApi.get(taskId.value)
  } catch (e) {
    error.value = '加载失败，请重试'
    // eslint-disable-next-line no-console
    console.error('[TaskDetail] fetchTask failed', e)
  } finally {
    loading.value = false
  }
}

onMounted(fetchTask)

// ==================== 派生数据 ====================
const statusDef = computed(() => getTaskStatus(task.value?.status))
const priorityDef = computed(() => getTaskPriority(task.value?.priority))
const categoryDef = computed(() => getTaskCategory(task.value?.category_id ?? undefined))

const RECURRENCE_LABEL: Record<string, string> = {
  'FREQ=DAILY': '每天',
  'FREQ=WEEKLY': '每周',
  'FREQ=MONTHLY': '每月',
}
const recurrenceText = computed(() => {
  const r = task.value?.recurrence_rule
  if (!r) return ''
  return RECURRENCE_LABEL[r] ?? r
})

const subtasks = computed(() => task.value?.subtasks ?? [])
const completedCount = computed(() => subtasks.value.filter((s) => s.is_completed).length)
const totalCount = computed(() => subtasks.value.length)
const progressPct = computed(() =>
  totalCount.value > 0 ? Math.round((completedCount.value / totalCount.value) * 100) : 0
)

// ==================== 操作 ====================
/** 勾选子任务：后端返回更新后的整个 Task，直接回写（并同步 store 列表） */
async function onToggleSubtask(subtaskId: string): Promise<void> {
  if (!task.value) return
  const fresh = await store.toggleSubtask(task.value.id, subtaskId)
  if (fresh) task.value = fresh
  else showFailToast('操作失败，请重试')
}

/** 切换完成 */
async function onToggleComplete(): Promise<void> {
  const t = task.value
  if (!t) return
  const next = t.status === 'done' ? 'todo' : 'done'
  await store.toggleComplete(t.id, next)
  // store 里若无该任务（直达详情页），store 会走直连分支；这里再从本地/后端取一次
  const fromStore = tasks.value.find((x) => x.id === t.id)
  if (fromStore) task.value = fromStore
  else await fetchTask()
}

/** 删除后返回列表 */
async function onDelete(): Promise<void> {
  if (!task.value) return
  try {
    await showConfirmDialog({
      title: '删除任务',
      message: `确认删除「${task.value.title}」？删除后 30 天内可恢复。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    const ok = await store.deleteTask(task.value.id)
    if (ok) router.replace('/task')
  } catch {
    // 用户取消
  }
}

// ==================== 编辑 ====================
const sheetShow = ref(false)

async function onSave(payload: CreateTaskReq): Promise<boolean> {
  if (!task.value) return false
  const updated = await store.updateTask(task.value.id, payload)
  if (updated) {
    await fetchTask()
    return true
  }
  return false
}

function goBack(): void {
  // 直接进详情页（无历史）时回列表，避免退出到站外
  if (window.history.length > 1) router.back()
  else router.replace('/task')
}
</script>

<template>
  <div class="task-detail-page">
    <!-- 顶部导航 -->
    <van-nav-bar
      title="任务详情"
      left-arrow
      :border="false"
      class="detail-nav"
      @click-left="goBack"
    >
      <template v-if="task" #right>
        <span class="nav-action" @click="sheetShow = true">编辑</span>
      </template>
    </van-nav-bar>

    <!-- 加载骨架 -->
    <div v-if="loading" class="detail-body">
      <div class="skel-title" />
      <div v-for="i in 4" :key="i" class="skel-row" />
    </div>

    <!-- 错误态 -->
    <div v-else-if="error || !task" class="detail-body">
      <div class="panel-error">
        <span>{{ error || '任务不存在' }}</span>
        <button type="button" class="retry-btn" @click="fetchTask">重试</button>
      </div>
      <button type="button" class="ghost-btn" @click="goBack">返回列表</button>
    </div>

    <!-- 正文 -->
    <div v-else class="detail-body">
      <!-- 标题 + 类别 -->
      <section class="card">
        <div class="title-row">
          <button
            type="button"
            class="checkbox"
            :class="{ 'is-checked': task.status === 'done' }"
            :aria-label="task.status === 'done' ? '标记为未完成' : '标记为已完成'"
            @click="onToggleComplete"
          >
            <span v-if="task.status === 'done'" class="check-tick" aria-hidden="true">✓</span>
          </button>
          <h1 class="detail-title" :class="{ 'is-done': task.status === 'done' }">{{ task.title }}</h1>
        </div>

        <!-- meta chips -->
        <div class="meta-row">
          <span
            class="meta-chip"
            :style="{ background: statusDef.bg, color: statusDef.fg }"
          >{{ statusDef.label }}</span>
          <span
            class="meta-chip"
            :style="{ background: priorityDef.bg, color: priorityDef.fg }"
          >{{ priorityDef.label }}</span>
          <span v-if="categoryDef" class="meta-chip is-plain">
            <Icon :name="categoryDef.icon" :size="14" class="chip-icon" />
            {{ categoryDef.label }}
          </span>
          <span v-if="task.due_date" class="meta-chip is-plain">
            <Icon name="Calendar" :size="14" class="chip-icon" />
            {{ task.due_date }}{{ task.due_time ? ` ${task.due_time}` : '' }}
          </span>
          <span v-if="task.reminder_at" class="meta-chip is-plain">
            <Icon name="Clock" :size="14" class="chip-icon" />
            {{ formatDateTime(task.reminder_at) }}
          </span>
          <span v-if="recurrenceText" class="meta-chip is-plain">
            <Icon name="RefreshCw" :size="14" class="chip-icon" />
            {{ recurrenceText }}
          </span>
        </div>
      </section>

      <!-- 描述 -->
      <section v-if="task.description" class="card">
        <div class="section-title">描述</div>
        <p class="detail-desc">{{ task.description }}</p>
      </section>

      <!-- 子任务 -->
      <section v-if="totalCount > 0" class="card">
        <div class="section-title">
          子任务
          <span class="section-count">{{ completedCount }}/{{ totalCount }}</span>
        </div>

        <div class="subtask-progress">
          <div class="subtask-progress-head">
            <span>完成进度</span>
            <span class="mono">{{ progressPct }}%</span>
          </div>
          <div class="subtask-progress-bar">
            <div class="subtask-progress-fill" :style="{ width: progressPct + '%' }" />
          </div>
        </div>

        <ul class="subtask-list">
          <li
            v-for="s in subtasks"
            :key="s.id"
            class="subtask-item"
            @click="onToggleSubtask(s.id)"
          >
            <span class="st-checkbox" :class="{ 'is-checked': s.is_completed }">
              <span v-if="s.is_completed" aria-hidden="true">✓</span>
            </span>
            <span class="subtask-title" :class="{ 'is-completed': s.is_completed }">{{ s.title }}</span>
          </li>
        </ul>
      </section>

      <!-- 任务信息 -->
      <section class="card">
        <div class="section-title">任务信息</div>
        <div class="info-row">
          <span class="info-label">状态</span>
          <span class="info-value">{{ statusDef.label }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">优先级</span>
          <span class="info-value">{{ priorityDef.label }}</span>
        </div>
        <div v-if="task.due_date" class="info-row">
          <span class="info-label">截止</span>
          <span class="info-value">{{ task.due_date }}{{ task.due_time ? ` ${task.due_time}` : '' }}</span>
        </div>
        <div v-if="task.reminder_at" class="info-row">
          <span class="info-label">提醒</span>
          <span class="info-value">{{ formatDateTime(task.reminder_at) }}</span>
        </div>
        <div v-if="recurrenceText" class="info-row">
          <span class="info-label">重复</span>
          <span class="info-value">{{ recurrenceText }}</span>
        </div>
        <div v-if="totalCount > 0" class="info-row">
          <span class="info-label">子任务</span>
          <span class="info-value">{{ completedCount }}/{{ totalCount }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">创建</span>
          <span class="info-value">{{ formatDateTime(task.created_at) }}</span>
        </div>
        <div v-if="task.completed_at" class="info-row">
          <span class="info-label">完成</span>
          <span class="info-value">{{ formatDateTime(task.completed_at) }}</span>
        </div>
      </section>

      <!-- 危险操作 -->
      <button type="button" class="danger-btn" @click="onDelete">删除任务</button>
    </div>

    <!-- 编辑弹层 -->
    <TaskEditSheet v-model:show="sheetShow" :task="task" :on-save="onSave" />
  </div>
</template>

<style lang="scss" scoped>
.task-detail-page {
  /* ⚠️ 不写 height：高度由 HomeLayout 的 .content 用 flex 直接分配
     （见 HomeLayout .content 注释）。写 height:100% 会与布局层的定位
     方案争抢同一组属性（特异性相同、由 CSS 注入顺序裁决），且依赖
     iOS 上不可靠的百分比解析 → 页面被内容撑高 → .detail-body 空转、
     滚动传到根、顶部导航被带着滚。 */
  background: var(--color-bg-app);
  display: flex;
  flex-direction: column;
}

.detail-nav {
  flex-shrink: 0;
  background: var(--color-bg-card);
}
:deep(.detail-nav .van-nav-bar__title) {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.nav-action {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-primary);
  cursor: pointer;
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px var(--space-5) calc(24px + env(safe-area-inset-bottom, 0px));
}

/* ========== 卡片 ========== */
.card {
  background: var(--color-bg-card);
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
  padding: 14px 16px;
  margin-bottom: 12px;
}

.title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.checkbox {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-strong);
  border-radius: 6px;
  margin-top: 3px;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.9); }
  &.is-checked {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
}
.check-tick {
  font-size: 14px;
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1;
}
.detail-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: 700;
  line-height: 1.4;
  color: var(--color-text-primary);
  word-break: break-all;
  &.is-done {
    text-decoration: line-through;
    color: var(--color-text-disabled);
  }
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.meta-chip {
  padding: 3px 9px;
  border-radius: 7px;
  font-size: var(--fs-micro);
  font-weight: 600;
  line-height: 1.5;
  &.is-plain {
    background: var(--color-bg-hover);
    color: var(--color-text-secondary);
    font-weight: 500;
  }
  /* chip 内图标与文字基线对齐（图标体系改造后新增） */
  .chip-icon {
    display: inline-block;
    vertical-align: -2px;
    margin-right: 3px;
  }
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 10px;
}
.section-count {
  font-size: var(--fs-micro);
  font-weight: 500;
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}
.detail-desc {
  margin: 0;
  font-size: var(--fs-caption);
  line-height: 1.65;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ========== 子任务 ========== */
.subtask-progress { margin-bottom: 12px; }
.subtask-progress-head {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  margin-bottom: 5px;
}
.mono { font-family: var(--font-num); }
.subtask-progress-bar {
  height: 6px;
  background: var(--color-bg-hover);
  border-radius: 3px;
  overflow: hidden;
}
.subtask-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-primary);
  transition: width var(--duration-normal) var(--ease-default);
}

.subtask-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.subtask-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
.st-checkbox {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--color-border-strong);
  border-radius: 5px;
  font-size: var(--fs-caption-sm);
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1;
  &.is-checked {
    background: var(--color-success);
    border-color: var(--color-success);
  }
}
.subtask-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  &.is-completed {
    text-decoration: line-through;
    color: var(--color-text-disabled);
  }
}

/* ========== 任务信息 ========== */
.info-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  font-size: var(--fs-caption);
}
.info-label {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}
.info-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  color: var(--color-text-primary);
  word-break: break-all;
}

/* ========== 危险操作 ========== */
.danger-btn {
  display: block;
  width: 100%;
  height: 44px;
  margin-top: 4px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-danger);
  border-radius: 12px;
  color: var(--color-danger);
  font-size: var(--fs-body);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-danger-light); }
}
.ghost-btn {
  display: block;
  width: 100%;
  height: 44px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: 12px;
  color: var(--color-text-secondary);
  font-size: var(--fs-body);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ========== 骨架 / 错误 ========== */
.skel-title {
  height: 26px;
  width: 60%;
  margin-bottom: 16px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  border-radius: 8px;
  animation: shimmer 1.5s infinite;
}
.skel-row {
  height: 60px;
  margin-bottom: 12px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  border-radius: 12px;
  animation: shimmer 1.5s infinite;
}
.panel-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 0;
  font-size: var(--fs-caption);
  color: var(--color-danger-dark);
  margin-bottom: 12px;
}
.retry-btn {
  height: 28px;
  padding: 0 14px;
  border: 1px solid currentColor;
  border-radius: 14px;
  background: transparent;
  color: inherit;
  font-size: var(--fs-caption-sm);
  cursor: pointer;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
