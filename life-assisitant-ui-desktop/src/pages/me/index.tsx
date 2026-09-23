/**
 * Me page (React 18 + TSX) — Personal center
 * M4: refactored to navigate to sub-pages instead of inline SideSheets
 */
import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  Card,
  Tag,
  Toast,
} from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { useUserStore, useDisplayName, useHasPermission } from '@/stores/user'
import UserAvatar from '@/components/UserAvatar'
import { compressAvatar } from '@/utils/avatar'
import { userApi } from '@/api/user'
import { storage } from '@/utils/storage'
import { Icon, TINT_VARS } from '@/components/icon'
import HealthSettingsDrawer from '@/pages/record/components/HealthSettingsDrawer'
import type { IconName, TintName } from '@/components/icon'
import type { RoleCode } from '@/api/types'

interface SettingItem {
  key: string
  icon: ReactNode
  label: string
  sublabel?: string
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
}

/** 角色徽标统一走 --tint-* 语义色（M2），不再散落硬编码 hex */
const roleLabel: Record<RoleCode, { text: string; icon: IconName; tint: TintName }> = {
  admin: { text: '管理员', icon: 'ShieldCheck', tint: 'warning' },
  editor: { text: '编辑者', icon: 'Pencil', tint: 'success' },
  viewer: { text: '查看者', icon: 'Eye', tint: 'accent' },
}

export default function MePage() {
  const userStore = useUserStore()
  const navigate = useNavigate()
  const displayName = useDisplayName()
  /** 健康设置浮层（「我的空间 → 健康设置」不开新页，直接开浮层） */
  const [healthOpen, setHealthOpen] = useState(false)
  /** 纪念日入口按 anniversary:view 显隐（无权限则整项不渲染，与后端权限点一致） */
  const canAnniversary = useHasPermission('anniversary:view')
  /** 记账分类入口按 finance:view 显隐（与分类选择器同权限点） */
  const canFinanceCategory = useHasPermission('finance:view')
  /** 习惯 / 待办分类管理入口按 category:view 显隐（spec-20260922-v2/06 §5 新增权限点） */
  const canUserCategory = useHasPermission('category:view')
  const role = userStore.user?.role
  const rl = role ? roleLabel[role] : roleLabel.viewer

  // D-03 第七轮：换头像入口在个人中心——鼠标移入头像显「点击上传」，选完即传
  const fileRef = useRef<HTMLInputElement>(null)
  const onPickAvatar = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许连续选同一文件
    if (!file) return
    if (!file.type.startsWith('image/')) { Toast.error('请选择图片文件'); return }
    if (file.size > 8 * 1024 * 1024) { Toast.error('图片过大，请选择 8MB 以内的图片'); return }
    try {
      // 第八轮：canvas 压成 256px JPEG File → multipart 上传，DB 只存返回的 /uploads/ URL
      const compressed = await compressAvatar(file)
      const res = await userApi.uploadAvatar(compressed)
      const freshUser = { ...userStore.user!, avatar: res.avatar }
      storage.set('user', freshUser)
      useUserStore.setState({ user: freshUser })
    } catch (err) {
      console.error('[me] 头像更新失败', err)
      if (err instanceof TypeError) Toast.error('图片处理失败，请换一张试试')
    }
  }, [userStore.user])

  // 退出登录入口已收敛到左下角用户卡的快捷面板（components/UserQuickPanel.tsx）：
  // 退出是「会话动作」而不是「偏好设置」，放身份区更顺手，也免得同一动作三个入口三种行为。
  // 「主题设置」同理已从本列表移除，主题快切只在那个面板里（删掉的原因：同一能力两处入口，
  // 而面板里的三档切换更顺手，本页留着只会让两处状态显示可能不一致）。

/**
 * ⚠️ 分组结构（spec 06 §1 / §9）：原来是一整条扁平长列表，找不到东西；
 *    现在按「我的空间 / 偏好 / 数据 / 其他」四组分隔。
 *    分组标题是**分隔符**（小字 + tertiary 色 + 无背景无阴影），不是卡片。
 */
interface SettingGroup {
  key: string
  title: string
  items: SettingItem[]
}

const GROUP_ORDER: ReadonlyArray<{ key: string; title: string }> = [
  { key: 'space', title: '我的空间' },
  { key: 'preference', title: '偏好' },
  { key: 'data', title: '数据' },
  { key: 'other', title: '其他' },
]

  // Build settings list — grouped; each item navigates to its sub-page
  // （除了「健康设置」：它是浮层，不开新页）
  const groups: SettingGroup[] = [
    {
      key: 'space',
      title: '我的空间',
      items: [
        {
          key: 'profile',
          icon: <Icon name="User" size={20} />,
          label: '个人资料',
          sublabel: userStore.user?.email,
          onClick: () => navigate('/me/profile'),
        },
        // 「重要日子」按 anniversary:view 显隐（无权限整项不渲染）
        ...(canAnniversary
          ? [
              {
                key: 'anniversaries',
                icon: <Icon name="Calendar" size={20} />,
                label: '重要日子',
                sublabel: '纪念日 / 倒数日',
                onClick: () => navigate('/me/anniversaries'),
              },
            ]
          : []),
        // 健康设置 —— ⚠️ 直接开浮层，不开新页（与记录页共用同一个 Drawer）。
        // 经期设置已并入这里，个人中心不再有独立的经期入口。
        {
          key: 'health',
          icon: <Icon name="HeartPulse" size={20} />,
          label: '健康设置',
          sublabel: '指标与经期',
          onClick: () => setHealthOpen(true),
        },
      ],
    },
    {
      key: 'preference',
      title: '偏好',
      items: [
        ...(canFinanceCategory
          ? [
              {
                key: 'finance-categories',
                icon: <Icon name="Tags" size={20} />,
                label: '记账分类',
                sublabel: '自定义收支分类',
                onClick: () => navigate('/me/finance-categories'),
              },
            ]
          : []),
        // 习惯 / 待办分类管理（spec-20260922-v2/04 §4.4，与「记账分类」同款形态）
        ...(canUserCategory
          ? [
              {
                key: 'categories',
                icon: <Icon name="FolderOpen" size={20} />,
                label: '分类管理',
                sublabel: '习惯 / 待办分类',
                onClick: () => navigate('/me/categories'),
              },
            ]
          : []),
        {
          key: 'notifications',
          icon: <Icon name="Bell" size={20} />,
          label: '通知设置',
          onClick: () => navigate('/me/notifications'),
        },
      ],
    },
    {
      key: 'data',
      title: '数据',
      items: [
        {
          key: 'sync',
          icon: <Icon name="RefreshCw" size={20} />,
          label: '同步状态',
          sublabel: '查看同步详情',
          onClick: () => navigate('/me/sync'),
        },
      ],
    },
    {
      key: 'other',
      title: '其他',
      items: [
        {
          key: 'password',
          icon: <Icon name="Lock" size={20} />,
          label: '隐私与安全',
          onClick: () => navigate('/me/security'),
        },
        {
          key: 'help',
          icon: <Icon name="HelpCircle" size={20} />,
          label: '帮助与反馈',
          onClick: () => navigate('/me/help'),
        },
        {
          key: 'about',
          icon: <Icon name="Info" size={20} />,
          label: '关于',
          sublabel: 'v1.0.0',
          onClick: () => navigate('/me/about'),
        },
      ],
    },
  ]

  return (
    <div className="me-page">
      {/* Header Card */}
      <div className="header-card">
        <div
          className="avatar-upload"
          role="button"
          tabIndex={0}
          title="点击上传头像"
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
        >
          <UserAvatar
            size="extra-large"
            style={{ backgroundColor: 'var(--color-primary-500)', color: 'white', fontWeight: 700 }}
          />
          <div className="avatar-upload-mask">点击上传</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onPickAvatar}
        />
        <div className="info">
          <h2>{displayName}</h2>
          <div className="meta">
            <Tag style={{ background: TINT_VARS[rl.tint].bg, color: TINT_VARS[rl.tint].fg, border: 'none' }}>
              <Icon name={rl.icon} size={14} style={{ marginRight: 4 }} />{rl.text}
            </Tag>
            <span className="email">{userStore.user?.email}</span>
          </div>
        </div>
      </div>

      {/* Settings List —— 四分组（spec 06 §1） */}
      <Card bordered={false} className="card">
        <div className="settings-list">
          {GROUP_ORDER.map((g) => {
            const group = groups.find((x) => x.key === g.key)
            if (!group || group.items.length === 0) return null
            return (
              <div key={g.key} className="settings-group">
                <div className="settings-group-title">{g.title}</div>
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className={`setting-item${item.danger ? ' danger' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={item.onClick}
                    onKeyDown={(e) => { if (e.key === 'Enter' && item.onClick) item.onClick() }}
                  >
                    <div className="setting-icon">{item.icon}</div>
                    <div className="setting-body">
                      <div className="setting-label">{item.label}</div>
                      {item.sublabel && <div className="setting-sublabel">{item.sublabel}</div>}
                    </div>
                    <div className="setting-right">
                      {item.right || <Icon name="ChevronRight" size={16} className="setting-arrow" />}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </Card>

      {/* 健康设置浮层（与记录页共用同一个组件） */}
      <HealthSettingsDrawer visible={healthOpen} onClose={() => setHealthOpen(false)} />
    </div>
  )
}
