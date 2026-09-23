/**
 * UserQuickPanel —— 悬停左下角用户卡时、在其上方展开的「身份 / 会话」浮层（D-03 第九轮）
 *
 * 边界划分：**身份区 vs 设置区**
 *   本面板 = 我是谁 + 今天怎么样 + 当前会话与设备 + 怎么离开 + 主题快切
 *   「我的」页 = 各项设置的完整入口（个人资料 / 通知 / 安全 / 同步 / 帮助 / 关于）
 * 所以：
 *   退出登录只在这里 + 顶栏图标出现（「我的」页那个大红块按钮已撤掉）；
 *   主题切换只在这里出现（「我的」页的「主题设置」条目已撤掉）；
 *   面板里不放跳向「我的」页其它子页的入口 —— 那是个人中心的事。
 *
 * 第十一轮加的四块（都插在「同步状态」上下，不新增跳转入口）：
 *   ① 上次登录：时间 / 设备 / IP —— 后端 /auth/me 一直在返回，原先前端只是没显示
 *   ② 今日简报：还剩几项待办 + 习惯打卡进度（GET /home，需 home:view）
 *   ③ 心情快记：5 档就地选（PUT /moods，需 mood:view + mood:write）
 *   ④ 登录设备：二级视图，列出活跃会话并可单独退出（GET/DELETE /auth/sessions）
 *
 * 权限处理：能拿数据的块按权限点显隐，没权限的用户根本看不到，
 * 而不是渲染出来点了报 403001。登录设备走会话生命周期路由（后端不挂权限点），
 * 任何登录用户都能看见并管理自己的设备。
 *
 * 为什么同步状态只读、不放「立即同步」按钮：
 *   POST /sync 挂了 home:sync 权限点，GET /sync/status 没有（后端 router.go 注释
 *   写明「属会话诊断，保持开放」）。放按钮就得再套一层权限判断，不如点状态行
 *   直接跳 /me/sync，那边本来就有按钮。
 */
import { useCallback, useEffect, useState } from 'react'
import { Modal, Tag, Toast } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import UserAvatar from '@/components/UserAvatar'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { useUserStore, useDisplayName, useHasPermission } from '@/stores/user'
import { useSyncStore } from '@/stores/sync'
import { useThemeStore } from '@/stores/theme'
import { useMoodStore } from '@/stores/mood'
import { homeApi } from '@/api/home'
import { authApi } from '@/api/auth'
import { storage } from '@/utils/storage'
import { formatRelativeTime } from '@/utils/datetime'
import { moodOptions, MOOD_VALUES_ASC, MOOD_META } from '@/utils/mood-dict'
import type { HomeKPI, MoodValue, SessionInfo } from '@/api/types'

/** 角色徽标：与「我的」页同一套 tint 语义色（RoleCode 是 string，故按 string 索引兜底） */
const roleLabel: Record<string, { text: string; icon: IconName; tint: TintName }> = {
  admin: { text: '管理员', icon: 'ShieldCheck', tint: 'warning' },
  editor: { text: '编辑者', icon: 'Pencil', tint: 'success' },
  viewer: { text: '查看者', icon: 'Eye', tint: 'accent' },
}

const THEME_OPTIONS: { key: 'light' | 'dark' | 'system'; icon: IconName; label: string }[] = [
  { key: 'light', icon: 'Sun', label: '浅色' },
  { key: 'dark', icon: 'Moon', label: '深色' },
  { key: 'system', icon: 'RefreshCw', label: '跟随系统' },
]

/** 后端 guessDevice 只回 desktop / mobile 两个值 */
const PLATFORM_LABEL: Record<string, string> = { desktop: '桌面端', mobile: '移动端' }

/** 面板内两屏：主视图 / 登录设备 */
type PanelView = 'main' | 'sessions'

type SyncTone = 'ok' | 'warn' | 'err' | 'idle'

export default function UserQuickPanel({ onNavigate }: {
  /** 面板内跳转：由父级负责收起浮层 */
  onNavigate: (path: string) => void
}) {
  const navigate = useNavigate()
  const userStore = useUserStore()
  const displayName = useDisplayName()
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const syncLoading = useSyncStore((s) => s.loading)
  const syncError = useSyncStore((s) => s.error)
  const syncStatus = useSyncStore((s) => s.status)
  const moodToday = useMoodStore((s) => s.current)
  const moodSaving = useMoodStore((s) => s.saving)

  const canViewHome = useHasPermission('home:view')
  const canViewMood = useHasPermission('mood:view')
  const canWriteMood = useHasPermission('mood:write')

  const [view, setView] = useState<PanelView>('main')
  const [kpi, setKpi] = useState<HomeKPI | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // 当前设备的 device_id（与 api/request.ts、stores/user.ts 写的是同一个 localStorage key）
  const currentDeviceId = storage.getString('device_id') ?? ''

  // 打开面板时校准：同步状态 / 今日简报 / 今日心情
  // （不轮询：这些都是「打开看一眼」的诊断信息，不是实时指标）
  useEffect(() => {
    useSyncStore.getState().fetch()
    if (canViewHome) {
      homeApi.fetch().then((r) => setKpi(r.kpi)).catch(() => setKpi(null))
    }
    if (canViewMood) {
      useMoodStore.getState().fetchToday()
    }
  }, [canViewHome, canViewMood])

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await authApi.listSessions()
      setSessions(res.items ?? [])
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  // 设备列表只在切到设备视图时才拉：主视图用不到，省一次请求
  useEffect(() => {
    if (view === 'sessions') loadSessions()
  }, [view, loadSessions])

  // 状态文案：error 优先于「已同步」，否则断网会显示成绿灯（store.error 的用途）
  const syncView: { tone: SyncTone; text: string } = (() => {
    if (syncLoading) return { tone: 'idle', text: '检查中…' }
    if (syncError) return { tone: 'err', text: '状态未知' }
    if (syncStatus.status === 'error') return { tone: 'err', text: '同步失败' }
    if (syncStatus.status === 'syncing') return { tone: 'idle', text: '同步中…' }
    if (syncStatus.pending > 0) return { tone: 'warn', text: `${syncStatus.pending} 条待同步` }
    if (!syncStatus.lastSyncAt) return { tone: 'idle', text: '尚未同步' }
    return { tone: 'ok', text: `已同步 · ${formatRelativeTime(syncStatus.lastSyncAt)}` }
  })()

  // 上次登录（后端 /auth/me 的 last_login_* —— 登录时写入 users 表）
  const lastLoginAt = userStore.user?.last_login_at
  const lastLoginDevice = userStore.user?.last_login_device
  const lastLoginIp = userStore.user?.last_login_ip
  const lastLoginText = lastLoginAt
    ? `${lastLoginDevice ? (PLATFORM_LABEL[lastLoginDevice] ?? lastLoginDevice) + ' · ' : ''}${formatRelativeTime(lastLoginAt)}`
    : ''

  // 今日简报。待办分子写「已完成/总数」而不是又算一次「还剩」——
  // 一行里混两种口径最容易看成同一个数。
  const brief = kpi
    ? {
        todo: kpi.todo_total === 0
          ? '今天没有待办'
          : kpi.todo_done >= kpi.todo_total
            ? `待办 ${kpi.todo_done}/${kpi.todo_total} · 全部完成`
            : `待办 ${kpi.todo_done}/${kpi.todo_total}`,
        habit: kpi.habit_total === 0
          ? '暂无习惯'
          : `习惯 ${kpi.habit_done}/${kpi.habit_total} 已打卡`,
      }
    : null

  const role = userStore.user?.role
  const rl = (role && roleLabel[role]) || roleLabel.viewer

  const onPickMood = useCallback(
    async (v: MoodValue) => {
      if (moodSaving) return
      // 新契约是按小时记录 + 三态语义：只发 mood 一个字段，energy / note 不会被碰；
      // 再点当前已选中的同一个值 = 显式发 0（这一小时不再单独记，显示回落到延续值）。
      const cur = useMoodStore.getState().current?.mood ?? 0
      await useMoodStore.getState().setMood(cur === v ? 0 : v)
    },
    [moodSaving],
  )

  const onRevoke = useCallback((s: SessionInfo) => {
    const label = PLATFORM_LABEL[s.platform] ?? s.platform
    const isSelf = !!currentDeviceId && s.device_id === currentDeviceId
    Modal.confirm({
      title: '退出该设备',
      content: isSelf
        ? '这就是你当前使用的设备，退出后需要重新登录。'
        : `将撤销「${label}${s.ip ? ' · ' + s.ip : ''}」的登录状态，该设备需要重新登录。`,
      okText: '退出该设备',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        setRevokingId(s.id)
        try {
          await authApi.revokeSession(s.id)
          if (isSelf) {
            // 把自己脚下的会话撤了，本地凭据也别留
            useUserStore.getState().resetLocal()
            navigate('/login')
            return
          }
          await loadSessions()
        } catch {
          Toast.error('操作失败，请稍后重试')
        } finally {
          setRevokingId(null)
        }
      },
    })
  }, [currentDeviceId, loadSessions, navigate])

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

  const onLogoutAll = useCallback(() => {
    Modal.confirm({
      title: '退出所有设备',
      content: '将撤销该账号在所有设备上的登录状态（含移动端），其它设备需要重新登录。',
      okText: '全部退出',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await userStore.logoutAllDevices()
        navigate('/login')
      },
    })
  }, [userStore, navigate])

  // ===== 设备视图 =====
  if (view === 'sessions') {
    return (
      <div className="user-panel">
        <div className="user-panel__backbar">
          <button type="button" className="user-panel__back" onClick={() => setView('main')}>
            <span className="user-panel__back-glyph">‹</span>登录设备
          </button>
        </div>
        <div className="user-panel__divider" />
        {sessionsLoading ? (
          <div className="user-panel__empty">读取中…</div>
        ) : sessions.length === 0 ? (
          <div className="user-panel__empty">没有活跃的登录设备</div>
        ) : (
          <div className="user-panel__sessions">
            {sessions.map((s) => {
              const isSelf = !!currentDeviceId && s.device_id === currentDeviceId
              return (
                <div key={s.id} className="user-panel__session">
                  <div className="user-panel__session-info">
                    <div className="user-panel__session-top">
                      <span className="user-panel__session-name">
                        {PLATFORM_LABEL[s.platform] ?? s.platform}
                      </span>
                      {isSelf && (
                        <span className="user-panel__self-tag">当前</span>
                      )}
                    </div>
                    <div className="user-panel__session-meta">
                      {s.ip ? `${s.ip} · ` : ''}{formatRelativeTime(s.login_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="user-panel__revoke"
                    disabled={revokingId === s.id}
                    onClick={() => onRevoke(s)}
                  >
                    {revokingId === s.id ? '退出中' : '退出'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="user-panel__divider" />
        <div className="user-panel__hint">
          退出某台设备会撤销它的登录凭证，该设备需重新登录；改密码会让所有设备都失效。
        </div>
      </div>
    )
  }

  // ===== 主视图 =====
  return (
    <div className="user-panel">
      {/* 账号概要 + 上次登录 */}
      <div className="user-panel__head">
        <UserAvatar size="medium" />
        <div className="user-panel__meta">
          <div className="user-panel__name" title={displayName}>{displayName}</div>
          <div className="user-panel__sub">
            <Tag
              size="small"
              style={{ background: TINT_VARS[rl.tint].bg, color: TINT_VARS[rl.tint].fg, border: 'none' }}
            >
              <Icon name={rl.icon} size={14} style={{ marginRight: 4 }} />{rl.text}
            </Tag>
            <span className="user-panel__email" title={userStore.user?.email}>
              {userStore.user?.email}
            </span>
          </div>
          {lastLoginText && (
            <div
              className="user-panel__lastlogin"
              title={lastLoginIp ? `来源 IP ${lastLoginIp}` : undefined}
            >
              上次登录 {lastLoginText}
            </div>
          )}
        </div>
      </div>

      <div className="user-panel__divider" />

      {/* 今日简报（home:view） */}
      {canViewHome && brief && (
        <>
          <div
            className="user-panel__row"
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('/home')}
            onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('/home') }}
          >
            <Icon name="ListChecks" size={20} className="user-panel__row-icon" />
            <div className="user-panel__row-stack">
              <span className="user-panel__row-label">{brief.todo}</span>
              <span className="user-panel__row-sub">{brief.habit}</span>
            </div>
            <Icon name="ChevronRight" size={16} className="user-panel__arrow" />
          </div>
          <div className="user-panel__divider" />
        </>
      )}

      {/* 心情快记（mood:view + mood:write） */}
      {canViewMood && (
        <>
          <div className="user-panel__section">
            <div className="user-panel__section-title">
              {/* mood 为 0 = 今天还没有心情值（延续也没延续到），不显示标签 */}
              今天心情{moodToday?.mood ? ` · ${MOOD_META[moodToday.mood].label}` : ''}
            </div>
            <div className="user-panel__moods" role="group" aria-label="今日心情">
              {moodOptions(MOOD_VALUES_ASC).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`user-panel__mood${moodToday?.mood === o.value ? ' active' : ''}`}
                  style={moodToday?.mood === o.value
                    ? { background: TINT_VARS[o.tint].bg, color: TINT_VARS[o.tint].fg, borderColor: TINT_VARS[o.tint].fg }
                    : undefined}
                  title={o.label}
                  disabled={!canWriteMood || moodSaving}
                  onClick={() => onPickMood(o.value)}
                >
                  <Icon name={o.icon} size={18} />
                </button>
              ))}
            </div>
          </div>
          <div className="user-panel__divider" />
        </>
      )}

      {/* 同步状态 + 登录设备（只读状态行，点击进各自详情） */}
      <div
        className="user-panel__row"
        role="button"
        tabIndex={0}
        onClick={() => onNavigate('/me/sync')}
        onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('/me/sync') }}
      >
        <span className={`user-panel__dot user-panel__dot--${syncView.tone}`} />
        <span className="user-panel__row-label">{syncView.text}</span>
        <Icon name="ChevronRight" size={16} className="user-panel__arrow" />
      </div>

      <div
        className="user-panel__row"
        role="button"
        tabIndex={0}
        onClick={() => setView('sessions')}
        onKeyDown={(e) => { if (e.key === 'Enter') setView('sessions') }}
      >
        <Icon name="ShieldCheck" size={20} className="user-panel__row-icon" />
        <span className="user-panel__row-label">登录设备</span>
        <Icon name="ChevronRight" size={16} className="user-panel__arrow" />
      </div>

      <div className="user-panel__divider" />

      {/* 外观快捷切换 */}
      <div className="user-panel__section">
        <div className="user-panel__section-title">外观</div>
        <div className="user-panel__themes" role="group" aria-label="主题模式">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              className={`user-panel__theme${theme === o.key ? ' active' : ''}`}
              title={o.label}
              onClick={() => setTheme(o.key)}
            >
              <Icon name={o.icon} size={16} />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="user-panel__divider" />

      {/* 危险区 */}
      <div className="user-panel__links">
        <div
          className="user-panel__row user-panel__row--danger"
          role="button"
          tabIndex={0}
          onClick={onLogout}
          onKeyDown={(e) => { if (e.key === 'Enter') onLogout() }}
        >
          <Icon name="LogOut" size={20} className="user-panel__row-icon" />
          <span className="user-panel__row-label">退出登录</span>
        </div>
        <div
          className="user-panel__row user-panel__row--muted"
          role="button"
          tabIndex={0}
          onClick={onLogoutAll}
          onKeyDown={(e) => { if (e.key === 'Enter') onLogoutAll() }}
        >
          <Icon name="ShieldCheck" size={20} className="user-panel__row-icon" />
          <span className="user-panel__row-label">退出所有设备</span>
        </div>
      </div>
    </div>
  )
}
