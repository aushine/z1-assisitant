/**
 * Me / About sub-page
 */
import { Card, Button, Toast } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'

const LINKS: { label: string }[] = [
  { label: '隐私政策' },
  { label: '服务条款' },
  { label: '开源许可证' },
  { label: '联系我们' },
]

export default function MeAboutPage() {
  const navigate = useNavigate()

  const onCheckUpdate = () => {
    Toast.info('当前已是最新版本')
  }

  const onOpenLink = (label: string) => {
    // M6：原 4 个 <a> 无 href，点击无任何反馈（死链）。
    // 桌面端暂无对应落地页，改为明确提示，避免误导为可跳转链接。
    Toast.info(`${label}页面暂未开放`)
  }

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>关于</h3>
      </div>

      <div className="settings-page">
        <Card bordered={false} className="card">
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <img src={`${import.meta.env.BASE_URL}z1-logo.png`} alt="Z1" style={{ width: 96, height: 96, objectFit: 'contain', margin: '0 auto 16px', display: 'block' }} />
            <h3 style={{ marginBottom: 4, fontWeight: 700 }}>Z1 v1.0.0</h3>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: 14, margin: 0 }}>Zero to One</p>
          </div>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button theme="light" onClick={onCheckUpdate}>检查更新</Button>
          </div>

          <div style={{
            textAlign: 'center',
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid var(--color-border-light)',
            fontSize: 13,
            color: 'var(--color-text-tertiary)',
          }}>
            <div style={{ marginBottom: 8 }}>
              {LINKS.map((l, i) => (
                <span key={l.label}>
                  {i > 0 && ' · '}
                  <a
                    style={{ color: 'var(--color-primary-500)', cursor: 'pointer' }}
                    onClick={() => onOpenLink(l.label)}
                    role="button"
                  >
                    {l.label}
                  </a>
                </span>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>© 2026 Z1 · Zero to One. All rights reserved.</p>
          </div>
        </Card>
      </div>
    </div>
  )
}
