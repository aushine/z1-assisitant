/**
 * Task page (React 18 + TSX)
 * M5 扩展：批量选择 + 批量操作栏 + 子任务数量显示 + 跳转详情
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Button,
  Tag,
  Table,
  Checkbox,
  Select,
  Input,
  Pagination,
  Modal,
  Skeleton,
  Tooltip,
} from '@douyinfe/semi-ui'
import { useTaskStore } from '@/stores/task'
import { taskApi } from '@/api/task'
import IconBox from '@/components/IconBox'
import { Icon, ICONS, TINT_VARS } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import { getTaskCategory, findCategoryByEmoji } from '@/utils/category-dict'
import type { CategoryDef } from '@/utils/category-dict'
import { TASK_PRIORITIES, getTaskPriority, getTaskStatus } from '@/utils/task-dict'
import TaskEditDrawer from '@/components/TaskEditDrawer'
import type {
  Task,
  TaskFilter,
  TaskPriority,
  CreateTaskReq,
  TaskStatus,
} from '@/api/types'

function categoryOf(task: Task): CategoryDef {
  if (task.category_id) {
    const c = getTaskCategory(task.category_id)
    if (c) return c
  }
  if (task.category_emoji) {
    const c = findCategoryByEmoji(task.category_emoji)
    if (c) return c
  }
  // 兜底：其他分类（Pin / neutral）
  return getTaskCategory('c_other')!
}

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今日' },
  { value: 'upcoming', label: '即将' },
  { value: 'done', label: '已完成' },
  { value: 'overdue', label: '逾期' },
]

// 优先级筛选项由 task-dict 派生（按紧急→宽松，与原字面量顺序一致），标签不再重复定义
const priorityOptions = [
  { value: '', label: '全部优先级' },
  ...[...TASK_PRIORITIES].reverse().map((p) => ({ value: p.value as string, label: p.label })),
]

export default function TaskPage() {
  const navigate = useNavigate()
  const store = useTaskStore()
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [error, setError] = useState('')
  const searchTimerRef = useRef<number | null>(null)

  /**
   * 页面级列表拉取：store.fetchList 的 catch 会静默吞错并写空状态，
   * 断网时会误导为「没数据」。这里直接调 taskApi.list 以便如实暴露错误（E02），
   * 结果写回 store（store 的增删改仍照常消费 items）。
   */
  const fetchList = useCallback(async () => {
    setError('')
    useTaskStore.setState({ loading: true })
    try {
      const { query } = useTaskStore.getState()
      const res = await taskApi.list({
        filter: query.filter,
        priority: query.priority || undefined,
        keyword: query.keyword || undefined,
        page: query.page,
        page_size: query.page_size,
      })
      useTaskStore.setState({
        items: res.items,
        total: res.total,
        loading: false,
        isEmpty: res.items.length === 0,
      })
    } catch {
      useTaskStore.setState({ items: [], total: 0, loading: false, isEmpty: true })
      setError('加载失败，请重试')
    }
  }, [])

  const kpi = useMemo(() => {
    const list = store.items
    const today = new Date().toISOString().slice(0, 10)
    const todayTotal = list.filter((t) => t.due_date === today && t.status !== 'done').length
    const todayDone = list.filter((t) => t.due_date === today && t.status === 'done').length
    const upcoming = list.filter((t) => t.due_date && t.due_date > today && t.status !== 'done').length
    const done = list.filter((t) => t.status === 'done').length
    const overdue = list.filter((t) => t.due_date && t.due_date < today && t.status !== 'done').length
    return {
      todayText: `${todayDone}/${todayTotal || todayDone + upcoming}`,
      todayProgress: todayTotal + todayDone > 0 ? Math.round((todayDone / (todayTotal + todayDone)) * 100) : 0,
      upcoming,
      done,
      overdue,
    }
  }, [store.items])

  const hasSelection = store.selectedIds.length > 0

  const columns = useMemo<any[]>(() => [
    {
      title: (
        <Checkbox
          checked={store.items.length > 0 && store.items.every((t) => store.selectedIds.includes(t.id))}
          indeterminate={hasSelection && !store.items.every((t) => store.selectedIds.includes(t.id))}
          onChange={(_e: any) => store.toggleSelectAll()}
        />
      ),
      dataIndex: 'checkbox',
      width: 48,
      render: (_v: unknown, record: Task) => (
        <Checkbox
          checked={store.selectedIds.includes(record.id)}
          onChange={(_e: any) => store.toggleSelect(record.id)}
        />
      ),
    },
    {
      title: '',
      dataIndex: 'done',
      width: 40,
      render: (_v: unknown, record: Task) => (
        <Checkbox
          checked={record.status === 'done'}
          onChange={(e: any) => onToggleComplete(record, e.target.checked)}
        />
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: 280,
      render: (_v: unknown, record: Task) => {
        const done = record.status === 'done'
        const subtaskInfo = record.subtasks_count ? ` (${record.subtasks_count})` : ''
        return (
          <div
            className="col-title"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/todo/${record.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/todo/${record.id}`) }}
          >
            <div
              className="title-text"
              style={{
                fontWeight: 600,
                color: done ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                textDecoration: done ? 'line-through' : 'none',
              }}
            >
              {record.title}{subtaskInfo && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-text-tertiary)' }}>{subtaskInfo}</span>}
            </div>
            {record.description ? <div className="title-desc">{record.description}</div> : null}
          </div>
        )
      },
    },
    {
      title: '分类',
      dataIndex: 'category_id',
      width: 120,
      render: (_v: unknown, record: Task) => {
        const c = categoryOf(record)
        return <IconBox icon={ICONS[c.icon]} tint={c.tint} size={32} iconSize={16} />
      },
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 100,
      render: (_v: unknown, record: Task) => {
        const p = getTaskPriority(record.priority)
        return (
          <Tooltip content={p.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: TINT_VARS[p.tint].fg }} />
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{p.label}</span>
            </div>
          </Tooltip>
        )
      },
    },
    {
      title: '截止',
      dataIndex: 'due_date',
      width: 160,
      render: (_v: unknown, record: Task) => {
        const overdue = isOverdue(record)
        return (
          <span style={{ color: overdue ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
            {formatDue(record)}
          </span>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (_v: unknown, record: Task) => {
        const s = getTaskStatus(record.status)
        const sv = TINT_VARS[s.tint]
        return <Tag style={{ background: sv.bg, color: sv.fg, border: 'none' }}>{s.label}</Tag>
      },
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: 120,
      render: (_v: unknown, record: Task) => (
        <div className="col-actions">
          <Tooltip content="编辑">
            <Button
              theme="borderless"
              type="tertiary"
              size="small"
              icon={<Icon name="Pencil" size={16} />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Tooltip content="删除">
            <Button
              theme="borderless"
              type="danger"
              size="small"
              icon={<Icon name="Trash2" size={16} />}
              onClick={() => onDelete(record)}
            />
          </Tooltip>
        </div>
      ),
    },
  ], [store.selectedIds, store.items])

  function openCreate() {
    setEditingTask(null)
    setDrawerVisible(true)
  }

  function openEdit(task: Task) {
    setEditingTask(task)
    setDrawerVisible(true)
  }

  async function onDrawerSubmit(data: CreateTaskReq) {
    setSaving(true)
    try {
      if (editingTask) {
        const ok = await store.update(editingTask.id, data)
        if (ok) setDrawerVisible(false)
      } else {
        const created = await store.create(data)
        if (created) setDrawerVisible(false)
      }
    } finally {
      setSaving(false)
    }
  }

  function onDelete(task: Task) {
    Modal.confirm({
      title: '删除任务',
      content: `确认删除「${task.title}」？此操作可在 30 天内恢复。`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await store.remove(task.id)
      },
    })
  }

  function onToggleComplete(record: Task, checked: boolean) {
    const next: TaskStatus = checked ? 'done' : 'todo'
    store.toggleComplete(record.id, next)
  }

  async function onBatchComplete() {
    await store.batchAction({ action: 'complete', task_ids: store.selectedIds })
  }

  async function onBatchDelete() {
    Modal.confirm({
      title: '批量删除',
      content: `确认删除选中的 ${store.selectedIds.length} 个任务？`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await store.batchAction({ action: 'delete', task_ids: store.selectedIds })
      },
    })
  }

  function formatDue(task: Task) {
    if (!task.due_date) return '—'
    if (task.due_time) return `${task.due_date} ${task.due_time}`
    return task.due_date
  }

  function isOverdue(task: Task) {
    if (!task.due_date || task.status === 'done') return false
    return task.due_date < new Date().toISOString().slice(0, 10)
  }

  function onSearchInput(v: string) {
    setSearchInput(v)
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    searchTimerRef.current = window.setTimeout(() => {
      store.setQuery({ keyword: v.trim() })
      fetchList()
    }, 350)
  }

  function onFilterChange(v: TaskFilter) {
    store.setQuery({ filter: v })
    fetchList()
  }

  function onPriorityChange(v: TaskPriority | '') {
    store.setQuery({ priority: v })
    fetchList()
  }

  function onPageChange(page: number) {
    store.setPage(page)
    fetchList()
  }

  useEffect(() => {
    fetchList()
  }, [fetchList])

  return (
    <div className="task-page">
      {/* D-03 第七轮：去页内大标题（与顶部导航重复），改用户管理式一行小字 */}
      <div className="page-tipbar">
        <span className="page-tip">待办 · 管理所有待办与日程，点右侧按钮新建待办</span>
        <div className="header-right">
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreate}>新建待办</Button>
        </div>
      </div>

      <div className="kpi-row">
        <Card bordered={false} className="kpi-card kpi-today">
          <div className="kpi-label">今日</div>
          <div className="kpi-value">{kpi.todayText}</div>
          <div className="kpi-foot">
            <div className="kpi-bar"><div className="kpi-bar-fill" style={{ width: kpi.todayProgress + '%' }} /></div>
            <span className="kpi-foot-text">{kpi.todayProgress}%</span>
          </div>
        </Card>
        <Card bordered={false} className="kpi-card kpi-upcoming">
          <div className="kpi-label">即将</div>
          <div className="kpi-value">{kpi.upcoming}</div>
          <div className="kpi-foot"><span className="kpi-foot-text muted">未来 7 天待办</span></div>
        </Card>
        <Card bordered={false} className="kpi-card kpi-done">
          <div className="kpi-label">已完成</div>
          <div className="kpi-value">{kpi.done}</div>
          <div className="kpi-foot"><span className="kpi-foot-text muted">累计完成</span></div>
        </Card>
        <Card bordered={false} className="kpi-card kpi-overdue">
          <div className="kpi-label">逾期</div>
          <div className="kpi-value">{kpi.overdue}</div>
          <div className="kpi-foot"><span className="kpi-foot-text muted">需要尽快处理</span></div>
        </Card>
      </div>

      <Card bordered={false} className="table-card">
        <div className="toolbar">
          <div className="toolbar-left">
            {React.createElement(Select as any, { value: store.query.filter, optionList: filterOptions, onChange: onFilterChange, style: { width: 140 } })}
            {React.createElement(Select as any, { value: store.query.priority, optionList: priorityOptions, onChange: onPriorityChange, style: { width: 160 } })}
            <Input value={searchInput} onChange={onSearchInput as any} placeholder="搜索标题…" prefix={<Icon name="Search" size={16} />} style={{ width: 240 }} />
          </div>
          <div className="toolbar-right">
            {hasSelection ? (
              <div className="batch-bar">
                <span className="batch-count">已选 {store.selectedIds.length} 项</span>
                <Button theme="light" type="primary" size="small" icon={<Icon name="CheckSquare" size={16} />} onClick={onBatchComplete}>批量完成</Button>
                <Button theme="light" type="danger" size="small" icon={<Icon name="Trash2" size={16} />} onClick={onBatchDelete}>批量删除</Button>
                <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="X" size={16} />} onClick={() => store.clearSelection()}>取消</Button>
              </div>
            ) : null}
            <Button theme="borderless" type="tertiary" icon={<Icon name="RefreshCw" size={16} />} onClick={fetchList} loading={store.loading}>刷新</Button>
          </div>
        </div>

        {store.loading && store.items.length === 0 ? (
          <div className="skeleton-wrap"><Skeleton /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchList} />
        ) : store.items.length > 0 ? (
          React.createElement(Table as any, { columns, dataSource: store.items, pagination: false, loading: store.loading, rowKey: 'id', size: 'middle', className: 'task-table' })
        ) : (
          <EmptyHint icon="Inbox" title="还没有待办" desc="点击「新建待办」开始" />
        )}

        {store.total > store.query.page_size && (
          <div className="pager-wrap">
            <Pagination currentPage={store.query.page} pageSize={store.query.page_size} total={store.total} onPageChange={onPageChange} />
          </div>
        )}
      </Card>

      <TaskEditDrawer visible={drawerVisible} task={editingTask} saving={saving} onClose={() => setDrawerVisible(false)} onSubmit={onDrawerSubmit} />
    </div>
  )
}
