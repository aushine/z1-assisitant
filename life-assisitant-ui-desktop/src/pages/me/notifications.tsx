/**
 * Me / Notifications sub-page
 * M5：接入真实通知（notificationApi / useNotificationStore）——展示列表、未读数、已读操作；
 * 通知偏好开关暂无后端端点，仍走本地 localStorage。
 */
import { useState, useCallback, useEffect } from 'react'
import { Card, Switch, Toast, Button, Skeleton, Tag } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { storage } from '@/utils/storage'
import { useNotificationStore } from '@/stores/notification'
import { notificationApi } from '@/api/notification'
import { EmptyHint } from '@/components/EmptyState'
import ErrorState from '@/components/ErrorState'

const NOTIF_KEYS = ['task_reminder', 'habit_reminder', 'budget_alert', 'weekly_report'] as const
type NotifKey = typeof NOTIF_KEYS[number]

const NOTIF_LABELS: Record<NotifKey, { title: string; desc: string }> = {
  task_reminder: { title: '任务提醒', desc: '任务到期前推送提醒' },
  habit_reminder: { title: '习惯提醒', desc: '每日习惯打卡提醒' },
  budget_alert: { title: '预算预警', desc: '支出超过预算阈值时预警' },
  weekly_report: { title: '周报推送', desc: '每周发送数据总结报告' },
}

function getNotifPrefs(): Record<NotifKey, boolean> {
  const saved = storage.get<Record<string, boolean>>('notif_prefs')
  return {
    task_reminder: saved?.task_reminder ?? true,
    habit_reminder: saved?.habit_reminder ?? true,
    budget_alert: saved?.budget_alert ?? true,
    weekly_report: saved?.weekly_report ?? false,
  }
}

function saveNotifPrefs(prefs: Record<NotifKey, boolean>) {
  storage.set('notif_prefs', prefs)
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MeNotificationsPage() {
  const navigate = useNavigate()
  const notificationStore = useNotificationStore()
  const [prefs, setPrefs] = useState<Record<NotifKey, boolean>>(getNotifPrefs)
  const [error, setError] = useState(false)

  useEffect(() => {
    notificationStore.fetch()
    notificationStore.fetchList()
  }, [])

  // 通知列表探错（store 的 fetchList 会静默吞错，失败时会把「暂无通知」误当真）
  useEffect(() => {
    let alive = true
    notificationApi
      .list({ page: 1, page_size: 20 })
      .then(() => { if (alive) setError(false) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [])

  const onToggle = useCallback((key: NotifKey, val: boolean) => {
    const next = { ...prefs, [key]: val }
    setPrefs(next)
    saveNotifPrefs(next)
    Toast.success(`${NOTIF_LABELS[key].title}已${val ? '开启' : '关闭'}`)
  }, [prefs])

  const markAllRead = () => {
    notificationStore.markAllRead()
    Toast.success('已全部标记为已读')
  }

  const showError = error && !notificationStore.loading && notificationStore.items.length === 0

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>通知设置</h3>
      </div>

      <div className="settings-page">
        {/* 通知列表（真实接口） */}
        <Card bordered={false} className="card">
          <div className="notif-list-header">
            <div className="notif-list-title">
              通知
              {notificationStore.unread > 0 && <Tag size="small" color="red">{notificationStore.unread} 未读</Tag>}
            </div>
            {notificationStore.unread > 0 && (
              <Button theme="borderless" type="tertiary" size="small" onClick={markAllRead}>
                全部已读
              </Button>
            )}
          </div>

          {notificationStore.loading ? (
            <Skeleton.Title style={{ width: '60%', marginBottom: 12 }} />
          ) : showError ? (
            <ErrorState compact message="通知加载失败，请重试" onRetry={() => { setError(false); notificationStore.fetchList() }} />
          ) : notificationStore.items.length === 0 ? (
            <EmptyHint icon="Inbox" title="暂无通知" />
          ) : (
            <div className="notif-list">
              {notificationStore.items.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item${n.is_read ? '' : ' unread'}`}
                  onClick={() => { if (!n.is_read) notificationStore.markRead(n.id) }}
                >
                  <div className="notif-item-main">
                    <div className="notif-item-title">{n.title}</div>
                    {n.body && <div className="notif-item-body">{n.body}</div>}
                    <div className="notif-item-time">{formatTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="notif-dot" />}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 通知偏好（本地存储） */}
        <Card bordered={false} className="card">
          <div className="notif-list-title" style={{ marginBottom: 8 }}>偏好</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {NOTIF_KEYS.map((key) => {
              const { title, desc } = NOTIF_LABELS[key]
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 0',
                    borderBottom: '1px solid var(--color-border-light)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{desc}</div>
                  </div>
                  <Switch checked={prefs[key]} onChange={(v: boolean) => onToggle(key, v)} />
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
