<script setup lang="ts">
/**
 * IconPicker —— 图标选择器（移动端 · 分类体系 2026-09-21）
 *
 * 规格：md/spec-20260921-v1/04-图标分组与自选.md §4
 *
 * 形态：底部弹窗（`van-popup` + **`teleport="body"`** 铁律）
 *   ① 置顶搜索框（按**图标名**模糊，大小写不敏感，搜索时**跨组**）
 *   ② 分组 chips（横向滚动，默认选中第 1 组，**切换组不清空搜索框**）
 *   ③ 4 列图标网格（单元格 ≥ 44px，满足触控下限）——**点图标即选中并关闭**
 *
 * ⚠️ 数据源 `ICON_GROUPS` 只引用 `ICONS` 注册表里的名字（04 §5.2），
 *    因此用户入库的图标名必定可渲染，不会因 lucide 版本漂移而失联。
 */
import { computed, ref, watch } from 'vue'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'
import { ICON_GROUPS } from '@/constants/icon-groups'

interface Props {
  show: boolean
  /** 当前已选图标名（高亮用） */
  modelValue?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'update:modelValue', v: IconName): void
  (e: 'select', v: IconName): void
}>()

/** 组名列表（按 ICON_GROUPS 的键顺序，即 04 §3.1 的 14 组顺序） */
const groupNames = Object.keys(ICON_GROUPS)

const keyword = ref('')
const activeGroup = ref<string>(groupNames[0] ?? '')

watch(
  () => props.show,
  (v) => {
    if (v) {
      keyword.value = ''
      activeGroup.value = groupNames[0] ?? ''
    }
  }
)

/** 是否处于搜索态 */
const searching = computed(() => keyword.value.trim().length > 0)

/**
 * 当前展示的图标：
 * - 搜索态 → **跨组**按名模糊匹配（大小写不敏感）
 * - 分组态 → 当前组的图标
 */
const visibleIcons = computed<IconName[]>(() => {
  const q = keyword.value.trim().toLowerCase()
  if (q) {
    const out: IconName[] = []
    const seen = new Set<string>()
    for (const group of groupNames) {
      for (const name of ICON_GROUPS[group] ?? []) {
        if (seen.has(name)) continue
        if (name.toLowerCase().includes(q)) {
          seen.add(name)
          out.push(name)
        }
      }
    }
    return out
  }
  return ICON_GROUPS[activeGroup.value] ?? []
})

function pick(name: IconName): void {
  emit('update:modelValue', name)
  emit('select', name)
  emit('update:show', false)
}

function close(): void {
  emit('update:show', false)
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留：本组件可能嵌在分类编辑浮层里，不 teleport 会被滚动容器压住 -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '64%' }"
    round
    teleport="body"
    :close-on-click-overlay="true"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="icon-picker">
      <div class="ip-header">
        <span class="ip-title">选择图标</span>
        <button type="button" class="ip-cancel" @click="close">取消</button>
      </div>

      <!-- 搜索（按图标名模糊，跨组） -->
      <div class="ip-search">
        <Icon name="Search" :size="16" class="ip-search-icon" aria-hidden="true" />
        <input
          v-model="keyword"
          type="search"
          class="ip-search-input"
          placeholder="搜索图标…"
          enterkeyhint="search"
        >
        <button
          v-if="searching"
          type="button"
          class="ip-search-clear"
          aria-label="清空"
          @click="keyword = ''"
        >×</button>
      </div>

      <!-- 分组 chips（搜索态隐藏，避免和跨组结果打架） -->
      <div v-if="!searching" class="ip-chips">
        <button
          v-for="g in groupNames"
          :key="g"
          type="button"
          class="ip-chip"
          :class="{ 'is-on': activeGroup === g }"
          @click="activeGroup = g"
        >
          {{ g }}
        </button>
      </div>

      <!-- 图标网格：4 列，单元格 ≥ 44px -->
      <div class="ip-body">
        <div v-if="visibleIcons.length === 0" class="ip-empty">没找到匹配的图标</div>
        <div v-else class="ip-grid">
          <button
            v-for="name in visibleIcons"
            :key="name"
            type="button"
            class="ip-cell"
            :class="{ 'is-active': modelValue === name }"
            :aria-label="name"
            @click="pick(name)"
          >
            <Icon :name="name" :size="22" />
          </button>
        </div>
      </div>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.icon-picker {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}

.ip-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px var(--space-4) 8px;
}
.ip-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.ip-cancel {
  border: 0;
  background: transparent;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  padding: 4px 6px;
  &:active { opacity: 0.7; }
}

.ip-search {
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 var(--space-4) var(--space-2);
  padding: 0 34px 0 32px;
  height: 38px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
.ip-search-icon {
  position: absolute;
  left: 10px;
  color: var(--color-text-tertiary);
}
.ip-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  &::placeholder { color: var(--color-text-disabled); }
  &::-webkit-search-cancel-button { display: none; }
}
.ip-search-clear {
  position: absolute;
  right: 6px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: var(--fs-h4);
  color: var(--color-text-tertiary);
  &:active { background: var(--color-bg-hover); }
}

.ip-chips {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  padding: 4px var(--space-4) var(--space-2);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}
.ip-chip {
  flex-shrink: 0;
  height: 30px;
  padding: 0 12px;
  border: 1.5px solid transparent;
  border-radius: 999px;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
  &.is-on {
    color: var(--color-primary);
    background: var(--color-primary-light);
    border-color: var(--color-primary);
    font-weight: 600;
  }
}

.ip-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  padding: 0 var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}
.ip-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.ip-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 44px 触控下限 */
  min-height: 44px;
  aspect-ratio: 1 / 1;
  border: 1.5px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.94); }
  &.is-active {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
}
.ip-empty {
  padding: 40px 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
</style>
