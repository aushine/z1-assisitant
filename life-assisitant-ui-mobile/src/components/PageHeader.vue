<script setup lang="ts">
/**
 * 页面顶部栏（PageHeader）
 *
 * 从 5 个 Tab 页里抽出来，由 HomeLayout **常驻渲染**（见 composables/usePageChrome.ts）。
 *
 * 为什么放到布局层：
 *   原来每个页面模板第一行都是 <header class="page-header">…，切模块时
 *   跟着页面一起销毁重建 —— 用户反馈「切模块要等一下才看到 header 和 tab」。
 *   提到布局层后，路由一变头部立即换文案，页面只做内容区过渡。
 *
 * 只有两种变体，且都是纯展示（数据全部由 usePageChrome 算好传进来）：
 *   - default：实色 --color-bg-card，与上方状态栏占位条、下方选项卡栏连成一片
 *   - hero   ：首页那条渐变色带（--color-primary-light → 页面底色）+ 圆形头像
 *
 * 右侧插槽按「配置」渲染而不是用 slot：布局是常驻组件，真正的 slot 内容
 * 在页面里（页面还没挂载），只能靠 usePageChrome 的 actions 配置 + 页面注册的
 * 处理函数（useHeaderAction）来打通。
 */
import Icon from '@/components/icon/Icon.vue'
import type { HeaderAction } from '@/stores/ui'

withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    /** 右侧次要文字（记录页的日期） */
    trailingText?: string
    variant?: 'default' | 'hero'
    /** hero 变体的圆形头像里显示的字 */
    avatarText?: string
    /** 右侧动作按钮 */
    actions?: HeaderAction[]
  }>(),
  { variant: 'default', actions: () => [] }
)

const emit = defineEmits<{
  action: [key: string]
}>()
</script>

<template>
  <header class="page-header" :class="{ 'is-hero': variant === 'hero' }">
    <div class="header-main">
      <span v-if="variant === 'hero' && avatarText" class="header-avatar" aria-hidden="true">
        {{ avatarText }}
      </span>
      <div class="header-text">
        <h1 class="page-title">{{ title }}</h1>
        <span v-if="subtitle" class="header-sub">{{ subtitle }}</span>
      </div>
    </div>

    <span v-if="trailingText" class="header-trailing">{{ trailingText }}</span>

    <div v-if="actions.length" class="header-actions">
      <button
        v-for="a in actions"
        :key="a.key"
        type="button"
        class="header-btn"
        :class="{ 'is-primary': a.primary, 'is-chip': a.chip }"
        :disabled="a.disabled"
        @click="emit('action', a.key)"
      >
        <Icon v-if="a.icon" :name="a.icon" :size="14" aria-hidden="true" />
        <span>{{ a.label }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped lang="scss">
.page-header {
  /* 顶部栏在滚动区之外（滚动下沉在页面内部的 body 容器里），
     不需要也不要用 position:sticky。 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  /* 高度 / 内边距与改造前各页 header 完全一致 —— 布局层只是搬了位置，
     不能让任何一个模块的头部高度发生变化。 */
  min-height: var(--app-header-height);
  padding: 10px var(--space-5);
  background: var(--color-bg-card);
  flex-shrink: 0;
}

/* 首页变体：渐变色带，首端与 HomeLayout 状态栏占位条同色（--color-primary-light） */
.page-header.is-hero {
  background: linear-gradient(180deg, var(--color-primary-light) 0%, var(--color-bg-app) 100%);
}

.header-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.header-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-h3);
  font-weight: 700;
  flex-shrink: 0;
}

/* 默认：标题与副标题同一基线并排（统计页「统计 按周期复盘趋势」） */
.header-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;

  /* 首页：问候语与日期上下两行 */
  .is-hero & {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
  }
}

.page-title {
  /* 五个 Tab 页标题同大（令牌统一，各页不要再写死字号） */
  font-size: var(--fs-page-title);
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-text-primary);
  margin: 0;
  /* 首页问候语带用户名，过长时省略，避免换行把顶部栏撑高 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  .is-hero & {
    margin-bottom: 2px;
  }
}

.header-sub,
.header-trailing {
  font-size: var(--fs-caption);
  line-height: 1.4;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-shrink: 0;
}

.header-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:active { transform: scale(0.96); }
  &:disabled { opacity: 0.5; }

  /* 主色文字（待办多选态的「全选」） */
  &.is-primary {
    color: var(--color-primary);
    font-weight: 600;
  }

  /* 胶囊按钮（统计页「导出」） */
  &.is-chip {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-pill);
    background: var(--tint-primary-bg);
    color: var(--tint-primary-fg);
    font-size: var(--fs-caption-sm);
    font-weight: 600;
  }
}
</style>
