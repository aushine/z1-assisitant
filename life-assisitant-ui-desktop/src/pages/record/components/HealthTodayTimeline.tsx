/**
 * HealthTodayTimeline —— 今日时间轴（桌面版，02 §12）
 *
 * 视觉规范照抄 src/pages/home/Timeline.tsx（.timeline-axis / .timeline-node /
 * .timeline-time 那套圆点连线，复用 home.scss 的全局样式，不新造视觉）。
 *
 * - 数据源：store.todayLog?.events（GET /health/overview 已返回，零额外请求，02 §12.8）。
 *   ⚠️ 不用 store.dayEvents —— 那是浮层当前选中日期的事件，浏览历史日期时会串数据。
 * - 排序：倒序（与首页时间线一致，「刚记了什么」第一眼可见）。
 * - 默认展开最近 5 条，超出折叠为「展开全部 N 条」。
 * - ⚠️ 本组件是「身体指标轴」：只渲染身体指标（饮水/排便/体温/体重/睡眠），
 *   心情/精力是独立轴（MoodSection），不再在此混排（双轴拆分，260920）。
 * - 圆点用指标色（CALENDAR_DOT_COLOR，与月历分类小点同一套色彩语言）。
 * - 点条目 → 小型 SideSheet：改时间 / 改数值 / 改备注 / 删除（走 editEvent / removeEvent，
 *   后端限制 date 与 metric_key 不可改，UI 不提供这两项，10 §5）。
 * - 底部缺口提示：「今天还没记：X、Y」+「记录 ›」→ 打开浮层并直达该指标。
 * - 空态不隐藏整块：显示「还没有记录 · 记录今天」。
 */
import { useMemo, useState } from 'react'
import {
  Card,
  SideSheet,
  Modal,
  Button,
  Input,
  InputNumber,
  Radio,
  TextArea,
} from '@douyinfe/semi-ui'
import { useHealthStore } from '@/stores/health'
import {
  CALENDAR_DOT_COLOR,
  METRIC_META,
  WATER_ML_MAX,
  BOWEL_TYPE_OPTIONS,
  isKnownMetricKey,
  healthMetric,
} from '@/constants/health'
import type { CalendarDotMark } from '@/constants/health'
import type { HealthEventItem } from '@/api/types'

/** 默认展开条数（身体指标轴，02 §12.2；双轴拆分后独立于心情轴） */
const EXPAND_COUNT = 5

/** events metric_key → 月历分类点 mark（同一套色彩语言；仅身体指标，不含 mood/energy） */
const EVENT_DOT: Record<string, CalendarDotMark> = {
  water: 'water',
  bbt: 'bbt',
  weight: 'weight',
  bowel: 'bowel',
  sleep: 'energy',
}

/** 缺口提示只看「预期每天都有」且走 events 的指标（事件型如排便不算漏记） */
const GAP_KEYS = ['water', 'bbt', 'weight', 'sleep'] as const

/** events key → 浮层面板 key（睡眠的面板叫 energy_sleep） */
function panelKey(k: string): string {
  return k === 'sleep' ? 'energy_sleep' : k
}

const BOWEL_TYPE_LABEL: Record<number, string> = (() => {
  const m: Record<number, string> = {}
  for (const o of BOWEL_TYPE_OPTIONS) m[o.value] = o.label
  return m
})()

/** 单条事件的展示值 */
function display(e: HealthEventItem): string {
  const meta = isKnownMetricKey(e.metric_key) ? METRIC_META[e.metric_key] : null
  if (e.value_int != null) return BOWEL_TYPE_LABEL[e.value_int] ?? String(e.value_int)
  if (e.value_num != null) {
    const digits = meta?.decimals ?? 0
    const n = digits > 0 ? e.value_num.toFixed(digits) : String(Math.round(e.value_num * 100) / 100)
    return meta?.unit ? `${n}${meta.unit}` : n
  }
  return '—'
}

function metricLabel(k: string): string {
  if (isKnownMetricKey(k)) return METRIC_META[k].label
  return healthMetric(k)?.name ?? k
}

/** 数值输入的边界（与浮层卡片一致） */
const VALUE_RANGE: Record<string, { min: number; max: number; step: number }> = {
  water: { min: 1, max: WATER_ML_MAX, step: 50 },
  bbt: { min: 34, max: 42, step: 0.01 },
  weight: { min: 20, max: 300, step: 0.1 },
  sleep: { min: 0, max: 24, step: 0.5 },
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

interface Props {
  /** 点「记录 ›」/ 空态「记录今天」→ 打开浮层并直达该指标（可空 = 落第一页） */
  onOpenMetric: (metricKey: string) => void
  /** 兜底：直接打开浮层（今天） */
  onOpenToday: () => void
}

export default function HealthTodayTimeline({ onOpenMetric, onOpenToday }: Props) {
  const store = useHealthStore()
  const [expanded, setExpanded] = useState(false)

  /* ==================== 数据：todayLog.events，倒序（身体指标轴） ==================== */
  const items = useMemo(() => {
    const all = [...(store.todayLog?.events ?? [])]
    all.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
    // 双轴拆分：本组件仅渲染身体指标（water/bbt/weight/bowel/sleep），
    // 心情/精力由 MoodSection 独立展示，这里不再混入或压缩 mood。
    return all.filter((e) => (e.metric_key as string) !== 'mood')
  }, [store.todayLog?.events])

  const shown = expanded ? items : items.slice(0, EXPAND_COUNT)

  /* ==================== 缺口提示 ==================== */
  const gaps = useMemo(() => {
    const d = store.todayLog
    if (!d) return []
    return GAP_KEYS.filter((k) => store.enabledMetrics().includes(k)).filter((k) => {
      if (k === 'water') return d.water_ml <= 0
      if (k === 'bbt') return d.bbt == null
      if (k === 'weight') return d.weight_kg == null
      return d.sleep_hours == null
    })
  }, [store.todayLog, store.enabledMetrics])

  /* ==================== 编辑弹层（小型 SideSheet） ==================== */
  const [editing, setEditing] = useState<HealthEventItem | null>(null)
  const [timeDraft, setTimeDraft] = useState('')
  const [numDraft, setNumDraft] = useState<number | undefined>(undefined)
  const [intDraft, setIntDraft] = useState<number | undefined>(undefined)
  const [noteDraft, setNoteDraft] = useState('')

  function openEdit(e: HealthEventItem) {
    setEditing(e)
    setTimeDraft(e.time)
    setNumDraft(e.value_num)
    setIntDraft(e.value_int)
    setNoteDraft(e.note ?? '')
  }

  function closeEdit() {
    setEditing(null)
  }

  async function saveEdit() {
    if (!editing) return
    const time = timeDraft.trim()
    if (!TIME_RE.test(time)) return
    const isBowel = editing.metric_key === 'bowel'
    await store.editEvent(editing.id, {
      time,
      ...(isBowel
        ? { value_int: intDraft }
        : { value_num: numDraft }),
      note: noteDraft.trim(),
    })
    closeEdit()
  }

  function confirmRemove() {
    if (!editing) return
    const e = editing
    Modal.confirm({
      title: '删除这条记录',
      content: `${e.time} · ${display(e)}`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        await store.removeEvent(e.id, e.date || store.today)
        closeEdit()
      },
    })
  }

  const editRange = editing ? VALUE_RANGE[editing.metric_key] : undefined

  return (
    <Card bordered={false} className="card health-tl">
      {/* 卡头：今天 + N 条记录（点击展开/收起，02 §12.6） */}
      <div className="card-head">
        <span className="card-title">今天</span>
        {items.length > 0 && (
          <span className="card-sub" style={{ cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
            {items.length} 条记录{items.length > EXPAND_COUNT ? (expanded ? ' · 收起' : ' · 展开全部') : ''}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        /* 空态不隐藏整块（02 §12.7） */
        <div className="health-tl-empty">
          <p className="health-tl-empty-text">还没有记录</p>
          <Button size="small" theme="light" type="primary" onClick={onOpenToday}>
            记录今天
          </Button>
        </div>
      ) : (
        <div className="timeline health-timeline">
          {shown.map((e) => {
            const dot = EVENT_DOT[e.metric_key as string] ?? 'weight'
            return (
              <div key={e.id} className="timeline-item health-tl-item" onClick={() => openEdit(e)}>
                <div className="timeline-time">{e.time}</div>
                <div className="timeline-axis">
                  <span
                    className="timeline-node"
                    title={metricLabel(e.metric_key)}
                    style={{ background: CALENDAR_DOT_COLOR[dot], boxShadow: '0 0 0 3px var(--color-bg-card)' }}
                  />
                </div>
                <div className="timeline-content">
                  <div className="timeline-title">{metricLabel(e.metric_key)}</div>
                  {e.note && <div className="timeline-detail">{e.note}</div>}
                </div>
                <div className="health-tl-value">{display(e)}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* 缺口提示：今天还没记：X、Y（02 §12.3） */}
      {gaps.length > 0 && (
        <div className="health-tl-gap">
          <span>
            今天还没记：{gaps.map((k) => metricLabel(k)).join('、')}
          </span>
          <a
            className="health-tl-gap-link"
            onClick={() => onOpenMetric(panelKey(gaps[0]))}
          >
            记录 ›
          </a>
        </div>
      )}

      {/* ==================== 编辑条目（改时间 / 改值 / 改备注 / 删） ==================== */}
      <SideSheet
        visible={!!editing}
        onCancel={closeEdit}
        placement="right"
        width={380}
        title={editing ? `编辑 ${metricLabel(editing.metric_key)} · ${editing.time}` : ''}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button type="danger" theme="light" disabled={store.saving} onClick={confirmRemove}>
              删除
            </Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={closeEdit}>取消</Button>
              <Button theme="solid" type="primary" loading={store.saving} onClick={saveEdit}>
                保存
              </Button>
            </div>
          </div>
        }
      >
        {editing && (
          <div className="health-tl-edit">
            <div className="health-tl-edit-row">
              <span className="health-tl-edit-label">时间</span>
              <Input
                value={timeDraft}
                onChange={(v: string) => setTimeDraft(v)}
                placeholder="HH:mm"
                style={{ width: 120 }}
              />
              {!TIME_RE.test(timeDraft.trim()) && (
                <span className="health-tl-edit-err">格式 HH:mm</span>
              )}
            </div>
            <div className="health-tl-edit-row">
              <span className="health-tl-edit-label">数值</span>
              {editing.metric_key === 'bowel' ? (
                <Radio.Group
                  value={String(intDraft ?? '')}
                  onChange={(v: any) => setIntDraft(Number(v))}
                  options={BOWEL_TYPE_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
                />
              ) : (
                <InputNumber
                  value={numDraft}
                  min={editRange?.min}
                  max={editRange?.max}
                  step={editRange?.step}
                  onChange={(v: number | string | undefined) => setNumDraft(v == null ? undefined : Number(v))}
                  style={{ width: 160 }}
                />
              )}
            </div>
            <div className="health-tl-edit-row">
              <span className="health-tl-edit-label">备注</span>
              <TextArea
                value={noteDraft}
                onChange={(v: string) => setNoteDraft(v)}
                maxLength={200}
                rows={2}
                placeholder="备注（可选）"
              />
            </div>
            <p className="period-caption">日期与指标不可改；改错了请删除后重新记一条。</p>
          </div>
        )}
      </SideSheet>
    </Card>
  )
}
