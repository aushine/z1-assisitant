/**
 * Task create/edit Drawer
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
import { Icon, TINT_VARS } from '@/components/icon'
import { TASK_CATEGORIES, getTaskCategory } from '@/utils/category-dict'
import type { CategoryDef } from '@/utils/category-dict'
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
    due_date: '',
    due_time: '',
    reminder_at: '',
    recurrence_rule: '',
    subtasks: [],
  })
  const [subtasks, setSubtasks] = useState<SubtaskForm[]>([])
  const [titleError, setTitleError] = useState('')

  // Reset form when visible changes or task changes
  useEffect(() => {
    if (!visible) return
    if (task) {
      setForm({
        title: task.title ?? '',
        description: task.description ?? '',
        priority: task.priority ?? 'normal',
        category_id: task.category_id ?? '',
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
        due_date: '',
        due_time: '',
        reminder_at: '',
        recurrence_rule: '',
        subtasks: [],
      })
      setSubtasks([])
    }
    setTitleError('')
  }, [visible, task?.id])

  const isEdit = !!task
  const titleText = isEdit ? '编辑任务' : '新建任务'

  const selectedCategory = useMemo(
    () => getTaskCategory(form.category_id) ?? null,
    [form.category_id]
  )

  const onTitleChange = useCallback((v: string) => {
    setForm((f) => ({ ...f, title: v }))
    if (v.trim()) setTitleError('')
  }, [])

  const onPickCategory = useCallback((c: CategoryDef) => {
    setForm((f) => ({ ...f, category_id: f.category_id === c.id ? '' : c.id }))
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

        {/* Category */}
        <div className="field">
          <label className="field-label">分类</label>
          <div className="category-grid">
            {TASK_CATEGORIES.map((c) => (
              <div
                key={c.id}
                className={`category-item${form.category_id === c.id ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onPickCategory(c)}
                onKeyDown={(e) => { if (e.key === 'Enter') onPickCategory(c) }}
              >
                <div className="category-emoji" style={{ background: TINT_VARS[c.tint].bg, color: TINT_VARS[c.tint].fg }}>
                  <Icon name={c.icon} size={18} style={{ color: TINT_VARS[c.tint].fg }} />
                </div>
                <div className="category-name">{c.label}</div>
              </div>
            ))}
          </div>
          {selectedCategory && (
            <div className="category-preview">
              已选：<strong><Icon name={selectedCategory.icon} size={14} style={{ color: TINT_VARS[selectedCategory.tint].fg, marginRight: 4 }} />{selectedCategory.label}</strong>
            </div>
          )}
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
    </SideSheet>
  )
}
