<script setup lang="ts">
import { onMounted } from 'vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

onMounted(() => {
  // 应用启动时尝试用持久化的 token 恢复登录态
  userStore.hydrate()
})
</script>

<template>
  <div class="app-root">
    <!--
      ⚠️ key 必须用「顶层路由记录」(matched[0].path)，**不能**用 route.fullPath。
      5 个 Tab 页（/home /task /record /stat /me）的顶层记录都是同一个 `/`
      （component = HomeLayout），key 恒定 → HomeLayout 只挂载一次、实例复用。
      历史 bug：key 用 fullPath 时，每次切 Tab 都让整个 HomeLayout 销毁重建，
      于是 ① 底部胶囊跟着做一次淡出淡入（肉眼就是「导航消失一会」）
      ② 5 个页面组件全部重新挂载、重新发请求（白屏变长）。
      二级页（/me/*、/system/*）顶层记录各不相同，切换时正常重建。
    -->
    <router-view v-slot="{ Component, route }">
      <transition name="fade-layout" mode="out-in">
        <component :is="Component" :key="route.matched[0]?.path ?? route.path" />
      </transition>
    </router-view>
  </div>
</template>

<style lang="scss">
.app-root {
  width: 100%;
  /* 高度链的一环：统一取 --app-height，不要写死 vh/dvh（见 reset.scss 注释）。
     历史坑：这里曾是 min-height: 100vh/100dvh，与布局层的 dvh 不是同一基准。 */
  height: 100%;
  height: var(--app-height);
  background: var(--color-bg-app);
  font-family: var(--font-family);
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 布局级切换动画（登录页 ↔ 主应用 ↔ 二级页），与布局内页签过渡分开命名，
   避免与 HomeLayout 里 scoped 的 .fade-page 语义混淆 */
.fade-layout-enter-active,
.fade-layout-leave-active {
  transition: opacity var(--duration-page) var(--ease-default);
}
.fade-layout-enter-from,
.fade-layout-leave-to {
  opacity: 0;
}
</style>
