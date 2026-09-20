/**
 * HealthStats — 统计 → 健康领域（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/pages/stat/index.vue（健康分支）
 * 最后同步：2026-09-19（md/spec-20260919-v1 · 05 §5 / §6）
 *
 * 四块内容，全部从 `GET /health/days?start=&end=` **现算**，不新增后端接口：
 *   1. 体重曲线（含 7 日移动平均线）
 *   2. 饮水达标（达标率 + 连续达标天数）
 *   3. 排便（周频次柱状 + 形态分布饼图）
 *   4. 体温曲线（自动标注升温台阶）
 *
 * ⚠️ 健康红线（spec 05 §6.2，违反就是产品事故）：
 *   - 不做诊断（不说"体温异常""可能有内分泌问题"）
 *   - 不做价值判断（不说"偏胖/偏瘦/不健康/排便不正常"）
 *   - 不造指标（不做「健康评分」「身体年龄」）
 *   - **不为体重上红绿**：曲线统一用 --color-primary 中性色
 *   - 体重 ±0.5kg 内说「持平」，不用涨跌箭头
 *   - 唯一允许的提示是中性陈述 + 「不构成医学诊断」尾注
 *
 * ⚠️ 数据不足的降级（spec 05 §6.3）：
 *   - 只有 1 个数据点 → 不画趋势，只显示该点 + 引导文案
 *   - 体重记录 < 7 天 → 不画 7 日均线（均线本身不可信）
 *   - 区间内该指标 0 记录 → 空态，不画空图
 */
import { useEffect, useMemo, useState } from 'react'
import { Card } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { healthApi } from '@/api/health'
import { BOWEL_TYPE_OPTIONS, DEFAULT_WATER_GOAL_ML } from '@/constants/health'
import { LineChartCard } from '@/components/charts/LineChartCard'
import { BarChartCard } from '@/components/charts/BarChartCard'
import { DoughnutCard } from '@/components/charts/DoughnutCard'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import type { HealthDayDetail, HealthSettings } from '@/api/types'

/** 中性色（体重/体温都用它，绝不按数值上红绿） */
const NEUTRAL = '#014DB2'

/** 排便形态分布的取色：中性色阶，只区分类别，不表达好坏 */
const BOWEL_TINTS = ['#014DB2', '#0284C7', '#0EA5E9', '#38BDF8']

/** 7 日移动平均；不足 window 天返回 null（均线不可信，宁可不画） */
function movingAverage(values: (number | null)[], window = 7): (number | null)[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1)
    const seg = values.slice(from, i + 1).filter((v): v is number => v != null)
    if (seg.length < window) return null
    return seg.reduce((a, b) => a + b, 0) / seg.length
  })
}

/** 日期 → MM-DD */
function shortDate(d: string): string {
  return d.length >= 10 ? d.slice(5) : d
}

export function HealthStats({ range }: { range: '7d' | '30d' | '90d' }) {
  const [days, setDays] = useState<HealthDayDetail[]>([])
  const [settings, setSettings] = useState<HealthSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)

    const daysN = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - (daysN - 1))
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    Promise.all([
      healthApi.listDays({ start: iso(start), end: iso(end) }),
      healthApi.getSettings(),
    ])
      .then(([list, st]) => {
        if (!alive) return
        setDays(list.items ?? [])
        setSettings(st)
      })
      .catch(() => {
        if (!alive) return
        setDays([])
        setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [range])

  const goal = settings?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML

  /* ==================== 1. 体重 ==================== */
  const weightPoints = useMemo(
    () => days.filter((d) => d.weight_kg != null && d.weight_kg > 0),
    [days]
  )
  const weightSeries = useMemo(
    () => weightPoints.map((d) => ({ label: shortDate(d.date), value: d.weight_kg as number })),
    [weightPoints]
  )
  const weightMA = useMemo(() => {
    if (weightPoints.length < 7) return null
    const ma = movingAverage(weightPoints.map((d) => d.weight_kg as number))
    return weightPoints.map((d, i) => ({
      label: shortDate(d.date),
      value: ma[i] == null ? 0 : Number((ma[i] as number).toFixed(2)),
    }))
  }, [weightPoints])

  /** 变化量：±0.5kg 内说「持平」（不做价值判断、不画涨跌箭头） */
  const weightDelta = useMemo(() => {
    if (weightPoints.length < 2) return null
    const first = weightPoints[0].weight_kg as number
    const last = weightPoints[weightPoints.length - 1].weight_kg as number
    const diff = last - first
    if (Math.abs(diff) <= 0.5) return { text: '持平', diff }
    return { text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg`, diff }
  }, [weightPoints])

  /* ==================== 2. 饮水 ==================== */
  const waterStats = useMemo(() => {
    const logged = days.filter((d) => d.water_ml > 0)
    const okDays = logged.filter((d) => d.water_ml >= goal)
    // 连续达标：从最近有记录的一天往前数
    let streak = 0
    for (let i = logged.length - 1; i >= 0; i--) {
      if (logged[i].water_ml >= goal) streak++
      else break
    }
    return {
      loggedDays: logged.length,
      okDays: okDays.length,
      rate: logged.length > 0 ? Math.round((okDays.length / logged.length) * 100) : 0,
      streak,
    }
  }, [days, goal])

  /* ==================== 3. 排便 ==================== */
  /** 周频次：按 ISO 周聚合（用日期差 /7 分桶，简单够用） */
  const bowelWeekly = useMemo(() => {
    if (days.length === 0) return []
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const buckets = new Map<number, { sum: number; label: string }>()
    sorted.forEach((d) => {
      const t = new Date(d.date).getTime()
      const key = Math.floor(t / (7 * 86400000))
      const cur = buckets.get(key) ?? { sum: 0, label: shortDate(d.date) }
      cur.sum += d.bowel_count
      buckets.set(key, cur)
    })
    return [...buckets.values()].map((b) => ({ label: b.label, value: b.sum }))
  }, [days])

  const bowelTypeData = useMemo(() => {
    const counts = new Map<number, number>()
    days.forEach((d) => {
      if (d.bowel_type > 0) counts.set(d.bowel_type, (counts.get(d.bowel_type) ?? 0) + 1)
    })
    return BOWEL_TYPE_OPTIONS.filter((o) => counts.has(o.value)).map((o, i) => ({
      label: o.label,
      value: counts.get(o.value) ?? 0,
      // 中性色阶：形态只是描述性分布，不按「好坏」上色
      color: BOWEL_TINTS[i % BOWEL_TINTS.length],
    }))
  }, [days])

  /* ==================== 4. 体温 ==================== */
  const bbtPoints = useMemo(() => days.filter((d) => d.bbt != null && d.bbt > 0), [days])
  const bbtSeries = useMemo(
    () => bbtPoints.map((d) => ({ label: shortDate(d.date), value: d.bbt as number })),
    [bbtPoints]
  )
  /**
   * 升温台阶：连续 3 天 ≥ 前 6 天均值 + 0.2℃ 的第一天。
   * 只做**标记**，不做诊断文案。
   */
  const bbtStepLabel = useMemo(() => {
    const vals = bbtPoints.map((d) => d.bbt as number)
    for (let i = 6; i < vals.length - 2; i++) {
      const prev = vals.slice(i - 6, i)
      const mean = prev.reduce((a, b) => a + b, 0) / prev.length
      const ok = [0, 1, 2].every((k) => vals[i + k] >= mean + 0.2)
      if (ok) return shortDate(bbtPoints[i].date)
    }
    return null
  }, [bbtPoints])

  if (loading) {
    return (
      <Card bordered={false} className="card">
        <div className="card-head">
          <span className="card-title">
            <Icon name="HeartPulse" size={20} style={{ marginRight: 6 }} />健康
          </span>
        </div>
        <div style={{ height: 200 }} />
      </Card>
    )
  }

  if (error) {
    return (
      <Card bordered={false} className="card">
        <ErrorState compact message="健康数据加载失败，请重试" onRetry={() => setError(false)} />
      </Card>
    )
  }

  const hasAny = days.length > 0

  return (
    <>
      {/* ⚠️ 体重曲线占整行、height=300 —— 桌面端优势是宽度，别塞进半栏 */}
      <Card bordered={false} className="card">
        <div className="card-head">
          <span className="card-title">
            <Icon name="TrendingUp" size={20} style={{ marginRight: 6 }} />体重曲线
          </span>
          <span className="card-sub">
            {weightPoints.length === 1
              ? '再记录几次就能看到趋势'
              : weightPoints.length < 7
                ? '记录满 7 天后显示 7 日均线'
                : weightDelta?.text ?? ''}
          </span>
        </div>
        {weightPoints.length === 0 ? (
          <EmptyHint icon="Inbox" title="该区间没有体重记录" />
        ) : weightPoints.length === 1 ? (
          <div className="health-single">
            <span className="health-single-value">{weightPoints[0].weight_kg?.toFixed(1)} kg</span>
            <span className="health-single-hint">再记录几次就能看到趋势</span>
          </div>
        ) : (
          <LineChartCard
            data={weightSeries}
            color={NEUTRAL}
            height={300}
            // 7 日移动平均线（虚线对照）；<7 天记录时 weightMA 为 null → 不画
            compare={weightMA ?? undefined}
          />
        )}
      </Card>

      <div className="chart-row">
        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title">
              <Icon name="Droplet" size={20} style={{ marginRight: 6 }} />饮水达标
            </span>
            <span className="card-sub">目标 {goal} ml</span>
          </div>
          {waterStats.loggedDays === 0 ? (
            <EmptyHint icon="Inbox" title="该区间没有饮水记录" />
          ) : (
            <div className="health-metric-row">
              <div className="health-metric">
                <div className="health-metric-value">{waterStats.rate}%</div>
                <div className="health-metric-label">达标率</div>
              </div>
              <div className="health-metric">
                <div className="health-metric-value">{waterStats.streak}</div>
                <div className="health-metric-label">连续达标天数</div>
              </div>
              <div className="health-metric">
                <div className="health-metric-value">
                  {waterStats.okDays}/{waterStats.loggedDays}
                </div>
                <div className="health-metric-label">达标 / 有记录</div>
              </div>
            </div>
          )}
        </Card>

        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title">
              <Icon name="BarChart3" size={20} style={{ marginRight: 6 }} />排便频次
            </span>
            <span className="card-sub">按周</span>
          </div>
          {bowelWeekly.length === 0 ? (
            <EmptyHint icon="Inbox" title="该区间没有排便记录" />
          ) : (
            <BarChartCard data={bowelWeekly} color={NEUTRAL} height={260} />
          )}
        </Card>
      </div>

      <div className="chart-row">
        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title">
              <Icon name="PieChart" size={20} style={{ marginRight: 6 }} />排便形态分布
            </span>
          </div>
          {bowelTypeData.length === 0 ? (
            <EmptyHint icon="Inbox" title="该区间没有形态记录" />
          ) : (
            <DoughnutCard data={bowelTypeData} height={260} />
          )}
        </Card>

        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title">
              <Icon name="Thermometer" size={20} style={{ marginRight: 6 }} />体温曲线
            </span>
            <span className="card-sub">{bbtStepLabel ? `升温台阶 ${bbtStepLabel}` : ''}</span>
          </div>
          {bbtPoints.length === 0 ? (
            <EmptyHint icon="Inbox" title="该区间没有体温记录" />
          ) : bbtPoints.length === 1 ? (
            <div className="health-single">
              <span className="health-single-value">{bbtPoints[0].bbt?.toFixed(2)} ℃</span>
              <span className="health-single-hint">再记录几次就能看到趋势</span>
            </div>
          ) : (
            <LineChartCard data={bbtSeries} color={NEUTRAL} height={260} />
          )}
        </Card>
      </div>

      {hasAny && (
        <p className="health-disclaimer">
          以上仅为记录的描述性统计，不构成医学诊断。如有不适请咨询专业医生。
        </p>
      )}
    </>
  )
}

export default HealthStats
