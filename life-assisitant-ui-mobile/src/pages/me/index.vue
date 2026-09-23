<script setup lang="ts">
/**
 * 我的（移动端 · Phase 5.1 重做）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/index.tsx
 * 最后同步：2026-09-18（Phase 5）
 *
 * 结构对齐桌面端：用户卡（可点头像换）+ 设置项列表（每项进二级页）+ 退出登录。
 *
 * 与桌面端的差异：
 *  1. 桌面端角色徽标写死了 admin/editor/viewer 三档 —— 那是 D-03 权限重构**之前**
 *     的遗留（后端内置角色现在只有 admin / user，editor/viewer 已删除）。
 *     移动端按后端实况只内置 admin/user 两档，自定义角色编码（动态字符串）
 *     原样回显，不再伪造「编辑者 / 查看者」这种不存在的身份。
 *  2. 主题项右侧显示当前生效的主题（读 theme store 而非直接读 localStorage，
 *     'system' 模式要能显示成「跟随系统」而不是解析后的 light/dark）。
 *  3. 「系统管理」入口按权限显隐（Phase 6.2）；桌面端此项在侧边栏，移动端放这里。
 *  4. 「首次登录需改密」提示（pwd_reset_required）—— 后端管理员建号初始密码
 *     123456 会置该标记，桌面端有横幅提示，移动端在此页内联提示。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showFailToast, showToast } from 'vant'
import { useUserStore } from '@/stores/user'
import { useThemeStore } from '@/stores/theme'
import { userApi } from '@/api/user'
import { compressAvatar } from '@/utils/avatar'
import { displayNameOf } from '@/utils/avatar'
import { getTint } from '@/utils/tint'
import { ANNIVERSARY_VIEW, HEALTH_VIEW } from '@/utils/permissions'
import UserAvatar from '@/components/UserAvatar.vue'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'
import type { RoleCode } from '@/api/types'

const router = useRouter()
const userStore = useUserStore()
const themeStore = useThemeStore()

const displayName = computed(() => displayNameOf(userStore.user))

/**
 * 角色徽标：内置 admin / user + 动态自定义角色。
 * 未知编码原样回显（而不是崩掉或伪装成别的角色）。
 */
const roleMeta = computed<{ text: string; tint: ReturnType<typeof getTint> }>(() => {
  const role: RoleCode | undefined = userStore.user?.role
  if (!role) return { text: '游客', tint: getTint('neutral') }
  if (role === 'admin') return { text: '管理员', tint: getTint('warning') }
  if (role === 'user') return { text: '普通用户', tint: getTint('primary') }
  return { text: role, tint: getTint('accent') }
})

// ==================== 主题 ====================
const themeLabel = computed(() => {
  const t = themeStore.theme
  if (t === 'dark') return '深色'
  if (t === 'system') return '跟随系统'
  return '浅色'
})

// ==================== 头像上传 ====================
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function pickAvatar(): void {
  fileInput.value?.click()
}

async function onAvatarChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 允许连续选同一文件
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    showFailToast('请选择图片文件')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    showFailToast('图片过大，请选择 8MB 以内的图片')
    return
  }

  uploading.value = true
  try {
    const compressed = await compressAvatar(file)
    const res = await userApi.uploadAvatar(compressed)
    // 后端只返回 { avatar }，要合并进当前 user 并落库
    userStore.patchUser({ avatar: res.avatar })
  } catch (err) {
    if (err instanceof TypeError) showFailToast('图片处理失败，请换一张试试')
    // ApiError 已在 request.ts 里 toast 过，这里不重复
  } finally {
    uploading.value = false
  }
}

// ==================== 设置项 ====================
interface SettingItem {
  key: string
  icon: IconName
  tint: ReturnType<typeof getTint>
  label: string
  sublabel?: string
  path: string
}

/**
 * ⚠️ 分组结构（spec 06 §1）：原来是一整条扁平长列表，找不到东西；
 *    现在按「我的空间 / 偏好 / 数据 / 其他」四组分隔。
 *    分组标题是**分隔符**（小字 + tertiary 色 + 无背景无阴影），不是卡片。
 */
interface SettingGroup {
  key: string
  title: string
  items: SettingItem[]
}

const settings = computed<SettingGroup[]>(() => {
  const groups: SettingGroup[] = []

  // ── 我的空间 ──
  const space: SettingItem[] = [
    {
      key: 'profile',
      icon: 'User',
      tint: getTint('primary'),
      label: '个人资料',
      sublabel: userStore.user?.email || undefined,
      path: '/me/profile',
    },
  ]
  // 重要日子（纪念日 / 倒数日）—— 纪念日模块的唯一入口
  if (userStore.hasPermission(ANNIVERSARY_VIEW)) {
    space.push({
      key: 'anniversaries',
      icon: 'Calendar',
      tint: getTint('accent'),
      label: '重要日子',
      sublabel: '纪念日 / 倒数日',
      path: '/me/anniversaries',
    })
  }
  // 健康设置 —— ⚠️ 经期设置已并入这里，个人中心不再有独立的经期入口
  // （老大 260919 复核 spec 时指出的偏差：两套经期设置并存）
  if (userStore.hasPermission(HEALTH_VIEW)) {
    space.push({
      key: 'health',
      icon: 'HeartPulse',
      tint: getTint('danger'),
      label: '健康设置',
      sublabel: '指标与经期',
      path: '/record/health/settings',
    })
  }
  groups.push({ key: 'space', title: '我的空间', items: space })

  // ── 偏好 ──
  const preference: SettingItem[] = [
    {
      key: 'theme',
      icon: 'Palette',
      tint: getTint('accent'),
      label: '主题设置',
      sublabel: themeLabel.value,
      path: '/me/theme',
    },
    {
      key: 'notifications',
      icon: 'Bell',
      tint: getTint('warning'),
      label: '通知设置',
      path: '/me/notifications',
    },
    {
      key: 'finance-categories',
      icon: 'PieChart',
      tint: getTint('primary'),
      label: '收支分类',
      sublabel: '管理记账分类',
      path: '/me/finance-categories',
    },
  ]
  // 习惯 / 待办分类管理（spec-20260922-v2/04 §4.4，与「收支分类」同款形态）
  if (userStore.hasPermission('category:view')) {
    preference.push({
      key: 'categories',
      icon: 'FolderOpen',
      tint: getTint('success'),
      label: '分类管理',
      sublabel: '习惯 / 待办分类',
      path: '/me/categories',
    })
  }
  groups.push({ key: 'preference', title: '偏好', items: preference })

  // ── 数据 ──
  groups.push({
    key: 'data',
    title: '数据',
    items: [
      {
        key: 'sync',
        icon: 'RefreshCw',
        tint: getTint('success'),
        label: '同步状态',
        sublabel: '查看同步详情',
        path: '/me/sync',
      },
    ],
  })

  // ── 其他 ──
  const others: SettingItem[] = [
    {
      key: 'security',
      icon: 'Lock',
      tint: getTint('danger'),
      label: '隐私与安全',
      path: '/me/security',
    },
    {
      key: 'help',
      icon: 'MessageCircle',
      tint: getTint('primary'),
      label: '帮助与反馈',
      path: '/me/help',
    },
    {
      key: 'about',
      icon: 'Info',
      tint: getTint('neutral'),
      label: '关于',
      sublabel: 'v1.0.0',
      path: '/me/about',
    },
  ]
  // 系统管理入口：按权限显隐（Phase 6.2），无权限时整项不渲染
  if (userStore.canAccessSystem) {
    others.push({
      key: 'system',
      icon: 'ShieldCheck',
      tint: getTint('warning'),
      label: '系统管理',
      sublabel: '用户与权限',
      path: '/system',
    })
  }
  groups.push({ key: 'other', title: '其他', items: others })

  return groups
})

function go(path: string): void {
  router.push(path)
}

// ==================== 退出 ====================
async function onLogout(): Promise<void> {
  try {
    await showConfirmDialog({
      title: '退出登录',
      message: '确定要退出登录吗？',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    // 取消
    return
  }
  await userStore.logout()
  router.replace({ name: 'Login' })
}

// ==================== 首次改密提示 ====================
function goSecurity(): void {
  router.push('/me/security')
}

// 版本号（与 about 页保持一致，避免两处硬编码漂移）
const APP_VERSION = 'v1.0.0'

function onVersionTap(): void {
  showToast({ message: `Z1 ${APP_VERSION}`, duration: 1200 })
}
</script>

<template>
  <div class="me-page">
    <!-- 顶部栏（我的）已提到 HomeLayout 常驻渲染，
         见 layouts/HomeLayout.vue + composables/usePageChrome.ts -->

    <main class="page-body">
      <!-- ====== 用户卡 ====== -->
      <section class="user-card">
        <button
          class="avatar-btn"
          type="button"
          :disabled="uploading"
          aria-label="更换头像"
          @click="pickAvatar"
        >
          <UserAvatar :user="userStore.user" :size="60" />
          <span class="avatar-mask">
            <span v-if="uploading" class="avatar-mask-text">上传中</span>
            <span v-else class="avatar-mask-text">换头像</span>
          </span>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden-input"
          @change="onAvatarChange"
        />

        <div class="user-info">
          <div class="user-name">{{ displayName }}</div>
          <div class="user-meta">
            <span
              class="role-tag"
              :style="{ background: roleMeta.tint.bg, color: roleMeta.tint.fg }"
            >
              {{ roleMeta.text }}
            </span>
            <span v-if="userStore.user?.email" class="user-email">
              {{ userStore.user.email }}
            </span>
          </div>
          <div v-if="userStore.user?.username" class="user-account">
            @{{ userStore.user.username }}
          </div>
        </div>
      </section>

      <!-- 首次登录改密提示 -->
        <button
          v-if="userStore.user?.pwd_reset_required"
          class="pwd-warn"
          type="button"
          @click="goSecurity"
        >
          <Icon name="AlertTriangle" :size="16" class="pwd-warn-emoji" />
          <span class="pwd-warn-text">当前仍是初始密码，为了账号安全请尽快修改</span>
          <span class="pwd-warn-arrow">›</span>
        </button>

      <!-- ====== 设置项（四分组，spec 06 §1） ====== -->
      <div v-for="g in settings" :key="g.key" class="settings-group">
        <p class="group-title">{{ g.title }}</p>
        <section class="settings-card">
          <button
            v-for="item in g.items"
            :key="item.key"
            class="setting-item"
            type="button"
            @click="go(item.path)"
          >
          <span class="setting-icon" :style="{ background: item.tint.bg }">
            <Icon :name="item.icon" :size="20" :style="{ color: item.tint.fg }" />
          </span>
          <span class="setting-body">
            <span class="setting-label">{{ item.label }}</span>
            <span v-if="item.sublabel" class="setting-sublabel">{{ item.sublabel }}</span>
          </span>
          <span class="setting-arrow">›</span>
        </button>
        </section>
      </div>

      <!-- ====== 退出 ====== -->
      <button class="logout-btn" type="button" @click="onLogout">
        <Icon name="LogOut" :size="20" class="logout-emoji" />
        退出登录
      </button>

      <!-- ====== 版本 ====== -->
      <button class="version" type="button" @click="onVersionTap">
        Z1 · Zero to One {{ APP_VERSION }}
      </button>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.me-page {
  /* ⚠️ 不写 height：高度由 HomeLayout 的 .content 用 flex 直接分配
     （见 HomeLayout .content 注释）。写 height:100% 会与布局层的定位
     方案争抢同一组属性（特异性相同、由 CSS 注入顺序裁决），且依赖
     iOS 上不可靠的百分比解析 → 页面被内容撑高 → .page-body 空转、
     滚动传到根。 */
  background: var(--color-bg-app);
  display: flex;
  flex-direction: column;
}

/* 顶部栏（我的）已由 HomeLayout 的 components/PageHeader.vue 渲染，本页不再自带 */

.page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 滚到两端不把滚动链传给父级，避免 iOS 上整个视口跟着弹动 */
  overscroll-behavior-y: contain;
  /* 底部留白走令牌，与其它页一致（底距 + 胶囊高 + 呼吸位） */
  padding: var(--space-3) var(--space-5) var(--tabbar-reserve, 83px);
}

/* ====== 用户卡 ====== */
.user-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--color-bg-card);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}

.avatar-btn {
  position: relative;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 50%;
  overflow: hidden;
  width: 60px;
  height: 60px;

  &:active .avatar-mask { opacity: 1; }
  &:disabled { opacity: 0.7; }
}
.avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-default);
}
.avatar-mask-text {
  color: #FFFFFF;
  font-size: var(--fs-tab);
  font-weight: 600;
}
.hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.user-info {
  flex: 1;
  min-width: 0;
}
.user-name {
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.role-tag {
  flex-shrink: 0;
  display: inline-block;
  font-size: var(--fs-micro);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  line-height: 1.5;
}
.user-email {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-account {
  margin-top: 4px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}

/* ====== 改密提示 ====== */
.pwd-warn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px var(--space-4);
  margin-bottom: var(--space-3);
  border: 0;
  border-radius: var(--radius-xl);
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
  text-align: left;

  &:active { opacity: 0.85; }
}
.pwd-warn-emoji { flex-shrink: 0; }
.pwd-warn-text {
  flex: 1;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  line-height: 1.4;
}
.pwd-warn-arrow {
  flex-shrink: 0;
  font-size: 18px;
  opacity: 0.7;
}

/* ====== 设置分组 ====== */
/* ⚠️ 分组标题是**分隔符**：小字 + tertiary 色 + 无背景无阴影。
   不要给它加卡片阴影 —— 那样它看起来像一条可点的设置项。 */
.settings-group { margin-bottom: var(--space-3); }
.group-title {
  margin: 0 0 6px var(--space-2);
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: 0.2px;
}

.settings-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.setting-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px var(--space-4);
  border: 0;
  background: transparent;
  text-align: left;

  & + .setting-item { border-top: 1px solid var(--color-border-light); }
  &:active { background: var(--color-bg-hover); }
}
.setting-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-base);
  line-height: 1;
  :deep(svg) { display: block; }
}
.setting-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.setting-label {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}
.setting-sublabel {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.setting-arrow {
  flex-shrink: 0;
  font-size: 20px;
  color: var(--color-text-disabled);
  line-height: 1;
}

/* ====== 退出 ====== */
.logout-btn {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--color-bg-card);
  color: var(--color-danger);
  font-size: var(--fs-body);
  font-weight: 600;
  border-radius: var(--radius-xl);
  border: 0;
  box-shadow: var(--shadow-xs);
  transition: all var(--duration-fast);

  &:active {
    transform: scale(0.98);
    background: var(--color-danger-light);
  }
}
.logout-emoji { display: inline-flex; }

.version {
  width: 100%;
  margin-top: var(--space-5);
  border: 0;
  background: transparent;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 8px 0;
}
</style>
