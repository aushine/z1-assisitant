/**
 * CalendarView — 收支日历（桌面端）
 *
 * 规范：md/spec-20260921-v2/03-流水与日历.md §B（收支日历）· §B-8（桌面端）
 *
 * 桌面端布局与移动端**不同**（§8）：不是「月历在上、明细卡在下」，而是
 * **左栏月历 + 右栏当日明细**两栏 —— 桌面横向空间充足，两栏可同时可见。
 *
 * 与移动端的差异（都是端差异，不是口径差异）：
 *   1. 补录手势：桌面鼠标没有「长按」语义 ⇒ 换成**右键**（§8）。
 *      ⚠️ 不实现长按：右键已经覆盖补录意图，两套并存会让「点一下」的语义变模糊。
 *   2. 明细不裁到 3 笔：§4 的「最多 3 笔」是移动端 46px 格子/小屏的取舍，
 *      桌面右栏放得下整日流水（可滚动），裁掉反而要用户再跳一次页。
 *      「查看全部 ›」仍保留 —— 它跳流水页的价值在「继续编辑/筛选」，不在「看到更多」。
 *
 * 数据：同一个 `GET /finance/calendar`（days 只含有记录的日期，summary.net 后端已算）。
 *   ⚠️ 格子净额 = `income − expense`；后端 `CalendarDay` **没有 net 字段**，
 *      只有 summary.net 是后端算好的（03 §B-6）。
 *   ⚠️ 当日流水走 `GET /transactions?start_date=X&end_date=X`：
 *      后端 service 把入参 end_date 解析成当日 00:00 后 **再 +1 天**（右闭 → 内部右开），
 *      即入参是**右闭**语义。若按「左闭右开」传 X+1，会多含次日一整天。
 *
 * ⚠️ 只复用月历的「布局与排版」：类名用 finance-cal-* 独立一份，
 *    不复用经期/健康的 st-* 语义色与指标圆点色（03 §C-2 明确「不抽」）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Skeleton } from '@douyinfe/semi-ui'
import { financeApi } from '@/api/finance'
import { useFinanceStore } from '@/stores/finance'
import { Icon } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import TransactionDetailDrawer from '@/components/TransactionDetailDrawer'
import TransactionEditDrawer from '@/components/TransactionEditDrawer'
import { CategoryIconCell } from '@/pages/record/components/CategoryIconCell'
import { amountColorVar, formatNetAmount, formatSignedAmount, netColorVar } from '@/utils/money'
import type {
  CalendarDay,
  CalendarResp,
  CreateTransactionReq,
  Transaction,
  UpdateTransactionReq,
} from '@/api/types'

/** 周表头从周一开始（与经期/健康月历一致） */
const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function todayStr(): string {
  return dateStr(new Date())
}
function monthStr(d: Date): string {
  return dateStr(d).slice(0, 7)
}

/** 可切换范围：与后端 GetCalendar 的校验对齐（今年 −5 ~ 今年 +1，非法月返回 400001） */
const NOW = new Date()
const MIN_MONTH = `${NOW.getFullYear() - 5}-01`
const MAX_MONTH = `${NOW.getFullYear() + 1}-12`

interface Cell {
  date: string
  day: number
  inMonth: boolean
}

interface Props {
  /** 「查看全部 ›」→ 切到流水子视图并带上该日筛选 */
  onViewAll?: (date: string) => void
}

export function CalendarView({ onViewAll }: Props) {
  const accounts = useFinanceStore((s) => s.accounts)
  const fetchAccounts = useFinanceStore((s) => s.fetchAccounts)
  const createTransaction = useFinanceStore((s) => s.createTransaction)
  const updateTransaction = useFinanceStore((s) => s.updateTransaction)

  const [viewMonth, setViewMonth] = useState(() => monthStr(NOW))
  const [selectedDate, setSelectedDate] = useState(() => todayStr())

  const [data, setData] = useState<CalendarResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const [dayTxs, setDayTxs] = useState<Transaction[]>([])
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState(false)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [createFor, setCreateFor] = useState<string | null>(null)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [saving, setSaving] = useState(false)

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await financeApi.getCalendar(viewMonth)
      setData(res)
    } catch {
      setData(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [viewMonth])

  const loadDay = useCallback(async () => {
    setDayLoading(true)
    setDayError(false)
    try {
      // ⚠️ 右闭语义（见文件头说明）：查「某一天」必须 start_date === end_date
      const res = await financeApi.listTransactions({
        start_date: selectedDate,
        end_date: selectedDate,
        page: 1,
        page_size: 100,
      })
      setDayTxs(res.items ?? [])
    } catch {
      setDayTxs([])
      setDayError(true)
    } finally {
      setDayLoading(false)
    }
  }, [selectedDate])

  useEffect(() => {
    void loadCalendar()
  }, [loadCalendar])

  useEffect(() => {
    void loadDay()
  }, [loadDay])

  useEffect(() => {
    if (accounts.length === 0) void fetchAccounts()
  }, [accounts.length, fetchAccounts])

  const tStr = todayStr()

  const cells = useMemo<Cell[]>(() => {
    const [y, m] = viewMonth.split('-').map(Number)
    const firstWeekDay = new Date(y, m - 1, 1).getDay()
    const firstCol = (firstWeekDay + 6) % 7 // 周一为第 0 列
    const daysInMonth = new Date(y, m, 0).getDate()
    const rows = Math.min(6, Math.max(4, Math.ceil((firstCol + daysInMonth) / 7)))
    const out: Cell[] = []
    for (let i = 0; i < rows * 7; i++) {
      const dayNum = i - firstCol + 1
      const d = new Date(y, m - 1, dayNum)
      out.push({
        date: dateStr(d),
        day: d.getDate(),
        inMonth: dayNum >= 1 && dayNum <= daysInMonth,
      })
    }
    return out
  }, [viewMonth])

  const dayMap = useMemo(() => {
    const map: Record<string, CalendarDay> = {}
    for (const d of data?.days ?? []) map[d.date] = d
    return map
  }, [data])

  function shift(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number)
    const next = monthStr(new Date(y, m - 1 + delta, 1))
    if (next < MIN_MONTH || next > MAX_MONTH) return
    setViewMonth(next)
    // 切月后右栏跟随：选中日不在新月份时，落到该月 1 号（本月则回今天）
    setSelectedDate((cur) =>
      cur.slice(0, 7) === next ? cur : next === tStr.slice(0, 7) ? tStr : `${next}-01`
    )
  }

  async function refreshAll() {
    await loadCalendar()
    await loadDay()
  }

  async function handleCreate(payload: CreateTransactionReq) {
    setSaving(true)
    try {
      const created = await createTransaction(payload)
      if (created) {
        setCreateFor(null)
        await refreshAll()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(id: string, payload: UpdateTransactionReq) {
    setSaving(true)
    try {
      const updated = await updateTransaction(id, payload)
      if (updated) {
        setEditTx(null)
        await refreshAll()
      }
    } finally {
      setSaving(false)
    }
  }

  const [yy, mm] = viewMonth.split('-').map(Number)
  const summary = data?.summary
  const net = summary?.net ?? 0

  const dayRec = dayMap[selectedDate]
  const dayIncome = dayRec?.income ?? 0
  const dayExpense = dayRec?.expense ?? 0
  const isSelectedToday = selectedDate === tStr
  const selDate = new Date(`${selectedDate}T00:00:00`)
  const selLabel = `${selDate.getMonth() + 1} 月 ${selDate.getDate()} 日 ${WEEK_CN[selDate.getDay()]}`

  const canPrev = viewMonth > MIN_MONTH
  const canNext = viewMonth < MAX_MONTH

  return (
    <div className="finance-cal-layout">
      {/* ==================== 左栏：月历 ==================== */}
      <Card bordered={false} className="card finance-cal-card">
        {loading && !data ? (
          <Skeleton placeholder={<Skeleton.Paragraph rows={7} />} loading active>
            <div style={{ height: 280 }} />
          </Skeleton>
        ) : error && !data ? (
          <ErrorState compact message="日历加载失败，请重试" onRetry={() => void loadCalendar()} />
        ) : (
          <>
            {/* 月份摘要（该月，不是「本月」；切月跟着变） */}
            <div className="finance-cal-summary">
              <span className="finance-cal-summary-month">{yy} 年 {mm} 月</span>
              <span className="finance-cal-summary-item" style={{ color: 'var(--color-success)' }}>
                收入 {formatSignedAmount(summary?.income ?? 0, 'income')}
              </span>
              <span className="finance-cal-summary-item" style={{ color: 'var(--color-danger)' }}>
                支出 {formatSignedAmount(summary?.expense ?? 0, 'expense')}
              </span>
              <span className="finance-cal-summary-item" style={{ color: netColorVar(net) }}>
                结余 {formatSignedAmount(Math.abs(net), net >= 0 ? 'income' : 'expense')}
              </span>
            </div>

            <div className="finance-cal-head">
              <span className="finance-cal-title">{yy} 年 {mm} 月</span>
              <div className="finance-cal-nav-group">
                <button
                  type="button"
                  className="finance-cal-nav-btn"
                  onClick={() => shift(-1)}
                  disabled={!canPrev}
                  style={{ opacity: canPrev ? 1 : 0.3 }}
                  aria-label="上个月"
                >
                  ‹
                </button>
                {viewMonth !== monthStr(NOW) && (
                  <button
                    type="button"
                    className="finance-cal-nav-btn finance-cal-nav-text"
                    onClick={() => {
                      const cur = monthStr(NOW)
                      setViewMonth(cur)
                      setSelectedDate(tStr)
                    }}
                  >
                    回到本月
                  </button>
                )}
                <button
                  type="button"
                  className="finance-cal-nav-btn"
                  onClick={() => shift(1)}
                  disabled={!canNext}
                  style={{ opacity: canNext ? 1 : 0.3 }}
                  aria-label="下个月"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="finance-cal-week">
              {WEEK.map((w, i) => (
                <span
                  key={w}
                  className="finance-cal-week-cell"
                  style={{ color: i >= 5 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}
                >
                  {w}
                </span>
              ))}
            </div>

            <div className={`finance-cal-grid${loading ? ' is-loading' : ''}`}>
              {cells.map((c) => {
                if (!c.inMonth) return <span key={c.date} className="finance-cal-cell empty" />
                const rec = dayMap[c.date]
                const cellNet = rec ? rec.income - rec.expense : 0
                const isToday = c.date === tStr
                const isSelected = c.date === selectedDate
                return (
                  <button
                    key={c.date}
                    type="button"
                    className={
                      'finance-cal-cell' +
                      (isToday ? ' is-today' : '') +
                      (isSelected ? ' is-selected' : '')
                    }
                    title={`${c.date}（右键补录）`}
                    onClick={() => setSelectedDate(c.date)}
                    onContextMenu={(e) => {
                      // 桌面端没有「长按」语义 ⇒ 右键 = 补录（03 §B-8）
                      e.preventDefault()
                      setCreateFor(c.date)
                    }}
                  >
                    <span className="finance-cal-day">{c.day}</span>
                    {rec && (
                      <span className="finance-cal-net" style={{ color: netColorVar(cellNet) }}>
                        {formatNetAmount(cellNet)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="finance-cal-hint">右键任意日期可补录当天账目</div>
          </>
        )}
      </Card>

      {/* ==================== 右栏：当日明细 ==================== */}
      <Card bordered={false} className="card finance-cal-daycard">
        <div className="finance-cal-dayhead">
          <span className="finance-cal-daytitle">
            {isSelectedToday && <span className="finance-cal-today-tag">今天 · </span>}
            {selLabel}
          </span>
          <span className="finance-cal-daycount">{dayTxs.length} 笔</span>
        </div>

        <div className="finance-cal-daysum">
          <span style={{ color: 'var(--color-success)' }}>
            收入 {formatSignedAmount(dayIncome, 'income')}
          </span>
          <span style={{ color: 'var(--color-danger)' }}>
            支出 {formatSignedAmount(dayExpense, 'expense')}
          </span>
        </div>

        <div className="finance-cal-txlist">
          {dayLoading ? (
            <Skeleton placeholder={<Skeleton.Paragraph rows={3} />} loading active>
              <div style={{ height: 120 }} />
            </Skeleton>
          ) : dayError ? (
            <ErrorState compact message="明细加载失败，请重试" onRetry={() => void loadDay()} />
          ) : dayTxs.length === 0 ? (
            <div className="finance-cal-empty">
              <Icon name="Inbox" size={28} />
              <div className="finance-cal-empty-text">这天没有记录</div>
              <Button theme="light" type="secondary" size="small" onClick={() => setCreateFor(selectedDate)}>
                记一笔
              </Button>
            </div>
          ) : (
            dayTxs.map((t) => (
              <button
                key={t.id}
                type="button"
                className="finance-cal-txrow"
                onClick={() => setDetailId(t.id)}
              >
                <CategoryIconCell
                  categoryId={t.category_id}
                  categoryName={t.category_name}
                  categoryEmoji={t.category_emoji}
                />
                <span className="finance-cal-txamt" style={{ color: amountColorVar(t.type) }}>
                  {formatSignedAmount(t.amount, t.type)}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="finance-cal-actions">
          <Button theme="light" type="secondary" size="small" onClick={() => setCreateFor(selectedDate)}>
            <Icon name="Plus" size={14} />
            <span style={{ marginLeft: 4 }}>记一笔</span>
          </Button>
          <Button
            theme="borderless"
            type="primary"
            size="small"
            onClick={() => onViewAll?.(selectedDate)}
          >
            <span style={{ marginRight: 2 }}>查看全部</span>
            <Icon name="ChevronRight" size={14} />
          </Button>
        </div>
      </Card>

      {/* ==================== 抽屉 ==================== */}
      <TransactionDetailDrawer
        visible={detailId !== null}
        txId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(tx) => {
          setDetailId(null)
          setEditTx(tx)
        }}
        onDeleted={refreshAll}
      />

      <TransactionEditDrawer
        visible={createFor !== null}
        mode="create"
        transaction={null}
        defaultType="expense"
        defaultDate={createFor ?? undefined}
        accounts={accounts}
        saving={saving}
        onClose={() => setCreateFor(null)}
        onSubmit={handleCreate}
      />

      <TransactionEditDrawer
        visible={editTx !== null}
        mode="edit"
        transaction={editTx}
        defaultType={editTx?.type ?? 'expense'}
        accounts={accounts}
        saving={saving}
        onClose={() => setEditTx(null)}
        onSubmit={handleCreate}
        onEditSubmit={handleEdit}
      />
    </div>
  )
}

export default CalendarView
