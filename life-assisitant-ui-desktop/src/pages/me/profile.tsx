/**
 * Me / Profile sub-page
 */
import { useState, useCallback } from 'react'
import { Card, Button, Input, Toast } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { useUserStore, useDisplayName } from '@/stores/user'
import UserAvatar from '@/components/UserAvatar'
import { userApi } from '@/api/user'
import { storage } from '@/utils/storage'

// 注：换头像入口在个人中心首页（头像 hover「点击上传」，D-03 第七轮）；
//     第八轮起走文件上传接口（压缩逻辑见 src/utils/avatar.ts），本页只负责展示与资料保存。
export default function MeProfilePage() {
  const navigate = useNavigate()
  const userStore = useUserStore()
  const displayName = useDisplayName()
  const user = userStore.user

  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
  })
  const [saving, setSaving] = useState(false)

  const onSave = useCallback(async () => {
    if (!form.name.trim()) {
      Toast.error('昵称不能为空')
      return
    }
    setSaving(true)
    try {
      const updated = await userApi.updateProfile({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
      })
      // 后端返回最新用户（含新 version），写回本地缓存与 store
      const freshUser = { ...userStore.user!, ...updated }
      storage.set('user', freshUser)
      useUserStore.setState({ user: freshUser })
    } catch (e) {
      // M3：失败即显式报错，不再「仅本地生效」假写。
      // 响应拦截器已 Toast 具体原因（校验 / 邮箱冲突 / 版本冲突），这里只记录。
      console.error('[profile] 保存失败', e)
    } finally {
      setSaving(false)
    }
  }, [form, userStore.user])

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>个人资料</h3>
      </div>

      <div className="settings-page">
        <Card bordered={false} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
            <UserAvatar
              size="extra-large"
              className="profile-avatar-initials"
              style={{ backgroundColor: 'var(--color-primary-500)', color: 'white', fontWeight: 700 }}
            />
            <div>
              <div className="profile-display-name">{displayName}</div>
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>{user?.username}</div>
            </div>
          </div>

          <div className="field">
            <label className="field-label">昵称</label>
            <Input
              value={form.name}
              onChange={(v: string) => setForm((f) => ({ ...f, name: v }))}
              placeholder="输入昵称"
              maxLength={30}
              showClear
            />
          </div>
          <div className="field">
            <label className="field-label">邮箱</label>
            <Input
              value={form.email}
              onChange={(v: string) => setForm((f) => ({ ...f, email: v }))}
              placeholder="输入邮箱"
              showClear
            />
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button theme="light" onClick={() => navigate('/me')}>取消</Button>
            <Button theme="solid" type="primary" loading={saving} onClick={onSave}>保存</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
