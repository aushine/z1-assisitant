/**
 * Me / 性价比人生指南 · iframe 内嵌页（spec-20261001-v3）
 *
 * SYNC-TO-MOBILE: life-assisitant-ui-mobile/src/pages/me/htlb.vue
 *
 * v2 时「我的 → 性价比人生指南」是外链跳转（window.location.href）—— 跳出 app。
 * 本批改为站内二级页 iframe 内嵌（带返回栏），保持 app 体验。
 * 指南地址仍**运行时**计算（utils/external.ts 的 htlbUrl()，与主站同源，
 * 不受 X-Frame-Options 同源限制）。
 *
 * ⚠️ 布局：.htlb-page 高度 100%（MainLayout 的 .content 是 flex:1 的定高滚动容器），
 *    返回栏定高 + iframe flex:1 —— 只有 iframe 内部文档滚动，页面不出双滚动条。
 */
import { useNavigate } from 'react-router-dom'
import { htlbUrl } from '@/utils/external'

export default function MeHtlbPage() {
  const navigate = useNavigate()

  return (
    <div className="sub-page htlb-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>性价比人生指南</h3>
      </div>

      {/* 指南正文：iframe 铺满内容区，独立滚动 */}
      <iframe src={htlbUrl()} title="性价比人生指南" className="htlb-frame" />
    </div>
  )
}
