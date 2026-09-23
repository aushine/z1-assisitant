/**
 * Task create/edit Drawer
 *
 * 260922 分类实体化（spec-20260922-v2/04 #48/49）：
 *   - 分类 6 宫格（写死常量）→ `<CategoryTiles>` 平铺 chips + 「管理 ›」，
 *     store 优先、常量兜底（04 §4.2）；
 *   - 新增图标行（已选 + 更换 › → IconPicker），`tasks.icon` 落库
 *     `lucide:<Name>`（Q10：存量 emoji 顺手换算；空 = 继承分类图标）。
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  SideSheet,
  Button,
  Input,
  TextArea,
  DatePicker,
  TimePicker,
  Typography,
  Select,
  Checkbox,
} from '@douyinfe/semi-ui'
import { Icon, ICONS, TINT_VARS } from '@/components/icon'
import type { IconName } from '@/components/icon'
import { resolveTaskIconView } from '@/utils/category-dict'
import { useUserCategoryStore, lucideIconName } from '@/stores/user-category'
import { getIconMapping } from '@/utils/icon-map'
import IconPicker from '@/components/finance/IconPicker'
import CategoryTiles from '@/components/finance/CategoryTiles'
import { TASK_PRIORITIES } from '@/utils/task-dict'
import type { Task, CreateTaskReq } from '@/api/types'

const { Title } = Typography

const RECURRENCE_OPTIONS = [
  { value: '', label: '不重复' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY', label: '每周' },
  { value: 'FREQ=MONTHLY', label: '每月' },
]

interface SubtaskForm {
  tempId: string
  title: string
  is_completed: boolean
  order: number
}

interface Props {
  visible: boolean
  task: Task | null
  saving?: boolean
  onClose: () => void
  onSubmit: (data: CreateTaskReq) => void
}

export default function TaskEditDrawer({ visible, task, saving = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateTaskReq>({
    title: '',
    description: '',
    priority: 'normal',
    category_id: '',
    icon: '', // '' = 跟随分类图标（04 §4.2）
    due_date: '',
    due_time: '',
    reminder_at: '',
    recurrence_rule: '',
    subtasks: [],
  })
  const [subtasks, setSubtasks] = useState<SubtaskForm[]>([])
  const [titleError, setTitleError] = useState('')
  const [iconOpen, setIconOpen] = useState(false)

  // Reset form when visible changes or task changes
  useEffect(() => {
    if (!visible) return
    if (task) {
      setForm({
        title: task.title ?? '',
        description: task.description ?? '',
        priority: task.priority ?? 'normal',
        category_id: task.category_id ?? '',
        // 存量 icon 可为 emoji：表单原样携带，保存时 iconForPayload 统一换算（Q10）
        icon: task.icon ?? '',
        due_date: task.due_date ?? '',
        due_time: task.due_time ?? '',
        reminder_at: task.reminder_at ?? '',
        recurrence_rule: task.recurrence_rule ?? '',
        subtasks: [],
      })
      setSubtasks(
        (task.subtasks ?? []).map((s, i) => ({
          tempId: s.id || `sub_${i}`,
          title: s.title,
          is_completed: s.is_completed,
          order: s.order ?? i,
        }))
      )
    } else {
      setForm({
        title: '',
        description: '',
        priority: 'normal',
        category_id: '',
        icon: '',
        due_date: '',
        due_time: '',
        reminder_at: '',
        recurrence_rule: '',
        subtasks: [],
      })
      setSubtasks([])
    }
    setTitleError('')
    setIconOpen(false)
  }, [visible, task?.id])

  const isEdit = !!task
  const titleText = isEdit ? '编辑任务' : '新建任务'

  // 订阅 task 域分类：store 数据到达后 iconView 重算（zustand 非响应式补丁）
  const catItems = useUserCategoryStore((s) => s.items.task)

  /** 图标优先级链：tasks.icon > 分类.icon > 分类.emoji > lucide:CircleDashed */
  const iconView = useMemo(
    () => resolveTaskIconView({ icon: form.icon, category_id: form.category_id }),
    [form.icon, form.category_id, catItems]
  )

  /** IconPicker 要**裸名**（无 lucide: 前缀）；存量 emoji 引用视为未选 */
  const pickerIcon: IconName | null = useMemo(() => {
    const raw = form.icon ?? ''
    if (!raw) return null
    const bare = raw.startsWith('lucide:') ? raw.slice(7) : raw
    return (ICONS as Record<string, unknown>)[bare] ? (bare as IconName) : null
  }, [form.icon])

  /**
   * Q10：保存时统一图标引用 ——
   * 空 = 继承分类图标；lucide 引用原样；存量 emoji 顺手换成 `lucide:<映射名>`。
   */
  const iconForPayload = useCallback((raw: string | undefined): string => {
    if (!raw) return ''
    if (raw.startsWith('lucide:')) return raw
    if ((ICONS as Record<string, unknown>)[raw]) return `lucide:${raw}`
    // 桌面端 icon-map 返回组件 ⇒ 经注册表反查名字（未注册降级 HelpCircle）
    return `lucide:${lucideIconName(getIconMapping(raw).icon) ?? 'HelpCircle'}`
  }, [])

  const onTitleChange = useCallback((v: string) => {
    setForm((f) => ({ ...f, title: v }))
    if (v.trim()) setTitleError('')
  }, [])

  const onPickCategory = useCallback((id: string) => {
    // 再点一次取消选择 ⇒ ''（未分类）。取消策略在父级，CategoryTiles 不判重
    setForm((f) => ({ ...f, category_id: f.category_id === id ? '' : id }))
  }, [])

  const addSubtask = useCallback(() => {
    setSubtasks((prev) => [
      ...prev,
      { tempId: `new_${Date.now()}`, title: '', is_completed: false, order: prev.length },
    ])
  }, [])

  const removeSubtask = useCallback((tempId: string) => {
    setSubtasks((prev) => prev.filter((s) => s.tempId !== tempId).map((s, i) => ({ ...s, order: i })))
  }, [])

  const updateSubtaskTitle = useCallback((tempId: string, title: string) => {
    setSubtasks((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, title } : s)))
  }, [])

  const toggleSubtaskDone = useCallback((tempId: string) => {
    setSubtasks((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, is_completed: !s.is_completed } : s)))
  }, [])

  const handleSubmit = useCallback(() => {
    const t = form.title?.trim() ?? ''
    if (!t) {
      setTitleError('标题不能为空')
      return
    }
    if (t.length > 100) {
      setTitleError('标题不能超过 100 字符')
      return
    }
    const validSubtasks = subtasks
      .filter((s) => s.title.trim())
      .map((s) => ({ title: s.title.trim(), order: s.order }))

    onSubmit({
      title: t,
      description: form.description?.trim() || undefined,
      priority: form.priority,
      category_id: form.category_id || undefined,
      icon: iconForPayload(form.icon),
      due_date: form.due_date || undefined,
      due_time: form.due_time || undefined,
      reminder_at: form.reminder_at || undefined,
      recurrence_rule: form.recurrence_rule || undefined,
      subtasks: validSubtasks.length > 0 ? validSubtasks : undefined,
    })
  }, [form, subtasks, onSubmit])

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={480}
      maskClosable={!saving}
      closable={false}
      title={null}
      keepDOM={false}
      className="task-drawer"
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
          <label className="field-label">
            标题 <span className="required">*</span>
          </label>
          <Input
            value={form.title}
            onChange={onTitleChange}
            placeholder="给任务起个名字（1-100 字符）"
            maxLength={100}
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
            rows={3}
            maxLength={500}
            showClear
          />
        </div>

        {/* Due date + time */}
        <div className="field">
          <label className="field-label">截止</label>
          <div className="due-row">
            <DatePicker
              value={form.due_date}
              onChange={(v: any) => setForm((f) => ({ ...f, due_date: String(v ?? '') }))}
              placeholder="选择日期"
              type="date"
              style={{ flex: 1 }}
            />
            <TimePicker
              value={form.due_time}
              onChange={(v: any) => setForm((f) => ({ ...f, due_time: String(v ?? '') }))}
              placeholder="选择时间"
              format="HH:mm"
              style={{ flex: 1 }}
            />
          </div>
        </div>

        {/* Reminder */}
        <div className="field">
          <label className="field-label">提醒</label>
          <div className="due-row">
            <TimePicker
              value={form.reminder_at}
              onChange={(v: any) => setForm((f) => ({ ...f, reminder_at: String(v ?? '') }))}
              placeholder="提醒时间（可选）"
              format="HH:mm"
              style={{ flex: 1 }}
            />
          </div>
        </div>

        {/* Priority */}
        <div className="field">
          <label className="field-label">优先级</label>
          <div className="priority-grid">
            {TASK_PRIORITIES.map((p) => {
              const tv = TINT_VARS[p.tint]
              const active = form.priority === p.value
              return (
                <div
                  key={p.value}
                  className="priority-chip"
                  style={{
                    background: active ? tv.bg : 'var(--color-bg-hover)',
                    color: active ? tv.fg : 'var(--color-text-secondary)',
                    borderColor: active ? tv.fg : 'var(--color-border-light)',
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setForm((f) => ({ ...f, priority: p.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') setForm((f) => ({ ...f, priority: p.value })) }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: tv.fg }} />
                    <span>{p.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 图标：已选 + 更换 › → IconPicker（04 §4.1，替代原 6 格 chip 里的图标猜测） */}
        <div className="field">
          <label className="field-label">图标</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="cat-icon-pick"
              onClick={() => setIconOpen(true)}
              style={{ background: TINT_VARS[iconView.tint].bg }}
            >
              <Icon name={iconView.icon} size={18} style={{ color: TINT_VARS[iconView.tint].fg }} />
              <span className="cat-icon-pick-text">更换</span>
            </button>
            <span className="field-tip" style={{ margin: 0 }}>
              {form.icon ? '已自选图标' : '跟随分类图标'}
            </span>
          </div>
        </div>

        {/* Category：一级平铺 chips + 管理入口（04 §4.1；与 HabitEditDrawer 同构，
            用户新增的分类能立刻选到；取消策略 = 再点一次清空，见 onPickCategory） */}
        <div className="field">
          <label className="field-label">分类</label>
          <CategoryTiles
            domain="task"
            value={form.category_id ?? ''}
            onChange={onPickCategory}
          />
        </div>

        {/* Recurrence */}
        <div className="field">
          <label className="field-label">重复</label>
          <Select
            value={form.recurrence_rule || ''}
            onChange={(v: any) => setForm((f) => ({ ...f, recurrence_rule: String(v ?? '') }))}
            optionList={RECURRENCE_OPTIONS}
            style={{ width: '100%' }}
          />
        </div>

        {/* Subtasks */}
        <div className="field">
          <label className="field-label">子任务</label>
          <div className="subtask-list">
            {subtasks.map((s) => (
              <div key={s.tempId} className="subtask-row">
                <Checkbox
                  checked={s.is_completed}
                  onChange={(_e: any) => toggleSubtaskDone(s.tempId)}
                />
                <Input
                  value={s.title}
                  onChange={(v: string) => updateSubtaskTitle(s.tempId, v)}
                  placeholder="子任务标题"
                  style={{ flex: 1 }}
                />
                <Button
                  theme="borderless"
                  type="danger"
                  size="small"
                  icon={<Icon name="Trash2" size={16} />}
                  onClick={() => removeSubtask(s.tempId)}
                />
              </div>
            ))}
          </div>
          <Button
            theme="light"
            type="secondary"
            size="small"
            icon={<Icon name="PlusCircle" size={16} />}
            onClick={addSubtask}
            style={{ marginTop: 8 }}
          >
            添加子任务
          </Button>
        </div>
      </div>
      <div className="drawer-footer">
        <Button theme="light" type="secondary" disabled={saving} onClick={onClose}>取消</Button>
        <Button theme="solid" type="primary" loading={saving} onClick={handleSubmit}>保存</Button>
      </div>

      {/* 分组图标候选（与 HabitEditDrawer / 移动端共用同一份 icon-groups 注册表） */}
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
