<script setup lang="ts">
import { assetBase } from '@/utils/asset'
/**
 * 关于（移动端 · Phase 5.8）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/about.tsx
 * 最后同步：2026-09-18
 *
 * 桌面端那 4 个「隐私政策 / 服务条款 / 开源许可证 / 联系我们」是**无 href 的死链**，
 * 桌面端已改为明确提示「暂未开放」；移动端照做 —— 宁可说没有，也不要放个点了没反应的链接。
 */
import { useRouter } from 'vue-router'
import { showToast } from 'vant'

const router = useRouter()

const APP_VERSION = 'v1.0.0'
const APP_NAME = 'Z1 · Zero to One'

const LINKS = ['隐私政策', '服务条款', '开源许可证', '联系我们']

function onCheckUpdate(): void {
  showToast({ message: '当前已是最新版本', duration: 1500 })
}

function onOpenLink(label: string): void {
  showToast({ message: `${label}页面暂未开放`, duration: 1500 })
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h2 class="sub-title">关于</h2>
    </header>

    <main class="sub-body">
      <section class="card brand-card">
        <!-- 08 §3.4：竖版 lockup（图形上 / slogan 下，同事定稿成品）替换手写 name + slogan；
             版本号是功能信息 ⇒ 保留，移至 lockup 下方 -->
        <img :src="`${assetBase}brand/z1-lockup-v.svg`" alt="Z1 · Zero to One" class="brand-logo" />
        <p class="brand-version">{{ APP_VERSION }}</p>
        <p class="brand-desc">任务 · 习惯 · 记账 · 统计，一站式个人效率管理平台</p>

        <button class="btn btn-ghost check-btn" type="button" @click="onCheckUpdate">
          检查更新
        </button>
      </section>

      <section class="card">
        <div class="link-row">
          <button
            v-for="(l, i) in LINKS"
            :key="l"
            type="button"
            class="link"
            @click="onOpenLink(l)"
          >
            {{ l }}<span v-if="i < LINKS.length - 1" class="link-sep">·</span>
          </button>
        </div>
        <p class="copyright">© 2026 Z1 · Zero to One. All rights reserved.</p>
      </section>

      <p class="version-line">{{ APP_NAME }} {{ APP_VERSION }}</p>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.brand-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px var(--space-4) 24px;
}
.brand-logo {
  /* lockup-v 为竖版构图（viewBox 384×428，高>宽）⇒ 定高 88px、宽度按比率自动；
     旧手写 brand-name / brand-slogan 两行已由 lockup 成品取代（08 §3.4） */
  height: 88px;
  width: auto;
  object-fit: contain;
  display: block;
  margin-bottom: var(--space-3);
}
.brand-version {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  letter-spacing: 0.5px;
}
.brand-desc {
  margin: 0 0 var(--space-5);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  line-height: 1.55;
}
.check-btn { max-width: 160px; }

.link-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: var(--space-3);
}
.link {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);

  &:active { opacity: 0.6; }
}
.link-sep {
  margin-left: 6px;
  color: var(--color-text-disabled);
}

.copyright {
  margin: 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border-light);
  text-align: center;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

.version-line {
  margin: var(--space-4) 0 0;
  text-align: center;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
</style>
