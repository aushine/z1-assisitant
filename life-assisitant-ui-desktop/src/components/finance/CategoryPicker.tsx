/**
 * CategoryPicker —— 记账分类选择器（桌面端）
 *
 * ⭐ 形态以「老大拍板」为准（推翻 spec 05 §4.5 的「不做 hover flyout」）：
 *   - 一级分类 **4 列平铺常驻**；
 *   - **点击一级 = 直接选中大类**（记大类的用户仍是 1 次点击，与现状持平）；
 *   - **鼠标 hover 到某个一级 → 浮出该一级的二级面板**（浮层、不占表单高度），
 *     点二级面板里的项 = 选中明细；鼠标移开即收起；
 *   - 属于「其他」这类**没有二级**的一级：点击直接选中并关闭，不弹空列表。
 *
 * 额外：内联「新建分类」入口（不叠第二层弹窗），建完直接选中回填。
 * 预算场景用 `level1Only`：只给一级、不展开二级、可选关闭新建入口。
 *
 * 260921 后续改动（05 §1.2.1 / §2.6 / §2.7）：
 *   - 有二级的一级，名字右侧补 `›`（**判断依据 `children.length > 0`** —— 二级全删掉
 *     标记自动消失，与「点了会不会出面板」的行为永远一致）；
 *   - 动作行右侧「管理 ›」直达 `/me/finance-categories`；
 *   - 一级 chip / 二级项**右键** → `Dropdown`（编辑 / 删除）；一级 chip **hover 时右上角
 *     露出 `⋮`**（点它等同右键，否则没人找得到这个入口）。
 *     菜单项复用 `CATEGORY_MENU_ACTIONS`（与管理页同一套定义）。
 *
 * ⚠️ 右键 / `⋮` 不得破坏既有的「点击一级 = 选中大类」与「hover 浮出二级面板」：
 *   - `⋮` 的 onClick 里 `stopPropagation`，不触发选中；
 *   - 菜单打开期间不收起二级浮层（否则右键二级项后浮层连锚点一起消失）。
 *
 * 选中判定一律按 `category_id`（不再按 name / emoji 比对）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dropdown, Modal } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_NAMES } from '@/components/icon/tints'
import { CATEGORY_MENU_ACTIONS } from '@/constants/category-menu'
import type { CategoryMenuActionKey } from '@/constants/category-menu'
import { useFinanceCategoryStore, resolveCategoryView } from '@/stores/financeCategory'
import type { FinanceCategory, CategoryScope } from '@/api/types'
import IconPicker from './IconPicker'

interface Props {
  scope: CategoryScope
  /** 当前选中的分类 id（一级或二级皆可） */
  value?: string | null
  onChange?: (cat: FinanceCategory) => void
  /** 预算场景：只选一级、不展开二级 */
  level1Only?: boolean
  /** 是否显示「新建分类」入口（默认 true） */
  showCreate?: boolean
}

export default function CategoryPicker({
  scope,
  value,
  onChange,
  level1Only = false,
  showCreate = true,
}: Props) {
  const navigate = useNavigate()
  const tree = useFinanceCategoryStore((s) => s.tree)
  const flat = useFinanceCategoryStore((s) => s.flat)
  const fetchTree = useFinanceCategoryStore((s) => s.fetchTree)
  const createCategory = useFinanceCategoryStore((s) => s.create)
  const updateCategory = useFinanceCategoryStore((s) => s.update)
  const removeCategory = useFinanceCategoryStore((s) => s.remove)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  /** 正在编辑的分类 id（为空 = 新建） */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 当前打开操作菜单的分类 id（一级 chip 或二级项） */
  const [menuForId, setMenuForId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<FinanceCategory | null>(null)
  /** 指针是否还在选择器内 —— 菜单收起时用来判断二级浮层要不要一起收 */
  const hoverInsideRef = useRef(false)

  useEffect(() => {
    if (tree.length === 0) void fetchTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 菜单收起后，若指针已不在选择器内，二级浮层一并收起（避免残留一块面板）
  useEffect(() => {
    if (!menuForId && !hoverInsideRef.current) setHoveredId(null)
  }, [menuForId])

  const topLevel = useMemo(
    () => tree.filter((c) => c.scope === scope),
    [tree, scope],
  )

  const hovered = hoveredId ? flat[hoveredId] : undefined

  function select(cat: FinanceCategory) {
    onChange?.(cat)
    setHoveredId(null)
  }

  // ---- 新建 / 编辑分类内联表单（两态共用，不叠第二层弹窗） ----
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<IconName | null>(null)
  const [tint, setTint] = useState<TintName | null>(null)
  const [nameError, setNameError] = useState('')
  const [iconOpen, setIconOpen] = useState(false)

  function openCreate(parentId: string | null) {
    setEditingId(null)
    setCreateParentId(parentId)
    setName('')
    setIcon(null)
    setTint(null)
    setNameError('')
    setCreating(true)
  }

  function openEdit(cat: FinanceCategory) {
    setHoveredId(null) // 进编辑态就收起二级浮层，避免两层面板叠着
    setEditingId(cat.id)
    setCreateParentId(cat.parent_id || null)
    setName(cat.name)
    setIcon((cat.icon as IconName | null) ?? null)
    setTint((cat.tint as TintName | null) ?? null)
    setNameError('')
    setCreating(true)
  }

  function closeForm() {
    setCreating(false)
    setEditingId(null)
  }

  async function submitForm() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('请输入名称')
      return
    }
    if (trimmed.length > 10) {
      setNameError('名称不能超过 10 个字')
      return
    }
    // 同 (scope, parent_id) 下重名（含未删除行，排除自身）行内报错，不弹 toast
    const dup = tree.some(
      (c) =>
        c.id !== editingId &&
        c.scope === scope &&
        (c.parent_id || '') === (createParentId || '') &&
        c.name === trimmed,
    )
    if (dup) {
      setNameError('该分类下已存在同名分类')
      return
    }

    if (editingId) {
      const ok = await updateCategory(editingId, {
        name: trimmed,
        icon: icon ?? null,
        tint: tint ?? null,
      })
      if (ok) closeForm()
      return
    }

    const created = await createCategory({
      parent_id: createParentId ?? '',
      scope,
      name: trimmed,
      icon: icon ?? null,
      tint: tint ?? null,
    })
    if (created) {
      select(created)
      closeForm()
    }
  }

  // 表单的图标/色预览（二级默认继承父级）
  const parentForPreview = createParentId ? flat[createParentId] : undefined
  const previewIcon: IconName = icon ?? (parentForPreview?.icon as IconName | undefined) ?? 'Package'
  const previewTint: TintName = tint ?? 'neutral'

  // ---- 右键 / ⋮ 操作菜单（编辑 / 删除） ----
  function onMenuAction(key: CategoryMenuActionKey, cat: FinanceCategory) {
    setMenuForId(null)
    if (key === 'edit') openEdit(cat)
    else setDeleting(cat)
  }

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    await removeCategory(deleting.id)
    setDeleting(null)
  }, [deleting, removeCategory])

  const deletingChildCount = deleting?.children?.length ?? 0

  /** 一组「编辑 / 删除」菜单项（与管理页共用 CATEGORY_MENU_ACTIONS） */
  function renderMenu(cat: FinanceCategory) {
    return (
      <Dropdown.Menu>
        {CATEGORY_MENU_ACTIONS.map((act) => (
          <Dropdown.Item
            key={act.key}
            type={act.danger ? 'danger' : 'tertiary'}
            icon={<Icon name={act.icon} size={16} />}
            onClick={() => onMenuAction(act.key, cat)}
          >
            {act.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    )
  }

  return (
    <div
      className="cat-picker"
      onMouseEnter={() => {
        hoverInsideRef.current = true
      }}
      onMouseLeave={() => {
        hoverInsideRef.current = false
        // 菜单打开时保留二级浮层：否则右键二级项后浮层先消失，菜单也失去锚点
        if (!menuForId) setHoveredId(null)
      }}
    >
      <div className="cat-grid cat-grid-4">
        {topLevel.map((cat) => {
          const v = resolveCategoryView({ category_id: cat.id }, flat)
          const isActive = value === cat.id
          const hasChildren = cat.children.length > 0
          return (
            <Dropdown
              key={cat.id}
              trigger="contextMenu"
              position="bottomLeft"
              visible={menuForId === cat.id}
              onVisibleChange={(vis) => setMenuForId(vis ? cat.id : null)}
              render={renderMenu(cat)}
            >
              <div
                className={`cat-chip${isActive ? ' active' : ''}`}
                onClick={() => select(cat)}
                onContextMenu={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (!level1Only && hasChildren) setHoveredId(cat.id)
                }}
              >
                <span
                  className="cat-emoji"
                  style={{ background: TINT_VARS[v.tint].bg, color: TINT_VARS[v.tint].fg }}
                >
                  <Icon name={v.icon} size={18} />
                </span>
                <span className="cat-name-row">
                  <span className="cat-name">{cat.name}</span>
                  {hasChildren && <Icon name="ChevronRight" size={12} className="cat-arrow" />}
                </span>
                {/* hover 时右上角露出的 ⋮；点它等同右键（stopPropagation：不触发选中） */}
                <button
                  type="button"
                  className="cat-more"
                  aria-label={`${cat.name} 的操作`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuForId(cat.id)
                  }}
                >
                  <Icon name="MoreHorizontal" size={16} className="cat-more-icon" />
                </button>
              </div>
            </Dropdown>
          )
        })}
      </div>

      {!creating && (
        <div className="cat-actions">
          {showCreate && (
            <button type="button" className="cat-create-btn" onClick={() => openCreate(null)}>
              <Icon name="PlusCircle" size={16} /> 新建分类
            </button>
          )}
          <button
            type="button"
            className="cat-manage-btn"
            onClick={() => navigate('/me/finance-categories')}
          >
            管理 <Icon name="ChevronRight" size={14} />
          </button>
        </div>
      )}

      {/* hover 浮出的二级面板（浮层，不占表单高度） */}
      {!level1Only && hovered && hovered.children.length > 0 && (
        <div className="cat-flyout">
          <div className="cat-flyout-title">
            <Icon name="ChevronRight" size={14} /> {hovered.name} 的细分
          </div>
          <div className="cat-flyout-list">
            {/* 首项 = 一级本身（只想记大类仍是 1 次点击）；右键 → 编辑 / 删除该大类 */}
            <Dropdown
              trigger="contextMenu"
              position="bottomLeft"
              visible={menuForId === hovered.id}
              onVisibleChange={(vis) => setMenuForId(vis ? hovered.id : null)}
              render={renderMenu(hovered)}
            >
              <button
                type="button"
                className={`cat-sub${value === hovered.id ? ' active' : ''}`}
                onClick={() => select(hovered)}
                onContextMenu={(e) => e.preventDefault()}
              >
                <Icon name="Folder" size={14} /> {hovered.name}
              </button>
            </Dropdown>
            {hovered.children.map((child) => {
              const cv = resolveCategoryView({ category_id: child.id }, flat)
              return (
                <Dropdown
                  key={child.id}
                  trigger="contextMenu"
                  position="bottomLeft"
                  visible={menuForId === child.id}
                  onVisibleChange={(vis) => setMenuForId(vis ? child.id : null)}
                  render={renderMenu(child)}
                >
                  <button
                    type="button"
                    className={`cat-sub${value === child.id ? ' active' : ''}`}
                    onClick={() => select(child)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <Icon name={cv.icon} size={14} /> {child.name}
                  </button>
                </Dropdown>
              )
            })}
          </div>
        </div>
      )}

      {/* 内联新建 / 编辑分类表单（不叠第二层弹窗） */}
      {creating && (
        <div className="cat-create-form">
          <div className="field">
            <label className="field-label">
              {editingId ? '编辑分类' : createParentId ? '二级分类名称' : '一级分类名称'}
              {createParentId ? `（归属「${parentForPreview?.name ?? ''}」）` : ''}
            </label>
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
              style={{
                background: TINT_VARS[previewTint].bg,
                color: TINT_VARS[previewTint].fg,
              }}
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
          </div>

          <div className="drawer-footer">
            <Button theme="light" type="tertiary" onClick={closeForm}>
              取消
            </Button>
            <Button theme="solid" type="primary" onClick={submitForm}>
              保存
            </Button>
          </div>
        </div>
      )}

      {/* 删除二次确认（05 §2.7 #1：删一级额外带子分类数量；历史记录保留） */}
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
        {deletingChildCount > 0 && (
          <div className="cat-del-md-line">该分类下有 {deletingChildCount} 个子分类，会一起移除。</div>
        )}
        <div className="cat-del-md-line">历史记录会保留，只是以后不再出现在选择器里。</div>
      </Modal>

      <IconPicker
        visible={iconOpen}
        value={icon}
        onClose={() => setIconOpen(false)}
        onSelect={(n) => setIcon(n)}
      />
    </div>
  )
}
