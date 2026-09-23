/**
 * Finance Category Store（收支分类树 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/financeCategory.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance_category.go
 * 契约文档：md/spec-20260921-v1/06-API规范.md §1、05-交互与页面设计.md §3
 * 最后同步：2026-09-21
 *
 * 职责：
 *   1. 持有分类树（按 scope 分两棵，一级内嵌 children），供选择器 / 管理页 / 各消费点查询；
 *   2. 分类 CRUD（**乐观更新 + 回滚 + Vant toast**）；
 *   3. 提供两个降级查询助手：
 *        - `byId(id)`      按 id 查缓存（树未加载时返回 undefined）
 *        - `resolveCat(tx)` ⭐ 各消费点统一入口，实现 `05` §3 的三级降级：
 *             ① 有 category_id → 查缓存：命中未删除 → 用它的 icon/tint/name；
 *                                命中但**已删除** → 分类名 + 中性灰，标 deleted；
 *                                未命中 → 走 ②
 *             ② 退到快照 `category_name + category_emoji`（resolveCategory 的
 *                既有降级：命中字典用字典色，未命中 Package + neutral）
 *
 * ⚠️ 后端只返回**未删除**的分类，所以"命中但已删除"靠本地 `deletedCache` 判定：
 *    用户本次软删的分类会被暂存，历史交易的 id 仍能显示成「名字 + 灰」而不是掉进快照。
 *
 * ⚠️ 二级的 icon / tint / emoji 可为 null = **继承父级**（03 §5）。`resolveNodeStyle`
 *    负责向上找到第一个非空值；都没有则 Package / neutral 兜底。
 *
 * ⚠️ 改一级名时后端会级联重拼二级的 full_name，本地乐观改拿不到 → 成功后
 *    `fetchTree()` 重新同步（105 条量级，成本可忽略）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { financeApi } from '@/api/finance'
import { feedback } from '@/utils/feedback'
import { ICONS, type IconName } from '@/components/icon/names'
import { resolveCategory } from '@/utils/category-dict'
import { getTint, type TintName, type TintVars } from '@/utils/tint'
import type {
  CreateFinanceCategoryReq,
  FinanceCategory,
  FinanceCategoryScope,
  UpdateFinanceCategoryReq,
} from '@/api/types'

/** 分类树：按收支方向分两棵，元素为一级（含 children） */
export type FinanceCategoryTree = Record<FinanceCategoryScope, FinanceCategory[]>

/** `resolveCat` 的返回：各消费点可直接拿去渲染 */
export interface ResolvedCategory {
  /** 分类 id（有 id 且命中时非空，可能指向已删除分类） */
  id: string
  /** 显示名（full_name → 快照名 → 「未分类」） */
  name: string
  icon: IconName
  tint: TintName
  vars: TintVars
  /** 原始 emoji（快照兜底时可能仍有值） */
  emoji?: string
  /** true = 该分类已被软删除，调用方应用中性灰渲染（05 §6） */
  deleted: boolean
}

/** 已告警过的失联图标名，避免控制台刷屏（沿用 icon-map.ts 模式） */
const warnedIcons = new Set<string>()

// ==================== 本地缓存（SWR 里「stale」的那一半） ====================
/**
 * 分类树的落盘缓存（260921）。
 *
 * 背景：`GET /finance/categories` 首次调用还要顺带触发后端**懒创建播种**
 * （20 个一级 + 85 个二级），接口天然偏慢。而以前选择器每次打开都得等它，
 * 于是「记一笔」先甩出一个「正在准备默认分类…」—— 可这份数据一小时都不会
 * 变一次，纯属白等。
 *
 * 现在：先拿上次的分类渲染（内存 → localStorage），再**后台静默刷新**，
 * 回来了就覆盖。`loading` 只在**真·冷启动且无缓存**时置位，其余时刻前台无感。
 *
 * ⚠️ key 必须带用户 id —— 分类是用户级数据，换账号必须换缓存。
 *    id 直接读 localStorage 的 `current_user`，**不 import user store**（避免循环依赖）。
 * ⚠️ 缓存只在 `reset()`（登出）时清；请求失败**不清**（宁可显示旧数据也别白屏）。
 */
const CACHE_PREFIX = 'z1_finance_categories_cache_v1'

interface TreeCache {
  savedAt: number
  seeded: boolean
  tree: FinanceCategoryTree
}

function cacheKey(): string {
  try {
    const raw = window.localStorage.getItem('current_user')
    const uid = raw ? ((JSON.parse(raw) as { id?: string }).id ?? 'anon') : 'anon'
    return `${CACHE_PREFIX}:${uid}`
  } catch {
    return `${CACHE_PREFIX}:anon`
  }
}

function readCache(): TreeCache | null {
  try {
    const raw = window.localStorage.getItem(cacheKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as TreeCache
    // 结构校验：坏数据一律当作没有缓存（宁可拉一次也别半血渲染）
    if (!parsed?.tree || !Array.isArray(parsed.tree.expense) || !Array.isArray(parsed.tree.income)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(payload: { tree: FinanceCategoryTree; seeded: boolean }): void {
  try {
    window.localStorage.setItem(cacheKey(), JSON.stringify({ ...payload, savedAt: Date.now() }))
  } catch {
    /* 隐私模式 / 配额满：静默降级为纯内存缓存 */
  }
}

function clearCache(): void {
  try {
    window.localStorage.removeItem(cacheKey())
  } catch {
    /* ignore */
  }
}

/** 有任意一侧的分类即视为「有缓存」（判断口径与 ensureFresh 一致） */
function hasAnyTree(t: FinanceCategoryTree): boolean {
  return t.expense.length > 0 || t.income.length > 0
}

/**
 * icon 字段（string）→ 可渲染的 IconName。
 * - 命中注册表 → 原样；
 * - 未命中（lucide 版本漂移 / 脏数据）→ HelpCircle + DEV warn 一次（04 §5.2）；
 * - 为空（连父级都没有）→ Package 兜底。
 */
function toIconName(raw: string | null | undefined): IconName {
  if (!raw) return 'Package'
  if (raw in ICONS) return raw as IconName
  if (import.meta.env.DEV && !warnedIcons.has(raw)) {
    warnedIcons.add(raw)
    // eslint-disable-next-line no-console
    console.warn(`[finance-category] 图标 "${raw}" 不在 ICONS 注册表，已降级为 HelpCircle`)
  }
  return 'HelpCircle'
}

/** 一级 / 二级按 sort 升序、同 sort 按 full_name 排（与后端返回口径一致） */
function sortNodes(nodes: FinanceCategory[]): FinanceCategory[] {
  return nodes.slice().sort((a, b) => a.sort - b.sort || a.full_name.localeCompare(b.full_name))
}

export const useFinanceCategoryStore = defineStore('financeCategory', () => {
  // ==================== state ====================
  /** 分类树（两棵） */
  const tree = ref<FinanceCategoryTree>({ expense: [], income: [] })
  const loading = ref(false)
  /** 是否至少成功拉取过一次（选择器据此决定要不要现拉） */
  const loadedOnce = ref(false)
  /** 本次请求是否触发后端懒创建播种 */
  const seeded = ref(false)

  /**
   * 本次会话内被软删的分类（id → 快照）。
   * 后端不再返回已删行，但历史交易仍引用它们的 id → 用它渲染「名字 + 中性灰」。
   */
  const deletedCache = ref<Map<string, FinanceCategory>>(new Map())

  /**
   * 冷启动先吃落盘缓存（同步执行 ⇒ 首帧就有分类，不存在「正在准备…」闪烁）。
   * store 是懒创建的，首次 `useFinanceCategoryStore()` 时 `current_user`
   * 已由登录流程写入，所以 cacheKey() 取得到。
   */
  const cached = readCache()
  if (cached) {
    tree.value = { expense: cached.tree.expense, income: cached.tree.income }
    seeded.value = cached.seeded
    loadedOnce.value = true
  }

  // ==================== getters ====================
  /** id → 分类节点（拍平两棵树的全部层级） */
  const byIdMap = computed<Map<string, FinanceCategory>>(() => {
    const map = new Map<string, FinanceCategory>()
    for (const scope of ['expense', 'income'] as FinanceCategoryScope[]) {
      for (const root of tree.value[scope]) {
        map.set(root.id, root)
        for (const child of root.children ?? []) map.set(child.id, child)
      }
    }
    return map
  })

  /** 数量统计：一级 / 含二级的总数（管理页用） */
  const counts = computed(() => {
    let roots = 0
    let all = 0
    for (const scope of ['expense', 'income'] as FinanceCategoryScope[]) {
      roots += tree.value[scope].length
      all += tree.value[scope].reduce((n, r) => n + 1 + (r.children?.length ?? 0), 0)
    }
    return { roots, all }
  })

  /** 按 id 查分类（含二级）。未加载 / 不存在 → undefined */
  function byId(id: string | undefined | null): FinanceCategory | undefined {
    if (!id) return undefined
    return byIdMap.value.get(id)
  }

  /** 某 scope 的一级列表（选择器 / 管理页用） */
  function rootsOf(scope: FinanceCategoryScope): FinanceCategory[] {
    return tree.value[scope]
  }

  /**
   * 解析某分类节点的 icon / tint（向上继承父级）。
   * 二级自身为空时取一级；命中失败按 04 §5.2 降级。
   */
  function resolveNodeStyle(node: FinanceCategory): { icon: IconName; tint: TintName } {
    let rawIcon: string | null = null
    let rawTint: string | null = null
    let cur: FinanceCategory | undefined = node
    // 只做两级，最多向上 2 步；防脏数据造成环
    for (let depth = 0; cur && depth < 3; depth++) {
      if (!rawIcon && cur.icon) rawIcon = cur.icon
      if (!rawTint && cur.tint) rawTint = cur.tint
      if (rawIcon && rawTint) break
      if (!cur.parent_id) break
      cur = byIdMap.value.get(cur.parent_id)
    }
    return { icon: toIconName(rawIcon), tint: (rawTint as TintName) || 'neutral' }
  }

  /** 渲染用的 name / icon / tint / vars（命中缓存时） */
  function styleOf(node: FinanceCategory): ResolvedCategory {
    const { icon, tint } = resolveNodeStyle(node)
    return {
      id: node.id,
      name: node.full_name || node.name,
      icon,
      tint,
      vars: getTint(tint),
      emoji: node.emoji ?? undefined,
      deleted: false,
    }
  }

  /**
   * ⭐ 统一降级入口（05 §3）：交易 / 预算 / 统计结果都调它。
   * 按 id 优先 → 已删分类中性灰 → 快照兜底。
   */
  function resolveCat(tx: {
    category_id?: string | null
    category_name?: string | null
    category_emoji?: string | null
  }): ResolvedCategory {
    const id = tx.category_id || ''
    if (id) {
      const hit = byId(id)
      if (hit) return styleOf(hit)
      const dead = deletedCache.value.get(id)
      if (dead) {
        return {
          id,
          name: dead.full_name || dead.name,
          icon: 'Package',
          tint: 'neutral',
          vars: getTint('neutral'),
          emoji: dead.emoji ?? undefined,
          deleted: true,
        }
      }
    }
    // 快照兜底：category_name + category_emoji（历史数据）
    const snap = resolveCategory(tx.category_emoji)
    return {
      id,
      name: tx.category_name || snap.label || '未分类',
      icon: snap.icon,
      tint: snap.tint,
      vars: snap.vars,
      emoji: tx.category_emoji ?? undefined,
      deleted: false,
    }
  }

  // ==================== actions ====================

  /**
   * 拉取分类树（GET /finance/categories）
   * ⚠️ 本接口承担懒创建播种，首次调用会顺带把 20 个一级 + 85 个二级建出来。
   *
   * ⚠️⚠️ 260921 修的核心 bug：带 `scope` 时**只替换该 scope**。
   *   旧实现无论请求哪个 scope 都是 `tree.value = map` 整体覆盖，而 `map`
   *   的另一侧恒为 `[]` ⇒ 切到「收入」顺手把「支出」清空，切回来又得重新请求。
   *   「切换支出/收入时总弹『正在准备默认分类…』」的真凶就是这一行。
   *
   * `silent = true`：不置 `loading`，给「有缓存时的后台刷新」用（UI 不该闪）。
   * 成功后落盘，供下次冷启动直接用。
   */
  async function fetchTree(
    scope?: FinanceCategoryScope,
    opts?: { silent?: boolean }
  ): Promise<void> {
    const silent = opts?.silent ?? false
    if (!silent) loading.value = true
    try {
      const res = await financeApi.listCategories(scope ? { scope } : {})
      const items = res.items ?? []
      const map: FinanceCategoryTree = { expense: [], income: [] }
      for (const root of items) {
        const node: FinanceCategory = { ...root, children: sortNodes(root.children ?? []) }
        if (map[node.scope]) map[node.scope].push(node)
      }
      map.expense = sortNodes(map.expense)
      map.income = sortNodes(map.income)
      // 只覆盖本次真正请求过的 scope，另一侧原样保留（见上方 ⚠️⚠️）
      tree.value = scope ? { ...tree.value, [scope]: map[scope] } : map
      seeded.value = Boolean(res.seeded)
      loadedOnce.value = true
      writeCache({ tree: tree.value, seeded: seeded.value })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[FinanceCategoryStore] fetchTree failed', e)
      // 保留既有树，不因一次失败清空（选择器可能正开着）；缓存也不清
    } finally {
      if (!silent) loading.value = false
    }
  }

  /** 两次后台静默刷新之间的最小间隔（挡住同一帧里多个调用点并发打同一接口） */
  const REFRESH_MIN_INTERVAL = 1500
  let lastFetchedAt = 0

  /**
   * ⭐ SWR 入口 —— 各消费点（选择器 / 收支列表 / 管理页 / 统计）一律调它，
   *   不要再直接调 `fetchTree`。
   *
   *   - 有缓存（内存或落盘）⇒ **立即返回**：UI 拿旧数据先渲染，同时后台静默刷新；
   *   - 无缓存（真·冷启动）⇒ 老实 await 一次，且**必须全量**（两侧一起拿），
   *     否则切 scope 时另一侧还是空的，等于没修。
   *
   * 全量只有 105 条，一次请求换掉「按 scope 各拉一次」的两次往返，划算。
   */
  async function ensureFresh(): Promise<void> {
    if (hasAnyTree(tree.value)) {
      if (Date.now() - lastFetchedAt > REFRESH_MIN_INTERVAL) {
        lastFetchedAt = Date.now()
        void fetchTree(undefined, { silent: true })
      }
      return
    }
    lastFetchedAt = Date.now()
    await fetchTree()
  }

  /** 新节点插入本地树（一级进 roots，二级进父节点 children） */
  function insertLocal(item: FinanceCategory): void {
    const scope = item.scope
    if (!tree.value[scope]) tree.value[scope] = []
    if (!item.parent_id) {
      tree.value[scope] = sortNodes([...tree.value[scope], { ...item, children: [] }])
      return
    }
    const parent = tree.value[scope].find((r) => r.id === item.parent_id)
    if (parent) {
      parent.children = sortNodes([...(parent.children ?? []), { ...item, children: [] }])
    }
  }

  /**
   * 新建分类（POST /finance/categories）
   * 后端返回带真实 id 的 item（children 为空数组），成功后插入本地树。
   */
  async function create(data: CreateFinanceCategoryReq): Promise<FinanceCategory | null> {
    try {
      const res = await financeApi.createCategory(data)
      const item = res.item
      insertLocal(item)
      // 本地 CRUD 也是「缓存的一部分」：立刻落盘，下次冷启动就能看到新分类
      writeCache({ tree: tree.value, seeded: seeded.value })
      return item
    } catch (e) {
      // 后端 400002 重名等已由 request 拦截器 toast，这里不再重复
      // eslint-disable-next-line no-console
      console.error('[FinanceCategoryStore] create failed', e)
      return null
    }
  }

  /**
   * 更新分类（PATCH /finance/categories/:id）
   * 乐观：先就地改本地节点；失败回滚。成功后重拉树同步「改一级名 → 二级 full_name 级联」。
   */
  async function update(id: string, data: UpdateFinanceCategoryReq): Promise<FinanceCategory | null> {
    const node = byId(id)
    if (!node) {
      // 缓存里没有（如树未加载）：直接打接口
      try {
        const res = await financeApi.updateCategory(id, data)
          await fetchTree(undefined, { silent: true })
        return res.item
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[FinanceCategoryStore] update failed', e)
        return null
      }
    }

    const original = { ...node } as FinanceCategory
    // 乐观：就地把可改字段覆盖（parent_id / scope 不可改，不处理）
    if (data.name !== undefined) {
      node.name = data.name
      // 一级：full_name = name；二级：full_name = `父-子`（本地先拼，随后 fetchTree 校正）
      const parent = node.parent_id ? byId(node.parent_id) : undefined
      node.full_name = parent ? `${parent.name}-${data.name}` : data.name
    }
    if (data.icon !== undefined) node.icon = data.icon
    if (data.tint !== undefined) node.tint = data.tint
    if (data.emoji !== undefined) node.emoji = data.emoji

    try {
      const res = await financeApi.updateCategory(id, data)
      const idx = tree.value[res.item.scope]?.findIndex((r) => r.id === id) ?? -1
      if (idx >= 0) tree.value[res.item.scope][idx] = { ...res.item, children: tree.value[res.item.scope][idx].children }
      // 级联更新（一级改名 → 二级 full_name）以服务端为准
      // silent：管理页自己会重渲染，没必要再闪一次全局 loading
      await fetchTree(undefined, { silent: true })
      return res.item
    } catch (e) {
      // 回滚
      node.name = original.name
      node.full_name = original.full_name
      node.icon = original.icon
      node.tint = original.tint
      node.emoji = original.emoji
      showFailToast('更新失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceCategoryStore] update rolled back', e)
      return null
    }
  }

  /**
   * 删除分类（DELETE /finance/categories/:id，软删除）
   * 乐观：先从本地树移除（并记入 deletedCache 供历史交易渲染），失败则恢复。
   * ⚠️ 删一级会连带后端级联软删其所有二级，本地一并移除。
   */
  async function remove(id: string): Promise<boolean> {
    let snapshot: { scope: FinanceCategoryScope; rootIdx: number; root: FinanceCategory; childIdx: number } | null = null
    const node = byId(id)
    if (node) {
      const scope = node.scope
      const list = tree.value[scope]

      if (!node.parent_id) {
        // 删一级：连同二级一起暂存
        const rootIdx = list.findIndex((r) => r.id === id)
        if (rootIdx >= 0) {
          const root = list[rootIdx]
          snapshot = { scope, rootIdx, root, childIdx: -1 }
          deletedCache.value.set(root.id, root)
          for (const c of root.children ?? []) deletedCache.value.set(c.id, c)
          list.splice(rootIdx, 1)
        }
      } else {
        const rootIdx = list.findIndex((r) => r.id === node.parent_id)
        if (rootIdx >= 0) {
          const children = list[rootIdx].children ?? []
          const childIdx = children.findIndex((c) => c.id === id)
          if (childIdx >= 0) {
            snapshot = { scope, rootIdx, root: list[rootIdx], childIdx }
            deletedCache.value.set(node.id, node)
            children.splice(childIdx, 1)
          }
        }
      }
    }

    try {
      await financeApi.removeCategory(id)
      writeCache({ tree: tree.value, seeded: seeded.value })
      feedback.destructiveDone('分类已删除')
      return true
    } catch (e) {
      // 回滚
      if (snapshot) {
        const { scope, rootIdx, root, childIdx } = snapshot
        if (childIdx >= 0) {
          const target = tree.value[scope][rootIdx]
          if (target) target.children = sortNodes([...(target.children ?? []), deletedCache.value.get(id)!])
          deletedCache.value.delete(id)
        } else {
          deletedCache.value.delete(root.id)
          for (const c of root.children ?? []) deletedCache.value.delete(c.id)
          tree.value[scope] = sortNodes([...tree.value[scope], root])
        }
      }
      showFailToast('删除失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[FinanceCategoryStore] remove rolled back', e)
      return false
    }
  }

  /** 重置（登出时调用）—— 连同落盘缓存一起清，避免下一个账号读到上一个人的分类 */
  function reset(): void {
    tree.value = { expense: [], income: [] }
    loading.value = false
    loadedOnce.value = false
    seeded.value = false
    deletedCache.value = new Map()
    lastFetchedAt = 0
    clearCache()
  }

  return {
    // state
    tree,
    loading,
    loadedOnce,
    seeded,
    // getters
    counts,
    byIdMap,
    // 查询助手
    byId,
    rootsOf,
    styleOf,
    resolveNodeStyle,
    resolveCat,
    // actions
    fetchTree,
    ensureFresh,
    create,
    update,
    remove,
    reset,
  }
})
