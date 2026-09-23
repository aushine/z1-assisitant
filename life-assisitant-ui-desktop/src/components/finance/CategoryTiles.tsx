/**
 * CategoryTiles —— 习惯 / 待办分类平铺选择器（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/finance/CategoryTiles.vue
 * spec-20260922-v2/04 §4.1 / §6：`CategoryPicker.tsx` 与财务的收支双树
 * **强耦合，不可复用**，这里按「一级平铺 + 管理入口」新建轻量版。
 *
 * 与财务选择器的**有意差异**（04 §5）：
 *   - 只有一级 ⇒ **点一下即选中，没有二级弹层**；
 *   - 尾部固定「管理 ›」入口 → `/me/categories?domain=<domain>`。
 *
 * 数据：`stores/user-category`（store 优先，zustand selector 订阅 ⇒
 * 数据到达后自动替换）；尚未加载时用 `utils/category-dict` 常量兜底，
 * 不闪空白（04 §4.2）。
 *
 * 取消选中策略不在本组件（保持组件"笨"）：父级拿到 onChange(id)
 * 后自行决定（如任务抽屉"再点一次 → 清空"）。
 */
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { TINT_VARS } from '@/components/icon/tints'
import { useUserCategoryStore, normalizeIconRef, DOMAIN_FALLBACK_ICON } from '@/stores/user-category'
import { HABIT_CATEGORIES, TASK_CATEGORIES } from '@/utils/category-dict'
import type { UserCategoryDomain } from '@/api/types'

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

  const options = useMemo<TileOption[]>(() => {
    if (loadedOnce) {
      const store = useUserCategoryStore.getState()
      return items.map((c) => {
        const r = store.resolveCategory(domain, c.id)
        const ref = normalizeIconRef(c.icon)
        return {
          id: c.id,
          label: r?.name ?? c.name,
          icon: r?.icon ?? ref?.icon ?? DOMAIN_FALLBACK_ICON[domain],
          tint: r?.tint ?? 'neutral',
        }
      })
    }
    const fallback = domain === 'habit' ? HABIT_CATEGORIES : TASK_CATEGORIES
    return fallback.map((c) => ({ id: c.id, label: c.label, icon: c.icon, tint: c.tint }))
  }, [items, loadedOnce, domain])

  const goManage = () => navigate(`/me/categories?domain=${domain}`)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const active = o.id === value
        const tv = TINT_VARS[o.tint]
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 32,
              padding: '0 12px',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              color: active ? tv.fg : 'var(--color-text-secondary)',
              background: active ? tv.bg : 'var(--color-bg-hover)',
              border: `1px solid ${active ? tv.fg : 'transparent'}`,
              borderRadius: 8,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transition: 'all var(--duration-fast) var(--ease-default)',
            }}
          >
            <Icon name={o.icon} size={14} />
            {o.label}
          </button>
        )
      })}
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
  )
}
