/**
 * FinanceCategory Store —— 用户级收支分类（记账分类体系升级）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/stores/finance-category.ts
 * 后端契约：md/spec-20260921-v1/06-API规范.md §1
 *
 * 分类从「前端写死的枚举」升级为「数据库里的用户级实体」：
 *   - 两级（大类 parent_id='' + 明细），可增删改、自选图标颜色；
 *   - 每个分类有唯一 id，所有渲染 / 统计 / 预算都**按 id**，不再按 name / emoji 比对；
 *   - 写操作走**乐观更新 + 失败回滚 + 用户可见提示**（与 anniversary store 同构）。
 *
 * 查询助手（降级规则见 05 §3）：
 *   - `byId(id)`：扁平索引查节点；
 *   - `resolveCategoryView(input, flat)`：按 id 优先、已删除走中性灰、未命中走
 *     快照 category_name + category_emoji 兜底。
 */
import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { financeApi } from '@/api/finance'
import type {
  FinanceCategory,
  CreateCategoryReq,
  PatchCategoryReq,
  CategoryScope,
} from '@/api/types'
import { ICONS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_NAMES } from '@/components/icon/tints'
import { findCategoryByEmoji } from '@/utils/category-dict'

// ---------------------------------------------------------------------------
// 纯函数：树操作（不可变更新）
// ---------------------------------------------------------------------------

/** 扁平索引：id → 节点（含两级） */
function buildFlat(tree: FinanceCategory[]): Record<string, FinanceCategory> {
  const map: Record<string, FinanceCategory> = {}
  const walk = (nodes: FinanceCategory[]) => {
    for (const n of nodes) {
      map[n.id] = n
      if (n.children?.length) walk(n.children)
    }
  }
  walk(tree)
  return map
}

function insertNode(tree: FinanceCategory[], node: FinanceCategory): FinanceCategory[] {
  if (!node.parent_id) return [...tree, node]
  return tree.map((root) =>
    root.id === node.parent_id
      ? { ...root, children: [...root.children, node] }
      : root,
  )
}

function replaceById(
  tree: FinanceCategory[],
  id: string,
  newNode: FinanceCategory,
): FinanceCategory[] {
  return tree.map((n) => {
    if (n.id === id) {
      // 服务端对一级的返回往往 children=[]，但乐观态已持有子项，保留既有 children
      const children =
        newNode.children && newNode.children.length > 0 ? newNode.children : n.children
      return { ...newNode, children }
    }
    if (n.children?.length) {
      const c = replaceById(n.children, id, newNode)
      if (c !== n.children) return { ...n, children: c }
    }
    return n
  })
}

function removeById(tree: FinanceCategory[], id: string): FinanceCategory[] {
  const result: FinanceCategory[] = []
  for (const n of tree) {
    if (n.id === id) continue
    const children = n.children?.length ? removeById(n.children, id) : n.children
    result.push({ ...n, children })
  }
  return result
}

function patchById(
  tree: FinanceCategory[],
  id: string,
  patch: PatchCategoryReq,
): FinanceCategory[] {
  return tree.map((n) => {
    if (n.id === id) {
      const updated: FinanceCategory = { ...n, ...patch }
      // 改一级名字时，级联重拼其所有二级的 full_name（与后端事务逻辑对齐）
      if (patch.name && !n.parent_id) {
        updated.full_name = patch.name
        updated.children = n.children.map((c) => ({
          ...c,
          full_name: `${patch.name}-${c.name}`,
        }))
      }
      return updated
    }
    if (n.children?.length) {
      const c = patchById(n.children, id, patch)
      if (c !== n.children) return { ...n, children: c }
    }
    return n
  })
}

// ---------------------------------------------------------------------------
// 图标 / 语义色：继承父级 + 安全降级（04 §5.2）
// ---------------------------------------------------------------------------

const ICON_LOOKUP = ICONS as Record<string, unknown>

function safeIcon(name: string | null | undefined): IconName {
  if (name && ICON_LOOKUP[name]) return name as IconName
  if (import.meta.env.DEV && name) {
    console.warn(`[finance-category] 图标名 "${name}" 未在 ICONS 注册表，降级为 HelpCircle`)
  }
  return 'HelpCircle'
}

function safeTint(t: string | null | undefined): TintName {
  if (t && (TINT_NAMES as readonly string[]).includes(t)) return t as TintName
  return 'neutral'
}

/** 向上取父级的 icon（二级 icon 为 null 时继承） */
function resolveIcon(
  node: FinanceCategory,
  flat: Record<string, FinanceCategory>,
): IconName {
  if (node.icon) return safeIcon(node.icon)
  if (node.parent_id && flat[node.parent_id]) {
    return resolveIcon(flat[node.parent_id], flat)
  }
  return 'Package'
}

/** 向上取父级的 tint（二级 tint 为 null 时继承） */
function resolveTint(
  node: FinanceCategory,
  flat: Record<string, FinanceCategory>,
): TintName {
  if (node.tint) return safeTint(node.tint)
  if (node.parent_id && flat[node.parent_id]) {
    return resolveTint(flat[node.parent_id], flat)
  }
  return 'neutral'
}

// ---------------------------------------------------------------------------
// 查询助手：降级后的统一视图
// ---------------------------------------------------------------------------

export interface ResolvedCategoryView {
  /** 分类 id（快照兜底时为 undefined） */
  id?: string
  /** 显示名 */
  name: string
  /** 渲染图标名 */
  icon: IconName
  /** 语义色 */
  tint: TintName
  /** 该分类已被软删除（历史交易里仍可见，渲染中性灰） */
  isDeleted: boolean
  /** 是否走了快照降级（id 查不到） */
  fromSnapshot: boolean
}

export interface CategoryResolveInput {
  category_id?: string | null
  category_name?: string | null
  category_emoji?: string | null
}

/**
 * 按 id 优先、快照兜底的降级解析（05 §3）。
 *
 * 1. 有 category_id 且命中：
 *      - 未删除 → 用分类的 icon / tint / name（icon/tint 空则继承父级）；
 *      - 已删除 → 用分类名 + **中性灰**（不显示「已删除」字样，避免噪音）；
 * 2. 未命中 / 无 id → 退到快照：category_name + category_emoji 经 category-dict 反查；
 * 3. 快照也查不到 → 兜底「未分类」+ Package + neutral。
 */
export function resolveCategoryView(
  input: CategoryResolveInput,
  flat: Record<string, FinanceCategory>,
): ResolvedCategoryView {
  const id = input.category_id
  if (id && flat[id]) {
    const node = flat[id]
    if (node.is_deleted) {
      return {
        id,
        name: node.name,
        icon: resolveIcon(node, flat),
        tint: 'neutral',
        isDeleted: true,
        fromSnapshot: false,
      }
    }
    return {
      id,
      name: node.name,
      icon: resolveIcon(node, flat),
      tint: resolveTint(node, flat),
      isDeleted: false,
      fromSnapshot: false,
    }
  }

  // 快照降级
  const snap = input.category_emoji ? findCategoryByEmoji(input.category_emoji) : undefined
  if (snap) {
    return {
      name: input.category_name || snap.label,
      icon: snap.icon,
      tint: snap.tint,
      isDeleted: false,
      fromSnapshot: true,
    }
  }

  return {
    name: input.category_name || '未分类',
    icon: 'Package',
    tint: 'neutral',
    isDeleted: false,
    fromSnapshot: true,
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface FinanceCategoryState {
  /** 一级分类森林（每个 root 带 children） */
  tree: FinanceCategory[]
  /** 扁平索引 id → 节点（供 byId / resolveCategoryView 使用） */
  flat: Record<string, FinanceCategory>
  loading: boolean

  fetchTree: () => Promise<void>
  /** 取某作用域的一级分类（按 sort 升序） */
  topLevel: (scope: CategoryScope) => FinanceCategory[]
  byId: (id: string) => FinanceCategory | undefined
  create: (data: CreateCategoryReq) => Promise<FinanceCategory | null>
  update: (id: string, data: PatchCategoryReq) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  resetLocal: () => void
}

function setTree(
  set: (partial: Partial<FinanceCategoryState>) => void,
  tree: FinanceCategory[],
) {
  set({ tree, flat: buildFlat(tree) })
}

export const useFinanceCategoryStore = create<FinanceCategoryState>((set, get) => ({
  tree: [],
  flat: {},
  loading: false,

  async fetchTree() {
    set({ loading: true })
    try {
      const res = await financeApi.listCategories()
      const tree = res?.items ?? []
      set({ tree, flat: buildFlat(tree), loading: false })
    } catch {
      set({ loading: false })
    }
  },

  topLevel(scope) {
    return (get().tree ?? []).filter((c) => c.scope === scope)
  },

  byId(id) {
    return get().flat[id]
  },

  async create(data) {
    const tempId = `tmp_cat_${Date.now()}`
    const parent = data.parent_id ? get().flat[data.parent_id] : undefined
    const tempNode: FinanceCategory = {
      id: tempId,
      parent_id: data.parent_id ?? '',
      scope: data.scope,
      name: data.name,
      full_name: parent ? `${parent.name}-${data.name}` : data.name,
      emoji: data.emoji ?? null,
      icon: data.icon ?? null,
      tint: data.tint ?? null,
      sort: 900,
      is_builtin: false,
      children: [],
    }
    setTree(set, insertNode(get().tree, tempNode))
    try {
      const created = await financeApi.createCategory(data)
      setTree(set, replaceById(get().tree, tempId, created))
      Toast.success('分类已创建')
      return created
    } catch {
      setTree(set, removeById(get().tree, tempId))
      Toast.error('分类创建失败，请重试')
      return null
    }
  },

  async update(id, data) {
    const before = get().flat[id]
    if (!before) return false
    setTree(set, patchById(get().tree, id, data))
    try {
      await financeApi.updateCategory(id, data)
      Toast.success('已保存')
      return true
    } catch {
      setTree(set, replaceById(get().tree, id, before))
      Toast.error('保存失败，请重试')
      return false
    }
  },

  async remove(id) {
    const beforeTree = get().tree
    setTree(set, removeById(beforeTree, id))
    try {
      await financeApi.removeCategory(id)
      Toast.success('已删除')
      return true
    } catch {
      setTree(set, beforeTree)
      Toast.error('删除失败，请重试')
      return false
    }
  },

  resetLocal() {
    set({ tree: [], flat: {}, loading: false })
  },
}))
