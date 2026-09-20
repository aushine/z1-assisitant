/**
 * AnniversaryEditDrawer —— 纪念日 / 倒数日编辑抽屉（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/AnniversaryEditSheet.vue
 * 设计：md/spec-20260919-v1/06-个人中心与纪念日.md §3.2
 *
 * ⚠️ 农历（calendar_type = 2）后端**尚未实现换算**（没引农历库，后端有明确
 *    TODO，当前按公历日期计算）。所以这里显示农历选项但不假装能换算 ——
 *    选中后给一句明确提示，避免用户以为存进去的是农历。
 */
import { useEffect, useState } from 'react'
import {
  SideSheet,
  Button,
  Input,
  TextArea,
  DatePicker,
  RadioGroup,
  Checkbox,
  Switch,
} from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { useAnniversaryStore } from '@/stores/anniversary'
import type {
  AnniversaryCategory,
  AnniversaryItem,
  AnniversaryRemindDay,
} from '@/api/types'

const TITLE_MAX = 50
const NOTE_MAX = 200

const REPEAT_OPTIONS = [
  { value: 1, label: '不重复' },
  { value: 2, label: '每年' },
  { value: 3, label: '每月' },
  { value: 4, label: '每周' },
]

const CALENDAR_OPTIONS = [
  { value: 1, label: '公历' },
  { value: 2, label: '农历' },
]

const REMIND_OPTIONS: { value: AnniversaryRemindDay; label: string }[] = [
  { value: 7, label: '7 天前' },
  { value: 3, label: '3 天前' },
  { value: 1, label: '1 天前' },
  { value: 0, label: '当天' },
]

const CATEGORY_OPTIONS: {
  value: AnniversaryCategory
  label: string
  icon: IconName
  color: string
}[] = [
  { value: 'birthday', label: '生日', icon: 'Sparkles', color: 'accent' },
  { value: 'anniversary', label: '纪念日', icon: 'Calendar', color: 'primary' },
  { value: 'countdown', label: '倒数日', icon: 'Clock', color: 'warning' },
  { value: 'other', label: '其他', icon: 'Sun', color: 'neutral' },
]

const ICON_OPTIONS: IconName[] = ['Sparkles', 'Calendar', 'Clock', 'Sun', 'HeartPulse']

const TINT_NAMES: TintName[] = ['primary', 'success', 'warning', 'danger', 'accent', 'neutral']

/** DatePicker 给的是 Date | string | undefined → YYYY-MM-DD */
function fmtDate(v: unknown): string {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function todayStr(): string {
  return fmtDate(new Date())
}

export default function AnniversaryEditDrawer({
  visible,
  item,
  onClose,
  onSaved,
}: {
  visible: boolean
  /** null = 新建 */
  item: AnniversaryItem | null
  onClose: () => void
  onSaved?: () => void
}) {
  const store = useAnniversaryStore()

  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState(todayStr())
  const [repeatRule, setRepeatRule] = useState(2)
  const [calendarType, setCalendarType] = useState(1)
  const [remindDays, setRemindDays] = useState<number[]>([0])
  const [category, setCategory] = useState<AnniversaryCategory>('anniversary')
  const [icon, setIcon] = useState<IconName>('Calendar')
  const [color, setColor] = useState<TintName>('primary')
  const [pinned, setPinned] = useState(false)
  const [note, setNote] = useState('')
  const [titleError, setTitleError] = useState('')

  useEffect(() => {
    if (!visible) return
    setTitleError('')
    if (item) {
      setTitle(item.title)
      setTargetDate(item.target_date)
      setRepeatRule(item.repeat_rule)
      setCalendarType(item.calendar_type)
      setRemindDays([...item.remind_days])
      setCategory(item.category)
      const rawIcon = item.icon as IconName
      setIcon(ICON_OPTIONS.includes(rawIcon) ? rawIcon : 'Calendar')
      const rawColor = item.color as TintName
      setColor(TINT_NAMES.includes(rawColor) ? rawColor : 'primary')
      setPinned(item.is_pinned)
      setNote(item.note || '')
    } else {
      setTitle('')
      setTargetDate(todayStr())
      setRepeatRule(2)
      setCalendarType(1)
      setRemindDays([0])
      setCategory('anniversary')
      setIcon('Calendar')
      setColor('primary')
      setPinned(false)
      setNote('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item])

  function pickCategory(v: AnniversaryCategory) {
    setCategory(v)
    const meta = CATEGORY_OPTIONS.find((o) => o.value === v)
    if (meta) {
      setIcon(meta.icon)
      setColor(meta.color as TintName)
    }
  }

  async function submit() {
    if (!title.trim()) {
      setTitleError('请填写标题')
      return
    }
    if (!targetDate) return
    const payload = {
      title: title.trim().slice(0, TITLE_MAX),
      target_date: targetDate,
      repeat_rule: repeatRule as 1 | 2 | 3 | 4,
      calendar_type: calendarType as 1 | 2,
      remind_days: [...remindDays].sort((a, b) => b - a) as AnniversaryRemindDay[],
      category,
      icon,
      color,
      is_pinned: pinned,
      note: note.slice(0, NOTE_MAX),
    }
    const ok = item ? await store.patch(item.id, payload) : await store.create(payload)
    if (!ok) return
    onSaved?.()
    onClose()
  }

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      title={item ? '编辑纪念日' : '新建纪念日'}
      width={480}
      footer={
        <div className="ann-edit-foot">
          <Button theme="light" type="secondary" onClick={onClose}>
            取消
          </Button>
          <Button theme="solid" type="primary" loading={store.saving} onClick={submit}>
            保存
          </Button>
        </div>
      }
    >
      <div className="ann-edit">
        <div className="ann-edit-block">
          <div className="period-setting-label">标题</div>
          <Input
            value={title}
            maxLength={TITLE_MAX}
            placeholder="例如：妈妈生日"
            onChange={(v: string) => {
              setTitle(v)
              if (titleError && v.trim()) setTitleError('')
            }}
          />
          {titleError && <div className="period-caption is-error">{titleError}</div>}
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">日期</div>
          <DatePicker
            type="date"
            value={targetDate}
            onChange={(v: unknown) => setTargetDate(fmtDate(v))}
            style={{ width: 220 }}
          />
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">重复</div>
          <RadioGroup
            type="button"
            value={repeatRule}
            onChange={(e: any) => setRepeatRule(Number(e?.target?.value ?? e))}
            options={REPEAT_OPTIONS}
          />
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">历法</div>
          <RadioGroup
            type="button"
            value={calendarType}
            onChange={(e: any) => setCalendarType(Number(e?.target?.value ?? e))}
            options={CALENDAR_OPTIONS}
          />
          {calendarType === 2 && (
            <div className="period-caption is-warn">农历换算暂未支持，当前按公历日期计算</div>
          )}
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">提前提醒（可不选）</div>
          <Checkbox.Group
            value={remindDays}
            onChange={(v: any) => setRemindDays((v ?? []).map(Number))}
            options={REMIND_OPTIONS}
            direction="horizontal"
          />
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">分类</div>
          <div className="ann-edit-cats">
            {CATEGORY_OPTIONS.map((o) => (
              <Button
                key={o.value}
                size="small"
                theme={category === o.value ? 'solid' : 'light'}
                type={category === o.value ? 'primary' : 'tertiary'}
                onClick={() => pickCategory(o.value)}
              >
                <Icon name={o.icon} size={14} style={{ marginRight: 4 }} />
                {o.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">图标</div>
          <div className="ann-edit-icons">
            {ICON_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={`ann-edit-icon${icon === n ? ' is-on' : ''}`}
                onClick={() => setIcon(n)}
                aria-label={n}
              >
                <Icon name={n} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">配色</div>
          <div className="ann-edit-icons">
            {TINT_NAMES.map((t) => (
              <button
                key={t}
                type="button"
                className={`ann-edit-color${color === t ? ' is-on' : ''}`}
                style={{ background: TINT_VARS[t].bg, color: TINT_VARS[t].fg }}
                onClick={() => setColor(t)}
                aria-label={t}
              >
                {color === t && <Icon name="CheckSquare" size={14} />}
              </button>
            ))}
          </div>
        </div>

        <div className="ann-edit-block ann-edit-row">
          <span className="period-setting-label">置顶</span>
          <Switch checked={pinned} onChange={(v: boolean) => setPinned(v)} />
        </div>

        <div className="ann-edit-block">
          <div className="period-setting-label">备注（选填）</div>
          <TextArea
            value={note}
            maxCount={NOTE_MAX}
            rows={3}
            placeholder="想说点什么…"
            onChange={(v: string) => setNote(v)}
          />
        </div>
      </div>
    </SideSheet>
  )
}
