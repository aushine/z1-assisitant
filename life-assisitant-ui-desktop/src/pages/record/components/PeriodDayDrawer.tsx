/**
 * PeriodDayDrawer —— 9 组经期记录表单（经期 Tab 的「记录浮层」桌面版）
 *
 * 与移动端契约（md/spec-260919/04 §4.4）字段与写入语义完全一致；桌面端不做横向分页，
 * 改用纵向 Collapse 把 9 组字段铺在 Drawer 里（§8）。
 *
 * 红线守卫：
 *  - 心情 mood 单选 1–5、精力 energy 1–3、备注 note ≤50（不存多选 key 数组）
 *  - 第 1 页「有出血」(flow 2–4) 与第 9 页「点滴出血」(flow=1) **互斥**：开点滴清空「有出血」，
 *    开「有出血」清空点滴（即时联动提示）
 *  - 整页全空 + 点完成 = 删除该日记录（调 DELETE），不留空行；若该日原本有记录先二次确认
 *  - 所有字段来自 constants/period.ts（症状 31 项 / 分泌物 5 型 / 经量 5 档），不另写一份
 *  - 整体覆盖语义：提交时把全部字段发给后端（未选 = 0 / null / 空数组）
 */
import { useEffect, useState, useMemo } from 'react'
import {
  SideSheet,
  Collapse,
  Radio,
  Checkbox,
  Switch,
  InputNumber,
  TextArea,
  Button,
  Toast,
  Modal,
  Tag,
} from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { usePeriodStore } from '@/stores/period'
import {
  PERIOD_SYMPTOM_GROUPS,
  PERIOD_FLOW_LEVELS,
  PERIOD_DISCHARGE_OPTIONS,
  PERIOD_INTERCOURSE_OPTIONS,
  PERIOD_DEFAULT_RECENT_SYMPTOMS,
  periodSymptomLabel,
} from '@/constants/period'
import type { PeriodDayDetail } from '@/api/types'

/** 各维度 ⓘ 说明（04 §7.2） */
const DIM_INFO: Record<string, string> = {
  flow: '记录每天的实际出血情况。经量会随时间变化，连续记录能看出这个月偏多还是偏少。',
  symptom: '身体的不适同样值得留档。记录 2–3 个周期后，你就能看到「哪些症状总在经前出现」。',
  mood: '心情与激素水平相关，黄体期出现情绪波动是常见现象，记录下来能帮你提前做心理准备。',
  energy: '卵泡期精力通常较好，黄体期容易疲惫。这些数据能让预测更贴合你的真实状态。',
  bbt: '基础体温需要在早晨醒来、未起床、未进食时测量。排卵后体温会升高 0.2–0.5 ℃ 并维持到下次经期，因此它擅长确认排卵，但通常要等排卵发生之后才看得出来。',
  weight: '黄体期因水钠潴留，体重上升 0.5–2 kg 属正常波动，不必因此焦虑。',
  discharge: '分泌物随周期变化：接近排卵时会变得清亮、可拉丝，这是生育力最高的信号。',
  intercourse: '仅供你自己参考。数据默认不显示在首页或统计中。',
  other: '点滴出血（量少到只需护垫）不等于月经。单独记录它可以避免把周期长度算错。',
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  const wd = new Date(date).getDay()
  return `${m}月${d}日 星期${WEEKDAYS[wd]}`
}

interface FormState {
  flow: number
  symptoms: string[]
  pain_level: number
  discharge: number
  bbt: number | null
  weight: number | null
  sleep_hours: number | null
  intercourse: number
  mood: number
  energy: number
  note: string
}

const EMPTY: FormState = {
  flow: 0,
  symptoms: [],
  pain_level: 0,
  discharge: 0,
  bbt: null,
  weight: null,
  sleep_hours: null,
  intercourse: 0,
  mood: 0,
  energy: 0,
  note: '',
}

function fromDay(day: PeriodDayDetail | null): FormState {
  if (!day) return { ...EMPTY }
  return {
    flow: day.flow ?? 0,
    symptoms: day.symptoms ?? [],
    pain_level: day.pain_level ?? 0,
    discharge: day.discharge ?? 0,
    bbt: day.bbt ?? null,
    weight: day.weight ?? null,
    sleep_hours: day.sleep_hours ?? null,
    intercourse: day.intercourse ?? 0,
    mood: day.mood ?? 0,
    energy: day.energy ?? 0,
    note: day.note ?? '',
  }
}

function isEmpty(f: FormState): boolean {
  return (
    f.flow === 0 &&
    f.symptoms.length === 0 &&
    f.pain_level === 0 &&
    f.discharge === 0 &&
    f.bbt == null &&
    f.weight == null &&
    f.sleep_hours == null &&
    f.intercourse === 0 &&
    f.mood === 0 &&
    f.energy === 0 &&
    f.note.trim() === ''
  )
}

export default function PeriodDayDrawer({
  date,
  onClose,
  onSaved,
}: {
  date: string | null
  onClose: () => void
  onSaved?: () => void
}) {
  const store = usePeriodStore()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [hadRecord, setHadRecord] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [lastBbt, setLastBbt] = useState<number | null>(null)
  const [lastWeight, setLastWeight] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!date) return
    let alive = true
    setForm(EMPTY)
    setHadRecord(false)
    store.fetchDay(date).then((resp) => {
      if (!alive) return
      if (resp) {
        setForm(fromDay(resp.day))
        setHadRecord(!!resp.day)
        setBleedOpen(!!resp.day && (resp.day?.flow ?? 0) >= 2)
        setRecent(resp.recent_symptoms?.length ? resp.recent_symptoms : [...PERIOD_DEFAULT_RECENT_SYMPTOMS])
        setLastBbt(resp.last_values?.bbt ?? null)
        setLastWeight(resp.last_values?.weight ?? null)
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const open = !!date
  const spotting = form.flow === 1
  const [bleedOpen, setBleedOpen] = useState(false)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  // 第 1 页：有出血（展开经量），未出血
  const chooseBleeding = (on: boolean) => {
    if (on) {
      setBleedOpen(true)
    } else {
      setBleedOpen(false)
      set('flow', 0)
    }
  }
  const chooseFlowLevel = (v: number) => set('flow', v) // 2/3/4

  // 第 9 页：点滴出血（与「有出血」互斥）
  const toggleSpotting = (on: boolean) => {
    if (on) {
      set('flow', 1) // 清空「有出血」选择（flow 归到点滴，唯一值）
      setBleedOpen(false)
    } else {
      set('flow', 0)
    }
  }

  const toggleSymptom = (key: string, on: boolean) =>
    set('symptoms', on ? [...form.symptoms, key] : form.symptoms.filter((k) => k !== key))

  const recentChips = useMemo(
    () => (recent.length ? recent : PERIOD_DEFAULT_RECENT_SYMPTOMS),
    [recent]
  )

  const submit = async () => {
    if (!date) return
    if (isEmpty(form)) {
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
    const ok = await store.upsertDay(date, {
      flow: form.flow,
      symptoms: form.symptoms,
      pain_level: form.pain_level,
      discharge: form.discharge,
      bbt: form.bbt,
      weight: form.weight,
      sleep_hours: form.sleep_hours,
      intercourse: form.intercourse,
      mood: form.mood,
      energy: form.energy,
      note: form.note,
    })
    setSaving(false)
    if (ok) {
      onSaved?.()
      onClose()
    }
  }

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
      <Collapse accordion={false} defaultActiveKey={['1', '2', '3', '4', '5', '6', '7', '8', '9']}>
        {/* 1. 经期 */}
        <Collapse.Panel
          itemKey="1"
          header={
            <span>
              经期
              {spotting && <Tag size="small" color="red" style={{ marginLeft: 6 }}>点滴中</Tag>}
            </span>
          }
        >
          <div className="dim-info">{DIM_INFO.flow}</div>
          <RadioGroup
            value={bleedOpen ? 'yes' : 'no'}
            onChange={(v: any) => chooseBleeding(v === 'yes')}
            options={[
              { label: '有出血', value: 'yes' },
              { label: '未出血', value: 'no' },
            ]}
          />
          {bleedOpen && (
            <div className="period-flow-levels">
              {PERIOD_FLOW_LEVELS.map((o) => (
                <Radio
                  key={o.value}
                  checked={form.flow === o.value}
                  onChange={() => chooseFlowLevel(o.value)}
                >
                  {o.label}
                  <span className="period-flow-hint">（{o.hint}）</span>
                </Radio>
              ))}
            </div>
          )}
        </Collapse.Panel>

        {/* 2. 症状 */}
        <Collapse.Panel itemKey="2" header="症状">
          <div className="dim-info">{DIM_INFO.symptom}</div>
          {/* 近期症状（动态 Top6） */}
          {recentChips.length > 0 && (
            <div className="period-recent">
              <div className="period-recent-title">近期常记</div>
              <div className="period-recent-chips">
                {recentChips.map((k) => {
                  const checked = form.symptoms.includes(k)
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
                value={form.symptoms}
                onChange={(vals: any) => set('symptoms', vals as string[])}
                options={g.items.map((i) => ({ label: i.label, value: i.key }))}
              />
            </div>
          ))}
          {/* 疼痛程度 1–5 */}
          <div className="period-group-label" style={{ marginTop: 12 }}>疼痛程度</div>
          <RadioGroup
            value={String(form.pain_level)}
            onChange={(v: any) => set('pain_level', Number(v))}
            options={[
              { label: '无', value: '0' },
              { label: '1', value: '1' },
              { label: '2', value: '2' },
              { label: '3', value: '3' },
              { label: '4', value: '4' },
              { label: '5', value: '5' },
            ]}
          />
        </Collapse.Panel>

        {/* 3. 心情（5 档单选） */}
        <Collapse.Panel itemKey="3" header="心情">
          <div className="dim-info">{DIM_INFO.mood}</div>
          <RadioGroup
            value={String(form.mood)}
            onChange={(v: any) => set('mood', Number(v))}
            options={[
              { label: '很差', value: '1' },
              { label: '低落', value: '2' },
              { label: '一般', value: '3' },
              { label: '不错', value: '4' },
              { label: '很好', value: '5' },
              { label: '不填', value: '0' },
            ]}
          />
          <div className="period-caption">单选 1–5；「不填」= 不记录心情</div>
        </Collapse.Panel>

        {/* 4. 精力 · 睡眠 */}
        <Collapse.Panel itemKey="4" header="精力 · 睡眠">
          <div className="dim-info">{DIM_INFO.energy}</div>
          <div className="period-group-label">精力</div>
          <RadioGroup
            value={String(form.energy)}
            onChange={(v: any) => set('energy', Number(v))}
            options={[
              { label: '疲惫', value: '1' },
              { label: '一般', value: '2' },
              { label: '充沛', value: '3' },
              { label: '不填', value: '0' },
            ]}
          />
          <div className="period-group-label" style={{ marginTop: 12 }}>睡眠时长（小时）</div>
          <InputNumber
            value={form.sleep_hours ?? undefined}
            min={0}
            max={24}
            step={0.5}
            onChange={(v: number | string | undefined) =>
              set('sleep_hours', v == null ? null : Number(v))
            }
            placeholder="0–24，步进 0.5"
            style={{ width: 200 }}
          />
        </Collapse.Panel>

        {/* 5. 体温 */}
        <Collapse.Panel itemKey="5" header={<span><Icon name="Thermometer" size={14} /> 体温</span>}>
          <div className="dim-info">{DIM_INFO.bbt}</div>
          <InputNumber
            value={form.bbt ?? undefined}
            min={34}
            max={42}
            step={0.01}
            onChange={(v: number | string | undefined) => set('bbt', v == null ? null : Number(v))}
            placeholder="34.00 – 42.00"
            style={{ width: 200 }}
          />
          {lastBbt != null && (
            <Button
              size="small"
              theme="light"
              type="secondary"
              style={{ marginLeft: 8 }}
              onClick={() => set('bbt', lastBbt)}
            >
              沿用上次 {lastBbt}
            </Button>
          )}
        </Collapse.Panel>

        {/* 6. 体重 */}
        <Collapse.Panel itemKey="6" header={<span><Icon name="Scale" size={14} /> 体重</span>}>
          <div className="dim-info">{DIM_INFO.weight}</div>
          <InputNumber
            value={form.weight ?? undefined}
            min={20}
            max={300}
            step={0.1}
            onChange={(v: number | string | undefined) => set('weight', v == null ? null : Number(v))}
            placeholder="20.00 – 300.00"
            style={{ width: 200 }}
          />
          {lastWeight != null && (
            <Button
              size="small"
              theme="light"
              type="secondary"
              style={{ marginLeft: 8 }}
              onClick={() => set('weight', lastWeight)}
            >
              沿用上次 {lastWeight}
            </Button>
          )}
        </Collapse.Panel>

        {/* 7. 分泌物 */}
        <Collapse.Panel itemKey="7" header="分泌物">
          <div className="dim-info">{DIM_INFO.discharge}</div>
          {PERIOD_DISCHARGE_OPTIONS.map((o) => (
            <Radio
              key={o.value}
              checked={form.discharge === o.value}
              onChange={() => set('discharge', o.value)}
            >
              {o.label}
              <span className="period-flow-hint">（{o.desc}）</span>
            </Radio>
          ))}
          {form.discharge !== 0 && (
            <Button size="small" theme="borderless" type="tertiary" onClick={() => set('discharge', 0)}>
              清除
            </Button>
          )}
        </Collapse.Panel>

        {/* 8. 性生活 */}
        <Collapse.Panel itemKey="8" header="性生活">
          <div className="dim-info">{DIM_INFO.intercourse}</div>
          <RadioGroup
            value={String(form.intercourse)}
            onChange={(v: any) => set('intercourse', Number(v))}
            options={[
              { label: '未记录', value: '0' },
              ...PERIOD_INTERCOURSE_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) })),
            ]}
          />
        </Collapse.Panel>

        {/* 9. 其他记录（点滴出血 + 备注） */}
        <Collapse.Panel itemKey="9" header="其他记录">
          <div className="dim-info">{DIM_INFO.other}</div>
          <div className="period-spotting-row">
            <span>有点滴出血</span>
            <Switch checked={spotting} onChange={(on: boolean) => toggleSpotting(on)} />
          </div>
          {spotting && (
            <div className="period-caption" style={{ color: 'var(--color-period-dark)' }}>
              已选「点滴出血」，将清空上方「有出血」的选择（两者互斥）。
            </div>
          )}
          <div className="period-group-label" style={{ marginTop: 12 }}>备注</div>
          <TextArea
            value={form.note}
            maxLength={50}
            showCounter
            rows={2}
            placeholder="最多 50 字"
            onChange={(v: string) => set('note', v)}
          />
        </Collapse.Panel>
      </Collapse>
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
