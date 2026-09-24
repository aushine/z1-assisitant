/**
 * CategoryTiles —— 习惯 / 待办分类平铺选择器（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/finance/CategoryTiles.vue
 * spec-20260922-v2/04 §4.1 / §6；spec-20260924-v1 §03 R3 扩为**两级**。
 *
 * 交互（R3）：一级 chip 行；选中某一级后**在其下方展开二级行**（首项「不限」= 只记一级，
 * 值为该一级 id），点二级 chip → onChange(二级 id)。一级无二级则不展开。
 * 尾部固定「管理 ›」入口 → `/me/categories?domain=<domain>`。
 *
 * 数据：`stores/user-category`（zustand selector 订阅 ⇒ 数据到达后自动替换）；
 * 尚未加载时用 `utils/category-dict` 常量兜底，不闪空白（04 §4.2）。
 *
 * 取消选中策略不在本组件（保持组件"笨"）：父级拿到 onChange(id) 后自行决定。
 */
import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_VARS } from '@/components/icon/tints'
import { useUserCategoryStore, normalizeIconRef, DOMAIN_FALLBACK_ICON } from '@/stores/user-category'
import { HABIT_CATEGORIES, TASK_CATEGORIES } from '@/utils/category-dict'
import type { UserCategory, UserCategoryDomain } from '@/api/types'

interface TileOption {
  id: string
  label: string
  icon: IconName
  tint: TintName
}

interface Props {
  /** 分类域：habit | task */
  domain: UserCategoryDomain
  /** 当前选中的分类 id（'' = 未选） */
  value: string
  /** 点击 chip（组件不判"再点一次"，由父级决定取消策略） */
  onChange: (id: string) => void
  /** 整体禁用（保存中） */
  disabled?: boolean
}

export default function CategoryTiles({ domain, value, onChange, disabled }: Props) {
  const navigate = useNavigate()
  // selector 订阅：store 的 items 整体替换 ⇒ 引用变化 ⇒ 自动重渲染
  const items = useUserCategoryStore((s) => s.items[domain])
  const loadedOnce = useUserCategoryStore((s) => s.loadedOnce[domain])

  useEffect(() => {
    // SWR：有数据立即返回 + 后台静默刷；冷启动 await 拉一次（ensureFresh 内部去重）
    void useUserCategoryStore.getState().ensureFresh(domain)
  }, [domain])

  const toOption = useMemo(
    () => (c: UserCategory): TileOption => {
      const store = useUserCategoryStore.getState()
      const r = store.resolveCategory(domain, c.id)
      const ref = normalizeIconRef(c.icon)
      return {
        id: c.id,
        label: r?.name ?? c.name,
        icon: r?.icon ?? ref?.icon ?? DOMAIN_FALLBACK_ICON[domain],
        tint: r?.tint ?? 'neutral',
      }
    },
    [domain],
  )

  /** 一级项 */
  const topOptions = useMemo<TileOption[]>(() => {
    if (loadedOnce) return items.filter((c) => !c.parent_id).map(toOption)
    const fallback = domain === 'habit' ? HABIT_CATEGORIES : TASK_CATEGORIES
    return fallback.map((c) => ({ id: c.id, label: c.label, icon: c.icon, tint: c.tint }))
  }, [items, loadedOnce, domain, toOption])

  /**
   * 当前生效的一级 id：选中值本身若是一级则直接是它；若是二级则取其 parent_id。
   * 用于决定展开哪一组的二级。
   */
  const activeTopId = useMemo(() => {
    if (!value) return ''
    const hit = items.find((c) => c.id === value)
    if (hit) return hit.parent_id || hit.id
    // 未加载 / 命中不了：把 value 当作一级（内置一级 id）
    return value
  }, [items, value])

  /** 当前一级下的二级项 */
  const childOptions = useMemo<TileOption[]>(() => {
    if (!loadedOnce || !activeTopId) return []
    return items.filter((c) => c.parent_id === activeTopId).map(toOption)
  }, [items, loadedOnce, activeTopId, toOption])

  const goManage = () => navigate(`/me/categories?domain=${domain}`)

  const chipStyle = (active: boolean, tint: TintName, small = false): CSSProperties => {
    const tv = TINT_VARS[tint]
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: small ? 28 : 32,
      padding: small ? '0 10px' : '0 12px',
      fontSize: small ? 12 : 13,
      fontWeight: active ? 600 : 500,
      color: active ? tv.fg : 'var(--color-text-secondary)',
      background: active ? tv.bg : 'var(--color-bg-hover)',
      border: `1px solid ${active ? tv.fg : 'transparent'}`,
      borderRadius: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'all var(--duration-fast) var(--ease-default)',
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {topOptions.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.id)}
            style={chipStyle(o.id === activeTopId || o.id === value, o.tint)}
          >
            <Icon name={o.icon} size={14} />
            {o.label}
          </button>
        ))}
        <button
          type="button"
          className="cat-tiles-manage"
          disabled={disabled}
          onClick={goManage}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 32,
            padding: '0 12px',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-primary)',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          管理 ›
        </button>
      </div>

      {/* 二级行：仅当「当前一级有二级」时展开 */}
      {childOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, paddingLeft: 4 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(activeTopId)}
            style={chipStyle(value === activeTopId, 'neutral', true)}
          >
            不限
          </button>
          {childOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.id)}
              style={chipStyle(o.id === value, o.tint, true)}
            >
              <Icon name={o.icon} size={13} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
