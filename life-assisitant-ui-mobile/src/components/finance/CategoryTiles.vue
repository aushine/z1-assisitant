<script setup lang="ts">
/**
 * CategoryTiles —— 习惯 / 待办分类平铺选择器（移动端）
 *
 * spec-20260922-v2/04 §4.1 / §6：`CategoryPicker.vue` 与财务的收支双树
 * **强耦合，不可复用**，这里按「一级平铺 + 管理入口」新建轻量版。
 *
 * 与财务选择器的**有意差异**（04 §5）：
 *   - 只有一级 ⇒ **点一下即选中，没有二级弹窗**；
 *   - 尾部固定「管理 ›」入口 → `/me/categories?domain=<domain>`。
 *
 * 数据：`stores/user-category`（store 优先）。分类尚未加载时先用
 * `utils/category-dict` 的旧常量兜底渲染，Pinia 数据到达后自动替换
 * —— 不闪空白、不报错（04 §4.2）。
 *
 * 取消选中策略不在本组件（保持组件"笨"）：父级拿到 update:modelValue
 * 后自行决定（如待办"再点一次 → c_other"）。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/icon/Icon.vue'
import { useUserCategoryStore } from '@/stores/user-category'
import { getTint, type TintName } from '@/utils/tint'
import type { TintVars } from '@/utils/tint'
import { HABIT_CATEGORIES, TASK_CATEGORIES } from '@/utils/category-dict'
import type { IconName } from '@/components/icon/names'
import type { UserCategoryDomain } from '@/api/types'

interface TileOption {
  id: string
  label: string
  icon: IconName
  tint: TintName
  vars: TintVars
}

interface Props {
  /** 分类域：habit | task */
  domain: UserCategoryDomain
  /** 当前选中的分类 id（'' = 未选） */
  modelValue: string
  /** 整体禁用（保存中） */
  disabled?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void
}>()

const router = useRouter()
const store = useUserCategoryStore()

onMounted(() => {
  void store.ensureFresh(props.domain)
})

/** store 优先、常量兜底的一级平铺列表 */
const options = computed<TileOption[]>(() => {
  if (store.loadedOnce[props.domain]) {
    return store.listByDomain(props.domain).map((c) => {
      const r = store.resolveCategory(props.domain, c.id)
      const tint: TintName = r?.tint ?? 'neutral'
      return {
        id: c.id,
        label: r?.name ?? c.name,
        icon: r?.icon ?? (props.domain === 'habit' ? 'Pin' : 'CircleDashed'),
        tint,
        vars: getTint(tint),
      }
    })
  }
  const fallback = props.domain === 'habit' ? HABIT_CATEGORIES : TASK_CATEGORIES
  return fallback.map((c) => ({ id: c.id, label: c.label, icon: c.icon, tint: c.tint, vars: c.vars }))
})

function pick(id: string) {
  if (props.disabled) return
  emit('update:modelValue', id)
}

function goManage() {
  if (props.disabled) return
  void router.push({ path: '/me/categories', query: { domain: props.domain } })
}
</script>

<template>
  <div class="cat-tiles">
    <button
      v-for="o in options"
      :key="o.id"
      type="button"
      class="cat-tile"
      :class="{ 'is-active': o.id === modelValue }"
      :style="o.id === modelValue ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg } : {}"
      :disabled="disabled"
      @click="pick(o.id)"
    >
      <Icon :name="o.icon" :size="14" /> {{ o.label }}
    </button>
    <button type="button" class="cat-tile cat-tile--manage" :disabled="disabled" @click="goManage">
      管理 ›
    </button>
  </div>
</template>

<style lang="scss" scoped>
/* 一级平铺 chip（04 §4.1）：数量可变 ⇒ 换行流式，不做 flex:1 拉伸 */
.cat-tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px 16px;
}
.cat-tile {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); }
  &.is-active {
    font-weight: 600;
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.cat-tile--manage {
  color: var(--color-primary);
  background: transparent;
  border-color: var(--color-border);
}
</style>
