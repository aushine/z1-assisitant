<script setup lang="ts">
/**
 * 性价比人生指南 · iframe 内嵌页（移动端 · spec-20261001-v3）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/htlb.tsx
 * 最后同步：2026-10-01（spec-20261001-v3 双端同批新增）
 *
 * v2 时「我的 → 性价比人生指南」是外链跳转（window.location.href）—— 跳出 app，
 * Safari 里会退化成「网页样」。本批改为站内二级页 iframe 内嵌（带返回按钮），
 * 保持 app 体验。指南地址仍**运行时**计算（utils/external.ts 的 htlbUrl()，
 * 与主站同源，不受 X-Frame-Options 同源限制）。
 *
 * ⚠️ 布局契约（同 subpage.scss 的 .sub-page）：固定高度 --app-height + overflow:hidden，
 *    只有 iframe 内部文档滚动 —— 页面自身不滚，避免「页面 + iframe」双滚动条。
 * ⚠️ 本页是**顶层路由**（不在 HomeLayout 里），拿不到布局的 .status-bar-placeholder，
 *    导航栏自己补刘海安全区（.sub-header 同款做法，见 subpage.scss 注释）。
 */
import { useRouter } from 'vue-router'
import { htlbUrl } from '@/utils/external'

const router = useRouter()

/** 返回「我的」。直接进本页（无历史）时兜底回 /me，避免退出到站外 */
function goBack(): void {
  if (window.history.length > 1) router.back()
  else router.replace('/me')
}
</script>

<template>
  <div class="htlb-page">
    <!-- 顶部导航（‹ 返回 + 标题） -->
    <van-nav-bar
      title="性价比人生指南"
      left-arrow
      :border="false"
      class="htlb-nav"
      @click-left="goBack"
    />

    <!-- 指南正文：iframe 铺满导航栏以下区域，独立滚动 -->
    <div class="htlb-body">
      <iframe :src="htlbUrl()" class="htlb-frame" title="性价比人生指南" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.htlb-page {
  /* 固定高度 + overflow:hidden：滚动只发生在 iframe 内部（理由见 script 头注释）。
     高度取 --app-height（不要写 100dvh/100vh，iOS standalone 的修正见 utils/safe-area.ts） */
  height: 100%;
  height: var(--app-height);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
}

.htlb-nav {
  flex-shrink: 0;
  /* 顶层路由无 status-bar-placeholder，自己补刘海安全区 */
  padding-top: env(safe-area-inset-top, 0px);
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-light);

  :deep(.van-nav-bar__title) {
    font-size: var(--fs-h4);
    font-weight: 600;
    color: var(--color-text-primary);
  }
}

.htlb-body {
  flex: 1;
  min-height: 0;
}

.htlb-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  /* 加载瞬间的底色跟随主题，暗色下不闪白 */
  background: var(--color-bg-card);
}
</style>
