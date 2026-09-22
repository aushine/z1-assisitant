<script setup lang="ts">
/**
 * BrandLogo —— 账户图标三态渲染器（spec-20260922-v1 · 02 §5/§6）
 *
 * 三态（02 §5.1 存储契约）：
 *   ① `brand:<slug>`  → <img>，slug 决定目录：
 *                        命中 banks.ts 的 logo 字段 → /bank-logos/<slug>.png
 *                        否则                       → /brand-logos/<slug>.png|svg
 *                        （bank-logos 153 个全 PNG；brand-logos 11 个中
 *                         visa / mastercard 是 SVG，png 失败再试 svg，链长有界不循环）
 *   ② `lucide:<Name>` → IconBox（彩色圆底 + 图标，复用既有通道，禁止给 <Icon> 设宽高）
 *   ③ emoji / 其他    → resolveAccountIcon（emoji → lucide + 语义色，存量兼容）
 *
 * 兜底铁律（02 §5.3）：brand 图片加载失败 / SHOW_BANK_LOGOS=false → 文字徽标
 * （fallbackText 首字 + fallbackColor，缺省中性灰 #8A8A8A），**绝不裂图**。
 *
 * ⚠️ 尺寸一律**内联 style**：本工程 postcss-px-to-viewport 会把 SCSS 里的 px
 *    转成 vw，图标盒会随屏幕缩放变形（同 components/IconBox.vue 的处理）。
 * ⚠️ 暗色主题：彩色 logo 底部加白色托底（02 §10）。
 */
import { computed, ref, watch } from 'vue'
import IconBox from '@/components/IconBox.vue'
import type { IconName } from '@/components/icon/names'
import { assetBase } from '@/utils/asset'
import { BANKS } from '@/constants/banks'
import { SHOW_BANK_LOGOS } from '@/constants/account'
import { resolveAccountIcon } from '@/utils/category-dict'

interface Props {
  /** 图标引用原文：`brand:<slug>` | `lucide:<Name>` | emoji */
  icon: string
  /** 盒子直径（px），与 IconBox 的 size 同语义 */
  size?: number
  /** 文字徽标用（传 bank.short 或账户名/类型名，取首字） */
  fallbackText?: string
  /** 文字徽标底色（B3：banks.ts 暂无品牌色字段，缺省中性灰） */
  fallbackColor?: string
  /** 银行 code（用于兜底文字与徽标降级） */
  institution?: string
  /** lucide/emoji 通道的盒子底色透传（数据驱动颜色；缺省 IconBox neutral） */
  bg?: string
  /** lucide/emoji 通道的前景色透传 */
  fg?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 20,
  fallbackText: '',
  fallbackColor: '#8A8A8A',
  institution: '',
  bg: undefined,
  fg: undefined,
})

type Kind = 'brand' | 'lucide' | 'emoji'
const kind = computed<Kind>(() => {
  if (props.icon.startsWith('brand:')) return 'brand'
  if (props.icon.startsWith('lucide:')) return 'lucide'
  return 'emoji'
})

// ==================== ① brand 通道 ====================
const brandSlug = computed(() => props.icon.slice('brand:'.length))
/** slug 决定目录：命中 banks.ts 的 logo 字段 → bank-logos；否则 brand-logos */
const brandDir = computed(() =>
  BANKS.some((b) => b.logo === brandSlug.value) ? 'bank-logos' : 'brand-logos'
)
/** bank-logos 全 PNG；brand-logos 里 visa/mastercard 是 SVG（02 §3.2）→ png 失败再试 svg */
const extChain = computed<string[]>(() =>
  brandDir.value === 'bank-logos' ? ['png'] : ['png', 'svg']
)
const extIdx = ref(0)
const imgFailed = ref(false)
// 图标引用变化（换银行 / 换类型）时重置探测链与失败态
watch(
  () => props.icon,
  () => {
    extIdx.value = 0
    imgFailed.value = false
  }
)
/** SHOW_BANK_LOGOS=false → 全部降级文字徽标（02 §10，布局不塌：徽标与图片同尺寸） */
const degraded = computed(() => kind.value === 'brand' && !SHOW_BANK_LOGOS)
const brandSrc = computed(() => {
  const ext = extChain.value[Math.min(extIdx.value, extChain.value.length - 1)]
  return `${assetBase}${brandDir.value}/${brandSlug.value}.${ext}`
})
/** 有界降级：png → svg → 文字徽标，onerror 后不再重试 */
function onImgError(): void {
  if (extIdx.value < extChain.value.length - 1) {
    extIdx.value += 1
    return
  }
  imgFailed.value = true
}

const bank = computed(() =>
  props.institution ? BANKS.find((b) => b.code === props.institution) : undefined
)

// ==================== 文字徽标（② 兜底） ====================
const badgeText = computed(() => {
  const t = props.fallbackText || bank.value?.short || props.institution
  return (t || '?').slice(0, 1)
})
const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${Math.round(props.size * 0.22)}px`,
}))
const badgeStyle = computed(() => ({
  ...boxStyle.value,
  background: props.fallbackColor,
  fontSize: `${Math.max(10, Math.round(props.size * 0.48))}px`,
}))

// ==================== ③ lucide / ④ emoji 通道 ====================
const lucideName = computed(() =>
  kind.value === 'lucide' ? (props.icon.slice('lucide:'.length) as IconName) : null
)
const emojiResolved = computed(() => resolveAccountIcon(props.icon || '💰'))
</script>

<template>
  <!-- ① brand：本地品牌资源，白托底（暗色主题下彩色 logo 需浅色底衬，02 §10） -->
  <div v-if="kind === 'brand' && !degraded && !imgFailed" class="brand-logo" :style="boxStyle">
    <img :src="brandSrc" alt="" loading="lazy" @error="onImgError">
  </div>

  <!-- ② 文字徽标：降级开关 / 图片加载失败 / 无品牌通道兜底，同尺寸保证布局不塌 -->
  <div
    v-else-if="kind === 'brand'"
    class="brand-badge"
    :style="badgeStyle"
    aria-hidden="true"
  >{{ badgeText }}</div>

  <!-- ③ lucide：复用 IconBox 通道（彩色圆底 + 图标一律 IconBox） -->
  <IconBox
    v-else-if="lucideName"
    :name="lucideName"
    :bg="bg"
    :fg="fg"
    :size="size"
  />

  <!-- ④ emoji 存量：resolveAccountIcon → lucide + 语义色 -->
  <IconBox
    v-else
    :name="emojiResolved.icon"
    :bg="bg ?? emojiResolved.vars.bg"
    :fg="fg ?? emojiResolved.vars.fg"
    :size="size"
  />
</template>

<style lang="scss" scoped>
.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background: #FFFFFF;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
}

.brand-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #FFFFFF;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
</style>
