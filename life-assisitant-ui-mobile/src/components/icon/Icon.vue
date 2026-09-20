<script setup lang="ts">
/**
 * 统一图标组件（02 §8.1 / §8.3）—— 移动端实现
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/icon/Icon.tsx
 * 最后同步：2026-09-18
 *
 * 三件事，和桌面端逐条对齐：
 *  1. 光学补偿：按 size 自动注入 strokeWidth（越大越细），业务代码不用管描边；
 *  2. dev 期校验：size 不在 6 级标度内 / 图标名不存在 → console.warn；
 *  3. 未知图标名降级为 HelpCircle，**生产环境不崩、不空**。
 *
 * 用法：
 *   <Icon name="Home" :size="20" />
 *   <Icon name="Flame" :size="16" style="color: var(--tint-warning-fg)" />
 *
 * 颜色默认继承 `currentColor`（不传 color 就跟随父级文字色）——
 * 只有「颜色携带信息」时才显式着色（02 §5.1 三级规则）。
 */
import { computed, watchEffect } from 'vue'
import { ICONS, type IconName, type LucideIcon } from './names'
import { ICON_SIZES, strokeWidthForSize } from './sizes'

/**
 * 关闭自动属性继承，改为在模板里显式 `v-bind="$attrs"`。
 * 原因：class / style 需要落到真正的 <svg> 上，显式绑定语义更清楚。
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** 图标名，必须是 ICONS 注册表中的键 */
    name: IconName
    /** 尺寸，只允许 6 级标度（14 / 16 / 20 / 24 / 32 / 48） */
    size?: number
    /** 描边宽度；不传则按光学补偿标度自动推导 */
    strokeWidth?: number
  }>(),
  { size: 20 }
)

/** 注册表按名查找（as const 的字面量类型需要放宽后才能动态索引） */
const ICONS_MAP = ICONS as unknown as Record<string, LucideIcon>

/** 运行时解析组件；未命中降级 HelpCircle */
const cmp = computed<LucideIcon>(() => ICONS_MAP[props.name] ?? ICONS_MAP.HelpCircle)

/** 描边：显式传入优先，否则光学补偿 */
const resolvedStrokeWidth = computed(() => props.strokeWidth ?? strokeWidthForSize(props.size))

if (import.meta.env.DEV) {
  watchEffect(() => {
    if (!ICON_SIZES.includes(props.size)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[icon] size ${props.size} 不在 6 级标度内（${ICON_SIZES.join(' / ')}），请使用其中之一`
      )
    }
    if (!(props.name in ICONS_MAP)) {
      // eslint-disable-next-line no-console
      console.warn(`[icon] 未知图标名 "${String(props.name)}"，已降级为 HelpCircle`)
    }
  })
}
</script>

<template>
  <component :is="cmp" :size="size" :stroke-width="resolvedStrokeWidth" v-bind="$attrs" />
</template>
