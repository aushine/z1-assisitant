<script setup lang="ts">
/**
 * 经期设置页（移动端 · 全屏 sub-page）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/PeriodSettings.tsx
 * 契约文档：md/spec-260919/04-页面与交互设计.md §1（双入口）
 *
 * 双入口之一（另一个是经期 Tab 概览卡右上角 ⚙）：
 *   - 记录 → 经期 → 概览卡 ⚙
 *   - 我的 → 经期设置
 * 两处**共用权限**（period:view / period:write），不新增按钮级权限点。
 *
 * 表单本体是 PeriodSettingsForm（自带数据读写与危险操作确认）。
 */
import { useRouter } from 'vue-router'
import PeriodSettingsForm from '@/components/period/PeriodSettingsForm.vue'

const router = useRouter()
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h2 class="sub-title">经期设置</h2>
    </header>

    <main class="sub-body">
      <PeriodSettingsForm />
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;
</style>
