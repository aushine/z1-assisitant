<script setup lang="ts">
/**
 * CategoryTiles —— 习惯 / 待办分类选择器（移动端 · **两级**）
 *
 * spec-20260922-v2/04 §4.1 / §6：`CategoryPicker.vue` 与财务的收支双树
 * **强耦合，不可复用**，这里按「一级 chip 行 + 按需展开的二级行 + 管理入口」新建轻量版。
 *
 * 260924（spec-20260924-v1/03 §5.1 · R3）—— **一级平铺升级为两级**：
 *   - 一级 chip 行：现状保留（点一级 = emit 一级 id，并展开其二级行）；
 *   - 二级 chip 行：**仅当「已选一级」且有二级时**才出现在一级行下方，
 *     首项固定「不限」（= 只挂一级，emit 一级 id），其后才是二级 chip；
 *   - 点二级 = emit 二级 id；一级没有二级 ⇒ 不渲染二级行（不是渲染空行）；
 *   - 与财务选择器的差异：财务是「记一笔时选二级」（常驻平铺 + 点一级弹二级），
 *     习惯/待办选择频率低 ⇒ 二级**按需展开**，不常驻占屏（03 §2）。
 *
 * 数据：`stores/user-category`（store 优先，树助手 listTopLevel / listChildren）。
 * 分类尚未加载时先用 `utils/category-dict` 的旧常量兜底渲染一级，Pinia 数据到达后
 * 自动替换 —— 不闪空白、不报错（04 §4.2）。⚠️ 常量表是「一级平铺」时代的遗产，
 * 只有 4/6 个内置一级、**没有二级**，所以兜底态下不展开二级行。
 *
 * 契约（**严格复用，勿改**）：
 *   props: modelValue / disabled / domain；emit: update:modelValue
 *   —— 二级也是分类 id，与一级同一根弦（调用方 `stores/habit`/task 存的都是 id）。
 *
 * 取消选中策略不在本组件（保持组件"笨"）：父级拿到 update:modelValue
 * 后自行决定（如待办"再点一次 → c_other"）。
 */
import { computed, onMounted, watch } from 'vue'
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
  /** 当前选中的分类 id（'' = 未选；一级 / 二级都是分类 id，同一根弦） */
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

/**
 * 兜底常量态（分类未加载）的一级选项。
 * ⚠️ 常量表无二级，故展开时二级行只会是「不限」一项 —— 见下面的 children 计算。
 */
function fallbackTiles(): TileOption[] {
  const fallback = props.domain === 'habit' ? HABIT_CATEGORIES : TASK_CATEGORIES
  return fallback.map((c) => ({ id: c.id, label: c.label, icon: c.icon, tint: c.tint, vars: c.vars }))
}

/**
 * 把一个分类 id 归一成可渲染的 chip 选项（store 优先）。
 * `fallback` 仅在 store 未加载时用得上（常量表的 label / icon / tint / vars）。
 */
function toTile(
  id: string,
  fallback?: { label: string; icon: IconName; tint: TintName; vars: TintVars },
): TileOption {
  const r = store.resolveCategory(props.domain, id)
  const tint: TintName = r?.tint ?? fallback?.tint ?? 'neutral'
  return {
    id,
    label: r?.name ?? fallback?.label ?? id,
    icon: r?.icon ?? fallback?.icon ?? (props.domain === 'habit' ? 'Pin' : 'CircleDashed'),
    tint,
    vars: r?.vars ?? fallback?.vars ?? getTint(tint),
  }
}

/** store 优先、常量兜底的一级 chip 行（R3：只取 parent_id === '' 的一级） */
const options = computed<TileOption[]>(() => {
  if (store.loadedOnce[props.domain]) {
    return store.listTopLevel(props.domain).map((c) => toTile(c.id))
  }
  return fallbackTiles()
})

/**
 * 二级 chip 行（R3 §5.1）：首项「不限」= 只挂一级（emit 一级 id），其后是二级。
 *
 * 「已选一级」的判定：modelValue 本身就是一级 id，或它指向的二级的 parent_id。
 * 两者都算「该一级已展开」—— 否则编辑一条挂在二级上的记录时，二级行不会展开，
 * 用户看不到当前选中的那个子项。
 */
const activeRootId = computed<string>(() => {
  const id = props.modelValue
  if (!id) return ''
  const node = store.byId(id)
  return node ? node.parent_id : ''
})

const children = computed<TileOption[]>(() => {
  const root = activeRootId.value
  if (!root) return []
  // 「不限」永远排第一（对齐财务「只记大类」）；它带着一级 chip 的图标 / 颜色
  const rootTile = options.value.find((o) => o.id === root)
  const base: TileOption = rootTile ?? toTile(root)
  const kids = store.loadedOnce[props.domain]
    ? store.listChildren(props.domain, root).map((c) => toTile(c.id))
    : []
  return [base, ...kids]
})

function pick(id: string) {
  if (props.disabled) return
  emit('update:modelValue', id)
}

/** 二级行是否激活：二级 id 直接命中；「不限」则看 modelValue 是否就是那个一级 id */
function isActiveChild(o: TileOption): boolean {
  return o.id === props.modelValue
}

/**
 * 点一级：emit 一级 id 并**展开**其二级行（即使该一级当前已是选中态 ——
 * 用户点它常常就是为了去选二级）。二级行为由 activeRootId 派生，无需额外状态。
 */
function pickRoot(id: string) {
  pick(id)
}

// ⚠️ 不做「从二级回落到一级」的兜底：一级若无二级，点一级 emit 一级 id；
//    若一级有二级但用户只想挂一级 —— 「不限」就是这个语义（见 children 首项）。
watch(
  () => props.domain,
  (d) => { void store.ensureFresh(d) }
)

function goManage() {
  if (props.disabled) return
  void router.push({ path: '/me/categories', query: { domain: props.domain } })
}
</script>

<template>
  <div class="cat-tiles">
    <!-- 一级 chip 行（现状保留）：点击 = 选中一级 + 展开其二级行 -->
    <div class="cat-row">
      <button
        v-for="o in options"
        :key="o.id"
        type="button"
        class="cat-tile"
        :class="{ 'is-active': o.id === activeRootId || o.id === modelValue }"
        :style="(o.id === activeRootId || o.id === modelValue)
          ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
          : {}"
        :disabled="disabled"
        @click="pickRoot(o.id)"
      >
        <Icon :name="o.icon" :size="14" /> {{ o.label }}
      </button>
      <button type="button" class="cat-tile cat-tile--manage" :disabled="disabled" @click="goManage">
        管理 ›
      </button>
    </div>

    <!-- 二级 chip 行（R3 §5.1）：仅在「已选一级」且一级存在时出现；
         首项「不限」= 只挂一级（值 = 一级 id） -->
    <div v-if="children.length" class="cat-row cat-row--child">
      <button
        v-for="o in children"
        :key="o.id"
        type="button"
        class="cat-tile cat-tile--child"
        :class="{ 'is-active': isActiveChild(o) }"
        :style="isActiveChild(o) ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg } : {}"
        :disabled="disabled"
        @click="pick(o.id)"
      >
        <Icon :name="o.icon" :size="13" /> {{ o.label }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* 一级 / 二级 chip 行（04 §4.1）：数量可变 ⇒ 换行流式，不做 flex:1 拉伸 */
.cat-tiles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 16px;
}
.cat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* 二级行：缩进 + 细分割线，让「从属关系」一眼看出来（R3 §9 端差异） */
.cat-row--child {
  padding-left: 12px;
  border-left: 2px solid var(--color-border-light);
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
/* 二级 chip 比一级小一号（36 → 30），弱化存在感，层级一眼可辨 */
.cat-tile--child {
  height: 30px;
  padding: 0 10px;
  font-size: var(--fs-micro);
}
</style>
