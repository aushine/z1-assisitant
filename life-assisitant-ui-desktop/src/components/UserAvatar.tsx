/**
 * UserAvatar —— 统一头像呈现（D-03 第六轮）
 *
 * 有 avatar（第八轮文件上传产物 /uploads/avatars/...，或 http 外链）→ 显示图片；
 * 相对路径经 resolveFileUrl 按 VITE_API_BASE 的 origin 拼全（dev 走 vite 代理）。
 * 无头像回落姓名首字（配色由调用方 style 传入，缺省 #014DB2 与原硬编码一致）。
 * 消费方：MainLayout 左下用户卡、个人中心 header 卡、profile 页。
 */
import { Avatar } from '@douyinfe/semi-ui'
import type { CSSProperties } from 'react'
import { useUserStore, useInitials } from '@/stores/user'
import { resolveFileUrl } from '@/utils/avatar'

type AvatarSize = 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large'

export default function UserAvatar({
  size = 'small',
  className,
  style,
}: {
  size?: AvatarSize
  className?: string
  style?: CSSProperties
}) {
  const avatar = useUserStore((s) => s.user?.avatar)
  const initials = useInitials()

  if (avatar) {
    return <Avatar size={size} src={resolveFileUrl(avatar)} className={className} style={style} />
  }
  return (
    <Avatar
      size={size}
      className={className}
      style={{ backgroundColor: '#014DB2', color: 'white', fontWeight: 600, ...style }}
    >
      {initials}
    </Avatar>
  )
}
