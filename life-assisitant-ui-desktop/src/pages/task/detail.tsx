/**
 * Task detail page
 * M5: 任务详情 — 子任务交互 + 完整信息展示
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button,
  Tag,
  Checkbox,
  Skeleton,
  Tooltip,
  Modal,
} from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import { taskApi } from '@/api/task'
import { useTaskStore } from '@/stores/task'
import TaskEditDrawer from '@/components/TaskEditDrawer'
import { getTaskPriority, getTaskStatus } from '@/utils/task-dict'
import type { Task, CreateTaskReq, TaskStatus } from '@/api/types'

const RECURRENCE_LABEL: Record<string, string> = {
  'FREQ=DAILY': '每天',
  'FREQ=WEEKLY': '每周',
  'FREQ=MONTHLY': '每月',
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useTaskStore()

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [drawerVisible, setDrawerVisible] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchTask = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const data = await taskApi.get(id)
      setTask(data)
    } catch {
      setError('加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchTask()
  }, [fetchTask])

  async function onToggleSubtask(subtaskId: string) {
    if (!id) return
    const fresh = await store.toggleSubtask(id, subtaskId)
    if (fresh) setTask(fresh)
  }

  async function onToggleComplete() {
    if (!task) return
    const next: TaskStatus = task.status === 'done' ? 'todo' : 'done'
    await store.toggleComplete(task.id, next)
    // Refresh from store
    const updated = store.items.find((t) => t.id === task.id)
    if (updated) setTask(updated)
    else await fetchTask()
  }

  async function onDelete() {
    if (!task) return
    Modal.confirm({
      title: '删除任务',
      content: `确认删除「${task.title}」？`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        const ok = await store.remove(task.id)
        if (ok) navigate('/todo', { replace: true })
      },
    })
  }

  async function onDrawerSubmit(data: CreateTaskReq) {
    if (!task) return
    setSaving(true)
    try {
      const ok = await store.update(task.id, data)
      if (ok) {
        setDrawerVisible(false)
        await fetchTask()
      }
    } finally {
      setSaving(false)
    }
  }

  // Subtask progress
  const subtasks = task?.subtasks ?? []
  const completedCount = subtasks.filter((s) => s.is_completed).length
  const totalCount = subtasks.length
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  if (loading) {
    return (
      <div className="task-detail-page">
        <Skeleton.Title style={{ width: 200, marginBottom: 16 }} />
        <Skeleton.Paragraph rows={6} />
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="task-detail-page">
        <Button
          icon={<Icon name="ArrowLeft" size={16} />}
          theme="borderless"
          type="tertiary"
          onClick={() => navigate('/todo')}
          style={{ marginBottom: 8 }}
        >
          返回列表
        </Button>
        <ErrorState message={error || '任务不存在'} onRetry={fetchTask} />
      </div>
    )
  }

  // 优先级 / 状态一律走 task-dict（唯一真相），颜色用 TINT_VARS 语义色，暗色自动联动
  const statusDef = getTaskStatus(task.status)
  const priorityDef = getTaskPriority(task.priority)
  const statusVars = TINT_VARS[statusDef.tint]
  const priorityVars = TINT_VARS[priorityDef.tint]

  return (
    <div className="task-detail-page">
      {/* Header */}
      <div className="detail-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Button
            icon={<Icon name="ArrowLeft" size={16} />}
            theme="borderless"
            type="tertiary"
            onClick={() => navigate('/todo')}
            style={{ marginBottom: 8, padding: '4px 8px' }}
          >
            返回列表
          </Button>
          <div className="detail-title-row">
            <Checkbox
              checked={task.status === 'done'}
              onChange={(_e: any) => onToggleComplete()}
              style={{ flexShrink: 0, marginTop: 2 }}
            />
            <h1 className={`detail-title${task.status === 'done' ? ' done' : ''}`}>
              {task.title}
            </h1>
          </div>
          <div className="detail-meta">
            <Tag style={{ background: statusVars.bg, color: statusVars.fg, border: 'none' }}>
              {statusDef.label}
            </Tag>
            <Tag style={{ background: priorityVars.fg, color: '#fff', border: 'none' }}>
              {priorityDef.label}
            </Tag>
            {task.due_date && (
              <span className="detail-meta-item">
                <Icon name="Calendar" size={16} /> {task.due_date}{task.due_time ? ` ${task.due_time}` : ''}
              </span>
            )}
            {task.reminder_at && (
              <span className="detail-meta-item">
                <Icon name="Clock" size={16} /> {new Date(task.reminder_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {task.recurrence_rule && (
              <span className="detail-meta-item">
                <Icon name="RefreshCw" size={16} /> {RECURRENCE_LABEL[task.recurrence_rule] ?? task.recurrence_rule}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Tooltip content="编辑">
            <Button icon={<Icon name="Pencil" size={16} />} theme="light" onClick={() => setDrawerVisible(true)}>编辑</Button>
          </Tooltip>
          <Tooltip content="删除">
            <Button icon={<Icon name="Trash2" size={16} />} type="danger" theme="light" onClick={onDelete}>删除</Button>
          </Tooltip>
        </div>
      </div>

      {/* Body */}
      <div className="detail-body">
        {/* Main content */}
        <div className="detail-main">
          {/* Description */}
          {task.description && (
            <div className="detail-section">
              <div className="detail-section-title">描述</div>
              <div className="detail-desc">{task.description}</div>
            </div>
          )}

          {/* Subtasks */}
          {totalCount > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">
                子任务 ({completedCount}/{totalCount})
              </div>
              <div className="subtask-progress">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  <span>完成进度</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="subtask-progress-bar">
                  <div className="subtask-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {subtasks.map((s) => (
                  <div key={s.id} className="subtask-item" onClick={() => onToggleSubtask(s.id)}>
                    <Checkbox
                      checked={s.is_completed}
                      onChange={(_e: any) => onToggleSubtask(s.id)}
                    />
                    <span className={`subtask-title${s.is_completed ? ' completed' : ''}`}>
                      {s.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state for no subtasks & no description */}
          {!task.description && totalCount === 0 && (
            <div className="detail-section">
              <EmptyHint icon="FolderOpen" title="暂无详细内容" />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="detail-sidebar">
          <div className="detail-section">
            <div className="detail-section-title">任务信息</div>

            <div className="sidebar-item">
              <span className="sidebar-label">状态</span>
              <Tag style={{ background: statusVars.bg, color: statusVars.fg, border: 'none', fontSize: 12 }}>
                {statusDef.label}
              </Tag>
            </div>

            <div className="sidebar-item">
              <span className="sidebar-label">优先级</span>
              <Tag style={{ background: priorityVars.fg, color: '#fff', border: 'none', fontSize: 12 }}>
                {priorityDef.label}
              </Tag>
            </div>

            {task.due_date && (
              <div className="sidebar-item">
                <span className="sidebar-label"><Icon name="Calendar" size={16} style={{ marginRight: 4 }} />截止</span>
                <span className="sidebar-value">{task.due_date}{task.due_time ? ` ${task.due_time}` : ''}</span>
              </div>
            )}

            {task.reminder_at && (
              <div className="sidebar-item">
                <span className="sidebar-label"><Icon name="Clock" size={16} style={{ marginRight: 4 }} />提醒</span>
                <span className="sidebar-value">
                  {new Date(task.reminder_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}

            {task.recurrence_rule && (
              <div className="sidebar-item">
                <span className="sidebar-label"><Icon name="RefreshCw" size={16} style={{ marginRight: 4 }} />重复</span>
                <span className="sidebar-value">{RECURRENCE_LABEL[task.recurrence_rule] ?? task.recurrence_rule}</span>
              </div>
            )}

            {task.subtasks_count !== undefined && task.subtasks_count > 0 && (
              <div className="sidebar-item">
                <span className="sidebar-label">子任务</span>
                <span className="sidebar-value">{completedCount}/{totalCount}</span>
              </div>
            )}

            <div className="sidebar-item">
              <span className="sidebar-label">创建</span>
              <span className="sidebar-value">{new Date(task.created_at).toLocaleDateString('zh-CN')}</span>
            </div>

            {task.completed_at && (
              <div className="sidebar-item">
                <span className="sidebar-label">完成</span>
                <span className="sidebar-value">{new Date(task.completed_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Drawer */}
      <TaskEditDrawer
        visible={drawerVisible}
        task={task}
        saving={saving}
        onClose={() => setDrawerVisible(false)}
        onSubmit={onDrawerSubmit}
      />
    </div>
  )
}
