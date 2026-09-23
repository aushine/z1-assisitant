import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// Vant 4 样式
import 'vant/lib/index.css'
// ⚠️ 05 §3.2 写的 `Toast.setDefaultOptions` 是 Vant 3 API，Vant 4（实装 4.10.2）
// 的同名能力是 `setToastDefaultOptions`，从 vant 直接引入、无副作用（样式已由上方全量 CSS 覆盖）。
import { setToastDefaultOptions } from 'vant'

// 全局样式
import './styles/tokens.scss'
import './styles/reset.scss'
import './styles/global.scss'

import { useThemeStore } from './stores/theme'
import { initSafeArea } from './utils/safe-area'
import { initUploadsBase } from './utils/avatar'

const app = createApp(App)
const pinia = createPinia()

// 反馈规范（05 §3.2）：全局 toast 统一 1.5s、不拦截点击（Vant 默认 2s）
setToastDefaultOptions({ duration: 1500, forbidClick: false })

// Pinia 状态管理
app.use(pinia)

// 路由
app.use(router)

/**
 * 主题初始化（修复 B3）
 *
 * `stores/theme.ts` 的 store 内联了 `applyTheme()`，且含有
 * `matchMedia('(prefers-color-scheme: dark)')` 的监听注册 —— 这些代码
 * **只在 store 被实例化时才执行**。此前 main.ts 从未调用过 `useThemeStore()`，
 * 于是：
 *   1. `document.documentElement.dataset.theme` 永远不会被写入
 *      → `[data-theme='dark']` 的整块 token 是死代码，暗色永远不生效；
 *   2. 系统主题切换的监听也从未注册。
 *
 * 显式传入 `pinia` 实例，使其在**挂载前**执行：首屏渲染就带上正确的
 * data-theme，避免「先按 light 画一帧再翻成 dark」的闪烁。
 */
useThemeStore(pinia)

// 全局错误处理
app.config.errorHandler = (err, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[Global Error]', err, info)
}

// iOS 底部安全区实测：必须在挂载前完成，避免首帧用错补偿值
initSafeArea()

// 上传文件对外基址探测（后端 storage.public_url）：挂载前 await，
// 首屏头像就直接用对地址；内部最多 ~4s 超时且失败静默回落，不会卡死启动
initUploadsBase().finally(() => {
  app.mount('#app')
})
