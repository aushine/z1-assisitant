/**
 * Me / Sync sub-page
 * M8：接入错误态；syncApi 返回 any，这里在页面侧收敛为强类型。
 */
import { useEffect, useCallback, useState } from 'react'
import { Card, Button, Tag, Table, Toast } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { useSyncStore } from '@/stores/sync'
import { syncApi } from '@/api/sync'
import { Icon } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import { formatRelativeTime } from '@/utils/datetime'

type DetailStatus = 'synced' | 'pending' | 'error'

/** syncApi.status() 实际返回结构（后端 GET /sync/status） */
interface SyncStatusResp {
  last_sync_at?: string | null
  status?: 'synced' | 'syncing' | 'pending' | 'error'
  pending?: number
  details?: Record<string, { last_sync: string | null; status: DetailStatus; pending_count: number }>
}

const statusColors: Record<string, 'green' | 'blue' | 'amber' | 'red'> = {
  synced: 'green',
  syncing: 'blue',
  pending: 'amber',
  error: 'red',
}

const statusLabels: Record<string, string> = {
  synced: '已同步',
  syncing: '同步中',
  pending: '待同步',
  error: '同步失败',
}

export default function MeSyncPage() {
  const navigate = useNavigate()
  const syncStore = useSyncStore()
  const { status } = syncStore
  const [error, setError] = useState('')

  /**
   * 页面级拉取：store.fetch 的 catch 静默吞错并保留初始「已同步」，
   * 断网会误导为「已同步」。这里直接调 syncApi.status 以便如实暴露错误（M8）。
   */
  const fetchStatus = useCallback(async () => {
    setError('')
    useSyncStore.setState({ loading: true })
    try {
      const res = (await syncApi.status()) as SyncStatusResp
      useSyncStore.setState({
        loading: false,
        status: {
          lastSyncAt: res.last_sync_at ?? null,
          status: res.status ?? 'synced',
          pending: res.pending ?? 0,
          details: res.details ?? {},
        },
      })
    } catch {
      useSyncStore.setState({ loading: false })
      setError('同步状态加载失败，请重试')
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const onSync = async () => {
    Toast.info('开始同步...')
    await syncStore.syncNow()
    if (useSyncStore.getState().status.status === 'synced') {
      Toast.success('同步完成')
    } else if (useSyncStore.getState().status.status === 'error') {
      Toast.error('同步失败，请重试')
    }
  }

  const detailRows = Object.entries(status.details).map(([key, val]) => ({
    key,
    module: key,
    last_sync: formatRelativeTime(val.last_sync),
    status: val.status,
    pending_count: val.pending_count ?? 0,
  }))

  const columns = [
    { title: '模块', dataIndex: 'module', key: 'module' },
    { title: '最后同步', dataIndex: 'last_sync', key: 'last_sync' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={statusColors[s] || 'green'}>{statusLabels[s] || s}</Tag>,
    },
    { title: '待处理', dataIndex: 'pending_count', key: 'pending_count' },
  ]

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>同步状态</h3>
      </div>

      <div className="settings-page">
        <Card bordered={false} className="card">
          {error ? (
            <ErrorState message={error} onRetry={fetchStatus} />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>最后同步</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{formatRelativeTime(status.lastSyncAt)}</div>
                </div>
                <Tag color={statusColors[status.status] || 'green'} size="large">{statusLabels[status.status]}</Tag>
              </div>

              {status.pending > 0 && (
                <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--tint-warning-bg)', color: 'var(--tint-warning-fg)', fontSize: 13 }}>
                  <Icon name="Hourglass" size={14} style={{ marginRight: 4 }} />有 {status.pending} 条数据待同步
                </div>
              )}

              <Button block theme="solid" type="primary" loading={status.status === 'syncing'} onClick={onSync}>
                立即同步
              </Button>

              {detailRows.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h4 style={{ marginBottom: 12, fontWeight: 700 }}>模块详情</h4>
                  <Table columns={columns as any} dataSource={detailRows} pagination={false} size="small" />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
