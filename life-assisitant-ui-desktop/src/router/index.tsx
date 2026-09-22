import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useUserStore } from '@/stores/user'
import { matchPermission } from '@/utils/permissions'
import MainLayout from '@/layouts/MainLayout'

// Pages
import LoginPage from '@/pages/login'
import HomePage from '@/pages/home'
import TaskPage from '@/pages/task'
import TaskDetailPage from '@/pages/task/detail'
import RecordPage from '@/pages/record'
import StatPage from '@/pages/stat'
import MePage from '@/pages/me'
import MeAnniversariesPage from '@/pages/me/anniversaries'
import MeFinanceCategoriesPage from '@/pages/me/finance-categories'
import MeProfilePage from '@/pages/me/profile'
import MeNotificationsPage from '@/pages/me/notifications'
import MeSecurityPage from '@/pages/me/security'
import MeSyncPage from '@/pages/me/sync'
import MeHelpPage from '@/pages/me/help'
import MeAboutPage from '@/pages/me/about'
import UserPage from '@/pages/user'
import PermissionPage from '@/pages/permission'
import ForbiddenPage from '@/pages/error/403'
import NotFoundPage from '@/pages/error/404'

// Auth guard wrapper
// D-03 权限重构：requiresAdmin（角色硬判）升级为 requiresPermission（权限点驱动，
// admin 直通语义与后端中间件对齐；未传权限点则只校验登录态）
function AuthGuard({
  children,
  requiresPermission,
}: {
  children: React.ReactNode
  requiresPermission?: string | string[]
}) {
  const accessToken = useUserStore((s) => s.accessToken)
  const user = useUserStore((s) => s.user)
  const permissions = useUserStore((s) => s.permissions)
  const isLoggedIn = !!accessToken && !!user

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />
  }

  if (requiresPermission && !matchPermission(user?.role, permissions, requiresPermission)) {
    return <Navigate to="/403" replace />
  }

  return <>{children}</>
}

// Already-logged-in redirect
function LoginRedirect() {
  const isLoggedIn = useUserStore((s) => !!s.accessToken && !!s.user)
  if (isLoggedIn) {
    return <Navigate to="/home" replace />
  }
  return <LoginPage />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginRedirect />,
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <MainLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <HomePage /> },
      { path: 'todo', element: <TaskPage /> },
      { path: 'todo/:id', element: <TaskDetailPage /> },
      { path: 'record', element: <RecordPage /> },
      { path: 'stat', element: <StatPage /> },
      { path: 'me', element: <MePage /> },
      // 纪念日 / 倒数日（spec 06 §3）—— 权限点驱动，与后端 anniversary:view 对齐
      {
        path: 'me/anniversaries',
        element: (
          <AuthGuard requiresPermission="anniversary:view">
            <MeAnniversariesPage />
          </AuthGuard>
        ),
      },
      { path: 'me/profile', element: <MeProfilePage /> },
      // 记账分类管理（spec 05 §2）—— 权限点 finance:view（与选择器同权限）
      {
        path: 'me/finance-categories',
        element: (
          <AuthGuard requiresPermission="finance:view">
            <MeFinanceCategoriesPage />
          </AuthGuard>
        ),
      },
      { path: 'me/notifications', element: <MeNotificationsPage /> },
      { path: 'me/security', element: <MeSecurityPage /> },
      { path: 'me/sync', element: <MeSyncPage /> },
      { path: 'me/help', element: <MeHelpPage /> },
      { path: 'me/about', element: <MeAboutPage /> },
      // 系统管理（D-03：权限点驱动，不再整块绑 admin——
      // 自定义角色勾选 user_mgmt:view / role_mgmt:view 即可进入）
      { path: 'system', element: <Navigate to="/system/user" replace /> },
      {
        path: 'system/user',
        element: (
          <AuthGuard requiresPermission="user_mgmt:view">
            <UserPage />
          </AuthGuard>
        ),
      },
      {
        path: 'system/permission',
        element: (
          <AuthGuard requiresPermission="role_mgmt:view">
            <PermissionPage />
          </AuthGuard>
        ),
      },
    ],
  },
  {
    path: '/403',
    element: <ForbiddenPage />,
  },
  {
    path: '/404',
    element: <NotFoundPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
], {
  // 子路径部署（vite build --base=/z1/）：basename 跟随构建 base；
  // dev 模式 BASE_URL='/' 完全不受影响。缺了它 /z1/ 会落进 '*' → 应用内 404。
  basename: import.meta.env.BASE_URL,
})
