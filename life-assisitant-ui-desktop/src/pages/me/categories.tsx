/**
 * 分类管理页 —— 习惯 / 待办（桌面端 · spec-20260922-v2/04 §4.4；R3/R4 两级重构）
 *
 * 形态**照抄** `me/finance-categories.tsx`（页面骨架 / 行操作 / SideSheet 编辑 /
 * Modal 删除确认同一份规范），并升级为**两级树**（一级 + 行内展开的二级）。
 *
 * ⚠️ 2026-09-24（spec-20260924-v1 §03 R3 + §04 R4）重构：
 *   1. **去掉页内「习惯/待办」分段切换** —— 由各自的入口带 `?domain=` 进来，\n *      页面只显示该域的分类；标题随 domain 变「习惯分类管理 / 待办分类管理」。\n *   2. **两级**：一级行可展开看二级，二级支持增删改；一级行另有「添加二级」。\n *   3. 删一级 → 后端级联软删其二级（前端仅提示语义）。\n *
 * 视觉：`.management-page`（max-width 900，管理场景），**不是** .settings-page。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Button, SideSheet, Modal, Skeleton, Empty } from '@douyinfe/semi-ui'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon, ICONS, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_NAMES } from '@/components/icon/tints'
import { useUserCategoryStore, normalizeIconRef, DOMAIN_FALLBACK_ICON } from '@/stores/user-category'
import type { UserCategory, UserCategoryDomain } from '@/api/types'
import IconPicker from '@/components/finance/IconPicker'

interface EditState {
  /** 正在编辑的分类（新建时为空） */
  cat?: UserCategory
  /** 新建时的所属一级（新增二级用）；一级新建为 undefined */
  parent?: UserCategory
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

  const [domain] = useState<UserCategoryDomain>(() => initialDomain(searchParams.get('domain')))
  const [edit, setEdit] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<UserCategory | null>(null)
  /** 展开的一级分类 id 集合 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    // 只预热当前域（R4：不再一次拉两域）
    void store.getState().ensureFresh(domain)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain])

  /** 一级分类（按 sort） */
  const topLevel = useMemo(
    () => (items[domain] ?? []).filter((c) => !c.parent_id),
    [items, domain],
  )
  const childrenOf = useCallback(
    (parentId: string) => (items[domain] ?? []).filter((c) => c.parent_id === parentId),
    [items, domain],
  )
  const isEmptyLoading = loading[domain] && !loadedOnce[domain] && topLevel.length === 0

  const onDelete = useCallback((cat: UserCategory) => setDeleting(cat), [])

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    await store.getState().remove(deleting.id)
    setDeleting(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleting])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCreateTop() {
    setEdit({})
  }
  function openCreateChild(parent: UserCategory) {
    setEdit({ parent })
    // 新建二级时确保其父展开
    setExpanded((prev) => new Set(prev).add(parent.id))
  }
  function openEdit(cat: UserCategory) {
    setEdit({ cat })
  }

  const domainLabel = domain === 'habit' ? '习惯' : '待办'

  return (
    <div className="management-page">
      <div className="page-tipbar">
        <div>
          <h2 className="page-title">
            <Icon name="FolderOpen" size={22} style={{ marginRight: 8 }} />
            {domainLabel}分类管理
          </h2>
          <span className="page-tip">
            自定义{domainLabel}分类（支持二级）、图标与颜色；历史记录按 id 关联，分类删除不影响已有数据
          </span>
        </div>
        <div className="header-right">
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreateTop}>
            新建一级分类
          </Button>
        </div>
      </div>

      <Card bordered={false} className="card">
        {isEmptyLoading ? (
          <div className="skeleton-wrap">
            <Skeleton>
              <Skeleton.Paragraph rows={4} />
            </Skeleton>
          </div>
        ) : topLevel.length === 0 ? (
          <Empty
            image={<Icon name="FolderOpen" size={48} />}
            title="还没有分类"
            description="点右上角「新建一级分类」添加第一个吧"
          />
        ) : (
          <div className="cat-mg-list">
            {topLevel.map((cat) => {
              const v = store.getState().resolveCategory(domain, cat.id)
              const tint = v?.tint ?? 'neutral'
              const icon = v?.icon ?? normalizeIconRef(cat.icon)?.icon ?? DOMAIN_FALLBACK_ICON[domain]
              const children = childrenOf(cat.id)
              const isOpen = expanded.has(cat.id)
              return (
                <div key={cat.id} className="cat-mg-row">
                  <div className="cat-mg-head">
                    <button
                      type="button"
                      className="cat-mg-toggle"
                      onClick={() => children.length && toggleExpand(cat.id)}
                      aria-label={isOpen ? '收起二级' : '展开二级'}
                      style={{ visibility: children.length ? 'visible' : 'hidden' }}
                    >
                      <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={16} />
                    </button>
                    <span className="cat-emoji" style={{ background: TINT_VARS[tint].bg, color: TINT_VARS[tint].fg }}>
                      <Icon name={icon} size={18} />
                    </span>
                    <div className="cat-mg-title">{cat.name}</div>
                    <div className="cat-mg-sub">
                      {cat.is_builtin ? '内置' : '自定义'}
                      {children.length > 0 && ` · ${children.length} 个二级`}
                    </div>
                    <div className="cat-mg-actions">
                      <Button size="small" theme="light" type="tertiary" onClick={() => openCreateChild(cat)}>
                        添加二级
                      </Button>
                      <Button size="small" theme="light" type="tertiary" onClick={() => openEdit(cat)}>
                        编辑
                      </Button>
                      <Button size="small" theme="light" type="danger" onClick={() => onDelete(cat)}>
                        删除
                      </Button>
                    </div>
                  </div>

                  {isOpen && children.length > 0 && (
                    <div className="cat-mg-children">
                      {children.map((child) => {
                        const cv = store.getState().resolveCategory(domain, child.id)
                        const ctint = cv?.tint ?? 'neutral'
                        const cicon = cv?.icon ?? normalizeIconRef(child.icon)?.icon ?? DOMAIN_FALLBACK_ICON[domain]
                        return (
                          <div key={child.id} className="cat-mg-row cat-mg-row--child">
                            <div className="cat-mg-head">
                              <span className="cat-mg-child-dash" aria-hidden="true" />
                              <span className="cat-emoji" style={{ background: TINT_VARS[ctint].bg, color: TINT_VARS[ctint].fg }}>
                                <Icon name={cicon} size={16} />
                              </span>
                              <div className="cat-mg-title">{child.name}</div>
                              <div className="cat-mg-sub">{child.is_builtin ? '内置' : '自定义'}</div>
                              <div className="cat-mg-actions">
                                <Button size="small" theme="light" type="tertiary" onClick={() => openEdit(child)}>
                                  编辑
                                </Button>
                                <Button size="small" theme="light" type="danger" onClick={() => onDelete(child)}>
                                  删除
                                </Button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
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
        siblings={items[domain] ?? []}
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
        <div className="cat-del-md-line">
          历史记录会保留，只是以后不再出现在选择器里。
          {deleting && !deleting.parent_id && '该分类下的二级分类会一并删除。'}
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 编辑浮层（新建 / 编辑共用 —— 支持一级与二级）
// ---------------------------------------------------------------------------

interface SheetProps {
  visible: boolean
  domain: UserCategoryDomain
  state: EditState | null
  /** 同域现有分类（重名行内校验用；二级重名只与同父下比） */
  siblings: UserCategory[]
  onClose: () => void
}

function CategoryEditSheet({ visible, domain, state, siblings, onClose }: SheetProps) {
  const editing = state?.cat
  /** 新建二级时的父（编辑时取 editing.parent_id） */
  const parentId = editing ? editing.parent_id : state?.parent?.id ?? ''

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

  const previewIcon: IconName = normalizeIconRef(iconRef)?.icon ?? DOMAIN_FALLBACK_ICON[domain]
  const previewTint: TintName = tint ?? normalizeIconRef(iconRef)?.tint ?? 'neutral'

  const title = editing
    ? editing.parent_id
      ? '编辑二级分类'
      : '编辑一级分类'
    : parentId
      ? '新建二级分类'
      : '新建一级分类'

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
    // 重名校验：二级只与同父下的兄弟比（后端 uk 也是 user+domain+parent+name）
    const sameParentSiblings = siblings.filter((s) => s.parent_id === parentId)
    if (sameParentSiblings.some((s) => s.name === trimmed && s.id !== editing?.id)) {
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
          parent_id: parentId || undefined,
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
      title={title}
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
