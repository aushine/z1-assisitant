import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// Vant 4 样式
import 'vant/lib/index.css'

// 全局样式
import './styles/tokens.scss'
import './styles/reset.scss'
import './styles/global.scss'

import { useThemeStore } from './stores/theme'
import { initSafeArea } from './utils/safe-area'

const app = createApp(App)
const pinia = createPinia()

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

app.mount('#app')
