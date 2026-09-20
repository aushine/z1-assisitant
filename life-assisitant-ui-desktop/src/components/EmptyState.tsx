/**
 * 统一空态（03 §1.2 G17：Inbox/FolderOpen + 统一文案结构）
 *
 * 全站空态唯一出口：原 home/stat 各自内联的 EmptyHint 与 task/record/me 的裸 Semi <Empty>
 * 统一收敛到本组件，避免文案结构、图标尺寸（32px）与样式四处漂移。
 */
import { Icon } from '@/components/icon'
import type { IconName } from '@/components/icon'

export interface EmptyHintProps {
  icon: IconName
  title: string
  desc?: string
}

export function EmptyHint({ icon, title, desc }: EmptyHintProps) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={32} /></div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
    </div>
  )
}

export default EmptyHint
