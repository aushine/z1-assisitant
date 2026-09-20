<script setup lang="ts">
/**
 * 经期设置向导页（移动端 · 全屏 sub-page）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/PeriodSetup.tsx
 * 契约文档：md/spec-260919/04-页面与交互设计.md §1 / §7.5
 *
 * 顶层路由（不挂 HomeLayout）：二级页自己管滚动，理由见 router/index.ts 的
 * 「我的 · 二级页」段落 —— HomeLayout 的 .content 已是滚动容器，嵌套会双滚动条。
 *
 * 两个出口：
 *   done  提交成功（后端已写 disclaimer_accepted_at）→ 回记录页经期 Tab
 *   skip  右上角「先看看」→ 回记录页但**不**确认免责，下次进入会再弹
 *
 * 回跳前把 `ui.recordTab` 置为 'period'：如果只是 router.replace('/record')，
 * 记录页会停在用户上次停留的那个 Tab（可能不是经期），看起来像「没进去」。
 */
import { useRouter } from 'vue-router'
import { usePeriodStore } from '@/stores/period'
import { useUiStore } from '@/stores/ui'
import PeriodSetupWizard from '@/components/period/PeriodSetupWizard.vue'

const router = useRouter()
const store = usePeriodStore()
const ui = useUiStore()

function backToRecord(): void {
  // 经期维度已并入「健康」二级 tab（RecordTab 2026-09-19 改为 habit|finance|health）
  ui.recordTab = 'health'
  router.replace('/record')
}

function onDone(): void {
  backToRecord()
}

function onSkip(): void {
  // 只标记「本次会话已跳过」，不写后端（04 §7.5）
  store.skipSetup()
  backToRecord()
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="backToRecord">‹</button>
      <h2 class="sub-title">设置向导</h2>
    </header>

    <!-- 向导自己管内部滚动（.wiz 高度 100%），所以不套 .sub-body -->
    <main class="wiz-wrap">
      <PeriodSetupWizard @done="onDone" @skip="onSkip" />
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.wiz-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  /* 子组件 .wiz 用 height:100%，需要父级高度是确定值 ——
     flex 子项 + min-height:0 恰好给了它确定高度 */
  :deep(> *) { flex: 1; min-height: 0; }
}
</style>
