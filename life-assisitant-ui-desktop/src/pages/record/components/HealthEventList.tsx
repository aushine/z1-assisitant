/**
 * 健康时间轴事件列表（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/health/HealthEventList.vue
 *
 * 一次记录 = 一行：`HH:mm · 值 · 备注`，可删（Semi Modal 二次确认）。
 *
 * ⚠️ 身体指标「**不延续**」—— 与心情（mood_logs 向前填充）语义相反：
 *    没记就是没记，列表里只出现真实记过的条目。
 *
 * ⚠️ 时间由**服务端**给（`item.time` 是后端落库的 HH:mm），前端不自己生成展示时间。
 */
import { useMemo, useState } from 'react'
import { Button, Modal, Tag, Typography } from '@douyinfe/semi-ui'
import { useHealthStore } from '@/stores/health'
import type { HealthEventItem, HealthEventMetricKey } from '@/api/types'

const { Text } = Typography

export default function HealthEventList({
  metric,
  date,
  unit = '',
  digits = 0,
  intLabel,
  emptyText = '今天还没有记录',
}: {
  /** 只看这个指标；不传 = 全部 */
  metric?: HealthEventMetricKey
  /** 哪一天（只用于「删完重拉哪天」的兜底） */
  date: string
  /** 数值单位后缀（ml / kg / ℃ / h） */
  unit?: string
  /** 数值小数位 */
  digits?: number
  /** 离散值 → 文案（bowel 形态）。不传就显示数字。 */
  intLabel?: Record<number, string>
  emptyText?: string
}) {
  const store = useHealthStore()
  const [pending, setPending] = useState<HealthEventItem | null>(null)

  const items = useMemo(() => {
    const all = store.dayEvents ?? []
    return metric ? all.filter((e) => e.metric_key === metric) : all
  }, [store.dayEvents, metric])

  function display(e: HealthEventItem): string {
    if (e.value_int != null) return intLabel?.[e.value_int] ?? String(e.value_int)
    if (e.value_num != null) {
      const n =
        digits > 0 ? e.value_num.toFixed(digits) : String(Math.round(e.value_num * 100) / 100)
      return unit ? `${n}${unit}` : n
    }
    return '—'
  }

  async function confirmRemove() {
    if (!pending) return
    const e = pending
    setPending(null)
    await store.removeEvent(e.id, e.date || date)
  }

  if (items.length === 0) {
    return <div className="health-ev-empty">{emptyText}</div>
  }

  return (
    <>
      <ul className="health-ev-list">
        {items.map((e) => (
          <li key={e.id} className="health-ev-row">
            <Tag size="small" shape="circle" type="light">
              {e.time}
            </Tag>
            <Text strong className="health-ev-val">
              {display(e)}
            </Text>
            {e.note && (
              <Text type="tertiary" size="small" className="health-ev-note" ellipsis={{ showTooltip: true }}>
                {e.note}
              </Text>
            )}
            <Button
              size="small"
              type="danger"
              theme="borderless"
              disabled={store.saving}
              onClick={() => setPending(e)}
            >
              删除
            </Button>
          </li>
        ))}
      </ul>

      <Modal
        title="删除这条记录"
        visible={!!pending}
        onOk={confirmRemove}
        onCancel={() => setPending(null)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ type: 'danger' }}
        width={360}
      >
        {pending && (
          <span>
            {pending.time} · {display(pending)}
          </span>
        )}
      </Modal>
    </>
  )
}
