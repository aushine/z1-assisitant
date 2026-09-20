/**
 * SmartBanner —— 管家建议横幅（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/SmartBanner.tsx
 * 最后同步：2026-09-18（Phase 2.2）
 *
 * 行为与桌面端对齐：
 *   - 可操作：每条建议带一个 CTA（去打卡 / 查看进度…）
 *   - 可关闭：「稍后」= 本次会话隐藏；「不再提示」= localStorage 持久隐藏
 *     （键名 `life-smart-banner-dismissed`，与桌面端共用同一 key）
 *   - 可切换：多条时底部圆点指示 + 点击切页
 *
 * 与桌面端的差异（刻意）：桌面端用 Semi Button + lucide 图标；
 * 移动端用原生 button + emoji（见 md/移动端移植方案.md §3.4）。
 */
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getTint, type TintName } from '@/utils/tint'
import { loadDismissed, saveDismissed, type SmartRec, type SmartRecType } from '@/utils/smart-recs'
import Icon from '@/components/icon/Icon.vue'

const props = defineProps<{
  recs: SmartRec[]
}>()

const router = useRouter()

const TYPE_TINT: Record<SmartRecType, TintName> = {
  warning: 'warning',
  success: 'success',
  danger: 'danger',
}

/** 本次会话内被「稍后」隐藏的建议 id */
const sessionHidden = ref<string[]>([])
/** 当前轮播下标 */
const index = ref(0)
/** 持久化的「不再提示」列表（挂载时读一次） */
const dismissedForever = ref<string[]>(loadDismissed())

/** 真正可见的建议 */
const visible = computed(() =>
  props.recs.filter(
    (r) => !dismissedForever.value.includes(r.id) && !sessionHidden.value.includes(r.id)
  )
)

/** 当前展示项（下标越界时回退到最后一条，避免隐藏后数组缩短导致空白） */
const currentIndex = computed(() => Math.min(index.value, Math.max(0, visible.value.length - 1)))
const current = computed<SmartRec | null>(() => visible.value[currentIndex.value] ?? null)

const tint = computed(() => getTint(current.value ? TYPE_TINT[current.value.type] : 'neutral'))

/** 建议数组变化（如刷新后规则不再命中）时把下标夹回合法范围 */
watch(
  () => visible.value.length,
  (len) => {
    if (len === 0) index.value = 0
    else if (index.value > len - 1) index.value = len - 1
  }
)

/** 稍后：仅本次会话隐藏当前建议 */
function dismissLater(): void {
  if (!current.value) return
  if (!sessionHidden.value.includes(current.value.id)) {
    sessionHidden.value.push(current.value.id)
  }
  index.value = Math.max(0, Math.min(index.value, visible.value.length - 1))
}

/** 不再提示：持久隐藏当前建议 */
function dismissForever(): void {
  if (!current.value) return
  const next = Array.from(new Set([...loadDismissed(), current.value.id]))
  dismissedForever.value = next
  saveDismissed(next)
  dismissLater()
}

function goCta(): void {
  if (!current.value) return
  router.push(current.value.cta.route)
}

function goIndex(i: number): void {
  index.value = i
}
</script>

<template>
  <section
    v-if="current"
    class="smart-banner"
    :style="{ background: tint.bg }"
    role="region"
    aria-label="管家建议"
  >
    <!-- 主行：图标 + 文案 -->
    <div class="sb-main">
      <Icon
        :name="current.icon"
        :size="20"
        class="sb-icon"
        :style="{ color: tint.fg }"
        aria-hidden="true"
      />
      <p class="sb-title" :style="{ color: tint.fg }">{{ current.title }}</p>
      <button
        type="button"
        class="sb-later"
        aria-label="稍后提醒"
        :style="{ color: tint.fg }"
        @click="dismissLater"
      >×</button>
    </div>

    <!-- 操作行：CTA + 不再提示 + 圆点 -->
    <div class="sb-actions">
      <button
        type="button"
        class="sb-cta"
        :style="{ background: tint.fg }"
        @click="goCta"
      >{{ current.cta.label }}</button>

      <button
        type="button"
        class="sb-forever"
        :style="{ color: tint.fg }"
        @click="dismissForever"
      >不再提示</button>

      <div v-if="visible.length > 1" class="sb-dots" role="tablist" aria-label="建议切换">
        <button
          v-for="(r, i) in visible"
          :key="r.id"
          type="button"
          class="sb-dot"
          :class="{ 'is-active': i === currentIndex }"
          :style="{ background: i === currentIndex ? tint.fg : 'currentColor' }"
          :aria-label="`第 ${i + 1} 条建议`"
          role="tab"
          :aria-selected="i === currentIndex"
          @click="goIndex(i)"
        />
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.smart-banner {
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
  padding: 12px 14px;
  margin-bottom: 16px;
}

.sb-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
/* 建议图标：尺寸由 <Icon :size> 控制；颜色取建议语气的语义色 fg */
.sb-icon {
  flex-shrink: 0;
  display: block;
  margin-top: 2px;
}
.sb-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  line-height: 1.45;
}
.sb-later {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  font-size: var(--fs-h3);
  line-height: 1;
  opacity: 0.7;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 1; }
}

.sb-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding-left: 26px;
}
.sb-cta {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  color: #FFFFFF;
  font-size: var(--fs-caption);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.85; }
}
.sb-forever {
  flex-shrink: 0;
  height: 30px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 0;
  border-radius: 15px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  opacity: 0.9;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 1; }
}

.sb-dots {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  color: rgba(0, 0, 0, 0.25);
}
.sb-dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--duration-fast) var(--ease-default);
  &.is-active { transform: scale(1.15); }
}
</style>
