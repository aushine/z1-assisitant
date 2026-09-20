/**
 * HealthDayDrawer —— 健康记录浮层（桌面版）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/health/HealthDaySheet.vue
 * SYNC-FROM:        src/pages/record/components/PeriodDayDrawer.tsx（复用 Collapse 结构）
 *
 * 与经期浮层的差异：
 *   1. 分页**按 settings.metrics_enabled 动态组装**（最多 11 页），而不是固定 9 页。
 *   2. 数据形状是 HealthDayDetail：经期相关字段落在 `period` 子块，心情落在 `moods` 子块，
 *      体重/体温/睡眠/饮水/排便/备注是顶层标量。
 *   3. 整体提交仍走 store.saveDay（取回→合并→整体提交），保证「只改饮水不抹其它指标」。
 *
 * 空提交（全空点「完成」）→ 视为删除该日记录，仅在该日原本已有记录时弹二次确认。
 */
import { useEffect, useState, useMemo } from 'react'
import {
  SideSheet,
  Collapse,
  Radio,
  Checkbox,
  InputNumber,
  TextArea,
  Button,
  Toast,
  Modal,
  Tag,
} from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { useHealthStore } from '@/stores/health'
import HealthEventList from './HealthEventList'
import {
  HEALTH_METRICS,
  BOWEL_TYPE_OPTIONS,
  DEFAULT_WATER_GOAL_ML,
  normalizeWaterStep,
  waterQuickOptions,
} from '@/constants/health'
import {
  PERIOD_SYMPTOM_GROUPS,
  PERIOD_DEFAULT_RECENT_SYMPTOMS,
  PERIOD_DISCHARGE_OPTIONS,
  PERIOD_INTERCOURSE_OPTIONS,
  periodSymptomLabel,
} from '@/constants/period'
import { MOOD_VALUES_ASC, ENERGY_VALUES_ASC, MOOD_META, ENERGY_META } from '@/utils/mood-dict'
import type { HealthDayDetail } from '@/api/types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 排便形态：value → 标签（时间轴上要把 1/2/3/4 显示成人话） */
const BOWEL_TYPE_LABEL: Record<number, string> = (() => {
  const m: Record<number, string> = {}
  for (const o of BOWEL_TYPE_OPTIONS) m[o.value] = o.label
  return m
})()

function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  const wd = new Date(date).getDay()
  return `${m}月${d}日 星期${WEEKDAYS[wd]}`
}

/** 经量（0-4）选项 */
const FLOW_OPTIONS = [
  { v: 0, l: '未出血' },
  { v: 1, l: '点滴出血' },
  { v: 2, l: '量少' },
  { v: 3, l: '中等' },
  { v: 4, l: '量多' },
]

/** 各维度 ⓘ 说明（文案逐字与产品稿一致） */
const DIM_INFO: Record<string, string> = {
  period: '记录每天的实际出血情况。经量会随时间变化，连续记录能看出这个月偏多还是偏少。',
  symptoms: '身体的不适同样值得留档。记录 2–3 个周期后，你就能看到「哪些症状总在经前出现」。',
  mood: '心情与激素水平相关，黄体期出现情绪波动是常见现象，记录下来能帮你提前做心理准备。',
  energy_sleep: '卵泡期精力通常较好，黄体期容易疲惫；睡眠时长则影响第二天的状态。',
  bbt: '基础体温需要在早晨醒来、未起床、未进食时测量。排卵后体温会升高 0.2–0.5℃ 并维持到下次经期。',
  weight: '黄体期因水钠潴留，体重上升 0.5–2kg 属正常波动，不必因此焦虑。',
  water: '充足饮水有助于代谢。设一个适合你的目标，每天看一眼进度就好。',
  bowel: '排便形态与频率是肠道健康最直接的信号，4 档足够日常记录，不必追求临床精确。',
  discharge: '分泌物随周期变化：接近排卵时会变得清亮、可拉丝，这是生育力最高的信号。',
  sex: '仅供你自己参考。数据默认不显示在首页或统计中。',
  note: '想记点什么都可以，自由书写，作为当天的补充备注。',
}

interface FormState {
  water_ml: number
  weight_kg: number | null
  bbt: number | null
  sleep_hours: number | null
  bowel_count: number
  bowel_type: number
  period: { flow: number; symptoms: string[]; pain_level: number; discharge: number; intercourse: number }
  moods: { mood: number; energy: number; note: string }
}

function emptyForm(): FormState {
  return {
    water_ml: 0,
    weight_kg: null,
    bbt: null,
    sleep_hours: null,
    bowel_count: 0,
    bowel_type: 0,
    period: { flow: 0, symptoms: [], pain_level: 0, discharge: 0, intercourse: 0 },
    moods: { mood: 0, energy: 0, note: '' },
  }
}

function fromDay(day: HealthDayDetail | null): FormState {
  if (!day) return emptyForm()
  return {
    water_ml: day.water_ml,
    weight_kg: day.weight_kg ?? null,
    bbt: day.bbt ?? null,
    sleep_hours: day.sleep_hours ?? null,
    bowel_count: day.bowel_count,
    bowel_type: day.bowel_type,
    period: {
      flow: day.period.flow,
      symptoms: [...day.period.symptoms],
      pain_level: day.period.pain_level,
      discharge: day.period.discharge,
      intercourse: day.period.intercourse,
    },
    moods: {
      mood: day.moods.mood ?? 0,
      energy: day.moods.energy ?? 0,
      note: day.moods.note ?? '',
    },
  }
}

function isEmpty(f: FormState): boolean {
  return (
    f.water_ml === 0 &&
    f.weight_kg == null &&
    f.bbt == null &&
    f.sleep_hours == null &&
    f.bowel_count === 0 &&
    f.bowel_type === 0 &&
    f.period.flow === 0 &&
    f.period.symptoms.length === 0 &&
    f.period.pain_level === 0 &&
    f.period.discharge === 0 &&
    f.period.intercourse === 0 &&
    f.moods.mood === 0 &&
    f.moods.energy === 0 &&
    !f.moods.note.trim()
  )
}

export default function HealthDayDrawer({
  date,
  metricKey,
  onClose,
  onSaved,
}: {
  date: string | null
  /** 直达该指标那一面板（02 §16.4）；优先于「全部展开」——
   *  传入时只展开目标面板（定位），不传则默认全部展开（月历/空态入口）。 */
  metricKey?: string
  onClose: () => void
  onSaved?: () => void
}) {
  const store = useHealthStore()
  const [form, setForm] = useState<FormState>(emptyForm())
  const [hadRecord, setHadRecord] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [lastBbt, setLastBbt] = useState<number | null>(null)
  const [lastWeight, setLastWeight] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!date) return
    let alive = true
    setForm(emptyForm())
    setHadRecord(false)
    store.fetchDay(date).then((resp) => {
      if (!alive) return
      if (resp) {
        setForm(fromDay(resp.day))
        setHadRecord(!!resp.day)
        setRecent(resp.recent_symptoms?.length ? resp.recent_symptoms : [...PERIOD_DEFAULT_RECENT_SYMPTOMS])
        setLastBbt(resp.health_last_values?.bbt ?? null)
        setLastWeight(resp.health_last_values?.weight_kg ?? null)
      }
    })
    // 身体指标的真源是 events，与日详情一并拉（时间轴 UI 要用）
    void store.fetchDayEvents(date)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const open = !!date
  // ⚠️ 身体指标已迁到 events，不再走 `set`；period / moods 用各自的 setter。
  const setPeriod = <K extends keyof FormState['period']>(k: K, v: FormState['period'][K]) =>
    setForm((f) => ({ ...f, period: { ...f.period, [k]: v } }))
  const setMood = <K extends keyof FormState['moods']>(k: K, v: FormState['moods'][K]) =>
    setForm((f) => ({ ...f, moods: { ...f.moods, [k]: v } }))

  const toggleSymptom = (key: string, on: boolean) =>
    setPeriod('symptoms', on ? [...form.period.symptoms, key] : form.period.symptoms.filter((k) => k !== key))

  const recentChips = useMemo(() => (recent.length ? recent : PERIOD_DEFAULT_RECENT_SYMPTOMS), [recent])

  // 按 HEALTH_METRICS 顺序过滤出已启用的分页（满足 dependsOn 约束）
  const enabledMetrics = store.settings?.metrics_enabled ?? []
  const panels = useMemo(
    () => HEALTH_METRICS.filter((m) => enabledMetrics.includes(m.key) && !(m.dependsOn && !enabledMetrics.includes(m.dependsOn))),
    [enabledMetrics],
  )

  const submit = async () => {
    if (!date) return
    // ⚠️ 还有 events 就不算空 —— 否则「点完成」会把时间轴上的记录全删掉
    const hasEvents = (store.dayEvents?.length ?? 0) > 0
    if (isEmpty(form) && !hasEvents) {
      if (hadRecord) {
        Modal.confirm({
          title: '清除这一天',
          content: '这一天没有任何记录，确定要清除吗？',
          okText: '清除',
          okButtonProps: { type: 'danger', theme: 'solid' },
          cancelText: '取消',
          onOk: async () => {
            setSaving(true)
            await store.deleteDay(date)
            setSaving(false)
            onSaved?.()
            onClose()
          },
        })
      } else {
        Toast.info('没有需要保存的内容')
        onClose()
      }
      return
    }
    setSaving(true)
    // ⚠️ 身体指标的真源是 events，这里把日汇总原样回填 —— 不填会被 PUT 判成「未记录」
    const s = store.daySummary
    const payload: HealthDayDetail = {
      date,
      water_ml: s?.water_ml ?? 0,
      weight_kg: s?.weight_kg ?? null,
      bbt: s?.bbt ?? null,
      sleep_hours: s?.sleep_hours ?? null,
      bowel_count: s?.bowel_times ?? 0,
      bowel_type: s?.bowel_types?.length ? s.bowel_types[s.bowel_types.length - 1] : 0,
      period: { ...form.period },
      moods: {
        mood: form.moods.mood,
        energy: form.moods.energy,
        note: form.moods.note.trim().slice(0, 50),
      },
    }
    const ok = await store.saveDay(date, payload)
    setSaving(false)
    if (ok) {
      onSaved?.()
      onClose()
    }
  }

  const waterGoal = store.settings?.water_goal_ml || DEFAULT_WATER_GOAL_ML
  /** 「一杯」多大：快捷档由此推导（每个用户的杯子不一样） */
  const waterStep = normalizeWaterStep(store.settings?.water_step_ml ?? 0)
  const waterQuick = waterQuickOptions(waterStep)
  /** 当天饮水总量（events 聚合，不是表单值） */
  const waterTotal = store.daySummary?.water_ml ?? 0
  const waterPct = waterGoal ? Math.min(100, Math.round((waterTotal / waterGoal) * 100)) : 0

  /* ==================== 时间轴事件（身体指标） ====================
   * ⚠️ 这些不再是「一天一个值」，而是**追加一次带时间点的事件**：
   *    填完点「记录此刻」→ POST /health/events，时间点由服务端给。
   *    当天已有值只作占位参考（体温取最早一次，体重/睡眠取最后一次）。 */
  const daySummary = store.daySummary
  const [bbtDraft, setBbtDraft] = useState<number | undefined>(undefined)
  const [weightDraft, setWeightDraft] = useState<number | undefined>(undefined)
  const [sleepDraft, setSleepDraft] = useState<number | undefined>(undefined)

  useEffect(() => {
    setBbtDraft(daySummary?.bbt ?? undefined)
    setWeightDraft(daySummary?.weight_kg ?? undefined)
    setSleepDraft(daySummary?.sleep_hours ?? undefined)
  }, [daySummary?.bbt, daySummary?.weight_kg, daySummary?.sleep_hours])

  /** 追加一条事件（时间不传 = 服务端当前时刻） */
  async function pushEvent(
    metricKey: 'water' | 'bbt' | 'weight' | 'sleep' | 'bowel',
    valueNum?: number,
    valueInt?: number,
  ) {
    if (!date) return
    await store.addEvent({
      date,
      metric_key: metricKey,
      ...(valueNum !== undefined ? { value_num: valueNum } : {}),
      ...(valueInt !== undefined ? { value_int: valueInt } : {}),
    })
  }

  function renderPanelBody(key: string) {
    switch (key) {
      case 'period':
        return (
          <>
            <div className="dim-info">{DIM_INFO.period}</div>
            <div className="period-flow-levels">
              {FLOW_OPTIONS.map((o) => (
                <Radio key={o.v} checked={form.period.flow === o.v} onChange={() => setPeriod('flow', o.v)}>
                  {o.l}
                </Radio>
              ))}
            </div>
          </>
        )
      case 'symptoms':
        return (
          <>
            <div className="dim-info">{DIM_INFO.symptoms}</div>
            {recentChips.length > 0 && (
              <div className="period-recent">
                <div className="period-recent-title">近期常记</div>
                <div className="period-recent-chips">
                  {recentChips.map((k) => {
                    const checked = form.period.symptoms.includes(k)
                    return (
                      <span
                        key={k}
                        className="period-recent-chip"
                        style={{ cursor: 'pointer', display: 'inline-block' }}
                        onClick={() => toggleSymptom(k, !checked)}
                      >
                        <Tag size="small" color={checked ? 'red' : undefined}>
                          {periodSymptomLabel(k)}
                        </Tag>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
            {PERIOD_SYMPTOM_GROUPS.map((g) => (
              <div key={g.key} className="period-symptom-group">
                <div className="period-group-label">{g.label}</div>
                <CheckboxGroup
                  value={form.period.symptoms}
                  onChange={(vals: any) => setPeriod('symptoms', vals as string[])}
                  options={g.items.map((i) => ({ label: i.label, value: i.key }))}
                />
              </div>
            ))}
            <div className="period-group-label" style={{ marginTop: 12 }}>疼痛程度</div>
            <RadioGroup
              value={String(form.period.pain_level)}
              onChange={(v: any) => setPeriod('pain_level', Number(v))}
              options={[
                { label: '无', value: '0' },
                { label: '1', value: '1' },
                { label: '2', value: '2' },
                { label: '3', value: '3' },
                { label: '4', value: '4' },
                { label: '5', value: '5' },
              ]}
            />
          </>
        )
      case 'mood':
        return (
          <>
            <div className="dim-info">{DIM_INFO.mood}</div>
            <RadioGroup
              value={String(form.moods.mood)}
              onChange={(v: any) => setMood('mood', Number(v))}
              options={[
                ...MOOD_VALUES_ASC.map((v) => ({
                  label: (
                    <span className="hk-row-with-icon">
                      <Icon name={MOOD_META[v].icon} size={16} />
                      {MOOD_META[v].label}
                    </span>
                  ),
                  value: String(v),
                })),
                { label: '不填', value: '0' },
              ]}
            />
            <div className="period-caption">单选 1–5；「不填」= 不记录心情</div>
          </>
        )
      case 'energy_sleep':
        return (
          <>
            <div className="dim-info">{DIM_INFO.energy_sleep}</div>
            <div className="period-group-label">精力</div>
            <RadioGroup
              value={String(form.moods.energy)}
              onChange={(v: any) => setMood('energy', Number(v))}
              options={[
                ...ENERGY_VALUES_ASC.map((v) => ({
                  label: (
                    <span className="hk-row-with-icon">
                      <Icon name={ENERGY_META[v].icon} size={16} />
                      {ENERGY_META[v].label}
                    </span>
                  ),
                  value: String(v),
                })),
                { label: '不填', value: '0' },
              ]}
            />
            <div className="period-group-label" style={{ marginTop: 12 }}>睡眠时长（记一次）</div>
            <InputNumber
              value={sleepDraft}
              min={0}
              max={24}
              step={0.5}
              onChange={(v: number | string | undefined) => setSleepDraft(v == null ? undefined : Number(v))}
              placeholder="0–24，步进 0.5"
              style={{ width: 200 }}
            />
            <Button
              size="small"
              theme="light"
              type="primary"
              style={{ marginLeft: 8 }}
              disabled={store.saving || sleepDraft == null}
              onClick={() => void pushEvent('sleep', sleepDraft)}
            >
              记录此刻
            </Button>
            <div className="period-caption">一天可记多次（如午睡另记一条）。</div>
            {date && <HealthEventList metric="sleep" date={date} unit="h" digits={1} emptyText="今天还没记睡眠" />}
          </>
        )
      case 'bbt':
        return (
          <>
            <div className="dim-info">{DIM_INFO.bbt}</div>
            <InputNumber
              value={bbtDraft}
              min={34}
              max={42}
              step={0.01}
              onChange={(v: number | string | undefined) => setBbtDraft(v == null ? undefined : Number(v))}
              placeholder="34.00 – 42.00"
              style={{ width: 200 }}
            />
            {lastBbt != null && (
              <Button size="small" theme="light" type="secondary" style={{ marginLeft: 8 }} onClick={() => setBbtDraft(lastBbt)}>
                沿用上次 {lastBbt}
              </Button>
            )}
            <Button
              size="small"
              theme="light"
              type="primary"
              style={{ marginLeft: 8 }}
              disabled={store.saving || bbtDraft == null}
              onClick={() => void pushEvent('bbt', bbtDraft)}
            >
              记录此刻
            </Button>
            <div className="period-caption">早晨醒来未起床时测量最准确；一天可记多次。</div>
            {date && <HealthEventList metric="bbt" date={date} unit="℃" digits={2} emptyText="今天还没记体温" />}
          </>
        )
      case 'weight':
        return (
          <>
            <div className="dim-info">{DIM_INFO.weight}</div>
            <InputNumber
              value={weightDraft}
              min={20}
              max={300}
              step={0.1}
              onChange={(v: number | string | undefined) => setWeightDraft(v == null ? undefined : Number(v))}
              placeholder="20.00 – 300.00"
              style={{ width: 200 }}
            />
            {lastWeight != null && (
              <Button size="small" theme="light" type="secondary" style={{ marginLeft: 8 }} onClick={() => setWeightDraft(lastWeight)}>
                沿用上次 {lastWeight}
              </Button>
            )}
            <Button
              size="small"
              theme="light"
              type="primary"
              style={{ marginLeft: 8 }}
              disabled={store.saving || weightDraft == null}
              onClick={() => void pushEvent('weight', weightDraft)}
            >
              记录此刻
            </Button>
            <div className="period-caption">黄体期体重上升 0.5–2kg 属正常波动；一天可记多次。</div>
            {date && <HealthEventList metric="weight" date={date} unit="kg" digits={1} emptyText="今天还没记体重" />}
          </>
        )
      case 'water':
        return (
          <>
            <div className="dim-info">{DIM_INFO.water}</div>
            <div className="health-quick-row">
              {waterQuick.map((o) => (
                <Button
                  key={o.cups}
                  size="small"
                  theme="light"
                  type="primary"
                  disabled={store.saving}
                  onClick={() => void pushEvent('water', o.ml)}
                >
                  {o.label}
                </Button>
              ))}
              <Button
                size="small"
                theme="light"
                type="secondary"
                disabled={store.saving}
                onClick={() => void pushEvent('water', -waterStep)}
              >
                记错了 −{waterStep}
              </Button>
            </div>
            <div className="health-qb-meter" style={{ marginTop: 8 }}>
              <span className="health-qb-meter-fill" style={{ width: `${waterPct}%` }} />
            </div>
            <div className="period-caption">
              目标 {waterGoal}ml · 一杯 {waterStep}ml（设置里可改） · 已记 {waterTotal}ml
            </div>
            {date && <HealthEventList metric="water" date={date} unit="ml" emptyText="今天还没记饮水" />}
          </>
        )
      case 'bowel':
        return (
          <>
            <div className="dim-info">{DIM_INFO.bowel}</div>
            <div className="period-group-label">记一次（选形态）</div>
            <div className="health-quick-row">
              {BOWEL_TYPE_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  size="small"
                  theme="light"
                  type="primary"
                  disabled={store.saving}
                  onClick={() => void pushEvent('bowel', undefined, o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <div className="period-caption">
              上午腹泻、下午正常 → 就记两条，各自带时间。
            </div>
            {date && (
              <HealthEventList
                metric="bowel"
                date={date}
                intLabel={BOWEL_TYPE_LABEL}
                emptyText="今天还没记排便"
              />
            )}
          </>
        )
      case 'discharge':
        return (
          <>
            <div className="dim-info">{DIM_INFO.discharge}</div>
            <RadioGroup
              value={String(form.period.discharge)}
              onChange={(v: any) => setPeriod('discharge', Number(v))}
              options={[
                { label: '未记录', value: '0' },
                ...PERIOD_DISCHARGE_OPTIONS.map((o) => ({ label: `${o.label}（${o.desc}）`, value: String(o.value) })),
              ]}
            />
          </>
        )
      case 'sex':
        return (
          <>
            <div className="dim-info">{DIM_INFO.sex}</div>
            <RadioGroup
              value={String(form.period.intercourse)}
              onChange={(v: any) => setPeriod('intercourse', Number(v))}
              options={[
                { label: '未记录', value: '0' },
                ...PERIOD_INTERCOURSE_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) })),
              ]}
            />
          </>
        )
      case 'note':
        return (
          <>
            <div className="dim-info">{DIM_INFO.note}</div>
            <TextArea
              value={form.moods.note}
              maxLength={50}
              showCounter
              rows={3}
              placeholder="最多 50 字"
              onChange={(v: string) => setMood('note', v)}
            />
          </>
        )
      default:
        return null
    }
  }

  // metricKey 优先（02 §16.4）：传入时只展开目标面板（定位），否则默认全部展开。
  // key 让 Collapse 在 metricKey 变化时重挂载，保证 defaultActiveKey 重新生效。
  const collapseKey = metricKey ? `metric-${metricKey}` : 'all'
  const defaultActiveKey = metricKey ? [metricKey] : panels.map((m) => m.key)

  return (
    <SideSheet
      visible={open}
      onCancel={onClose}
      placement="right"
      width={560}
      title={date ? dateLabel(date) : '记录'}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button theme="solid" type="primary" loading={saving} onClick={submit}>
            完成
          </Button>
        </div>
      }
    >
      {panels.length === 0 ? (
        <p className="dim-info">尚未选择任何指标，请在「设置」中开启。</p>
      ) : (
        <Collapse key={collapseKey} accordion={false} defaultActiveKey={defaultActiveKey}>
          {panels.map((m) => (
            <Collapse.Panel key={m.key} itemKey={m.key} header={m.name}>
              {renderPanelBody(m.key)}
            </Collapse.Panel>
          ))}
        </Collapse>
      )}
    </SideSheet>
  )
}

/* ---- 局部小组件：RadioGroup / CheckboxGroup 直接用 Semi 命名（避免额外 import） ---- */
function RadioGroup(props: any) {
  return <Radio.Group {...props} />
}
function CheckboxGroup(props: any) {
  return <Checkbox.Group {...props} />
}
