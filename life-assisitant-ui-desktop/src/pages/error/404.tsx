/**
 * 404 Not Found page (React 18 + TSX)
 */
import { Button } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/icon'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="error-page">
      <div className="emoji"><Icon name="Compass" size={48} /></div>
      <h1>404</h1>
      <p>页面不存在</p>
      <p className="sub">你访问的页面已不存在或被移动。请检查链接或返回首页。</p>
      <div className="actions">
        <Button type="primary" theme="solid" onClick={() => navigate('/home')}>返回首页</Button>
        <Button theme="borderless" onClick={() => navigate(-1)}>返回上一页</Button>
      </div>
    </div>
  )
}
