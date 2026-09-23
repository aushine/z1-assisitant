/**
 * User Category Store —— 习惯 / 待办分类（桌面端 · zustand）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/stores/user-category.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/user_category.go
 * 契约文档：md/spec-20260922-v2/06-数据模型与API.md §3、04-习惯与待办分类图标.md
 *
 * 与 `stores/financeCategory.ts` 同构（乐观更新 + 失败回滚 + Toast），差异：
 *   1. **一级平铺** —— 没有 parent_id / children，样式解析退化为
 *      「icon 引用 > emoji 映射 > 域默认图标」；
 *   2. 域是 `domain`（habit | task），请求**必传**；
 *   3. 降级显示走「已删除分类 / 原 id + 中性色」（04 §3.3），无 emoji 快照列。
 *
 * ⚠️ 与 Pinia 版本的关键区别：zustand 的 `getState()` 不建立订阅。
 *    `utils/category-dict` 的解析助手因此是**非响应式**的 —— 需要
 *    「数据到达后自动替换」的组件（列表 / 平铺选择器 / 管理页）必须
 *    自己用 selector 订阅 `items` / `loadedOnce`（桌面首页方案见交付报告）。
 *
 * ⚠️ icon 引用兼容三种写法（04 §4.3）：`lucide:<Name>`（落库口径）、
 *    `<Name>`（财务种子裸名）、emoji（存量习惯图标，走 getIconMapping）。
 */
import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { feedback } from '@/utils/feedback'
import { userCategoryApi } from '@/api/user-category'
import { ICONS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_NAMES } from '@/components/icon/tints'
import { getIconMapping } from '@/utils/icon-map'
import type {
  CreateUserCategoryReq,
  UpdateUserCategoryReq,
  UserCategory,
  UserCategoryDomain,
} from '@/api/types'

const ALL_DOMAINS: readonly UserCategoryDomain[] = ['habit', 'task']

/** 渲染用的解析结果（与收支分类 ResolvedCategoryView 同形，桌面端不带 vars —— 用 TINT_VARS[tint]） */
export interface ResolvedUserCategory {
  /** 分类 id（软删 / 未命中兜底时是原 id 或 ''） */
  id: string
  /** 显示名（软删 → 「已删除分类」；未命中 → 原 id；未加载 → 由调用方常量兜底） */
  name: string
  icon: IconName
  tint: TintName
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

/** 已告警过的失联图标名，避免控制台刷屏（沿用 financeCategory 模式） */
const warnedIcons = new Set<string>()

const ICON_LOOKUP = ICONS as Record<string, unknown>

/**
 * LucideIcon（React 组件）→ ICONS 注册表里的**字符串名**。
 *
 * ⚠️ 桌面端 `utils/icon-map` 的 `getIconMapping()` 返回的是**组件**而非名字
 * （移动端返回字符串名）—— 存 / 渲染 / 落库口径需要名字，这里经一次
 * 反查 Map（组件引用身份比对，两端 lucide 同包同实例）换回名字。
 * 未注册组件返回 null。
 */
const COMPONENT_NAME_BY_REF = new Map<unknown, IconName | null>()
export function lucideIconName(comp: unknown): IconName | null {
  if (!comp) return null
  const cached = COMPONENT_NAME_BY_REF.get(comp)
  if (cached !== undefined) return cached
  const hit = (Object.entries(ICONS) as [string, unknown][]).find(([, c]) => c === comp)?.[0]
  const name = (hit as IconName | undefined) ?? null
  COMPONENT_NAME_BY_REF.set(comp, name)
  return name
}

/**
 * 图标引用 → { icon, tint }。tint 为 undefined 表示"引用本身不带色"
 * （lucide 引用只有名字；emoji 引用附带语义色）。
 * 供 utils/category-dict 的兜底链复用，不在业务代码直接调。
 */
export function normalizeIconRef(
  raw: string | null | undefined,
): { icon: IconName; tint?: TintName } | null {
  if (!raw) return null
  const bare = raw.startsWith('lucide:') ? raw.slice(7) : raw
  if (bare && ICON_LOOKUP[bare]) return { icon: bare as IconName }
  // 非 lucide 引用 → 存量 emoji（不写迁移 SQL，照常渲染，04 §4.3）
  if (!raw.startsWith('lucide:') && !ICON_LOOKUP[raw]) {
    const m = getIconMapping(raw)
    const name = lucideIconName(m.icon) ?? 'HelpCircle'
    return { icon: name, tint: m.tint }
  }
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

/** 分类行的图标 / 颜色：icon 引用 > emoji 映射（04 §4.2）> HelpCircle 兜底 */
function categoryStyle(cat: UserCategory): { icon: IconName; tint: TintName; emoji?: string } {
  const emoji = cat.emoji || undefined
  const ref = normalizeIconRef(cat.icon)
  if (ref) {
    return { icon: ref.icon, tint: safeTint(cat.tint) ?? ref.tint ?? 'neutral', emoji }
  }
  if (emoji) {
    const m = normalizeIconRef(emoji)! // emoji 走 icon-map（内部已含组件→名字反查 + HelpCircle 降级）
    return { icon: m.icon, tint: safeTint(cat.tint) ?? m.tint ?? 'neutral', emoji }
  }
  return { icon: 'HelpCircle', tint: safeTint(cat.tint) ?? 'neutral', emoji }
}

/** 内置顺序 + 新建追加：尊重后端 sort 升序 */
function sortNodes(nodes: UserCategory[]): UserCategory[] {
  return nodes.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

function emptyRecord<T>(v: () => T): Record<UserCategoryDomain, T> {
  return { habit: v(), task: v() }
}

interface UserCategoryState {
  /** 两域分类列表（一级平铺；后端只返回未删除的行） */
  items: Record<UserCategoryDomain, UserCategory[]>
  loading: Record<UserCategoryDomain, boolean>
  /** 各域是否至少成功拉取过一次（助手据此决定要不要走常量兜底） */
  loadedOnce: Record<UserCategoryDomain, boolean>
  /** 本次请求是否触发后端懒播种 */
  seeded: Record<UserCategoryDomain, boolean>
  /** 本次会话内被软删的分类（id → 快照），历史行渲染「已删除分类」用 */
  deletedCache: Record<string, UserCategory>

  fetchDomain: (domain: UserCategoryDomain, opts?: { silent?: boolean }) => Promise<void>
  ensureFresh: (domain?: UserCategoryDomain) => Promise<void>
  listByDomain: (domain: UserCategoryDomain) => UserCategory[]
  byId: (id: string | undefined | null) => UserCategory | undefined
  resolveCategory: (
    domain: UserCategoryDomain,
    id: string | undefined | null,
  ) => ResolvedUserCategory | undefined
  /** 04 §4.2：habits.icon > 分类.icon > 分类.emoji > lucide:Pin */
  resolveHabitIcon: (habit: { icon?: string; category?: string }) => { icon: IconName; tint: TintName }
  /** 04 §4.2：tasks.icon > 分类.icon > 分类.emoji > lucide:CircleDashed */
  resolveTaskIcon: (task: { icon?: string; category_id?: string | null }) => { icon: IconName; tint: TintName }
  create: (data: CreateUserCategoryReq) => Promise<UserCategory | null>
  update: (id: string, data: UpdateUserCategoryReq) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  reset: () => void
}

/** 两次后台静默刷新之间的最小间隔（挡住同一帧多调用点并发打同一接口） */
const REFRESH_MIN_INTERVAL = 1500
const lastFetchedAt: Record<UserCategoryDomain, number> = { habit: 0, task: 0 }

export const useUserCategoryStore = create<UserCategoryState>((set, get) => ({
  items: emptyRecord<UserCategory[]>(() => []),
  loading: emptyRecord<boolean>(() => false),
  loadedOnce: emptyRecord<boolean>(() => false),
  seeded: emptyRecord<boolean>(() => false),
  deletedCache: {},

  async fetchDomain(domain, opts) {
    const silent = opts?.silent ?? false
    if (!silent) set((s) => ({ loading: { ...s.loading, [domain]: true } }))
    try {
      const res = await userCategoryApi.list({ domain })
      set((s) => ({
        items: { ...s.items, [domain]: sortNodes(res?.items ?? []) },
        seeded: { ...s.seeded, [domain]: Boolean(res?.seeded) },
        loadedOnce: { ...s.loadedOnce, [domain]: true },
        loading: { ...s.loading, [domain]: false },
      }))
    } catch {
      // 保留既有列表：宁可显示旧数据也别白屏（错误 toast 由 request 拦截器负责）
      set((s) => ({ loading: { ...s.loading, [domain]: false } }))
    }
  },

  /**
   * ⭐ SWR 入口 —— 各消费点（平铺选择器 / 管理页 / 列表）一律调它。
   *   - 已有数据 ⇒ 立即返回，同时后台静默刷新（1.5s 去重）；
   *   - 冷启动 ⇒ await 拉一次。不传 domain ⇒ 两域各自处理。
   */
  async ensureFresh(domain) {
    const targets = domain ? [domain] : ALL_DOMAINS
    await Promise.all(
      targets.map(async (d) => {
        if (get().items[d].length > 0) {
          if (Date.now() - lastFetchedAt[d] > REFRESH_MIN_INTERVAL) {
            lastFetchedAt[d] = Date.now()
            void get().fetchDomain(d, { silent: true })
          }
          return
        }
        if (get().loading[d]) return
        lastFetchedAt[d] = Date.now()
        await get().fetchDomain(d)
      }),
    )
  },

  listByDomain(domain) {
    return get().items[domain] ?? []
  },

  byId(id) {
    if (!id) return undefined
    for (const d of ALL_DOMAINS) {
      const hit = get().items[d].find((c) => c.id === id)
      if (hit) return hit
    }
    return undefined
  },

  /**
   * ⭐ 统一解析入口（04 §3.3 + §4.2）：列表 / 卡片 / 详情都调它。
   * 命中 → icon/tint/name；软删 → 「已删除分类」+ 中性；
   * 未命中（域已加载）→ 原 id + 中性；域未加载 → undefined（调用方常量兜底）。
   */
  resolveCategory(domain, id) {
    if (!id) return undefined
    const hit = get().byId(id)
    if (hit) {
      const s = categoryStyle(hit)
      return { id, name: hit.name, icon: s.icon, tint: s.tint, emoji: s.emoji, deleted: false, unknown: false }
    }
    const dead = get().deletedCache[id]
    if (dead) {
      return {
        id,
        name: '已删除分类',
        icon: DOMAIN_FALLBACK_ICON[domain],
        tint: 'neutral',
        emoji: dead.emoji || undefined,
        deleted: true,
        unknown: false,
      }
    }
    if (get().loadedOnce[domain]) {
      // 异常数据：id 不在表里 → 显示原值 + 中性色，不报错、不隐藏（04 §3.3）
      return {
        id,
        name: id,
        icon: DOMAIN_FALLBACK_ICON[domain],
        tint: 'neutral',
        deleted: false,
        unknown: true,
      }
    }
    return undefined
  },

  resolveHabitIcon(habit) {
    const ref = normalizeIconRef(habit.icon)
    if (ref) {
      const cat = ref.tint ? null : get().resolveCategory('habit', habit.category)
      return { icon: ref.icon, tint: ref.tint ?? cat?.tint ?? 'neutral' }
    }
    const cat = get().resolveCategory('habit', habit.category)
    if (cat) return { icon: cat.icon, tint: cat.tint }
    return { icon: DOMAIN_FALLBACK_ICON.habit, tint: 'neutral' }
  },

  resolveTaskIcon(task) {
    const ref = normalizeIconRef(task.icon)
    if (ref) {
      const cat = ref.tint ? null : get().resolveCategory('task', task.category_id)
      return { icon: ref.icon, tint: ref.tint ?? cat?.tint ?? 'neutral' }
    }
    const cat = get().resolveCategory('task', task.category_id)
    if (cat) return { icon: cat.icon, tint: cat.tint }
    // 未分类（category_id 为空）→ 中性 + CircleDashed（04 §3.3）
    return { icon: DOMAIN_FALLBACK_ICON.task, tint: 'neutral' }
  },

  /** 新建分类（POST，返回 {item}）。新分类追加在域尾；失败 toast 已由拦截器/兜底提示 */
  async create(data) {
    try {
      const res = await userCategoryApi.create(data)
      const item = res.item
      set((s) => ({
        items: { ...s.items, [item.domain]: [...(s.items[item.domain] ?? []), item] },
        deletedCache: (() => {
          const next = { ...s.deletedCache }
          delete next[item.id]
          return next
        })(),
      }))
      return item
    } catch {
      // 重名等后端行内错误已由 request 拦截器 toast，这里不再重复
      return null
    }
  },

  /** 更新分类（PATCH /:id）。乐观改 → 失败回滚 */
  async update(id, data) {
    const before = get().byId(id)
    if (!before) {
      // 缓存里没有（如该域未加载）：直接打接口，成功后并入本地
      try {
        const res = await userCategoryApi.update(id, data)
        const d = res.item.domain
        set((s) => ({
          items: { ...s.items, [d]: sortNodes([...(s.items[d] ?? []), res.item]) },
        }))
        return true
      } catch {
        Toast.error('保存失败，请重试')
        return false
      }
    }
    const domain = before.domain
    const patched: UserCategory = {
      ...before,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.emoji !== undefined ? { emoji: data.emoji } : {}),
      ...(data.tint !== undefined ? { tint: data.tint } : {}),
    }
    const replaceLocal = (next: UserCategory) =>
      set((s) => ({
        items: { ...s.items, [domain]: (s.items[domain] ?? []).map((c) => (c.id === next.id ? next : c)) },
      }))
    replaceLocal(patched)
    try {
      const res = await userCategoryApi.update(id, data)
      replaceLocal(res.item)
      return true
    } catch {
      replaceLocal(before)
      Toast.error('保存失败，请重试')
      return false
    }
  },

  /** 删除分类（软删，204）。乐观移除 + 记 deletedCache，失败恢复原位 */
  async remove(id) {
    const node = get().byId(id)
    let restoreIdx = -1
    if (node) {
      const list = get().items[node.domain] ?? []
      restoreIdx = list.findIndex((c) => c.id === id)
      set((s) => ({
        items: { ...s.items, [node.domain]: (s.items[node.domain] ?? []).filter((c) => c.id !== id) },
        deletedCache: { ...s.deletedCache, [node.id]: node },
      }))
    }
    try {
      await userCategoryApi.remove(id)
      feedback.destructiveDone('已删除')
      return true
    } catch {
      if (node && restoreIdx >= 0) {
        set((s) => {
          const list = [...(s.items[node.domain] ?? [])]
          list.splice(restoreIdx, 0, node)
          const nextCache = { ...s.deletedCache }
          delete nextCache[id]
          return { items: { ...s.items, [node.domain]: list }, deletedCache: nextCache }
        })
      }
      Toast.error('删除失败，请重试')
      return false
    }
  },

  /** 重置（登出时调用）。桌面端现状：财务 store 同样未在登出里调 reset，沿用约定 */
  reset() {
    lastFetchedAt.habit = 0
    lastFetchedAt.task = 0
    set({
      items: emptyRecord<UserCategory[]>(() => []),
      loading: emptyRecord<boolean>(() => false),
      loadedOnce: emptyRecord<boolean>(() => false),
      seeded: emptyRecord<boolean>(() => false),
      deletedCache: {},
    })
  },
}))
