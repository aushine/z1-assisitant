/**
 * Theme Store
 * - 浅色 / 深色 / 跟随系统
 * - 持久化到 localStorage，应用到 <html data-theme="...">
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { storage } from '@/utils/storage'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_KEY = 'theme'

/** 解析 system → light/dark */
function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/**
 * 应用主题到 DOM
 *
 * ⚠️ 必须同时写**两个**开关，缺一不可：
 *   1. `data-theme="dark|light"` —— 本项目自己的 token（styles/tokens.scss 的
 *      `[data-theme='dark']` 块）靠它生效；
 *   2. `van-theme-dark` 类 —— **Vant 4 的暗色模式**用的是这个类名
 *      （官方做法：在 html 上添加 van-theme-dark）。Vant 组件（Tabs / List /
 *      SwipeCell / NavBar / Field / Picker / Dialog …）的暗色 CSS 变量
 *      全部挂在它下面。
 *
 * 只写 data-theme 的后果：自定义 token 变暗了，但所有 Vant 组件仍是白底黑字，
 * 页面会「一半暗一半亮」—— 这是本项目此前真实存在的缺陷（Phase 5 修复）。
 */
/**
 * 与 styles/tokens.scss 的 `--color-bg-app` 对应（读取 CSS 变量失败时的兜底）。
 * 改 tokens.scss 时这里也要同步。
 */
const BG_APP_FALLBACK: Record<'light' | 'dark', string> = {
  light: '#F9F9F9',
  dark: '#0A1628',
}

/**
 * 同步 `<meta name="theme-color">` 到当前主题的**页面底色**。
 *
 * 为什么要同步：iOS 26.1 起 `apple-mobile-web-app-status-bar-style=black-translucent`
 * 对状态栏失效（社区已复现并向 Apple 提了 bug），主屏 Web App 顶部会由系统绘制
 * 一条实色状态栏。那条形色若与页面底色不一致，就会呈现为「莫名的一条白/深色块」。
 * 系统状态栏配色会参考 theme-color，把它对齐到 --color-bg-app，顶部就能与页面连成一片。
 *
 * 桌面/浏览器里这个值只影响地址栏染色，同样无害。
 */
function syncThemeColor(resolved: 'light' | 'dark'): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) return
  // 优先读真实 CSS 变量，避免这里和 tokens.scss 漂移
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-bg-app')
    .trim()
  meta.content = fromCss || BG_APP_FALLBACK[resolved]
}

function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.classList.toggle('van-theme-dark', resolved === 'dark')
  // 让浏览器原生控件（滚动条、输入框、日期选择器）也跟着切换
  root.style.colorScheme = resolved
  syncThemeColor(resolved)
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeMode>((storage.get(THEME_KEY) as ThemeMode) || 'light')

  /** 当前实际生效的主题 */
  function resolved(): 'light' | 'dark' {
    return resolveTheme(theme.value)
  }

  function setTheme(mode: ThemeMode): void {
    theme.value = mode
    storage.set(THEME_KEY, mode)
    applyTheme(mode)
  }

  // 监听系统主题变化（仅 system 模式下生效）
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme.value === 'system') applyTheme('system')
    })
  }

  // 启动时应用
  applyTheme(theme.value)

  return { theme, resolved, setTheme }
})
