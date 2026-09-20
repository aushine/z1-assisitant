/**
 * 首页「重要日子」卡片（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/AnniversaryCard.vue
 * 设计：md/spec-20260919-v1/06-个人中心与纪念日.md §2 / §9
 *
 * 规则：
 *   - 最近 3 条（后端 upcoming 接口给的，已按 days_left 升序）
 *   - days_left === 0 → 「就是今天」并整行淡底高亮
 *   - ⚠️ 一条都没有时**整卡不渲染**（不放空卡片占位）
 *   - ⚠️ 桌面端**不做** dismiss（那是移动端 SmartBanner 那套模式，桌面端没有）
 *
 * ⚠️ 倒计时与下次发生日**全部来自后端**（days_left / next_date），前端不自己算日期差。
 */
import { useEffect } from 'react'
import { Card } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { useAnniversaryStore } from '@/stores/anniversary'
import { categoryMeta, daysLeftText, iconOf, isToday } from '@/utils/anniversary'

export function AnniversaryCard() {
  const navigate = useNavigate()
  const store = useAnniversaryStore()

  useEffect(() => {
    void store.fetchUpcoming(3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = store.upcoming
  // ⚠️ 空态 = 整卡不渲染，而不是渲染一张空卡片
  if (items.length === 0) return null

  return (
    <Card bordered={false} className="card">
      <div className="card-head">
        <span className="card-title">
          <Icon name="Calendar" size={20} style={{ marginRight: 6 }} />
          重要日子
        </span>
        <a className="view-all" onClick={() => navigate('/me/anniversaries')}>
          全部
        </a>
      </div>

      <div className="ann-home-list">
        {items.map((it) => {
          const meta = categoryMeta(it.category)
          const tint = TINT_VARS[(it.color || meta.color) as TintName] ?? TINT_VARS.neutral
          const today = isToday(it.days_left)
          return (
            <div key={it.id} className={`ann-home-item${today ? ' is-today' : ''}`}>
              <span className="ann-home-icon" style={{ background: tint.bg, color: tint.fg }}>
                <Icon name={iconOf(it.icon, it.category) as IconName} size={16} />
              </span>
              <span className="ann-home-title">{it.title}</span>
              <span className="ann-home-date">{it.next_date.slice(5).replace('-', '/')}</span>
              <span className={`ann-home-days${today ? ' is-today' : ''}`}>
                {daysLeftText(it.days_left)}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default AnniversaryCard
