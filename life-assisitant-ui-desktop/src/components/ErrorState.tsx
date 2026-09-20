/**
 * 统一错误态组件（03 §1.2 G15 / 任务清单 E01）。
 *
 * 与空态（Empty）明显区分：错误是「出问题了」（danger 色警示图标 + 重试），
 * 空是「还没数据」。当前所有 store 的 catch 静默吞错并写空状态，导致断网时
 * 显示「你还没有数据」——此组件即用来修复该问题。
 *
 * 用法：
 *   import ErrorState from '@/components/ErrorState'
 *   <ErrorState message="加载失败，请重试" onRetry={fetch} />
 *   <ErrorState compact />  // 卡片内 / Tab 内
 */
import { Button } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'

export interface ErrorStateProps {
  /** 错误文案，默认「加载失败，请重试」 */
  message?: string
  /** 有则渲染「重试」按钮 */
  onRetry?: () => void
  /** 紧凑模式（卡片内 / Tab 内） */
  compact?: boolean
  /** 附加类名 */
  className?: string
}

export function ErrorState({
  message = '加载失败，请重试',
  onRetry,
  compact = false,
  className,
}: ErrorStateProps) {
  const cls = [
    'error-state',
    compact ? 'error-state--compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls}>
      <Icon name="AlertTriangle" size={compact ? 24 : 32} className="error-state__icon" />
      <p className="error-state__message">{message}</p>
      {onRetry && (
        <Button theme="light" type="secondary" size="small" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}

export default ErrorState
