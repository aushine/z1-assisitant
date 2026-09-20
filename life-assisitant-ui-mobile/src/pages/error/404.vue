<script setup lang="ts">
import { useRouter } from 'vue-router'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()

function goHome() {
  router.push({ name: 'Home', replace: true })
}
</script>

<template>
  <div class="error-page">
    <div class="error-card">
      <Icon name="Search" :size="48" class="emoji" />
      <h1 class="code">404</h1>
      <h2 class="title">页面不存在</h2>
      <p class="desc">你访问的页面已下架或地址错误<br />检查一下链接吧～</p>
      <div class="actions">
        <button class="btn btn-primary" type="button" @click="goHome">回到首页</button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.error-page {
  /* 高度取 --app-height（见 reset.scss）：standalone 下 WebKit 会少算动态
     视口高度，写死 100% / 100dvh 会让页面底部空出一条。 */
  min-height: var(--app-height);
  background: var(--color-bg-app);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-5);
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.error-card {
  width: 100%;
  max-width: 360px;
  background: var(--color-bg-card);
  border-radius: var(--radius-2xl);
  padding: 40px 24px;
  box-shadow: var(--shadow-md);
  text-align: center;
}

.emoji {
  margin-bottom: 16px;
  :deep(svg) { display: block; }
}

.code {
  font-size: 48px;
  font-weight: 700;
  color: var(--color-primary);
  margin: 0 0 8px;
  letter-spacing: 2px;
  line-height: 1;
}

.title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 12px;
}

.desc {
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  line-height: 1.6;
  margin: 0 0 28px;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn {
  flex: 1;
  height: 44px;
  border: 0;
  border-radius: 10px;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast);

  &.btn-primary {
    background: var(--color-primary);
    color: #FFFFFF;
    box-shadow: var(--shadow-button);

    &:active { background: var(--color-primary-dark); transform: scale(0.98); }
  }
}
</style>
