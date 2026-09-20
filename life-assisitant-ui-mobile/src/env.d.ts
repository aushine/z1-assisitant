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
    /** 需要的权限点，数组语义为「任一命中即通过」 */
    requiresPermission?: string | readonly string[]
    /** @deprecated 用 requiresPermission；等价于「角色必须是 admin」 */
    requiresAdmin?: boolean
  }
}

export {}
