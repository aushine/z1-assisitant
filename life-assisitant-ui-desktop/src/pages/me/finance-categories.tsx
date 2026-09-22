/**
 * 记账分类管理页（桌面端）
 *
 * 需求要点（md/spec-20260921-v1/05 §2 + 老大拍板）：
 *   - 一级分类列表 + 二级分类管理（行内展开，不叠第二层弹窗）；
 *   - 编辑走「浮层」SideSheet（新建/编辑一级或二级共用）；
 *   - 二级管理区里，「一级本身」这一行**不能删除、也不能改名**（改名/删除在大类行操作）；
 *   - 删除确认文案必须说明「历史记录保留，只是不再出现在选择器里」；
 *   - 不提供「恢复默认分类」入口；
 *   - 二级图标/颜色默认继承父级（自身 icon/tint 为空 ⇒ 取父级）。
 *
 * 视觉与间距对齐现有 me 二级页（.management-page，max-width:900px）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Button, RadioGroup, Radio, SideSheet, Modal, Skeleton, Empty } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_NAMES } from '@/components/icon/tints'
import { resolveCategoryView, useFinanceCategoryStore } from '@/stores/financeCategory'
import { CATEGORY_MENU_ACTIONS } from '@/constants/category-menu'
import type { FinanceCategory, CategoryScope, CreateCategoryReq, PatchCategoryReq } from '@/api/types'
import IconPicker from '@/components/finance/IconPicker'

type Scope = CategoryScope

interface EditState {
  /** 若为二级，记录其所属一级 id；为空表示编辑/新建一级 */
  parentId: string | null
  /** 正在编辑的分类（新建时为空） */
  cat?: FinanceCategory
}

export default function FinanceCategoriesPage() {
  const navigate = useNavigate()
  const tree = useFinanceCategoryStore((s) => s.tree)
  const flat = useFinanceCategoryStore((s) => s.flat)
  const loading = useFinanceCategoryStore((s) => s.loading)
  const fetchTree = useFinanceCategoryStore((s) => s.fetchTree)
  const createCategory = useFinanceCategoryStore((s) => s.create)
  const updateCategory = useFinanceCategoryStore((s) => s.update)
  const removeCategory = useFinanceCategoryStore((s) => s.remove)

  const [scope, setScope] = useState<Scope>('expense')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [edit, setEdit] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<FinanceCategory | null>(null)

  useEffect(() => {
    void fetchTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const topLevel = useMemo(() => tree.filter((c) => c.scope === scope), [tree, scope])

  const onDelete = useCallback(
    (cat: FinanceCategory) => {
      setDeleting(cat)
    },
    [],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    await removeCategory(deleting.id)
    setDeleting(null)
  }, [deleting, removeCategory])

  function openCreatePrimary() {
    setEdit({ parentId: null })
  }
  function openCreateSecondary(parentId: string) {
    setEdit({ parentId })
  }
  function openEdit(cat: FinanceCategory) {
    setEdit({ parentId: cat.parent_id || null, cat })
  }

  return (
    <div className="management-page">
      <div className="page-tipbar">
        <div>
          <h2 className="page-title">
            <Icon name="Tags" size={22} style={{ marginRight: 8 }} />
            记账分类
          </h2>
          <span className="page-tip">自定义一级 / 二级分类、图标与颜色；历史记账按 id 关联，分类删除不影响已记账目</span>
        </div>
        <div className="header-right">
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreatePrimary}>
            新建分类
          </Button>
        </div>
      </div>

      <Card bordered={false} className="card">
        <div className="ann-scope">
          <RadioGroup
            type="button"
            value={scope}
            onChange={(e: any) => setScope((e?.target?.value ?? e) as Scope)}
          >
            <Radio value="expense">支出</Radio>
            <Radio value="income">收入</Radio>
          </RadioGroup>
        </div>

        {loading && tree.length === 0 ? (
          <div className="skeleton-wrap">
            <Skeleton>
              <Skeleton.Paragraph rows={4} />
            </Skeleton>
          </div>
        ) : topLevel.length === 0 ? (
          <Empty
            image={<Icon name="Tags" size={48} />}
            title="还没有分类"
            description="点右上角「新建分类」添加第一个吧"
          />
        ) : (
          <div className="cat-mg-list">
            {topLevel.map((cat) => {
              const v = resolveCategoryView({ category_id: cat.id }, flat)
              const isOpen = !!expanded[cat.id]
              const children = cat.children ?? []
              return (
                <div key={cat.id} className="cat-mg-row">
                  <div className="cat-mg-head">
                    <span
                      className="cat-emoji"
                      style={{ background: TINT_VARS[v.tint].bg, color: TINT_VARS[v.tint].fg }}
                    >
                      <Icon name={v.icon} size={18} />
                    </span>
                    <div className="cat-mg-title">{cat.name}</div>
                    <div className="cat-mg-sub">{children.length > 0 ? `${children.length} 个细分` : '无细分'}</div>
                    <div className="cat-mg-actions">
                      {children.length > 0 && (
                        <Button
                          size="small"
                          theme="light"
                          type="tertiary"
                          icon={isOpen ? <Icon name="ChevronDown" size={16} /> : <Icon name="ChevronRight" size={16} />}
                          onClick={() => setExpanded((p) => ({ ...p, [cat.id]: !isOpen }))}
                        >
                          {isOpen ? '收起' : '管理细分'}
                        </Button>
                      )}
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

                  {isOpen && (
                    <div className="cat-mg-children">
                      {/* 二级管理区：一级本身这一行不可删除、不可改名（仅作标题展示） */}
                      <div className="cat-mg-parent-hint">
                        「{cat.name}」的细分（父级不可在此删除 / 改名）
                      </div>
                      {children.map((child) => {
                        const cv = resolveCategoryView({ category_id: child.id }, flat)
                        return (
                          <div key={child.id} className="cat-mg-child">
                            <span
                              className="cat-emoji cat-emoji-sm"
                              style={{ background: TINT_VARS[cv.tint].bg, color: TINT_VARS[cv.tint].fg }}
                            >
                              <Icon name={cv.icon} size={15} />
                            </span>
                            <div className="cat-mg-title">{child.name}</div>
                            {cv.fromSnapshot && <span className="cat-mg-tag">已删除</span>}
                            <div className="cat-mg-actions">
                              {CATEGORY_MENU_ACTIONS.map((act) => (
                                <Button
                                  key={act.key}
                                  size="small"
                                  theme="light"
                                  type={act.danger ? 'danger' : 'tertiary'}
                                  onClick={() => (act.key === 'edit' ? openEdit(child) : onDelete(child))}
                                >
                                  {act.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      <Button
                        size="small"
                        theme="light"
                        type="secondary"
                        icon={<Icon name="PlusCircle" size={16} />}
                        onClick={() => openCreateSecondary(cat.id)}
                      >
                        添加细分
                      </Button>
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
        scope={scope}
        state={edit}
        flat={flat}
        onClose={() => setEdit(null)}
        onCreate={createCategory}
        onUpdate={updateCategory}
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
        {(deleting?.children?.length ?? 0) > 0 && (
          <div className="cat-del-md-line">
            该分类下有 {deleting?.children?.length} 个子分类，会一起移除。
          </div>
        )}
        <div className="cat-del-md-line">历史记录会保留，只是以后不再出现在选择器里。</div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 编辑浮层（新建 / 编辑一级或二级共用）
// ---------------------------------------------------------------------------

interface SheetProps {
  visible: boolean
  scope: Scope
  state: EditState | null
  flat: Record<string, FinanceCategory>
  onClose: () => void
  onCreate: (data: CreateCategoryReq) => Promise<FinanceCategory | null>
  onUpdate: (id: string, data: PatchCategoryReq) => Promise<boolean>
}

function CategoryEditSheet({ visible, scope, state, flat, onClose, onCreate, onUpdate }: SheetProps) {
  const isSecondary = !!state?.parentId
  const editing = state?.cat
  const parent = state?.parentId ? flat[state.parentId] : undefined

  const [name, setName] = useState('')
  const [icon, setIcon] = useState<IconName | null>(null)
  const [tint, setTint] = useState<TintName | null>(null)
  const [nameError, setNameError] = useState('')
  const [iconOpen, setIconOpen] = useState(false)

  // 打开 / 切换编辑对象时同步表单
  useEffect(() => {
    if (!visible) return
    setName(editing?.name ?? '')
    setIcon((editing?.icon as IconName | undefined) ?? null)
    setTint((editing?.tint as TintName | undefined) ?? null)
    setNameError('')
    setIconOpen(false)
  }, [visible, editing])

  const previewTint: TintName = tint ?? (parent?.tint as TintName | undefined) ?? 'neutral'
  const previewIcon: IconName = icon ?? (parent?.icon as IconName | undefined) ?? 'Package'

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
    const payload: PatchCategoryReq = {
      name: trimmed,
      icon: icon ?? null,
      tint: tint ?? null,
    }
    if (editing) {
      await onUpdate(editing.id, payload)
    } else {
      await onCreate({
        parent_id: state?.parentId ?? '',
        scope,
        name: trimmed,
        icon: icon ?? null,
        tint: tint ?? null,
      })
    }
    onClose()
  }

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={420}
      title={editing ? '编辑分类' : isSecondary ? '新建二级分类' : '新建一级分类'}
    >
      <div className="drawer-body">
        {isSecondary && parent && (
          <div className="field-tip">归属「{parent.name}」· 图标与颜色留空则继承父级</div>
        )}
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
        </div>

        <div className="field">
          <label className="field-label">颜色</label>
          <div className="color-row">
            {TINT_NAMES.map((t) => (
              <button
                key={t}
                type="button"
                className={`color-chip${tint === t ? ' active' : ''}`}
                style={{ background: TINT_VARS[t].bg }}
                onClick={() => setTint(t)}
                aria-label={t}
              />
            ))}
          </div>
          {isSecondary && (
            <div className="field-tip">不选则继承父级「{parent?.name}」的颜色</div>
          )}
        </div>
      </div>
      <div className="drawer-footer">
        <Button theme="light" type="tertiary" onClick={onClose}>
          取消
        </Button>
        <Button theme="solid" type="primary" onClick={save}>
          保存
        </Button>
      </div>

      <IconPicker visible={iconOpen} value={icon} onClose={() => setIconOpen(false)} onSelect={(n) => setIcon(n)} />
    </SideSheet>
  )
}
