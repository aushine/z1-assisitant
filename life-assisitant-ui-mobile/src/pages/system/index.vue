<script setup lang="ts">
/**
 * 系统管理 · 入口（移动端 · Phase 6.2）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop 侧边栏「系统管理」分组
 * 最后同步：2026-09-18（Phase 6）
 *
 * 桌面端把「用户管理 / 权限管理」放在侧边栏分组里；移动端没有侧边栏，
 * 因此在「我的」页放一个「系统管理」入口（按 canAccessSystem 显隐），
 * 进来后是这张 hub 卡。
 *
 * ⚠️ 两项入口**各自**按权限点独立显隐，不是「能进系统管理就能看全部」：
 *    用户管理要 user_mgmt:view，权限管理要 role_mgmt:view。
 *    只被授予其中一项的自定义角色（如「用户运营」）不该看见另一项 ——
 *    否则点进去就是 403 页面，是坏体验也是信息泄露（暴露了系统有哪些模块）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { getTint } from '@/utils/tint'
import { ROLE_MGMT_VIEW, USER_MGMT_VIEW } from '@/utils/permissions'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'

const router = useRouter()
const userStore = useUserStore()

interface HubEntry {
  key: string
  /** Lucide 图标名 */
  icon: IconName
  bg: string
  fg: string
  label: string
  desc: string
  path: string
}

const entries = computed<HubEntry[]>(() => {
  const list: HubEntry[] = []

  if (userStore.hasPermission(USER_MGMT_VIEW)) {
    const t = getTint('primary')
    list.push({
      key: 'users',
      icon: 'Users',
      bg: t.bg,
      fg: t.fg,
      label: '用户管理',
      desc: '成员账号、角色分配、启用禁用与删除',
      path: '/system/users',
    })
  }

  if (userStore.hasPermission(ROLE_MGMT_VIEW)) {
    const t = getTint('warning')
    list.push({
      key: 'permissions',
      icon: 'Key',
      bg: t.bg,
      fg: t.fg,
      label: '角色与权限',
      desc: '角色维护与功能权限矩阵',
      path: '/system/permissions',
    })
  }

  return list
})

/** 当前身份展示（让管理员清楚自己是用哪个角色进来的） */
const roleText = computed(() => {
  const role = userStore.user?.role
  if (!role) return '未知'
  if (role === 'admin') return '管理员'
  if (role === 'user') return '普通用户'
  return role
})

function go(path: string): void {
  router.push(path)
}

function goBack(): void {
  router.back()
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goBack">‹</button>
      <span class="sub-title">系统管理</span>
    </header>

    <div class="sub-body">
      <p class="page-tip">
        当前身份：<b>{{ roleText }}</b> · 下列入口按你的实际权限显示
      </p>

      <section v-if="entries.length > 0" class="entry-list">
        <button
          v-for="e in entries"
          :key="e.key"
          class="entry-card"
          type="button"
          @click="go(e.path)"
        >
          <span class="entry-icon" :style="{ background: e.bg, color: e.fg }">
            <Icon :name="e.icon" :size="20" />
          </span>
          <span class="entry-body">
            <span class="entry-label">{{ e.label }}</span>
            <span class="entry-desc">{{ e.desc }}</span>
          </span>
          <span class="entry-arrow">›</span>
        </button>
      </section>

      <!-- 理论上进不来（入口已按权限显隐 + 路由守卫），兜底提示 -->
      <div v-else class="state-empty">
        <Icon name="Lock" :size="32" class="state-icon" />
        <p class="state-text">你没有系统管理相关权限</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.page-tip {
  margin: 0 0 var(--space-3);
  padding: 0 2px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  line-height: 1.5;

  b { color: var(--color-text-secondary); font-weight: 600; }
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.entry-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: var(--space-4);
  border: 0;
  border-radius: var(--radius-xl);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-xs);
  text-align: left;

  &:active { background: var(--color-bg-hover); }
}

.entry-icon {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  line-height: 1;
  /* 图标尺寸由 <Icon :size> 控制，这里不再用 font-size 撑 emoji */
  svg { display: block; }
}

.entry-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.entry-label {
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--color-text-primary);
}
.entry-desc {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.entry-arrow {
  flex-shrink: 0;
  font-size: 20px;
  line-height: 1;
  color: var(--color-text-disabled);
}
</style>
