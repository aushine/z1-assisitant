<script setup lang="ts">
/**
 * 重要日子（纪念日 / 倒数日）管理页（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/anniversaries.tsx
 * 设计：md/spec-20260919-v1/06-个人中心与纪念日.md §3
 *
 * ⚠️ 分组（最近 / 本月 / 全部）**直接用后端 scope 参数拿**，前端不做二次分组 ——
 *    next_date 是后端实时推导的，前端拿 days_left 自己切会在跨月边界上错。
 *
 * ⚠️ 布局：二级页用 subpage.scss 的「固定高度 + .sub-body 单滚动容器」模型，
 *    顶部栏自绘并补 env(safe-area-inset-top)。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import AnniversaryEditSheet from '@/components/AnniversaryEditSheet.vue'
import { useAnniversaryStore, type AnniversaryScope } from '@/stores/anniversary'
import { categoryMeta, daysLeftText, iconOf, isToday, remindText, repeatLabel } from '@/utils/anniversary'
import { getTint } from '@/utils/tint'
import type { AnniversaryItem } from '@/api/types'

const router = useRouter()
const store = useAnniversaryStore()

const SCOPES: ReadonlyArray<{ value: AnniversaryScope; label: string }> = [
  { value: 'upcoming', label: '最近' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' },
]

const scope = ref<AnniversaryScope>('all')
const error = ref('')

const sheetShow = ref(false)
const editing = ref<AnniversaryItem | null>(null)

onMounted(() => {
  reload()
})

async function reload(): Promise<void> {
  error.value = ''
  try {
    await store.fetchList(scope.value)
  } catch {
    error.value = '加载失败'
  }
}

async function onScope(v: AnniversaryScope): Promise<void> {
  if (v === scope.value) return
  scope.value = v
  await reload()
}

function openCreate(): void {
  editing.value = null
  sheetShow.value = true
}

function openEdit(it: AnniversaryItem): void {
  editing.value = it
  sheetShow.value = true
}

async function onDelete(it: AnniversaryItem): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除',
      message: `确定删除「${it.title}」吗？`,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  await store.remove(it.id)
}

const list = computed(() => store.items)

/** 某条所属 tint（配色 key 直接就是 TintName） */
function tintOf(it: AnniversaryItem) {
  return getTint(it.color || categoryMeta(it.category).color)
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h1 class="sub-title">重要日子</h1>
      <button class="sub-right" type="button" @click="openCreate">+ 新建</button>
    </header>

    <main class="sub-body">
      <!-- 分组切换 -->
      <div class="scope-seg">
        <button
          v-for="s in SCOPES"
          :key="s.value"
          class="scope-btn"
          :class="{ 'is-on': scope === s.value }"
          type="button"
          @click="onScope(s.value)"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="store.loading && list.length === 0" class="skeleton" />

      <!-- 错误 -->
      <div v-else-if="error" class="state-error">
        <span>{{ error }}</span>
        <button class="retry-btn" type="button" @click="reload">重试</button>
      </div>

      <!-- 空态 -->
      <div v-else-if="list.length === 0" class="state-empty">
        <Icon name="Calendar" :size="34" class="state-icon" />
        <p class="state-text">还没有重要的日子，点右上角新建一个吧</p>
      </div>

      <!-- 列表 -->
      <div v-else class="card ann-list">
        <van-swipe-cell v-for="it in list" :key="it.id">
          <button class="ann-row" type="button" @click="openEdit(it)">
            <span class="ann-icon" :style="{ background: tintOf(it).bg, color: tintOf(it).fg }">
              <Icon :name="iconOf(it.icon, it.category)" :size="18" />
            </span>
            <span class="ann-body">
              <span class="ann-title">
                {{ it.title }}
                <Icon v-if="it.is_pinned" name="Pin" :size="12" class="ann-pin" />
              </span>
              <span class="ann-sub">
                {{ categoryMeta(it.category).label }} · {{ repeatLabel(it.repeat_rule) }} ·
                {{ remindText(it.remind_days) }}
              </span>
              <span v-if="it.note" class="ann-note">{{ it.note }}</span>
            </span>
            <span class="ann-right">
              <span class="ann-date">{{ it.next_date.slice(5).replace('-', '/') }}</span>
              <span class="ann-days" :class="{ 'is-today': isToday(it.days_left) }">
                {{ daysLeftText(it.days_left) }}
              </span>
            </span>
          </button>
          <template #right>
            <button class="ann-swipe-del" type="button" @click="onDelete(it)">删除</button>
          </template>
        </van-swipe-cell>
      </div>

      <p class="ann-foot">
        下次发生日与倒计时由服务端按「基准日 + 重复规则」实时推导，不随设备时区漂移。
      </p>
    </main>

    <AnniversaryEditSheet
      v-model:show="sheetShow"
      :item="editing"
      @saved="reload"
    />
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.scope-seg {
  display: flex;
  gap: 6px;
  padding: 3px;
  margin-bottom: var(--space-3);
  background: var(--color-bg-hover);
  border-radius: var(--radius-lg);
}
.scope-btn {
  flex: 1;
  padding: 8px 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  &.is-on {
    background: var(--color-bg-card);
    color: var(--color-primary);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
}

.ann-list { padding: 0 var(--space-4); }

.ann-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border: 0;
  background: transparent;
  text-align: left;

  & + .ann-row { border-top: 1px solid var(--color-border-light); }
  &:active { opacity: 0.7; }
}
.ann-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
}
.ann-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ann-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.ann-pin { color: var(--color-warning); }
.ann-sub,
.ann-note {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ann-right {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.ann-date {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-num);
}
.ann-days {
  font-size: var(--fs-micro);
  font-weight: 600;
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
  &.is-today { color: var(--color-danger); }
}

.ann-swipe-del {
  height: 100%;
  padding: 0 20px;
  border: 0;
  background: var(--color-danger);
  color: #FFFFFF;
  font-size: var(--fs-body-sm);
  font-weight: 600;
}

.ann-foot {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-micro);
  line-height: 1.6;
  color: var(--color-text-tertiary);
}
</style>
