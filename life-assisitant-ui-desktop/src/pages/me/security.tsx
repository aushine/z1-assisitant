/**
 * Me / Security sub-page
 */
import { useState, useCallback } from 'react'
import { Card, Button, Input, Toast } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'

export default function MeSecurityPage() {
  const navigate = useNavigate()
  const userStore = useUserStore()

  const [form, setForm] = useState({ old: '', new: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onSave = useCallback(async () => {
    setError('')
    if (!form.old) { setError('请输入当前密码'); return }
    if (form.new.length < 6) { setError('新密码至少 6 位'); return }
    if (form.new !== form.confirm) { setError('两次密码不一致'); return }
    setSaving(true)
    try {
      await authApi.changePassword({ old_password: form.old, new_password: form.new })
      Toast.success('密码已修改，请重新登录')
      userStore.logout()
      navigate('/login')
    } catch (err: any) {
      Toast.error(err?.message || '修改失败')
    } finally {
      setSaving(false)
    }
  }, [form, userStore, navigate])

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>隐私与安全</h3>
      </div>

      <div className="settings-page">
      <Card bordered={false} className="card">
        <h4 style={{ marginBottom: 16, fontWeight: 700 }}>修改密码</h4>
        <div className="field">
          <label className="field-label">当前密码</label>
          <Input
            mode="password"
            value={form.old}
            onChange={(v: string) => setForm((f) => ({ ...f, old: v }))}
            placeholder="输入当前密码"
          />
        </div>
        <div className="field">
          <label className="field-label">新密码</label>
          <Input
            mode="password"
            value={form.new}
            onChange={(v: string) => setForm((f) => ({ ...f, new: v }))}
            placeholder="至少 6 位"
          />
        </div>
        <div className="field">
          <label className="field-label">确认新密码</label>
          <Input
            mode="password"
            value={form.confirm}
            onChange={(v: string) => setForm((f) => ({ ...f, confirm: v }))}
            placeholder="再次输入新密码"
          />
        </div>
        {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8 }}>{error}</div>}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button theme="light" onClick={() => navigate('/me')}>取消</Button>
          <Button theme="solid" type="primary" loading={saving} onClick={onSave}>确认修改</Button>
        </div>
      </Card>
      </div>
    </div>
  )
}
