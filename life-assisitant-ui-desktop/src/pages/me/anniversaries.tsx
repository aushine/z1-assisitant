/**
 * 重要日子（纪念日 / 倒数日）管理页（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/pages/me/anniversaries.vue
 * 设计：md/spec-20260919-v1/06-个人中心与纪念日.md §3 / §9
 *
 * ⚠️ 分组（最近 / 本月 / 全部）**直接用后端 scope 参数拿**，前端不做二次分组 ——
 *    next_date 是后端实时推导的，前端拿 days_left 自己切会在跨月边界上错。
 *
 * ⚠️ 宽度例外：现有二级页统一 `.settings-page { max-width: 600px }`，
 *    但 600px 对纪念日列表太窄（每行要放 图标+标题+日期+重复规则+倒计时+置顶）。
 *    这里用**只属于本页**的 `.management-page`（max-width: 900px），
 *    不动 `.settings-page`（它服务已有 6 个二级页，改了会一起变）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, Button, RadioGroup, Radio, Modal, Skeleton, Empty } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import AnniversaryEditDrawer from '@/components/AnniversaryEditDrawer'
import ErrorState from '@/components/ErrorState'
import { useAnniversaryStore, type AnniversaryScope } from '@/stores/anniversary'
import {
  categoryMeta,
  daysLeftText,
  iconOf,
  isToday,
  remindText,
  repeatLabel,
} from '@/utils/anniversary'
import type { AnniversaryItem } from '@/api/types'

const SCOPES: { value: AnniversaryScope; label: string }[] = [
  { value: 'upcoming', label: '最近' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' },
]

export default function AnniversariesPage() {
  const navigate = useNavigate()
  const store = useAnniversaryStore()

  const [scope, setScope] = useState<AnniversaryScope>('all')
  const [error, setError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<AnniversaryItem | null>(null)

  const load = useCallback(
    async (s: AnniversaryScope) => {
      setError('')
      try {
        await store.fetchList(s)
      } catch {
        setError('加载失败')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    void load(scope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  function openCreate() {
    setEditing(null)
    setDrawerOpen(true)
  }

  function openEdit(it: AnniversaryItem) {
    setEditing(it)
    setDrawerOpen(true)
  }

  function onDelete(it: AnniversaryItem) {
    Modal.error({
      title: '删除',
      content: `确定删除「${it.title}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        await store.remove(it.id)
      },
    })
  }

  const loading = store.loading && store.items.length === 0

  return (
    <div className="management-page">
      <div className="page-tipbar">
        <div>
          <h2 className="page-title">
            <Icon name="Calendar" size={22} style={{ marginRight: 8 }} />
            重要日子
          </h2>
          <span className="page-tip">纪念日 / 倒数日 —— 下次发生日与倒计时由服务端实时推导</span>
        </div>
        <div className="header-right">
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreate}>
            新建
          </Button>
        </div>
      </div>

      <Card bordered={false} className="card">
        <div className="ann-scope">
          <RadioGroup
            type="button"
            value={scope}
            onChange={(e: any) => setScope((e?.target?.value ?? e) as AnniversaryScope)}
          >
            {SCOPES.map((s) => (
              <Radio key={s.value} value={s.value}>
                {s.label}
              </Radio>
            ))}
          </RadioGroup>
        </div>

        {loading && (
          <div className="skeleton-wrap">
            <Skeleton>
              <Skeleton.Paragraph rows={4} />
            </Skeleton>
          </div>
        )}

        {!loading && error && <ErrorState message={error} onRetry={() => load(scope)} />}

        {!loading && !error && store.items.length === 0 && (
          <Empty
            image={<Icon name="Calendar" size={48} />}
            title="还没有重要的日子"
            description="点右上角「新建」添加一个吧"
          />
        )}

        {!loading && !error && store.items.length > 0 && (
          <div className="ann-list">
            {store.items.map((it) => {
              const meta = categoryMeta(it.category)
              const tint = TINT_VARS[(it.color || meta.color) as TintName] ?? TINT_VARS.neutral
              return (
                <div key={it.id} className={`ann-row${isToday(it.days_left) ? ' is-today' : ''}`}>
                  <span className="ann-row-icon" style={{ background: tint.bg, color: tint.fg }}>
                    <Icon name={iconOf(it.icon, it.category) as IconName} size={18} />
                  </span>

                  <div className="ann-row-body">
                    <div className="ann-row-title">
                      {it.title}
                      {it.is_pinned && <Icon name="Pin" size={12} className="ann-row-pin" />}
                    </div>
                    <div className="ann-row-sub">
                      {meta.label} · {repeatLabel(it.repeat_rule)} · {remindText(it.remind_days)}
                      {it.note ? ` · ${it.note}` : ''}
                    </div>
                  </div>

                  <div className="ann-row-right">
                    <span className="ann-row-date">{it.next_date}</span>
                    <span className={`ann-row-days${isToday(it.days_left) ? ' is-today' : ''}`}>
                      {daysLeftText(it.days_left)}
                    </span>
                  </div>

                  {/* 桌面端不做左滑删除：行尾按钮 + 二次确认 */}
                  <div className="ann-row-actions">
                    <Button size="small" theme="light" type="tertiary" onClick={() => openEdit(it)}>
                      编辑
                    </Button>
                    <Button size="small" theme="light" type="danger" onClick={() => onDelete(it)}>
                      删除
                    </Button>
                  </div>
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

      <AnniversaryEditDrawer
        visible={drawerOpen}
        item={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => load(scope)}
      />
    </div>
  )
}
