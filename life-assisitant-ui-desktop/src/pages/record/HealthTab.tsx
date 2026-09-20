/**
 * HealthTab —— 健康 Tab 主容器（桌面版）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/health/HealthSection.vue
 * SYNC-FROM:        src/pages/record/PeriodTab.tsx（布局与编排风格）
 *
 * 布局（09 §12.1，260920 修订）：.health-grid 两列栅格（380px / 1fr，@1100 退化为单列）。
 *   左栏：① 今日健康（分类卡）→ ② 今日心情（MoodSection 移入本组件内部渲染，
 *         否则「插在今日健康卡与时间轴之间」在兄弟层级上做不到）→ ③ 今日时间轴；
 *   右栏：月历（宽屏才有意义）+ 月份摘要条 + 图例（都在 HealthCalendar 内）。
 *
 * ⚠️ HealthQuickBar 已删除（02 §16.7）：它的录入入口由今日健康分类卡的行接手，
 *    它走 saveDay 写身体指标的调用是 P0 静默失效的根因，随重做一并消灭。
 * ⚠️ 页内不再重复「健康」标题（二级 tab 已表达）；健康设置齿轮移到概览卡右上角（10 §8）。
 *
 * 数据来源：useHealthStore（缓存策略见 05 §13）。记录浮层按 settings.metrics_enabled
 * 动态组装面板（在 HealthDayDrawer 内完成），支持 metricKey 直达（02 §16.4）。
 */
import { useEffect, useState, useCallback } from 'react'
import { Button, Skeleton } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import { useHealthStore } from '@/stores/health'
import HealthOverviewCard from './components/HealthOverviewCard'
import HealthCalendar from './components/HealthCalendar'
import HealthTodayTimeline from './components/HealthTodayTimeline'
import MoodSection from './components/MoodSection'
import HealthDayDrawer from './components/HealthDayDrawer'
import HealthSettingsDrawer from './components/HealthSettingsDrawer'
import HealthSetupWizard from './components/HealthSetupWizard'

/** 本地日期 YYYY-MM-DD */
function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** events key → 浮层面板 key（睡眠面板叫 energy_sleep） */
function panelKey(k: string): string {
  return k === 'sleep' ? 'energy_sleep' : k
}

export default function HealthTab() {
  const store = useHealthStore()
  const [setupVisible, setSetupVisible] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [dayDrawerDate, setDayDrawerDate] = useState<string | null>(null)
  /** 直达该指标那一面板（02 §16.4）；空 = 全部展开（月历入口） */
  const [dayDrawerMetric, setDayDrawerMetric] = useState<string>('')
  const [loadError, setLoadError] = useState(false)

  const reload = useCallback(() => {
    setLoadError(false)
    Promise.all([store.fetchOverview(), store.fetchCalendar(todayStr().slice(0, 7), true)]).then(
      ([ov]) => setLoadError(!ov),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDay = useCallback((date: string) => {
    setDayDrawerMetric('')
    setDayDrawerDate(date)
  }, [])

  /** 分类卡某行 / 时间轴缺口 → 打开浮层并直达该指标那一面板 */
  const openMetric = useCallback(
    (key: string) => {
      setDayDrawerMetric(panelKey(key))
      setDayDrawerDate(store.today || todayStr())
    },
    [store.today],
  )

  /** 是否启用经期（门控月历的经期图例，与后端 marks 的门控保持一致） */
  const periodOn = useHealthStore((s) => s.enabledMetrics().includes('period'))

  const handleSkip = useCallback(() => {
    store.skipSetup()
    setSetupVisible(false)
  }, [store])

  // 加载中
  if (!store.loaded) {
    return (
      <div className="health-tab">
        <Skeleton placeholder={<Skeleton.Paragraph rows={6} />} loading={true} active>
          <span />
        </Skeleton>
      </div>
    )
  }

  // 加载失败
  if (loadError) {
    return (
      <div className="health-tab">
        <ErrorState compact message="健康数据加载失败，请重试" onRetry={reload} />
      </div>
    )
  }

  // 未初始化 → 引导入口
  if (!store.initialized) {
    return (
      <div className="health-tab">
        <section className="health-guide">
          <div className="health-guide-icon">
            <Icon name="HeartPulse" size={32} />
          </div>
          <h3 className="health-guide-title">记录你的身体节律</h3>
          <p className="health-guide-desc">
            经期、症状、心情、睡眠、体重、饮水、排便……一次勾选你关心的指标，每天花一分钟打卡。
          </p>
          <Button theme="solid" type="primary" block onClick={() => setSetupVisible(true)}>
            开始设置
          </Button>
          <Button theme="borderless" type="tertiary" block onClick={() => openDay(todayStr())}>
            先随便记记
          </Button>
        </section>

        <HealthSetupWizard visible={setupVisible} onClose={() => setSetupVisible(false)} onSkip={handleSkip} />
      </div>
    )
  }

  // 已初始化：正常视图（.health-grid 两列，09 §12.1）
  return (
    <div className="health-tab">
      <div className="health-grid">
        {/* ===== 左栏 380px：今日健康 → 今日心情 → 今日时间轴 ===== */}
        <div className="health-grid-left">
          <HealthOverviewCard onOpenMetric={openMetric} onOpenSettings={() => setSettingsVisible(true)} />
          <MoodSection collapse />
          <HealthTodayTimeline onOpenMetric={openMetric} onOpenToday={() => openDay(todayStr())} />
        </div>

        {/* ===== 右栏 1fr：月历 + 月份摘要条 + 图例 ===== */}
        <div className="health-grid-right">
          <HealthCalendar onPickDate={openDay} periodOn={periodOn} />
        </div>
      </div>

      {/* 记录抽屉（按 settings.metrics_enabled 动态分页，支持 metricKey 直达） */}
      <HealthDayDrawer
        date={dayDrawerDate}
        metricKey={dayDrawerMetric}
        onClose={() => setDayDrawerDate(null)}
        onSaved={reload}
      />

      {/* 设置抽屉 —— 经期设置已并入这里（onOpenSetup 让它能直接开经期向导） */}
      <HealthSettingsDrawer
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onOpenSetup={() => {
          setSettingsVisible(false)
          setSetupVisible(true)
        }}
      />

      {/* 引导向导（一般不需要，但仍可被「设置」等入口触发） */}
      <HealthSetupWizard visible={setupVisible} onClose={() => setSetupVisible(false)} onSkip={handleSkip} />
    </div>
  )
}
