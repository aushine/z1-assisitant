/**
 * HabitSection — 习惯 KPI + 热力图 + 表格。
 *
 * R32：分类 emoji 映射改查 category-dict（HABIT_CATEGORIES / getHabitCategory），
 *      移除本地 sport/diet/life/study 的 emoji+bg/fg 平行定义。
 * R2：状态筛选现在会在 setStatusFilter 后触发 refetch（此前只改状态不拉数据）。
 * R7：今日达成后打卡按钮禁用（此前文案变「已完成」但仍可点）。
 * S05/S06：连续天数徽章（StreakBadge）逐行展示 + KPI 区「最长连续」取代名不符实的 kpi-streak。
 * S07：里程碑 7/21/66/100/365（MilestoneRow）+ 奖牌令牌 --medal-*。
 * 移除所有 Semi 图标与裸 emoji 字面量（B08/B09）。
 */
import { useState, useEffect, useMemo } from 'react'
import {
  Card,
  Button,
  Tag,
  Table,
  Select,
  Skeleton,
  Tooltip,
  Modal,
  InputNumber,
} from '@douyinfe/semi-ui'
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table'
import { Icon, ICONS, TINT_VARS } from '@/components/icon'
import { EmptyHint } from '@/components/EmptyState'
import ErrorState from '@/components/ErrorState'
import { useHabitStore } from '@/stores/habit'
import { habitApi } from '@/api/habit'
import { statsApi } from '@/api/stats'
import IconBox from '@/components/IconBox'
import { getIconMapping } from '@/utils/icon-map'
import { HABIT_CATEGORIES, getHabitCategory } from '@/utils/category-dict'
import HabitEditDrawer from '@/components/HabitEditDrawer'
import { HabitHeatmap } from './components/HabitHeatmap'
import { StreakBadge, MilestoneRow, streakUnit } from './components/StreakBadge'
import type {
  Habit,
  HabitStatus,
  CreateHabitReq,
  UpdateHabitReq,
  HabitHeatmapItem,
} from '@/api/types'

const habitFilterOptions = [
  { value: '', label: '全部' },
  { value: 'active', label: '活跃' },
  { value: 'archived', label: '已归档' },
]

const categoryFilterOptions = [
  { value: '', label: '全部分类' },
  ...HABIT_CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
]

const frequencyLabel: Record<string, string> = { daily: '每日', weekly: '每周', monthly: '每月' }

export function HabitSection() {
  const habitStore = useHabitStore()
  const now = useMemo(() => new Date(), [])
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1) // 1-12
  const [habitDrawerVisible, setHabitDrawerVisible] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [habitSaving, setHabitSaving] = useState(false)
  const [heatmapData, setHeatmapData] = useState<HabitHeatmapItem[]>([])
  const [error, setError] = useState(false)
  const [checkInModal, setCheckInModal] = useState<{ visible: boolean; habitId: string; habitTitle: string }>({ visible: false, habitId: '', habitTitle: '' })
  const [checkInDuration, setCheckInDuration] = useState<number>(0)

  // Fetch heatmap data（按当前选中月份）
  useEffect(() => {
    const startDate = `${calYear}-${String(calMonth).padStart(2, '0')}-01`
    const daysInMonth = new Date(calYear, calMonth, 0).getDate()
    const endDate = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
    statsApi.habitStats({ start_date: startDate, end_date: endDate }).then((res) => {
      setHeatmapData(res.heatmap || [])
    }).catch(() => {
      setError(true)
    })
  }, [calYear, calMonth, habitStore.items.length])

  // 习惯列表探错（record/index 已在 mount 时 fetchList，但 store 会静默吞错）
  useEffect(() => {
    let alive = true
    habitApi
      .list({})
      .then(() => { if (alive) setError(false) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [])

  // 全站「最长连续」KPI（取活跃习惯里 longest_streak 最大值）
  const bestStreak = useMemo(() =>
    habitStore.items
      .filter((h) => h.status === 'active')
      .reduce((m, h) => Math.max(m, h.longest_streak ?? 0), 0),
    [habitStore.items]
  )

  function shiftMonth(delta: number) {
    let y = calYear
    let m = calMonth + delta
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setCalYear(y)
    setCalMonth(m)
  }

  const isCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth() + 1

  const habitColumns = useMemo<ColumnProps<Habit>[]>(() => [
    {
      title: '习惯',
      dataIndex: 'title',
      width: 260,
      render: (_v: any, record: Habit, _i: number) => {
        const habitIcon = record.icon ? getIconMapping(record.icon).icon : ICONS.HelpCircle
        const iconBg = record.color ? record.color + '22' : undefined
        return (
          <div className="col-habit" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBox icon={habitIcon} bg={iconBg} fg={record.color || undefined} size={32} iconSize={16} />
            <div className="habit-text" style={{ minWidth: 0 }}>
              <div className="habit-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.title}</div>
              {record.description ? <div className="habit-desc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-tertiary)', fontSize: 12 }}>{record.description}</div> : null}
            </div>
          </div>
        )
      },
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 110,
      render: (v: string) => {
        const c = getHabitCategory(v)
        if (!c) return <span style={{ color: 'var(--color-text-tertiary)' }}>{v || '—'}</span>
        return (
          <Tag style={{ background: TINT_VARS[c.tint].bg, color: TINT_VARS[c.tint].fg, border: 'none', fontSize: 12 }}>
            <Icon name={c.icon} size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />
            {c.label}
          </Tag>
        )
      },
    },
    {
      title: '频率',
      dataIndex: 'frequency',
      width: 80,
      render: (v: string) => (
        <span style={{ color: 'var(--color-text-secondary)' }}>{frequencyLabel[v] ?? v}</span>
      ),
    },
    {
      title: '目标',
      dataIndex: 'target_count',
      width: 100,
      render: (_v: any, r: Habit, _i: number) => `${r.target_count} ${r.unit}`,
    },
    {
      title: '今日进度',
      dataIndex: 'today_count',
      width: 170,
      render: (_v: any, r: Habit, _i: number) => {
        const done = r.today_count ?? 0
        const total = r.target_count
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
        const finished = !!(r.today_done ?? r.today_completed)
        return (
          <div className="col-progress">
            <div className="progress-text">
              <span style={{ fontWeight: 600, color: finished ? 'var(--color-success-dark)' : 'var(--color-text-primary)' }}>
                {done}
              </span>
              <span className="muted">/ {total}</span>
              {finished ? (
                <Tag style={{ marginLeft: 8, background: 'var(--color-success-light)', color: 'var(--color-success-dark)', border: 'none' }}>
                  <Icon name="CheckSquare" size={12} style={{ marginRight: 2, verticalAlign: '-2px' }} /> 已达成
                </Tag>
              ) : null}
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: pct + '%', background: finished ? 'var(--color-success)' : r.color }}
              />
            </div>
          </div>
        )
      },
    },
    {
      title: '连续',
      dataIndex: 'current_streak',
      width: 110,
      render: (_v: any, r: Habit, _i: number) => (
        <StreakBadge streak={r.current_streak ?? 0} unit={streakUnit(r.frequency)} />
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: HabitStatus) => (
        <Tag style={{
          background: s === 'active' ? 'var(--color-success-light)' : 'var(--color-bg-hover)',
          color: s === 'active' ? 'var(--color-success-dark)' : 'var(--color-text-tertiary)',
          border: 'none',
        }}>{s === 'active' ? '活跃' : '已归档'}</Tag>
      ),
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: 160,
      render: (_v: any, record: Habit, _i: number) => {
        const done = !!(record.today_done ?? record.today_completed)
        return (
          <div className="col-actions">
            <Tooltip content={done ? '今日已完成' : '打卡'}>
              <Button
                theme="borderless"
                type="primary"
                size="small"
                icon={<Icon name="CheckSquare" size={16} />}
                disabled={record.status !== 'active' || done}
                onClick={() => setCheckInModal({ visible: true, habitId: record.id, habitTitle: record.title })}
              >{done ? '已完成' : '打卡'}</Button>
            </Tooltip>
            <Tooltip content="编辑">
              <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="Pencil" size={16} />} onClick={() => openEditHabit(record)} />
            </Tooltip>
            <Tooltip content="删除">
              <Button theme="borderless" type="danger" size="small" icon={<Icon name="X" size={16} />} onClick={() => onDeleteHabit(record)} />
            </Tooltip>
          </div>
        )
      },
    },
  ], [])

  function openEditHabit(h: Habit) {
    setEditingHabit(h)
    setHabitDrawerVisible(true)
  }

  function openCreateHabit() {
    setEditingHabit(null)
    setHabitDrawerVisible(true)
  }

  async function onHabitDrawerSubmit(data: CreateHabitReq | UpdateHabitReq) {
    setHabitSaving(true)
    try {
      if (editingHabit) {
        const ok = await habitStore.update(editingHabit.id, data as UpdateHabitReq)
        if (ok) setHabitDrawerVisible(false)
      } else {
        const created = await habitStore.create(data as CreateHabitReq)
        if (created) setHabitDrawerVisible(false)
      }
    } finally {
      setHabitSaving(false)
    }
  }

  function onDeleteHabit(h: Habit) {
    Modal.confirm({
      title: '删除习惯',
      content: `确认删除「${h.title}」？此操作可在 30 天内恢复。`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await habitStore.remove(h.id)
      },
    })
  }

  const filteredItems = habitStore.items.filter((h) => {
    if (habitStore.categoryFilter && h.category !== habitStore.categoryFilter) return false
    return true
  })

  const showError = error && !habitStore.loading && filteredItems.length === 0

  return (
    <Card bordered={false} className="card">
      <div className="card-head">
        <span className="card-title"><Icon name="ListChecks" size={16} style={{ marginRight: 6 }} />习惯追踪</span>
        <span className="card-sub">坚持就是力量</span>
      </div>

      <div className="kpi-row">
        <div className="kpi-card kpi-today">
          <div className="kpi-label">今日完成</div>
          <div className="kpi-value">{habitStore.todayDone}/{habitStore.todayTotal}</div>
          <div className="kpi-foot">
            <div className="kpi-bar">
              <div className="kpi-bar-fill" style={{
                width: habitStore.todayTotal > 0 ? Math.round((habitStore.todayDone / habitStore.todayTotal) * 100) + '%' : '0%',
                background: 'var(--color-success)',
              }} />
            </div>
            <span className="kpi-foot-text">
              {habitStore.todayTotal > 0 ? Math.round((habitStore.todayDone / habitStore.todayTotal) * 100) + '%' : '—'}
            </span>
          </div>
        </div>
        <div className="kpi-card kpi-streak">
          <div className="kpi-label">最长连续</div>
          <div className="kpi-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="Flame" size={22} style={{ color: 'var(--color-warning)' }} />
            {bestStreak}
          </div>
          <div className="kpi-foot"><span className="kpi-foot-text muted">天 · 历史最佳</span></div>
        </div>
        <div className="kpi-card kpi-month">
          <div className="kpi-label">今日打卡</div>
          <div className="kpi-value">{habitStore.todayCheckIns}</div>
          <div className="kpi-foot"><span className="kpi-foot-text muted">次</span></div>
        </div>
        <div className="kpi-card kpi-total">
          <div className="kpi-label">总习惯数</div>
          <div className="kpi-value">{habitStore.total}</div>
          <div className="kpi-foot"><span className="kpi-foot-text muted">含已归档</span></div>
        </div>
      </div>

      {/* 里程碑（S07） */}
      <div className="milestone-section">
        <span className="card-sub" style={{ marginRight: 12 }}>里程碑</span>
        <MilestoneRow longestStreak={bestStreak} />
      </div>

      {/* Habit Heatmap */}
      {heatmapData.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{calYear}年{calMonth}月打卡日历</span>
            <Button theme="borderless" type="tertiary" size="small" onClick={() => shiftMonth(-1)}>‹</Button>
            <Button theme="borderless" type="tertiary" size="small" onClick={() => shiftMonth(1)}>›</Button>
            {!isCurrentMonth && (
              <Button theme="borderless" type="secondary" size="small" onClick={() => { setCalYear(now.getFullYear()); setCalMonth(now.getMonth() + 1) }}>回到本月</Button>
            )}
          </div>
          <HabitHeatmap data={heatmapData} year={calYear} month={calMonth} />
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-left">
          <Select value={habitStore.statusFilter as any} optionList={habitFilterOptions as any} onChange={(v: any) => { habitStore.setStatusFilter(v); habitStore.fetchList() }} style={{ width: 140 }} />
          <Select value={habitStore.categoryFilter as any} optionList={categoryFilterOptions as any} onChange={(v: any) => habitStore.setCategoryFilter(v)} style={{ width: 150 }} />
        </div>
        <div className="toolbar-right">
          <Button theme="solid" type="secondary" size="small" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreateHabit}>新建习惯</Button>
          <Button theme="borderless" type="tertiary" icon={<Icon name="RefreshCw" size={16} />} onClick={() => habitStore.fetchList()} loading={habitStore.loading}>刷新</Button>
        </div>
      </div>

      {habitStore.loading && filteredItems.length === 0 ? (
        <div className="skeleton-wrap"><Skeleton><Skeleton.Paragraph rows={3} /></Skeleton></div>
      ) : showError ? (
        <ErrorState compact message="习惯加载失败，请重试" onRetry={() => { setError(false); habitStore.fetchList() }} />
      ) : filteredItems.length > 0 ? (
        <Table columns={habitColumns as any} dataSource={filteredItems} pagination={false} loading={habitStore.loading} rowKey="id" size="middle" className="habit-table" />
      ) : (
        <EmptyHint icon="FolderOpen" title="还没有习惯" desc="点击「新建习惯」开始" />
      )}

      <HabitEditDrawer visible={habitDrawerVisible} habit={editingHabit} saving={habitSaving} onClose={() => setHabitDrawerVisible(false)} onSubmit={onHabitDrawerSubmit} />

      {/* 打卡弹窗 */}
      <Modal
        title="打卡"
        visible={checkInModal.visible}
        onCancel={() => { setCheckInModal({ visible: false, habitId: '', habitTitle: '' }); setCheckInDuration(0) }}
        onOk={() => {
          habitStore.checkIn(checkInModal.habitId, { duration_minutes: checkInDuration > 0 ? checkInDuration : undefined })
          setCheckInModal({ visible: false, habitId: '', habitTitle: '' })
          setCheckInDuration(0)
        }}
        okText="确认打卡"
        cancelText="取消"
      >
        <div style={{ padding: '12px 0' }}>
          <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
            「{checkInModal.habitTitle}」
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>打卡时长（分钟）：</span>
            <InputNumber
              value={checkInDuration}
              onChange={(v: number | string | undefined) => setCheckInDuration(typeof v === 'number' ? v : parseInt(String(v ?? 0), 10) || 0)}
              min={0}
              max={1440}
              style={{ width: 100 }}
              placeholder="0"
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>留空或填 0 表示不记录时长</span>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

export default HabitSection
