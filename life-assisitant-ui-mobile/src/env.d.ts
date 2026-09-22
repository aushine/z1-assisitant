/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_APP_TITLE: string
  readonly VITE_USE_MOCK: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * 路由 meta 增强（vue-router 4 官方推荐写法）。
 *
 * 不声明的话 `to.meta.xxx` 取到的是 `unknown`，守卫里就得处处 `as`，
 * 而且拼错字段名（如 requiresAdmin → requireAdmin）TS 不会报错，
 * 表现为「守卫静默不生效」——这正是最难查的一类路由 bug。
 *
 * ⚠️ 文件末尾的 `export {}` 是**必需**的：
 *    本文件若没有任何顶层 import/export，TS 会把它当成**全局脚本**，
 *    此时 `declare module 'vue-router'` 被解释为「声明一个叫 vue-router 的
 *    环境模块」——即**整体覆盖**掉真实的 vue-router 类型，于是
 *    createRouter / useRouter / RouteRecordRaw 全部「不存在」。
 *    加上 export 后本文件成为模块，`declare module` 才是**模块增强**。
 */
declare module 'vue-router' {
  interface RouteMeta {
    /** 文档标题（会拼成 `{title} · Z1 · Zero to One`） */
    title?: string
    /** 'blank' 表示不使用 HomeLayout */
    layout?: string
    /** 是否需要登录（默认 true；显式 false 才公开） */
    requiresAuth?: boolean
    /** 所属底部 Tab（用于 TabBar 高亮） */
    tab?: string
    /** 二级页面：隐藏底部 TabBar（且不留出它的高度） */
    hideTab?: boolean
    /**
     * 覆盖层子路由：**不离开当前模块**，在宿主页面之上叠一层全屏页。
     *
     * 与普通二级页（/me/* 那种顶层路由）的区别是宿主页面**保持挂载**：
     * 返回时页面不重建、浮层不重开、滚动位置与表单草稿都还在。
     * 例：记录页的「记一笔」里点「管理」进分类管理页，返回要回到记一笔
     * （见 router/index.ts 的 /record/finance-categories 与
     *  pages/record/index.vue 的覆盖层渲染）。
     */
    overlay?: boolean
    /** 需要的权限点，数组语义为「任一命中即通过」 */
    requiresPermission?: string | readonly string[]
    /** @deprecated 用 requiresPermission；等价于「角色必须是 admin」 */
    requiresAdmin?: boolean
  }
}

export {}
