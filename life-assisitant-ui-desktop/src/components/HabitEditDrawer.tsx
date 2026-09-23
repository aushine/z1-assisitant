/**
 * Habit create/edit Drawer
 *
 * 260922 分类实体化（spec-20260922-v2/04 #46/47）：
 *   - 16 个硬编码 emoji → 「已选图标 + 更换」单行 → IconPicker（分组候选，
 *     两端共用注册表），落库口径 `lucide:<Name>`（Q10：存量 emoji 顺手换算）；
 *   - 分类 Select（写死 4 项）→ `<CategoryTiles>` 平铺 chips + 「管理 ›」，
 *     用户自建分类即时可见。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  SideSheet,
  Button,
  Input,
  InputNumber,
  TextArea,
  RadioGroup,
  Radio,
  Typography,
  Checkbox,
} from '@douyinfe/semi-ui'
import { Icon, ICONS, TINT_VARS } from '@/components/icon'
import type { IconName } from '@/components/icon'
import { getIconMapping } from '@/utils/icon-map'
import { resolveHabitIconView } from '@/utils/category-dict'
import { lucideIconName } from '@/stores/user-category'
import IconPicker from '@/components/finance/IconPicker'
import CategoryTiles from '@/components/finance/CategoryTiles'
import type {
  Habit,
  CreateHabitReq,
  UpdateHabitReq,
  HabitFrequency,
} from '@/api/types'

const { Title } = Typography

const COLOR_OPTIONS = [
  { value: '#014DB2', label: '主色蓝' },
  { value: '#10B981', label: '成功绿' },
  { value: '#F59E0B', label: '琥珀' },
  { value: '#EF4444', label: '红' },
  { value: '#8B5CF6', label: '紫' },
  { value: '#06B6D4', label: '青' },
  { value: '#EC4899', label: '粉' },
  { value: '#6B7280', label: '灰' },
]

const FREQUENCY_OPTIONS: { value: HabitFrequency; label: string }[] = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

interface Props {
  visible: boolean
  habit: Habit | null
  saving?: boolean
  onClose: () => void
  onSubmit: (data: CreateHabitReq | UpdateHabitReq) => void
}

export default function HabitEditDrawer({ visible, habit, saving = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateHabitReq>({
    title: '',
    description: '',
    icon: '', // '' = 跟随分类图标（04 §4.2；旧默认 '💧' 废除）
    color: '#014DB2',
    category: 'life',
    frequency: 'daily',
    target_count: 1,
    unit: '次',
    track_duration: false,
  })
  const [titleError, setTitleError] = useState('')
  const [iconOpen, setIconOpen] = useState(false)

  useEffect(() => {
    if (!visible) return
    if (habit) {
      setForm({
        title: habit.title ?? '',
        description: habit.description ?? '',
        // 存量 icon 可为 emoji：表单原样携带，保存时 iconForPayload 统一换算（Q10）
        icon: habit.icon ?? '',
        color: habit.color ?? '#014DB2',
        category: habit.category ?? 'life',
        frequency: habit.frequency ?? 'daily',
        target_count: habit.target_count ?? 1,
        unit: habit.unit ?? '次',
        track_duration: habit.track_duration ?? false,
      })
    } else {
      setForm({
        title: '',
        description: '',
        icon: '',
        color: '#014DB2',
        frequency: 'daily',
        target_count: 1,
        unit: '次',
      })
    }
    setTitleError('')
    setIconOpen(false)
  }, [visible, habit?.id])

  const isEdit = !!habit
  const titleText = isEdit ? '编辑习惯' : '新建习惯'

  const onTitleChange = useCallback((v: string) => {
    setForm((f) => ({ ...f, title: v }))
    if (v.trim()) setTitleError('')
  }, [])

  /** 摘要行展示的图标：habit.icon > 分类.icon > 分类.emoji > Pin（store 优先、常量兜底） */
  const iconView = useMemo(
    () => resolveHabitIconView({ icon: form.icon, category: form.category }),
    [form.icon, form.category],
  )

  /** IconPicker 要**裸名**（无 lucide: 前缀）；存量 emoji 引用视为未选 */
  const pickerIcon: IconName | null = useMemo(() => {
    const raw = form.icon ?? ''
    if (!raw) return null
    const bare = raw.startsWith('lucide:') ? raw.slice(7) : raw
    return (ICONS as Record<string, unknown>)[bare] ? (bare as IconName) : null
  }, [form.icon])

  /**
   * Q10：新建/编辑保存时统一图标引用 ——
   * 空 = 继承分类图标；lucide 引用原样；存量 emoji 顺手换成 `lucide:<映射名>`。
   */
  const iconForPayload = useCallback((raw: string | undefined): string => {
    if (!raw) return ''
    if (raw.startsWith('lucide:')) return raw
    if ((ICONS as Record<string, unknown>)[raw]) return `lucide:${raw}`
    // 桌面端 icon-map 返回组件 ⇒ 经注册表反查名字（未注册降级 HelpCircle）
    return `lucide:${lucideIconName(getIconMapping(raw).icon) ?? 'HelpCircle'}`
  }, [])

  const pickColor = useCallback((c: string) => {
    setForm((f) => ({ ...f, color: c }))
  }, [])

  const onTargetChange = useCallback((v: number | string | undefined) => {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? '1'), 10)
    setForm((f) => ({ ...f, target_count: Number.isFinite(n) && n > 0 ? n : 1 }))
  }, [])

  const handleSubmit = useCallback(() => {
    const t = form.title?.trim() ?? ''
    if (!t) {
      setTitleError('标题不能为空')
      return
    }
    if (t.length > 50) {
      setTitleError('标题不能超过 50 字符')
      return
    }
    onSubmit({
      title: t,
      description: form.description?.trim() || undefined,
      icon: iconForPayload(form.icon),
      color: form.color,
      category: form.category,
      frequency: form.frequency,
      target_count: form.target_count,
      unit: form.unit?.trim() || '次',
      track_duration: form.track_duration,
    })
  }, [form, onSubmit])

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={480}
      maskClosable={!saving}
      closable={false}
      title={null}
      className="habit-drawer"
    >
      <div className="drawer-header">
        <Title heading={5} style={{ margin: 0 }}>{titleText}</Title>
        <Button
          theme="borderless"
          type="tertiary"
          disabled={saving}
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="X" size={16} />
        </Button>
      </div>
      <div className="drawer-body">
        {/* Title */}
        <div className="field">
          <label className="field-label">标题 <span className="required">*</span></label>
          <Input
            value={form.title}
            onChange={onTitleChange}
            placeholder="给习惯起个名字（1-50 字符）"
            maxLength={50}
            showClear
            autoFocus
          />
          {titleError && <div className="field-error">{titleError}</div>}
        </div>

        {/* Description */}
        <div className="field">
          <label className="field-label">描述</label>
          <TextArea
            value={form.description}
            onChange={(v: string) => setForm((f) => ({ ...f, description: v }))}
            placeholder="补充一下细节（可选）"
            rows={2}
            maxLength={200}
            showClear
          />
        </div>

        {/* 图标：已选 + 更换 › → IconPicker（04 §4.1，替代 16 格 emoji） */}
        <div className="field">
          <label className="field-label">图标</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="cat-icon-pick"
              onClick={() => setIconOpen(true)}
              style={{ background: form.color ? form.color + '22' : TINT_VARS[iconView.tint].bg }}
            >
              <Icon name={iconView.icon} size={18} style={{ color: TINT_VARS[iconView.tint].fg }} />
              <span className="cat-icon-pick-text">更换</span>
            </button>
            <span className="field-tip" style={{ margin: 0 }}>
              {form.icon ? '已自选图标' : '跟随分类图标'}
            </span>
          </div>
        </div>

        {/* Category：一级平铺 chips + 管理入口（04 #46） */}
        <div className="field">
          <label className="field-label">分类</label>
          <CategoryTiles
            domain="habit"
            value={form.category ?? ''}
            onChange={(id) => setForm((f) => ({ ...f, category: id }))}
          />
        </div>

        {/* Color */}
        <div className="field">
          <label className="field-label">颜色</label>
          <div className="color-row">
            {COLOR_OPTIONS.map((c) => (
              <div
                key={c.value}
                className={`color-chip${form.color === c.value ? ' active' : ''}`}
                style={{
                  background: c.value,
                  boxShadow: form.color === c.value ? `0 0 0 3px ${c.value}33` : 'none',
                }}
                title={c.label}
                role="button"
                tabIndex={0}
                onClick={() => pickColor(c.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') pickColor(c.value) }}
              />
            ))}
          </div>
        </div>

        {/* Frequency */}
        <div className="field">
          <label className="field-label">频率</label>
          <RadioGroup
            value={form.frequency}
            onChange={(e: any) => setForm((f) => ({ ...f, frequency: e.target.value }))}
            type="button"
          >
            {FREQUENCY_OPTIONS.map((f) => (
              <Radio key={f.value} value={f.value}>{f.label}</Radio>
            ))}
          </RadioGroup>
        </div>

        {/* Target + Unit */}
        <div className="field">
          <label className="field-label">目标 + 单位</label>
          <div className="target-row">
            <InputNumber
              value={form.target_count}
              onChange={onTargetChange}
              placeholder="1"
              min={1}
              style={{ width: 100 }}
            />
            <Input
              value={form.unit}
              onChange={(v: string) => setForm((f) => ({ ...f, unit: v }))}
              placeholder="次 / 杯 / 分钟…"
              style={{ flex: 1 }}
            />
          </div>
        </div>

        {/* Track Duration */}
        <div className="field">
          <label className="field-label">打卡设置</label>
          <Checkbox
            checked={form.track_duration}
            onChange={(e: any) => setForm((f) => ({ ...f, track_duration: e.target.checked }))}
          >
            记录打卡时长（打卡时可输入分钟数）
          </Checkbox>
        </div>

        {/* Preview */}
        <div className="field">
          <label className="field-label">预览</label>
          <div
            className="preview"
            style={{
              background: form.color + '15',
              borderColor: form.color,
            }}
          >
            <div
              className="preview-emoji"
              style={{ background: form.color + '33', color: form.color }}
            >
              <Icon name={iconView.icon} size={24} style={{ color: form.color }} />
            </div>
            <div className="preview-text">
              <div className="preview-title">{form.title || '习惯名'}</div>
              <div className="preview-sub">
                {form.target_count}{form.unit} / {form.frequency === 'daily' ? '天' : form.frequency === 'weekly' ? '周' : '月'}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="drawer-footer">
        <Button theme="light" type="secondary" disabled={saving} onClick={onClose}>取消</Button>
        <Button theme="solid" type="primary" loading={saving} onClick={handleSubmit}>保存</Button>
      </div>

      {/* 分组图标候选（两端共用 icon-groups 注册表，零改动复用） */}
      <IconPicker
        visible={iconOpen}
        value={pickerIcon}
        onClose={() => setIconOpen(false)}
        onSelect={(n) => {
          // 落库口径 `lucide:<Name>`（04 §4.3）
          setForm((f) => ({ ...f, icon: `lucide:${n}` }))
          setIconOpen(false)
        }}
      />
    </SideSheet>
  )
}
