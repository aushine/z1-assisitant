/**
 * ReverseButton — 撤销交易按钮（仅非 transfer 类型可见）
 */
import { Button, Modal } from '@douyinfe/semi-ui'
import type { Transaction } from '@/api/types'
import { useFinanceStore } from '@/stores/finance'

interface Props {
  tx: Transaction
  onReversed?: () => void
}

export function ReverseButton({ tx, onReversed }: Props) {
  const financeStore = useFinanceStore()

  if (tx.type === 'transfer') return null

  function handleReverse() {
    Modal.confirm({
      title: '撤销交易',
      content: '将生成一笔反向交易，原账户余额回滚。确认撤销？',
      okText: '确认撤销',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        const ok = await financeStore.reverseTransaction(tx.id, undefined)
        if (ok) {
          onReversed?.()
        }
      },
    })
  }

  return (
    <Button
      type="danger"
      theme="borderless"
      size="small"
      onClick={handleReverse}
    >
      撤销交易
    </Button>
  )
}

export default ReverseButton
