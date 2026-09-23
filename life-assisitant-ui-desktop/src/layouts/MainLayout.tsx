/**
 * Desktop main layout: left Sidebar (260px) + right Main (flex: 1)
 * Right Main = HeaderBar (80px) + <Outlet />
 */
import { useMemo, useEffect, useState, useCallback } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Tag, Badge, Button, Modal, Popover } from '@douyinfe/semi-ui'
import UserAvatar from '@/components/UserAvatar'
import UserQuickPanel from '@/components/UserQuickPanel'
import { Icon } from '@/components/icon'
import type { IconName } from '@/components/icon'
import { useUserStore, useIsAdmin, useIsLoggedIn, useDisplayName, useHasPermission } from '@/stores/user'
import { matchPermission } from '@/utils/permissions'
import { useNotificationStore } from '@/stores/notification'
import { useThemeStore } from '@/stores/theme'
import '@/styles/reset.scss'
import '@/styles/global.scss'

interface NavItem {
  name: string
  label: string
  path: string
  icon: IconName
  /** D-03：入口所需权限点（缺省 = 登录即可见；admin 直通语义在 matchPermission 内） */
  perm?: string
}

interface NavGroup {
  title: string
  items: NavItem[]
}

/** 内置角色中文名；自定义角色 fallback 显示编码（角色名在权限管理页可见） */
const roleLabel: Record<string, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '查看者',
  user: '用户',
}

export default function MainLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const userStore = useUserStore()
  const isAdmin = useIsAdmin()
  const isLoggedIn = useIsLoggedIn()
  const displayName = useDisplayName()
  const notifications = useNotificationStore()
  const canViewNotifications = useHasPermission('notification:view')
  const role = userStore.user?.role
  const permissions = userStore.permissions
  // 左下用户卡的快捷面板开合（受控：面板内跳转后需要主动收起浮层）
  const [userPanelOpen, setUserPanelOpen] = useState(false)

  // 08 §3.3 / D35：暗色主题下 z1-mark 的深蓝「1」会沉进深色侧栏 ⇒ logo 按主题切 src。
  // 主题状态源 = stores/theme.ts（zustand；'system' 的解析方式与 applyTheme 保持一致）。
  const theme = useThemeStore((s) => s.theme)
  const isDarkTheme =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // D-03：无 notification:view 时不拉未读数（避免 403001 噪声）
  useEffect(() => {
    if (canViewNotifications) notifications.fetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewNotifications])

  // 进主界面时用 GET /auth/me 校准本地缓存的用户资料（含 avatar）。
  // 此前 fetchCurrentUser 定义了却没有任何调用点 → user 永远是「登录那一刻」的
  // localStorage 快照，服务端改过头像/姓名后个人中心与左下角不会更新，
  // 于是与用户管理列表（每次实时 GET /users）出现不一致，看着像「假象」。
  useEffect(() => {
    if (!isLoggedIn) return
    useUserStore.getState().fetchCurrentUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  // D-03 第六轮：管理员代建用户持统一初始密码首次登录 → 提示去安全页改密。
  // 每次进应用只提一次（关掉不打扰；下次登录仍会提示，直到改密成功标记清零）。
  useEffect(() => {
    if (userStore.user?.pwd_reset_required) {
      Modal.warning({
        title: '请修改初始密码',
        content: '当前密码为管理员代建的初始密码，为了账号安全，请设置新密码后再使用。',
        okText: '去修改密码',
        onOk: () => navigate('/me/security'),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navGroups: NavGroup[] = useMemo(
    () => [
      {
        title: '个人功能',
        items: [
          { name: 'Home', label: '首页', path: '/home', icon: 'Home' },
          { name: 'Todo', label: '待办', path: '/todo', icon: 'ListChecks' },
          { name: 'Record', label: '记录', path: '/record', icon: 'BookOpen' },
          { name: 'Stat', label: '统计', path: '/stat', icon: 'BarChart3' },
          { name: 'Me', label: '我的', path: '/me', icon: 'User' },
        ],
      },
      {
        title: '系统管理',
        items: [
          { name: 'UserMgmt', label: '用户管理', path: '/system/user', icon: 'Users', perm: 'user_mgmt:view' },
          { name: 'PermissionMgmt', label: '权限管理', path: '/system/permission', icon: 'ShieldCheck', perm: 'role_mgmt:view' },
        ],
      },
    ],
    []
  )

  // D-03：菜单可见性由权限点驱动（admin 直通），不再是「整块仅管理员」
  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((g) => ({
          ...g,
          items: g.items.filter((it) => matchPermission(role, permissions, it.perm ?? [])),
        }))
        .filter((g) => g.items.length > 0),
    [navGroups, role, permissions]
  )

  // Map route name to path for active detection
  // （键必须与 navGroups item.name 完全一致——曾写 'Task' 而导航项叫 'Todo'，
  //   导致「待办」是唯一没有选中高亮的菜单项）
  const routeNameMap: Record<string, string> = {
    Home: '/home',
    Todo: '/todo',
    Record: '/record',
    Stat: '/stat',
    Me: '/me',
    UserMgmt: '/system/user',
    PermissionMgmt: '/system/permission',
  }

  // Get current route name from path
  const currentPath = location.pathname
  const currentName = useMemo(() => {
    for (const [name, path] of Object.entries(routeNameMap)) {
      if (currentPath === path || currentPath.startsWith(path + '/')) {
        return name
      }
    }
    return ''
  }, [currentPath])

  function go(path: string) {
    if (currentPath === path) return
    navigate(path)
  }

  // 顶栏退出：与左下用户卡面板里的退出同一条链路（Modal.confirm → userStore.logout
  // → 服务端真撤销 refresh_token），两处入口行为保持一致。
  const onLogout = useCallback(() => {
    Modal.confirm({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      okText: '退出',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await userStore.logout()
        navigate('/login')
      },
    })
  }, [userStore, navigate])

  // Header data - derive from route (prefix matching for dynamic routes)
  const pageTitle = useMemo(() => {
    const exact: Record<string, string> = {
      '/home': '首页',
      '/todo': '待办',
      '/record': '记录',
      '/stat': '统计',
      '/me': '我的',
      '/system/user': '用户管理',
      '/system/permission': '权限管理',
    }
    if (exact[currentPath]) return exact[currentPath]
    // Dynamic / task detail
    if (currentPath.startsWith('/todo/')) return '待办详情'
    // /me sub-pages
    const mePages: Record<string, string> = {
      '/me/profile': '个人资料',
      '/me/notifications': '通知中心',
      '/me/security': '安全设置',
      '/me/sync': '数据同步',
      '/me/help': '帮助中心',
      '/me/about': '关于',
    }
    if (mePages[currentPath]) return mePages[currentPath]
    if (currentPath.startsWith('/me/')) return '我的'
    return ''
  }, [currentPath])

  const pageSubtitle = useMemo(() => {
    const exact: Record<string, string> = {
      // D-03 第六轮：一律「操作说明」句式（对齐用户/权限管理基准），
      // 不再复述导航标题（旧「待办 + 日程管理」与标题「待办」同义反复）
      '/home': '快速查看今日待办、打卡与收支',
      '/todo': '新建、完成与批量管理任务和日程',
      '/record': '习惯打卡与收支记账都在这里',
      '/stat': '按周期复盘趋势并导出数据',
      '/me': '资料、通知、安全与同步设置',
      '/system/user': '系统成员与状态',
      '/system/permission': '角色与权限矩阵',
    }
    if (exact[currentPath]) return exact[currentPath]
    if (currentPath.startsWith('/todo/')) return '查看任务详情与子任务'
    const meSubtitles: Record<string, string> = {
      '/me/profile': '管理个人信息',
      '/me/notifications': '查看通知与消息',
      '/me/security': '密码与登录安全',
      '/me/sync': '数据备份与恢复',
      '/me/help': '常见问题与指引',
      '/me/about': '版本与团队信息',
    }
    if (meSubtitles[currentPath]) return meSubtitles[currentPath]
    if (currentPath.startsWith('/me/')) return '个人中心'
    return ''
  }, [currentPath])

  const userRole = role

  return (
    <div className="layout">
      {/* ====== Left Sidebar ====== */}
      <aside className="sidebar">
        <div className="logo">
          {/* 08 §3.3：侧栏半透明白底 ⇒ 浅底用无底 mark；暗色切 -white（isDarkTheme，D35）。
              ⚠️ 原手写 <span className="logo-text">Z1</span> 已删 —— mark 内已含 Z1 字形，
              并存即「两个 Z1」（v3 规范 §5.6 禁止） */}
          <img
            src={`${import.meta.env.BASE_URL}brand/${isDarkTheme ? 'z1-mark-white.svg' : 'z1-mark.svg'}`}
            alt="Z1"
            className="logo-square"
          />
        </div>

        <nav className="nav">
          {visibleGroups.map((group) => (
            <div key={group.title} className="nav-group">
              <div className="group-title">{group.title}</div>
              {group.items.map((item) => (
                <div
                  key={item.name}
                  className={`nav-item${currentName === item.name ? ' active' : ''}`}
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => go(item.path)}
                  onKeyDown={(e) => { if (e.key === 'Enter') go(item.path) }}
                >
                  <Icon name={item.icon} className="nav-icon" size={20} />
                  <span className="nav-label">{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* 悬停触发、向上展开：面板贴着侧栏底部的用户卡出现在其上方，不遮右侧内容区。
            两个 delay 单位是**毫秒**（Semi 默认仅 50ms，见 semi-foundation constants.js），
            所以必须显式给足 —— 卡片到面板之间有约 8px 空隙，鼠标穿过时不能被判成
            「离开」把面板收掉（Semi 会在 portal 上重绑 mouseEnter 取消隐藏，
            所以 300ms 足够穿过空隙、又不会让关闭显得迟钝）。 */}
        {isLoggedIn && (
          <Popover
            trigger="hover"
            position="topLeft"
            mouseEnterDelay={80}
            mouseLeaveDelay={300}
            visible={userPanelOpen}
            onVisibleChange={setUserPanelOpen}
            content={
              <UserQuickPanel
                onNavigate={(path) => {
                  setUserPanelOpen(false)
                  navigate(path)
                }}
              />
            }
          >
            <div className="user-card" aria-haspopup="menu" aria-expanded={userPanelOpen}>
              <UserAvatar size="small" />
              <div className="user-info">
                <div className="user-name">{displayName}</div>
                {userRole && (
                  <div className="user-role">{roleLabel[userRole] ?? userRole}</div>
                )}
              </div>
            </div>
          </Popover>
        )}
      </aside>

      {/* ====== Right Main ====== */}
      <main className="main">
        <header className="header">
          <div className="header-left">
            <h2 className="header-title">{pageTitle}</h2>
            {pageSubtitle && <p className="header-subtitle">{pageSubtitle}</p>}
          </div>
          <div className="header-right">
            {/* Notification bell（D-03：notification:view 权限点控制） */}
            {canViewNotifications && (
              <Badge count={notifications.unread} dot={notifications.unread > 0 && notifications.unread <= 9} overflowCount={9}>
                <Button
                  theme="borderless"
                  type="tertiary"
                  icon={<Icon name="Bell" size={20} />}
                  onClick={() => navigate('/me/notifications')}
                />
              </Badge>
            )}

            {isAdmin && (
              <Tag
                color="amber"
                size="large"
                style={{ background: '#FEF3C7', color: '#B45309', border: 'none' }}
              >
                <Icon name="ShieldCheck" size={16} style={{ marginRight: 4 }} />
                管理员
              </Tag>
            )}
            {/* 退出登录：顶栏快捷图标 + 左下用户卡面板，共两处（用户要求保留顶栏这个）。
                这里保持「图标 + Modal.confirm」—— 顶栏图标位误点成本高，必须有二次确认；
                面板危险区那处同样带确认，两处行为一致。 */}
            <Button
              theme="borderless"
              type="danger"
              icon={<Icon name="LogOut" size={20} />}
              aria-label="退出登录"
              onClick={onLogout}
            />
          </div>
        </header>

        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
