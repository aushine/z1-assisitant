/**
 * User Category Store（习惯 / 待办分类 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/user-category.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/user_category.go
 * 契约文档：md/spec-20260922-v2/06-数据模型与API.md §3、04-习惯与待办分类图标.md
 *
 * 与 `stores/finance-category.ts` 同构，差异只有三点（04 §5）：
 *   1. **两级分类（2026-09-24 R3）** —— 后端返回**扁平全量**（一级 + 二级），
 *      前端用 `listTopLevel` / `listChildren` 自行组树；`parent_id === ''` 即一级。
 *      （旧版是「一级平铺」，本轮 spec-20260924-v1/03 已推翻。）
 *   2. 域是 `domain`（habit | task）而非 scope，且请求**必传**；
 *   3. 无快照列 —— 历史行只有 category_id，降级显示走
 *      「已删除分类 / 原 id + 中性色」（04 §3.3），不再查 emoji 快照。
 *
 * ⚠️ **存的是扁平数组，树是「视图」不是「状态」**（R3 §6）：
 *    `items[domain]` 是后端原样返回的一级+二级混合列表；
 *    `byIdMap` / `byId` / `resolveCategory` 语义**不变**（二级 id 一样能解析）；
 *    展示层一律走 `listTopLevel` / `listChildren`，不要自己 filter。
 *    之所以不做成 children 嵌套：那样每次增删改都要两端同步维护嵌套结构，
 *    而扁平数组只需 append/replace 一行（与后端响应形状也一致）。
 *
 * ⚠️ icon 引用兼容三种写法（后端种子 / 存量数据都可能碰到）：
 *    `lucide:<Name>`（04 §4.3 落库口径）→ 去前缀查注册表；
 *    `<Name>`（财务种子的裸名写法）→ 直接查注册表；
 *    emoji（存量习惯图标）→ 走 getIconMapping 照常渲染。
 *
 * ⚠️ 分类尚未加载时各助手返回 undefined，调用方走 utils/category-dict 的
 *    常量兜底表渲染（先兜底、数据到了再替换，不闪空白 —— 04 §4.2）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { userCategoryApi } from '@/api/user-category'
import { feedback } from '@/utils/feedback'
import { ICONS, type IconName } from '@/components/icon/names'
import { getTint, TINT_NAMES, type TintName, type TintVars } from '@/utils/tint'
import { getIconMapping } from '@/utils/icon-map'
import type {
  CreateUserCategoryReq,
  UpdateUserCategoryReq,
  UserCategory,
  UserCategoryDomain,
} from '@/api/types'

/** 渲染用的解析结果（与收支分类 ResolvedCategory 同形） */
export interface ResolvedUserCategory {
  /** 分类 id（软删 / 未命中兜底时是原 id 或 ''） */
  id: string
  /** 显示名（软删 → 「已删除分类」；未命中 → 原 id；未加载 → 由调用方兜底） */
  name: string
  icon: IconName
  tint: TintName
  vars: TintVars
  emoji?: string
  /** true = 该分类已被软删除（只显示、不提供"点进去"） */
  deleted: boolean
  /** true = id 不在用户分类表里（异常数据）：显示原值 + 中性色 */
  unknown: boolean
}

/** 域默认图标（04 §4.2 优先级链最后一级） */
export const DOMAIN_FALLBACK_ICON: Record<UserCategoryDomain, IconName> = {
  habit: 'Pin',
  task: 'CircleDashed',
}

/** 已告警过的失联图标名，避免控制台刷屏（沿用 finance-category 模式） */
const warnedIcons = new Set<string>()

// ==================== 本地缓存（SWR 里「stale」的那一半） ====================
// ⚠️ key 必须带用户 id —— 分类是用户级数据，换账号必须换缓存。
//    id 直接读 localStorage 的 `current_user`，不 import user store（避免循环依赖）。
const CACHE_PREFIX = 'z1_user_categories_cache_v1'

interface DomainsCache {
  savedAt: number
  seeded: Record<UserCategoryDomain, boolean>
  items: Record<UserCategoryDomain, UserCategory[]>
}

const ALL_DOMAINS: readonly UserCategoryDomain[] = ['habit', 'task']

function emptyItems(): Record<UserCategoryDomain, UserCategory[]> {
  return { habit: [], task: [] }
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

function readCache(): DomainsCache | null {
  try {
    const raw = window.localStorage.getItem(cacheKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as DomainsCache
    // 结构校验：坏数据一律当作没有缓存（宁可拉一次也别半血渲染）
    if (
      !parsed?.items ||
      !Array.isArray(parsed.items.habit) ||
      !Array.isArray(parsed.items.task)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(payload: {
  items: Record<UserCategoryDomain, UserCategory[]>
  seeded: Record<UserCategoryDomain, boolean>
}): void {
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

// ==================== icon / tint 归一 ====================

/**
 * 图标引用 → { icon, tint }。tint 为 undefined 表示"引用本身不带色"
 * （lucide 引用只有名字；emoji 引用附带语义色）。
 * 供 utils/category-dict 的兜底链复用，不在业务代码直接调。
 */
export function normalizeIconRef(raw: string | null | undefined): { icon: IconName; tint?: TintName } | null {
  if (!raw) return null
  const bare = raw.startsWith('lucide:') ? raw.slice(7) : raw
  if (bare && bare in ICONS) return { icon: bare as IconName }
  // 非 lucide 引用 → 存量 emoji（不写迁移 SQL，照常渲染，04 §4.3）
  const m = getIconMapping(raw)
  if (m) return { icon: m.icon, tint: m.tint }
  if (import.meta.env.DEV && !warnedIcons.has(raw)) {
    warnedIcons.add(raw)
    // eslint-disable-next-line no-console
    console.warn(`[user-category] 图标 "${raw}" 无法解析，已降级为 HelpCircle`)
  }
  return { icon: 'HelpCircle' }
}

function safeTint(t: string | null | undefined): TintName | null {
  if (t && (TINT_NAMES as readonly string[]).includes(t)) return t as TintName
  return null
}

/** 已告警过的未注册 emoji（getIconMapping 内部也会 warn 一次，这里只防我们的重复） */
function categoryStyle(cat: UserCategory): { icon: IconName; tint: TintName; emoji?: string } {
  const emoji = cat.emoji || undefined
  // 优先级：分类 icon > 分类 emoji 映射（04 §4.2）
  const ref = normalizeIconRef(cat.icon)
  if (ref) {
    return {
      icon: ref.icon,
      tint: safeTint(cat.tint) ?? ref.tint ?? 'neutral',
      emoji,
    }
  }
  if (emoji) {
    const m = getIconMapping(emoji)
    return { icon: m.icon, tint: safeTint(cat.tint) ?? m.tint, emoji }
  }
  return { icon: 'HelpCircle', tint: safeTint(cat.tint) ?? 'neutral', emoji }
}

/**
 * 全序比较（R3，2026-09-24）：先按 parent_id 分组、组内按 sort。
 *
 * ⚠️ 落盘 / 内存里的 `items[domain]` 用这个顺序。
 *    原因：旧的「只按 sort 排」在一级（10/20/30…）与二级（各自父下 10/20/30…）
 *    **值域重叠**时会扁平混排、同级互相穿插，靠 Array.sort 的稳定性去赌
 *    「同 sort 的相对顺序」在不同引擎/不同插入历史下并不保险（旧 sortNodes 已删）。
 *    加上 parent_id 作首键后：一级聚在前（parent_id===''）、每个父的二级各自连续，
 *    组内 sort 升序 —— 树助手因此只需一次 filter 就能拿到正确顺序，无需二次排序。
 *    对「按 parent 分组后」的稳定性由 spec R3 §1 显式要求。
 */
function sortFlat(nodes: UserCategory[]): UserCategory[] {
  return nodes
    .slice()
    .sort(
      (a, b) =>
        a.parent_id.localeCompare(b.parent_id) ||
        a.sort - b.sort ||
        a.name.localeCompare(b.name)
    )
}

export const useUserCategoryStore = defineStore('userCategory', () => {
  // ==================== state ====================
  /** 两域分类列表（一级平铺；后端只返回未删除的行） */
  const items = ref<Record<UserCategoryDomain, UserCategory[]>>(emptyItems())
  const loading = ref<Record<UserCategoryDomain, boolean>>({ habit: false, task: false })
  /** 各域是否至少成功拉取过一次（助手据此决定要不要走常量兜底） */
  const loadedOnce = ref<Record<UserCategoryDomain, boolean>>({ habit: false, task: false })
  /** 本次请求是否触发后端懒创建播种 */
  const seeded = ref<Record<UserCategoryDomain, boolean>>({ habit: false, task: false })

  /**
   * 本次会话内被软删的分类（id → 快照）。
   * 后端不再返回已删行，但历史习惯/任务仍引用其 id → 渲染「已删除分类」+ 中性灰。
   */
  const deletedCache = ref<Map<string, UserCategory>>(new Map())

  /** 冷启动先吃落盘缓存（同步执行 ⇒ 首帧就有分类） */
  const cached = readCache()
  if (cached) {
    items.value = { habit: cached.items.habit, task: cached.items.task }
    seeded.value = { habit: Boolean(cached.seeded?.habit), task: Boolean(cached.seeded?.task) }
    loadedOnce.value = { habit: true, task: true }
  }

  // ==================== 树助手（2026-09-24 R3 新增） ====================
  /**
   * 某域的**一级**分类（`parent_id === ''`），按 sort 升序。
   * ⚠️ 与 `listByDomain` 的区别：后者是**扁平全量**（一级+二级），
   *    只用于「全量查找 / id 合法性校验」；任何列表渲染都该用本助手。
   */
  function listTopLevel(domain: UserCategoryDomain): UserCategory[] {
    return (items.value[domain] ?? []).filter((c) => c.parent_id === '')
  }

  /**
   * 某一级下的**二级**分类，按 sort 升序。
   * `parentId` 为空 ⇒ 返回 []（不是「一级」，二级必须挂在父下）。
   * 分类未加载 / 父不存在 ⇒ []（调用方按空处理，不报错）。
   */
  function listChildren(domain: UserCategoryDomain, parentId: string): UserCategory[] {
    if (!parentId) return []
    return (items.value[domain] ?? []).filter((c) => c.parent_id === parentId)
  }

  /**
   * 某域的「一级 id → 其二级列表」映射（管理页 / 选择器一次遍历用）。
   * 值可能是空数组 —— 表示该一级**没有二级**（此时 UI 不展开二级行）。
   * 键的顺序即 items 的全序，组内已按 sort 升序。
   */
  function childrenByParent(domain: UserCategoryDomain): Map<string, UserCategory[]> {
    const map = new Map<string, UserCategory[]>()
    for (const c of items.value[domain] ?? []) {
      if (!c.parent_id) continue
      const list = map.get(c.parent_id)
      if (list) list.push(c)
      else map.set(c.parent_id, [c])
    }
    return map
  }

  // ==================== getters ====================
  /** id → 分类（两域拍平；内置 id 与 uc_ 前缀 id 天然不互撞） */
  const byIdMap = computed<Map<string, UserCategory>>(() => {
    const map = new Map<string, UserCategory>()
    for (const d of ALL_DOMAINS) for (const c of items.value[d]) map.set(c.id, c)
    return map
  })

  /**
   * 某域的**扁平全量**列表（一级 + 二级混排，全序见 sortFlat）。
   *
   * ⚠️ 2026-09-24 R3：语义收窄为「纯数据出口」，**不要再拿它直接平铺渲染** ——
   *    它含二级，平铺会把二级当一级显示。
   *    树形展示请用 `listTopLevel` / `listChildren`；
   *    「分类 id 是否合法」这类全量查找仍可用它（等价于 byIdMap 的那一半）。
   *    现存消费点：`stores/habit.ts` 的 id 合法性校验、`HabitSection.vue` 的
   *    筛选 chip（已按 parent_id 过滤只取一级）。
   */
  function listByDomain(domain: UserCategoryDomain): UserCategory[] {
    return items.value[domain] ?? []
  }

  /** 按 id 查分类。未加载 / 不存在 → undefined */
  function byId(id: string | undefined | null): UserCategory | undefined {
    if (!id) return undefined
    return byIdMap.value.get(id)
  }

  /**
   * ⭐ 统一解析入口（04 §3.3 + §4.2）：列表 / 卡片 / 详情都调它。
   * 命中 → icon/tint/name；软删 → 「已删除分类」+ 中性；
   * 未命中（域已加载）→ 原 id + 中性；域未加载 → undefined（调用方常量兜底）。
   */
  function resolveCategory(
    domain: UserCategoryDomain,
    id: string | undefined | null
  ): ResolvedUserCategory | undefined {
    if (!id) return undefined
    const hit = byIdMap.value.get(id)
    if (hit) {
      const s = categoryStyle(hit)
      return {
        id,
        name: hit.name,
        icon: s.icon,
        tint: s.tint,
        vars: getTint(s.tint),
        emoji: s.emoji,
        deleted: false,
        unknown: false,
      }
    }
    const dead = deletedCache.value.get(id)
    if (dead) {
      return {
        id,
        name: '已删除分类',
        icon: DOMAIN_FALLBACK_ICON[domain],
        tint: 'neutral',
        vars: getTint('neutral'),
        emoji: dead.emoji || undefined,
        deleted: true,
        unknown: false,
      }
    }
    if (loadedOnce.value[domain]) {
      // 异常数据：id 不在表里 → 显示原值 + 中性色，不报错、不隐藏（04 §3.3）
      return {
        id,
        name: id,
        icon: DOMAIN_FALLBACK_ICON[domain],
        tint: 'neutral',
        vars: getTint('neutral'),
        deleted: false,
        unknown: true,
      }
    }
    return undefined
  }

  /**
   * ⭐ 习惯图标解析（04 §4.2 优先级链）：
   *   habits.icon（非空，存量可为 emoji） > 分类.icon > 分类.emoji > lucide:Pin
   */
  function resolveHabitIcon(
    habit: { icon?: string; category?: string },
  ): { icon: IconName; tint: TintName; vars: TintVars } {
    const ref = normalizeIconRef(habit.icon)
    if (ref) {
      const cat = ref.tint ? null : resolveCategory('habit', habit.category)
      const tint = ref.tint ?? cat?.tint ?? 'neutral'
      return { icon: ref.icon, tint, vars: getTint(tint) }
    }
    const cat = resolveCategory('habit', habit.category)
    if (cat) return { icon: cat.icon, tint: cat.tint, vars: cat.vars }
    return { icon: DOMAIN_FALLBACK_ICON.habit, tint: 'neutral', vars: getTint('neutral') }
  }

  /**
   * ⭐ 任务图标解析（04 §4.2）：
   *   tasks.icon（新增列，可空） > 分类.icon > 分类.emoji > lucide:CircleDashed
   */
  function resolveTaskIcon(
    task: { icon?: string; category_id?: string | null },
  ): { icon: IconName; tint: TintName; vars: TintVars } {
    const ref = normalizeIconRef(task.icon)
    if (ref) {
      const cat = ref.tint ? null : resolveCategory('task', task.category_id)
      const tint = ref.tint ?? cat?.tint ?? 'neutral'
      return { icon: ref.icon, tint, vars: getTint(tint) }
    }
    const cat = resolveCategory('task', task.category_id)
    if (cat) return { icon: cat.icon, tint: cat.tint, vars: cat.vars }
    // 未分类（category_id 为空）→ 中性 + CircleDashed（04 §3.3）
    return { icon: DOMAIN_FALLBACK_ICON.task, tint: 'neutral', vars: getTint('neutral') }
  }

  // ==================== actions ====================

  /**
   * 拉取某域分类（GET /user-categories?domain=…）。
   * `silent = true`：不置 loading，给「有缓存时的后台刷新」用。成功后落盘。
   */
  async function fetchDomain(
    domain: UserCategoryDomain,
    opts?: { silent?: boolean }
  ): Promise<void> {
    const silent = opts?.silent ?? false
    if (!silent) loading.value[domain] = true
    try {
      const res = await userCategoryApi.list({ domain })
      // R3：响应是扁平全量（一级 + 二级），落盘前先做全序归一（见 sortFlat）
      items.value = { ...items.value, [domain]: sortFlat(res.items ?? []) }
      seeded.value = { ...seeded.value, [domain]: Boolean(res.seeded) }
      loadedOnce.value = { ...loadedOnce.value, [domain]: true }
      writeCache({ items: items.value, seeded: seeded.value })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[UserCategoryStore] fetchDomain failed', e)
      // 保留既有列表与缓存：宁可显示旧数据也别白屏
    } finally {
      if (!silent) loading.value[domain] = false
    }
  }

  /** 两次后台静默刷新之间的最小间隔（挡住同一帧多调用点并发打同一接口） */
  const REFRESH_MIN_INTERVAL = 1500
  const lastFetchedAt: Record<UserCategoryDomain, number> = { habit: 0, task: 0 }

  /**
   * ⭐ SWR 入口 —— 各消费点（平铺选择器 / 管理页 / 列表）一律调它，不要直接 fetchDomain。
   *   - 有数据（内存或落盘）⇒ 立即返回，同时后台静默刷新；
   *   - 冷启动 ⇒ await 拉一次。
   * 不传 domain ⇒ 两域各自处理。
   */
  async function ensureFresh(domain?: UserCategoryDomain): Promise<void> {
    const targets = domain ? [domain] : ALL_DOMAINS
    await Promise.all(
      targets.map(async (d) => {
        if (items.value[d].length > 0) {
          if (Date.now() - lastFetchedAt[d] > REFRESH_MIN_INTERVAL) {
            lastFetchedAt[d] = Date.now()
            void fetchDomain(d, { silent: true })
          }
          return
        }
        if (loading.value[d]) return
        lastFetchedAt[d] = Date.now()
        await fetchDomain(d)
      })
    )
  }

  /**
   * 本地插入（新分类追加在域尾 —— "内置顺序 + 新建追加"，04 §4.4）。
   * ⚠️ R3：二级同样走这里（parent_id 非空）—— 插入后立即 sortFlat 重排，
   *    保证树助手拿到的组内顺序就是 sort 序。
   */
  function insertLocal(item: UserCategory): void {
    const list = items.value[item.domain] ?? []
    items.value = { ...items.value, [item.domain]: sortFlat([...list, item]) }
  }

  /**
   * 新建分类（POST /user-categories）。成功后把带真实 id 的 item 插入本地并落盘。
   * ⚠️ 2026-09-24 R3：`data.parent_id` 非空 = 建二级（后端校验父必须存在且同域
   *    一级）。这里不做任何加工，**直接透传** —— 二级同样走 insertLocal + 落盘，
   *    否则新建完刷新，二级会先消失。
   */
  async function create(data: CreateUserCategoryReq): Promise<UserCategory | null> {
    try {
      const res = await userCategoryApi.create(data)
      const item = res.item
      deletedCache.value.delete(item.id)
      insertLocal(item)
      writeCache({ items: items.value, seeded: seeded.value })
      return item
    } catch (e) {
      // 重名等后端行内错误已由 request 拦截器 toast，这里不再重复
      // eslint-disable-next-line no-console
      console.error('[UserCategoryStore] create failed', e)
      return null
    }
  }

  /**
   * 更新分类（PATCH /user-categories/:id）。乐观改 → 失败回滚。
   */
  async function update(id: string, data: UpdateUserCategoryReq): Promise<UserCategory | null> {
    const node = byId(id)
    if (!node) {
      // 缓存里没有（如该域未加载）：直接打接口
      try {
        const res = await userCategoryApi.update(id, data)
        const d = res.item.domain
        items.value = { ...items.value, [d]: sortFlat([...(items.value[d] ?? []), res.item]) }
        writeCache({ items: items.value, seeded: seeded.value })
          return res.item
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[UserCategoryStore] update failed', e)
        return null
      }
    }

    const domain = node.domain
    const original = { ...node }
    const patched: UserCategory = {
      ...node,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.emoji !== undefined ? { emoji: data.emoji } : {}),
      ...(data.tint !== undefined ? { tint: data.tint } : {}),
    }
    replaceLocal(patched)
    try {
      const res = await userCategoryApi.update(id, data)
      replaceLocal(res.item)
      writeCache({ items: items.value, seeded: seeded.value })
      return res.item
    } catch (e) {
      replaceLocal(original)
      // eslint-disable-next-line no-console
      console.error('[UserCategoryStore] update rolled back', e)
      return null
    }

    function replaceLocal(next: UserCategory): void {
      const list = (items.value[domain] ?? []).map((c) => (c.id === next.id ? next : c))
      // ⚠️ 改名会改变同 sort 下的次序 —— 用 sortFlat 保持与 fetchDomain 同一口径
      items.value = { ...items.value, [domain]: sortFlat(list) }
    }
  }

  /**
   * 删除分类（DELETE /user-categories/:id，软删）。
   * 乐观移除 + 记入 deletedCache（历史行渲染「已删除分类」），失败恢复原位。
   */
  async function remove(id: string): Promise<boolean> {
    const node = byId(id)
    let snapshot: { domain: UserCategoryDomain; idx: number } | null = null
    if (node) {
      const list = items.value[node.domain] ?? []
      const idx = list.findIndex((c) => c.id === id)
      if (idx >= 0) {
        snapshot = { domain: node.domain, idx }
        items.value = { ...items.value, [node.domain]: list.filter((c) => c.id !== id) }
      }
      deletedCache.value.set(node.id, node)
    }
    try {
      await userCategoryApi.remove(id)
      writeCache({ items: items.value, seeded: seeded.value })
      feedback.destructiveDone('分类已删除')
      return true
    } catch (e) {
      if (snapshot && node) {
        deletedCache.value.delete(id)
        const list = items.value[snapshot.domain] ?? []
        list.splice(snapshot.idx, 0, node)
        items.value = { ...items.value, [snapshot.domain]: [...list] }
      }
      // eslint-disable-next-line no-console
      console.error('[UserCategoryStore] remove rolled back', e)
      return false
    }
  }

  /** 重置（登出时调用）—— 连同落盘缓存一起清，避免下一个账号读到上一个人的分类 */
  function reset(): void {
    items.value = emptyItems()
    loading.value = { habit: false, task: false }
    loadedOnce.value = { habit: false, task: false }
    seeded.value = { habit: false, task: false }
    deletedCache.value = new Map()
    lastFetchedAt.habit = 0
    lastFetchedAt.task = 0
    clearCache()
  }

  return {
    // state
    items,
    loading,
    loadedOnce,
    seeded,
    deletedCache,
    // getters
    byIdMap,
    // 查询助手
    byId,
    listByDomain,
    // 树助手（R3）
    listTopLevel,
    listChildren,
    childrenByParent,
    resolveCategory,
    resolveHabitIcon,
    resolveTaskIcon,
    // actions
    fetchDomain,
    ensureFresh,
    create,
    update,
    remove,
    reset,
  }
})
