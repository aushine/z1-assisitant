/**
 * 403 Forbidden page (React 18 + TSX)
 */
import { Button } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/icon'

export default function ForbiddenPage() {
  const navigate = useNavigate()

  return (
    <div className="error-page">
      <div className="emoji"><Icon name="Lock" size={48} /></div>
      <h1>403</h1>
      <p>无访问权限</p>
      <p className="sub">你没有访问该页面的权限。请联系管理员或返回首页。</p>
      <div className="actions">
        <Button type="primary" theme="solid" onClick={() => navigate('/home')}>返回首页</Button>
        <Button theme="borderless" onClick={() => navigate(-1)}>返回上一页</Button>
      </div>
    </div>
  )
}
