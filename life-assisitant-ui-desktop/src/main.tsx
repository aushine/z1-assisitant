import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useUserStore } from './stores/user'
import { bindRequestHelpers } from './api/request'

// Semi Design global styles
import '@douyinfe/semi-ui/lib/es/_base/base.css'

// Custom styles
// 顺序即优先级：tokens.scss 是唯一的令牌来源（A01/A04 已合并 design-tokens.css）
import './styles/reset.scss'
import './styles/tokens.scss'
import './styles/semi-theme.scss'
import './styles/semi-overrides.css'
import './styles/global.scss'
import './styles/layout.scss'
import './styles/login.scss'
import './styles/home.scss'
import './styles/drawers.scss'
import './styles/pages.scss'
import './styles/settings.scss'
import './styles/stat.scss'

// Inject axios interceptors
bindRequestHelpers({
  getUserStore: () => useUserStore.getState(),
  routerPush: (path) => {
    // Programmatic navigation via router
    router.navigate(path)
  },
})

// Global error handler
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
