<script setup lang="ts">
/**
 * 主题设置（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/theme.tsx
 * 最后同步：2026-09-18（Phase 5.2）
 *
 * 三个选项：浅色 / 深色 / 跟随系统，选中项高亮 + 右上角勾选。
 *
 * ⚠️ 主题切换会同时写入 `data-theme` 与 `van-theme-dark`（见 stores/theme.ts），
 *    所以本页的预览色块用 `van-*` 组件也能正确跟随。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { getTint } from '@/utils/tint'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'

const router = useRouter()
const themeStore = useThemeStore()

const OPTIONS: Array<{ key: ThemeMode; icon: IconName; label: string; desc: string }> = [
  { key: 'light', icon: 'Sun', label: '浅色', desc: '始终使用明亮外观' },
  { key: 'dark', icon: 'Moon', label: '深色', desc: '夜间护眼，降低亮度' },
  { key: 'system', icon: 'RefreshCw', label: '跟随系统', desc: '随系统外观自动切换' },
]

const current = computed(() => themeStore.theme)
const resolved = computed(() => themeStore.resolved())

function pick(mode: ThemeMode): void {
  if (mode === current.value) return
  themeStore.setTheme(mode)
  const label = OPTIONS.find((o) => o.key === mode)?.label ?? mode
  showSuccessToast(`${label}已启用`)
}

function goBack(): void {
  router.back()
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goBack">‹</button>
      <h2 class="sub-title">主题设置</h2>
    </header>

    <main class="sub-body">
      <section class="card">
        <h3 class="card-title">外观</h3>
        <div class="theme-grid">
          <button
            v-for="o in OPTIONS"
            :key="o.key"
            type="button"
            class="theme-option"
            :class="{ active: current === o.key }"
            @click="pick(o.key)"
          >
            <span v-if="current === o.key" class="check" aria-hidden="true">✓</span>
            <span class="theme-emoji"><Icon :name="o.icon" :size="24" /></span>
            <span class="theme-label">{{ o.label }}</span>
            <span class="theme-desc">{{ o.desc }}</span>
          </button>
        </div>
      </section>

      <section class="card">
        <h3 class="card-title">当前状态</h3>
        <div class="row">
          <span class="row-body">
            <span class="row-label">已选模式</span>
            <span class="row-sub">
              {{ OPTIONS.find((o) => o.key === current)?.label }}
            </span>
          </span>
          <span
            class="badge"
            :style="{ background: getTint(resolved === 'dark' ? 'accent' : 'warning').bg, color: getTint(resolved === 'dark' ? 'accent' : 'warning').fg }"
          >
            {{ resolved === 'dark' ? '深色生效中' : '浅色生效中' }}
          </span>
        </div>
        <p class="field-hint">
          选择「跟随系统」时，外观会随设备的深色模式设置自动切换；切换后图表、热力图与
          Vant 组件会同步换色，无需刷新页面。
        </p>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.theme-option {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 8px 14px;
  border: 2px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  transition: all var(--duration-fast) var(--ease-default);

  &.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
  &:active { transform: scale(0.97); }
}
.check {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: var(--fs-caption);
  font-weight: 700;
  color: var(--color-primary);
  line-height: 1;
}
.theme-emoji { line-height: 1; :deep(svg) { display: block; } }
.theme-label {
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-text-primary);
}
.theme-desc {
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  text-align: center;
  line-height: 1.35;
}
</style>
