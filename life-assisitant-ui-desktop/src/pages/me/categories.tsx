/**
 * 分类管理页 —— 习惯 / 待办（桌面端 · spec-20260922-v2/04 §4.4）
 *
 * 形态**完全照抄** `me/finance-categories.tsx`（页面骨架 / 行操作 /
 * SideSheet 编辑 / Modal 删除确认同一份规范），只减掉两级树：
 * 一级平铺 ⇒ 行上直接「编辑 / 删除」。一页两分段（习惯 / 待办），
 * 分段初值取 `?domain=`（CategoryTiles「管理 ›」带入）。
 *
 * 视觉：`.management-page`（max-width 900，管理场景），**不是** .settings-page。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Button, RadioGroup, Radio, SideSheet, Modal, Skeleton, Empty } from '@douyinfe/semi-ui'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon, ICONS, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_NAMES } from '@/components/icon/tints'
import { useUserCategoryStore, normalizeIconRef, DOMAIN_FALLBACK_ICON } from '@/stores/user-category'
import { CATEGORY_MENU_ACTIONS } from '@/constants/category-menu'
import type { UserCategory, UserCategoryDomain } from '@/api/types'
import IconPicker from '@/components/finance/IconPicker'

interface EditState {
  /** 正在编辑的分类（新建时为空） */
  cat?: UserCategory
}

function initialDomain(q: string | null): UserCategoryDomain {
  return q === 'task' || q === 'habit' ? q : 'habit'
}

export default function MeCategoriesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const store = useUserCategoryStore
  const items = useUserCategoryStore((s) => s.items)
  const loading = useUserCategoryStore((s) => s.loading)
  const loadedOnce = useUserCategoryStore((s) => s.loadedOnce)

  const [domain, setDomain] = useState<UserCategoryDomain>(() => initialDomain(searchParams.get('domain')))
  const [edit, setEdit] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<UserCategory | null>(null)

  useEffect(() => {
    // 两域一起预热（ensureFresh 内部按域去重），切分段不用再等
    void store.getState().ensureFresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categories = useMemo(() => items[domain] ?? [], [items, domain])
  const isEmptyLoading = loading[domain] && !loadedOnce[domain] && categories.length === 0

  const onDelete = useCallback((cat: UserCategory) => setDeleting(cat), [])

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    await store.getState().remove(deleting.id)
    setDeleting(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleting])

  function openCreate() {
    setEdit({})
  }
  function openEdit(cat: UserCategory) {
    setEdit({ cat })
  }

  return (
    <div className="management-page">
      <div className="page-tipbar">
        <div>
          <h2 className="page-title">
            <Icon name="FolderOpen" size={22} style={{ marginRight: 8 }} />
            分类管理
          </h2>
          <span className="page-tip">自定义习惯 / 待办分类、图标与颜色；历史记录按 id 关联，分类删除不影响已有数据</span>
        </div>
        <div className="header-right">
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreate}>
            新建分类
          </Button>
        </div>
      </div>

      <Card bordered={false} className="card">
        <div className="ann-scope">
          <RadioGroup
            type="button"
            value={domain}
            onChange={(e: any) => setDomain((e?.target?.value ?? e) as UserCategoryDomain)}
          >
            <Radio value="habit">习惯分类</Radio>
            <Radio value="task">待办分类</Radio>
          </RadioGroup>
        </div>

        {isEmptyLoading ? (
          <div className="skeleton-wrap">
            <Skeleton>
              <Skeleton.Paragraph rows={4} />
            </Skeleton>
          </div>
        ) : categories.length === 0 ? (
          <Empty
            image={<Icon name="FolderOpen" size={48} />}
            title="还没有分类"
            description="点右上角「新建分类」添加第一个吧"
          />
        ) : (
          <div className="cat-mg-list">
            {categories.map((cat) => {
              const v = store.getState().resolveCategory(domain, cat.id)
              const tint = v?.tint ?? 'neutral'
              const icon = v?.icon ?? normalizeIconRef(cat.icon)?.icon ?? DOMAIN_FALLBACK_ICON[domain]
              return (
                <div key={cat.id} className="cat-mg-row">
                  <div className="cat-mg-head">
                    <span className="cat-emoji" style={{ background: TINT_VARS[tint].bg, color: TINT_VARS[tint].fg }}>
                      <Icon name={icon} size={18} />
                    </span>
                    <div className="cat-mg-title">{cat.name}</div>
                    <div className="cat-mg-sub">{cat.is_builtin ? '内置' : '自定义'}</div>
                    <div className="cat-mg-actions">
                      {CATEGORY_MENU_ACTIONS.map((act) => (
                        <Button
                          key={act.key}
                          size="small"
                          theme="light"
                          type={act.danger ? 'danger' : 'tertiary'}
                          onClick={() => (act.key === 'edit' ? openEdit(cat) : onDelete(cat))}
                        >
                          {act.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="ann-back">
        <Button theme="light" type="tertiary" onClick={() => navigate('/me')}>
          返回个人中心
        </Button>
      </div>

      <CategoryEditSheet
        visible={!!edit}
        domain={domain}
        state={edit}
        siblings={categories}
        onClose={() => setEdit(null)}
      />

      <Modal
        visible={!!deleting}
        onCancel={() => setDeleting(null)}
        title="删除分类"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ type: 'danger', theme: 'solid' }}
        onOk={confirmDelete}
      >
        确认删除「{deleting?.name}」？
        <div className="cat-del-md-line">历史记录会保留，只是以后不再出现在选择器里。</div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 编辑浮层（新建 / 编辑共用 —— 一级平铺，没有二级）
// ---------------------------------------------------------------------------

interface SheetProps {
  visible: boolean
  domain: UserCategoryDomain
  state: EditState | null
  /** 同域现有分类（重名行内校验用） */
  siblings: UserCategory[]
  onClose: () => void
}

function CategoryEditSheet({ visible, domain, state, siblings, onClose }: SheetProps) {
  const editing = state?.cat

  const [name, setName] = useState('')
  /** 落库口径的图标引用（`lucide:<Name>`）；null = 未选（渲染域默认图标） */
  const [iconRef, setIconRef] = useState<string | null>(null)
  const [tint, setTint] = useState<TintName | null>(null)
  const [nameError, setNameError] = useState('')
  const [iconOpen, setIconOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // 打开 / 切换编辑对象时同步表单
  useEffect(() => {
    if (!visible) return
    setName(editing?.name ?? '')
    setIconRef(editing?.icon || null)
    setTint((editing?.tint as TintName | null | undefined) ?? null)
    setNameError('')
    setIconOpen(false)
  }, [visible, editing])

  /** IconPicker 要裸名（存量 emoji 引用视为未选） */
  const pickerIcon: IconName | null = useMemo(() => {
    if (!iconRef) return null
    const bare = iconRef.startsWith('lucide:') ? iconRef.slice(7) : iconRef
    return (ICONS as Record<string, unknown>)[bare] ? (bare as IconName) : null
  }, [iconRef])

  const previewIcon: IconName =
    normalizeIconRef(iconRef)?.icon ?? DOMAIN_FALLBACK_ICON[domain]
  const previewTint: TintName = tint ?? normalizeIconRef(iconRef)?.tint ?? 'neutral'

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('请输入名称')
      return
    }
    if (trimmed.length > 10) {
      setNameError('名称不能超过 10 个字')
      return
    }
    // 同域重名（后端行内错误也会拦，这里行内提示，口径照抄财务）
    if (siblings.some((s) => s.name === trimmed && s.id !== editing?.id)) {
      setNameError('该名称已存在')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const ok = await useUserCategoryStore.getState().update(editing.id, {
          name: trimmed,
          icon: iconRef,
          tint: tint,
        })
        if (ok) onClose()
      } else {
        const created = await useUserCategoryStore.getState().create({
          domain,
          name: trimmed,
          icon: iconRef,
          tint: tint,
          emoji: null,
        })
        if (created) onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideSheet
      visible={visible}
      onCancel={saving ? () => undefined : onClose}
      placement="right"
      width={420}
      title={editing ? '编辑分类' : '新建分类'}
    >
      <div className="drawer-body">
        <div className="field">
          <label className="field-label">名称</label>
          <input
            className="cat-input"
            value={name}
            autoFocus
            maxLength={10}
            placeholder="最多 10 个字"
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError('')
            }}
          />
          {nameError && <div className="field-error">{nameError}</div>}
        </div>

        <div className="field">
          <label className="field-label">图标</label>
          <button
            type="button"
            className="cat-icon-pick"
            onClick={() => setIconOpen(true)}
            style={{ background: TINT_VARS[previewTint].bg, color: TINT_VARS[previewTint].fg }}
          >
            <Icon name={previewIcon} size={18} />
            <span className="cat-icon-pick-text">更换</span>
          </button>
          <div className="field-tip">不选则用{domain === 'habit' ? '习惯' : '待办'}默认图标</div>
        </div>

        <div className="field">
          <label className="field-label">颜色</label>
          <div className="color-row">
            {TINT_NAMES.map((t) => (
              <button
                key={t}
                type="button"
                className={`color-chip${previewTint === t ? ' active' : ''}`}
                style={{ background: TINT_VARS[t].bg }}
                onClick={() => setTint(t)}
                aria-label={t}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="drawer-footer">
        <Button theme="light" type="tertiary" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button theme="solid" type="primary" onClick={save} loading={saving}>
          保存
        </Button>
      </div>

      <IconPicker
        visible={iconOpen}
        value={pickerIcon}
        onClose={() => setIconOpen(false)}
        onSelect={(n) => {
          // 落库口径 `lucide:<Name>`（04 §4.3）
          setIconRef(`lucide:${n}`)
          setIconOpen(false)
        }}
      />
    </SideSheet>
  )
}
