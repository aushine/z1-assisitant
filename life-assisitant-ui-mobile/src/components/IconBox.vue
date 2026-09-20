<script setup lang="ts">
/**
 * IconBox —— 彩色圆底 + 图标（02 §8.2）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/IconBox.tsx
 * 最后同步：2026-09-18
 *
 * 从「任意 bg/fg hex」收敛为 6 组 --tint-* 语义色：
 *   <IconBox name="BookOpen" tint="accent" :size="40" />
 *
 * 兼容期保留 bg/fg 字符串透传，用于数据驱动的颜色（如习惯自定义色），
 * 新代码应优先使用 tint。
 *
 * ⚠️ 尺寸走**内联 style**，不写进 SCSS —— 本工程 postcss-px-to-viewport
 *    会把 SCSS 里的 px 转成 vw，导致图标盒随屏幕缩放变形。
 */
import { computed } from 'vue'
import Icon from './icon/Icon.vue'
import type { IconName } from './icon/names'
import { strokeWidthForSize } from './icon/sizes'
import { TINT_VARS, type TintName } from '@/utils/tint'

/** 图标盒允许的尺寸（02 §8.2：32 / 40 / 48 三档） */
export type IconBoxSize = 32 | 40 | 48

const props = withDefaults(
  defineProps<{
    /** 图标名（ICONS 注册表的键） */
    name: IconName
    /** 语义色（优先），默认 neutral */
    tint?: TintName
    /** 背景色透传（数据驱动颜色用），优先用 tint */
    bg?: string
    /** 前景色透传（数据驱动颜色用），优先用 tint */
    fg?: string
    /** 圆直径（px），默认 40，建议 32 / 40 / 48 */
    size?: IconBoxSize | number
    /** 图标尺寸（px），默认取 size 的一半，落入 §4 标度 */
    iconSize?: number
    /** 描边宽度，默认按光学补偿标度注入 */
    strokeWidth?: number
  }>(),
  {
    tint: 'neutral',
    size: 40,
  }
)

const resolvedIconSize = computed(() => props.iconSize ?? Math.round(Number(props.size) / 2))
const resolvedStrokeWidth = computed(
  () => props.strokeWidth ?? strokeWidthForSize(resolvedIconSize.value)
)

const bgValue = computed(() => props.bg ?? TINT_VARS[props.tint].bg)
const fgValue = computed(() => props.fg ?? TINT_VARS[props.tint].fg)

/**
 * 圆角契约（01 §7.4）：<32 → 4px，32–44 → 8px，≥44 → 10px。
 * 本工程 tokens 的圆角命名与桌面端不同（无 xs，8px 叫 --radius-base），
 * 故这里的令牌名按移动端换算。
 */
const radiusVar = computed(() => {
  const s = Number(props.size)
  if (s < 32) return 'var(--radius-sm)' // 4px
  if (s >= 44) return 'var(--radius-lg)' // 10px
  return 'var(--radius-base)' // 8px
})

const boxStyle = computed(() => ({
  width: `${Number(props.size)}px`,
  height: `${Number(props.size)}px`,
  borderRadius: radiusVar.value,
  background: bgValue.value,
  color: fgValue.value,
}))
</script>

<template>
  <div class="icon-box" :style="boxStyle">
    <Icon
      :name="name"
      :size="resolvedIconSize"
      :stroke-width="resolvedStrokeWidth"
      :style="{ color: fgValue }"
    />
  </div>
</template>

<style lang="scss" scoped>
.icon-box {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
