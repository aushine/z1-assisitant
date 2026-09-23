/**
 * 路由配置
 * - 路径遵循 spec/02-导航规范.md §5
 * - 守卫遵循 spec/02-导航规范.md §5.2
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserStore } from '@/stores/user'
import {
  ANNIVERSARY_VIEW,
  PERIOD_VIEW,
  PERIOD_WRITE,
  HEALTH_VIEW,
  HEALTH_WRITE,
  ROLE_MGMT_VIEW,
  USER_MGMT_VIEW,
} from '@/utils/permissions'

const routes: RouteRecordRaw[] = [
  // ============ 登录页（无 Layout） ============
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/login/index.vue'),
    meta: {
      title: '登录',
      layout: 'blank',
      requiresAuth: false,
    },
  },

  // ============ 认证相关（公开） ============
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/pages/register/index.vue'),
    meta: { title: '注册', layout: 'blank', requiresAuth: false },
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/pages/forgot-password/index.vue'),
    meta: { title: '忘记密码', layout: 'blank', requiresAuth: false },
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/pages/reset-password/index.vue'),
    meta: { title: '重置密码', layout: 'blank', requiresAuth: false },
  },

  // ============ 受保护的主应用（HomeLayout 包含 5 Tab + 状态栏） ============
  {
    path: '/',
    component: () => import('@/layouts/HomeLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'Home' } },
      { path: 'home', name: 'Home', component: () => import('@/pages/home/index.vue'), meta: { title: '首页', tab: 'home' } },
      { path: 'task', name: 'Task', component: () => import('@/pages/task/index.vue'), meta: { title: '待办', tab: 'task' } },
      // 任务详情（Phase 2.5）：二级页面，隐藏 TabBar
      { path: 'task/:id', name: 'TaskDetail', component: () => import('@/pages/task/detail.vue'), meta: { title: '任务详情', tab: 'task', hideTab: true } },
      {
        path: 'record',
        name: 'Record',
        component: () => import('@/pages/record/index.vue'),
        meta: { title: '记录', tab: 'record' },
        /**
         * 记录模块的**覆盖层子路由**（2026-09-21）。
         *
         * 「记一笔」浮层里的「管理 ›」原先 push 顶层路由 /me/finance-categories，
         * 于是 HomeLayout 与记录页**整体被卸载**：记一笔的草稿、浮层的开合状态
         * 全没了，返回时页面重新挂载 —— 用户看到的是「回到财务了」＋
         * 「选中动画又播了一遍」。
         *
         * 挂成 /record 的子路由后：记录页（父级）保持挂载，只在它上面叠一层
         * 全屏页（见 pages/record/index.vue 的覆盖层）；返回（含 iOS 左滑）
         * 只是弹掉这一层，宿主原样还在。
         *
         * ⚠️ 与 /me/finance-categories 是**同一个页面组件**、两个入口：
         *    从「记录 → 记一笔」进 = 覆盖层（要在返回后回到记一笔）；
         *    从「我的 → 偏好 → 收支分类」进 = 普通二级页（没有宿主要保留）。
         */
        children: [
          {
            path: 'finance-categories',
            name: 'RecordFinanceCategories',
            component: () => import('@/pages/me/finance-categories.vue'),
            meta: {
              title: '收支分类',
              requiresPermission: 'finance:view',
              overlay: true,
            },
          },
        ],
      },
      { path: 'stat', name: 'Stat', component: () => import('@/pages/stat/index.vue'), meta: { title: '统计', tab: 'stat' } },
      { path: 'me', name: 'Me', component: () => import('@/pages/me/index.vue'), meta: { title: '我的', tab: 'me' } },
    ],
  },

  // ============ 我的 · 二级页（顶层路由，全屏、自带返回栏、不带 TabBar） ============
  //
  // ⚠️ 刻意**不**挂在 HomeLayout 下：HomeLayout 的 `.content` 已经是
  //    `overflow-y: auto` 的滚动容器，而二级页自己也有 `.sub-body` 滚动区，
  //    嵌套会产生「双滚动条 + 内层滚不到底」的经典毛病。
  //    放顶层后二级页自己管滚动，同时自行补 env(safe-area-inset-top)（见 subpage.scss）。
  {
    path: '/me/profile',
    name: 'MeProfile',
    component: () => import('@/pages/me/profile.vue'),
    meta: { title: '个人资料', requiresAuth: true },
  },
  {
    path: '/me/theme',
    name: 'MeTheme',
    component: () => import('@/pages/me/theme.vue'),
    meta: { title: '主题设置', requiresAuth: true },
  },
  {
    path: '/me/notifications',
    name: 'MeNotifications',
    component: () => import('@/pages/me/notifications.vue'),
    meta: { title: '通知设置', requiresAuth: true },
  },
  {
    path: '/me/security',
    name: 'MeSecurity',
    component: () => import('@/pages/me/security.vue'),
    meta: { title: '隐私与安全', requiresAuth: true },
  },
  {
    path: '/me/sync',
    name: 'MeSync',
    component: () => import('@/pages/me/sync.vue'),
    meta: { title: '同步状态', requiresAuth: true },
  },
  {
    path: '/me/anniversaries',
    name: 'MeAnniversaries',
    component: () => import('@/pages/me/anniversaries.vue'),
    meta: {
      title: '重要日子',
      requiresAuth: true,
      requiresPermission: ANNIVERSARY_VIEW,
    },
  },
  // 收支分类管理（2026-09-21 分类体系）：查看走 finance:view，增删改由后端 finance:category 收口
  //
  // ⚠️ 这是「我的 → 偏好」那条入口用的**独立二级页**。
  //    记录页「记一笔 → 管理」用的是它的覆盖层版 /record/finance-categories
  //    （同一个组件，理由见上面 record 子路由的注释）。
  {
    path: '/me/finance-categories',
    name: 'MeFinanceCategories',
    component: () => import('@/pages/me/finance-categories.vue'),
    meta: {
      title: '收支分类',
      requiresAuth: true,
      requiresPermission: 'finance:view',
    },
  },
  // ============ 习惯 / 待办分类管理 · 二级页（260922 v2 批次四） ============
  //
  // spec-20260922-v2/04 §4.4：一页两分段（习惯 / 待办），入口有两处 ——
  // 「我的 → 偏好 → 分类管理」与 CategoryTiles 的「管理 ›」（带 ?domain= 预选）。
  {
    path: '/me/categories',
    name: 'MeCategories',
    component: () => import('@/pages/me/categories.vue'),
    meta: {
      title: '分类管理',
      requiresAuth: true,
      requiresPermission: 'category:view',
    },
  },
  {
    path: '/me/help',
    name: 'MeHelp',
    component: () => import('@/pages/me/help.vue'),
    meta: { title: '帮助与反馈', requiresAuth: true },
  },
  {
    path: '/me/about',
    name: 'MeAbout',
    component: () => import('@/pages/me/about.vue'),
    meta: { title: '关于', requiresAuth: true },
  },

  // ============ 账目详情 · 二级页（260921 v2 批次二） ============
  //
  // 顶层路由，理由与 /record/period/* 一致：挂成 HomeLayout 子路由会继承
  // 布局的滚动容器 → 双滚动条。收支列表行 / 日历明细行点击进入。
  {
    path: '/record/tx/:id',
    name: 'TransactionDetail',
    component: () => import('@/pages/record/tx-detail.vue'),
    meta: {
      title: '账目详情',
      requiresAuth: true,
      requiresPermission: 'finance:view',
    },
  },

  // ============ 经期 · 二级页（顶层路由，理由同 /me/*） ============
  //
  // 路径刻意挂在 /record/period/* 下 —— 语义上属于「记录 → 经期」这一支，
  // 但**不能**挂成 HomeLayout 的子路由：那样会继承布局的滚动容器而双滚动条。
  // 放在顶层后二级页自己管滚动（见 subpage.scss 的 .sub-page/.sub-body）。
  //
  // 权限：设置页与经期 Tab **共用** period:view；
  //      设置向导会写数据（POST /period/setup），按 period:write 收口。
  //      「我的 → 经期设置」入口同样按 period:view 显隐，不新增权限点。
  {
    path: '/record/period/settings',
    name: 'PeriodSettings',
    component: () => import('@/pages/record/period/settings.vue'),
    meta: {
      title: '经期设置',
      requiresAuth: true,
      requiresPermission: PERIOD_VIEW,
    },
  },
  {
    path: '/record/period/setup',
    name: 'PeriodSetup',
    component: () => import('@/pages/record/period/setup.vue'),
    meta: {
      title: '设置向导',
      requiresAuth: true,
      requiresPermission: PERIOD_WRITE,
    },
  },

  // ============ 健康 · 二级页（2026-09-19 新增） ============
  //
  // 顶层路由，理由与 /record/period/* 完全一致：挂成 HomeLayout 子路由会
  // 继承布局滚动容器 → 双滚动条。
  //
  // 权限：设置页 health:view（只读展示 + 指标开关，开关本身走 write 接口，
  //      但页面入口按 view 收口，与经期设置页共用 period:view 的做法一致）；
  //      首次引导会 POST /health/setup 落库，按 health:write 收口。
  {
    path: '/record/health/settings',
    name: 'HealthSettings',
    component: () => import('@/pages/record/health/settings.vue'),
    meta: {
      title: '健康设置',
      requiresAuth: true,
      requiresPermission: HEALTH_VIEW,
    },
  },
  {
    path: '/record/health/setup',
    name: 'HealthSetup',
    component: () => import('@/pages/record/health/setup.vue'),
    meta: {
      title: '健康设置向导',
      requiresAuth: true,
      requiresPermission: HEALTH_WRITE,
    },
  },

  // ============ 系统管理（Phase 6，顶层路由，理由同 /me/*） ============
  //
  // ⚠️ hub 页 `/system` **不挂** requiresPermission：
  //    它是两项入口的聚合，自身按 user_mgmt:view / role_mgmt:view 逐项显隐。
  //    若在这里硬挂其中一个，只有另一项权限的账号（如「财务专员」只有
  //    role_mgmt:view）就会被守卫挡在门外，明明有权限却进不去。
  //    真正的访问控制在叶子页 + 后端中间件两处收口。
  {
    path: '/system',
    name: 'System',
    component: () => import('@/pages/system/index.vue'),
    meta: { title: '系统管理', requiresAuth: true },
  },
  {
    path: '/system/users',
    name: 'SystemUsers',
    component: () => import('@/pages/system/users.vue'),
    meta: {
      title: '用户管理',
      requiresAuth: true,
      requiresPermission: USER_MGMT_VIEW,
    },
  },
  {
    path: '/system/permissions',
    name: 'SystemPermissions',
    component: () => import('@/pages/system/permissions.vue'),
    meta: {
      title: '角色与权限',
      requiresAuth: true,
      requiresPermission: ROLE_MGMT_VIEW,
    },
  },

  // ============ 错误页 ============
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/pages/error/403.vue'),
    meta: { title: '无访问权限', requiresAuth: false },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/pages/error/404.vue'),
    meta: { title: '页面未找到', requiresAuth: false },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  },
})

// ==================== 路由守卫 ====================
router.beforeEach((to, _from, next) => {
  const userStore = useUserStore()

  // 1. 文档标题
  const baseTitle = 'Z1 · Zero to One'
  document.title = to.meta.title ? `${to.meta.title} · ${baseTitle}` : baseTitle

  // 2. 登录页守卫：已登录用户访问 /login → 跳首页
  if (to.name === 'Login' && userStore.isLoggedIn) {
    next({ name: 'Home', replace: true })
    return
  }

  // 3. 受保护路由：未登录 → 跳登录（带 redirect）
  if (to.meta.requiresAuth !== false && !userStore.isLoggedIn) {
    next({
      name: 'Login',
      query: { redirect: to.fullPath },
      replace: true,
    })
    return
  }

  // 4. 权限路由判定
  //
  //    D-03 权限重构后，内置角色只剩 admin / user，还有管理员自建的动态角色，
  //    「是不是管理员」不足以表达访问控制 —— 必须按**权限点**判定。
  //    - meta.requiresPermission: 单点或数组（数组语义为「任一命中即通过」）
  //    - meta.requiresAdmin: 旧写法，保留兼容（等价于角色必须为 admin）
  //
  //    判定用 userStore.hasPermission，内部对 admin 走旁路（恒 true），
  //    与后端 `role == model.RoleAdmin` 的直通语义一致。
  const required = to.meta.requiresPermission
  if (required && !userStore.hasPermission(required)) {
    next({ name: 'Forbidden', replace: true })
    return
  }
  if (to.meta.requiresAdmin && !userStore.isAdmin) {
    next({ name: 'Forbidden', replace: true })
    return
  }

  next()
})

export default router
