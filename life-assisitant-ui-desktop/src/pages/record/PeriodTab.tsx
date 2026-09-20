/**
 * PeriodTab —— 经期 Tab 主体（记录模块第 5 个维度，2026-09-19 新增）
 *
 * 桌面端布局（md/spec-260919/04-页面与交互设计.md §8）：月历 + 概览 + 9 组记录表单。
 * 移动端的 9 页横向 swiper 改为「今日快捷记录条 + 点日期打开 Drawer」的桌面形态。
 *
 * 红线守卫：
 *  - 数据不足（confidence=insufficient）一个具体日期都不显示（PeriodOverviewCard）
 *  - 隐私遮罩（👁）开启后只换掩码、不阉割功能（各子组件遵守）
 *  - 所有预测数字带「预计 / 预测」字样
 *
 * 数据来源：usePeriodStore（缓存策略见 05 §13）。
 */
import { useEffect, useState, useCallback } from 'react'
import { Card, Button, Toast, Space, Modal } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { usePeriodStore } from '@/stores/period'
import type { PeriodDayDetail } from '@/api/types'
import PeriodOverviewCard from './components/PeriodOverviewCard'
import PeriodCalendar from './components/PeriodCalendar'
import PeriodDayDrawer from './components/PeriodDayDrawer'
import PeriodHistoryList from './components/PeriodHistoryList'
import PeriodSettingsDrawer from './components/PeriodSettingsDrawer'
import PeriodSetupWizard from './components/PeriodSetupWizard'

/** 本地日期 YYYY-MM-DD */
function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 从现有日记构造写回 payload（整体覆盖语义下必须补齐所有字段，避免误清空） */
export function buildDayPayload(
  existing: PeriodDayDetail | null,
  patch: Partial<PeriodDayDetail>
): Omit<PeriodDayDetail, 'date'> & { date: string } {
  const base: PeriodDayDetail = existing ?? {
    date: '',
    flow: 0,
    symptoms: [],
    pain_level: 0,
    discharge: 0,
    bbt: null,
    weight: null,
    sleep_hours: null,
    intercourse: 0,
    mood: null,
    energy: null,
    note: '',
  }
  return {
    date: '',
    flow: patch.flow ?? base.flow,
    symptoms: patch.symptoms ?? base.symptoms,
    pain_level: patch.pain_level ?? base.pain_level,
    discharge: patch.discharge ?? base.discharge,
    bbt: patch.bbt !== undefined ? patch.bbt : base.bbt,
    weight: patch.weight !== undefined ? patch.weight : base.weight,
    sleep_hours: patch.sleep_hours !== undefined ? patch.sleep_hours : base.sleep_hours,
    intercourse: patch.intercourse ?? base.intercourse,
    mood: patch.mood !== undefined ? patch.mood : base.mood,
    energy: patch.energy !== undefined ? patch.energy : base.energy,
    note: patch.note !== undefined ? patch.note : base.note,
  }
}

export default function PeriodTab() {
  const store = usePeriodStore()
  const [setupVisible, setSetupVisible] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [statsVisible, setStatsVisible] = useState(false)
  const [dayDrawerDate, setDayDrawerDate] = useState<string | null>(null)

  // 进入模块：拉概览 + 周期历史 + 当月月历
  useEffect(() => {
    store.fetchOverview()
    store.fetchCycles()
    const m = todayStr().slice(0, 7)
    store.fetchCalendar(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 首次进入且未初始化 / 未确认免责 → 自动打开引导向导（needSetup）
  useEffect(() => {
    // 本会话已点过「先看看」则不再强推向导（04 §7.5；与移动端 setupSkipped 对齐）
    if (store.setupSkipped) return
    if (store.loaded && !store.initialized) {
      setSetupVisible(true)
    } else if (store.loaded && store.initialized && !store.disclaimerAccepted) {
      setSetupVisible(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded, store.initialized, store.disclaimerAccepted, store.setupSkipped])

  const openDay = useCallback((date: string) => setDayDrawerDate(date), [])

  /** 跳过后不写后端，但本会话内记住，避免向导反复弹出 */
  const handleSkip = useCallback(() => {
    store.skipSetup()
    setSetupVisible(false)
  }, [store])

  /** 任何写操作后强制刷新当前月（cycles_changed=false 时缓存不失效，需手动刷） */
  const refreshMonth = useCallback(() => {
    store.invalidateCalendar()
    store.fetchCalendar(todayStr().slice(0, 7), true)
    store.fetchCycles()
  }, [store])

  /** 今天快捷记录：合并现有今日日记，只改 flow（整体覆盖语义下必须带全字段） */
  const quickFlow = useCallback(
    async (flow: number) => {
      const date = todayStr()
      const payload = buildDayPayload(store.todayLog, { flow })
      const ok = await store.upsertDay(date, { ...payload, date } as any)
      if (ok) {
        refreshMonth()
        Toast.success('已记录今天')
      }
    },
    [store, refreshMonth]
  )

  const masked = store.masked

  return (
    <div className="period-tab">
      {/* 顶部操作行（右侧）：隐私遮罩 / 预测依据 / 设置 */}
      <div className="period-toolbar">
        <span className="period-toolbar-title">
          <Icon name="Droplet" size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} />
          经期
        </span>
        <Space>
          <Button
            theme="borderless"
            type="tertiary"
            icon={<Icon name={masked ? 'EyeOff' : 'Eye'} size={16} />}
            onClick={() => {
              store.toggleMasked()
              Toast.info(masked ? '已显示敏感内容' : '已隐藏敏感内容，再点一次恢复')
            }}
            title={masked ? '显示敏感内容' : '隐藏敏感内容'}
          />
          <Button
            theme="borderless"
            type="tertiary"
            icon={<Icon name="Info" size={16} />}
            onClick={() => setStatsVisible(true)}
            title="预测依据"
          >
            预测依据
          </Button>
          <Button
            theme="solid"
            type="primary"
            icon={<Icon name="Calendar" size={16} />}
            onClick={() => openDay(todayStr())}
          >
            记今天
          </Button>
          <Button
            theme="light"
            type="secondary"
            icon={<Icon name="Settings" size={16} />}
            onClick={() => setSettingsVisible(true)}
          >
            设置
          </Button>
        </Space>
      </div>

      <div className="period-grid">
        <div className="period-col-left">
          <PeriodOverviewCard onOpenSettings={() => setSettingsVisible(true)} />
          <PeriodHistoryList onPickCycle={(start: string) => openDay(start)} />
        </div>
        <div className="period-col-right">
          <PeriodCalendar onPickDate={openDay} />
          {/* 今日快捷记录条 */}
          <Card bordered={false} className="card period-quick">
            <div className="card-head">
              <span className="card-title">今天</span>
            </div>
            <div className="period-quick-row">
              <span className="period-quick-label">经量</span>
              {[
                { v: 2, label: '量少' },
                { v: 3, label: '中等' },
                { v: 4, label: '量多' },
              ].map((o) => (
                <Button
                  key={o.v}
                  size="small"
                  theme={store.todayLog?.flow === o.v ? 'solid' : 'light'}
                  type={store.todayLog?.flow === o.v ? 'primary' : 'secondary'}
                  onClick={() => quickFlow(o.v)}
                >
                  {o.label}
                </Button>
              ))}
              <Button
                size="small"
                theme="light"
                type="secondary"
                onClick={() => openDay(todayStr())}
              >
                + 更多
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* 记录 Drawer（9 组字段） */}
      <PeriodDayDrawer
        date={dayDrawerDate}
        onClose={() => setDayDrawerDate(null)}
        onSaved={refreshMonth}
      />

      {/* 设置 Drawer */}
      <PeriodSettingsDrawer
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onOpenSetup={() => {
          setSettingsVisible(false)
          setSetupVisible(true)
        }}
      />

      {/* 首次引导向导 */}
      <PeriodSetupWizard visible={setupVisible} onClose={() => setSetupVisible(false)} onSkip={handleSkip} />

      {/* 预测依据弹层（ⓘ，仅统计口径、不含个人数据，隐私遮罩下也可正常使用 04 §3.6） */}
      <Modal
        title="预测依据"
        visible={statsVisible}
        onCancel={() => setStatsVisible(false)}
        footer={null}
        width={420}
      >
        {store.prediction ? (
          <div className="period-stats">
            <div className="period-stats-row">
              <span>置信度</span>
              <b>{store.prediction.confidence_reason}</b>
            </div>
            <div className="period-stats-row">
              <span>参考样本</span>
              <b>{store.prediction.sample_size} 个完整周期</b>
            </div>
            {store.prediction.stats && (
              <>
                <div className="period-stats-row">
                  <span>中位周期</span>
                  <b>{store.prediction.stats.median_cycle} 天</b>
                </div>
                <div className="period-stats-row">
                  <span>波动范围</span>
                  <b>
                    {store.prediction.stats.recent_cycles?.length
                      ? store.prediction.stats.recent_cycles.join(' / ')
                      : '—'}
                  </b>
                </div>
              </>
            )}
            <p className="period-stats-hint">
              预测用「中位数 + 稳健波动」估算，而不是平均值 —— 个别异常周期不会把结果带偏。记录
              2–3 个周期后会明显变准，记录基础体温还能确认排卵。
            </p>
          </div>
        ) : (
          <p className="period-stats-hint">预测数据暂不可用，先记录 1–2 次经期即可查看。</p>
        )}
      </Modal>
    </div>
  )
}
