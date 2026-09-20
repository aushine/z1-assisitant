/**
 * Me / Help & Feedback sub-page
 */
import { useState, useCallback } from 'react'
import { Card, Collapse, Input, Button, Toast, Select } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { feedbackApi } from '@/api/feedback'

const FAQ = [
  { q: '如何创建任务？', a: '在「任务」页点击右上角「+ 新建任务」按钮，填写标题和截止日期即可。' },
  { q: '如何设置习惯提醒？', a: '在「我的 → 通知设置」中开启「习惯提醒」开关，具体提醒时间在创建习惯时设置。' },
  { q: '如何多账户记账？', a: '在「记录」页点击「新建账户」可添加多个账户类型（储蓄/信用卡/花呗/微信零钱）。' },
  { q: '数据同步失败怎么办？', a: '前往「我的 → 同步状态」点击「立即同步」重试。' },
]

/** 经期记录 · 操作指引（D13，与移动端帮助页逐字一致） */
const PERIOD_GUIDE = [
  { q: '怎么记一天？', a: '在「记录 → 经期」点月历上的任意日期，或点右下角「记今天」，在 9 组表单里填完点「完成」。' },
  { q: '只想记「今天有没有出血」？', a: '用月历上方的「今天」快捷条，点一下经量就记好了。' },
  { q: '记错了怎么办？', a: '再点那一天，改成正确的值；把某一组全部清空后点「完成」，会问你要不要清除这一天的记录。' },
  { q: '为什么预测不准？', a: '预测基于你自己记录的日期：只有约 13% 的人周期正好 28 天，日历法对排卵日的准确率约 21%。记录 2–3 个周期后会明显变准，记基础体温更准。' },
  { q: '不想让别人看到结论？', a: '概览卡右上角点 👁，敏感内容会变成掩码，但记录功能照常用。' },
]

export default function MeHelpPage() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [fbType, setFbType] = useState<string>('bug')
  const [fbContent, setFbContent] = useState('')
  const [fbContact, setFbContact] = useState('')

  const onSubmit = useCallback(async () => {
    if (!fbContent.trim()) {
      Toast.error('请填写反馈内容')
      return
    }
    setSubmitting(true)
    try {
      await feedbackApi.create({
        type: fbType as any,
        content: fbContent.trim(),
        contact: fbContact.trim() || undefined,
      })
      Toast.success('反馈已提交，感谢您的支持！')
      setFbContent('')
      setFbContact('')
    } catch {
      Toast.warning('提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }, [fbType, fbContent, fbContact])

  return (
    <div className="sub-page">
      <div className="sub-page-header">
        <span className="back-btn" onClick={() => navigate('/me')}>‹ 返回</span>
        <h3>帮助与反馈</h3>
      </div>

      <div className="settings-page">
      <Card bordered={false} className="card" title="常见问题" style={{ marginBottom: 16 }}>
        <Collapse>
          {FAQ.map((item) => (
            <Collapse.Panel header={item.q} itemKey={item.q} key={item.q}>
              {item.a}
            </Collapse.Panel>
          ))}
        </Collapse>
      </Card>

      <Card bordered={false} className="card" title="经期记录 · 操作指引" style={{ marginBottom: 16 }}>
        <Collapse>
          {PERIOD_GUIDE.map((item) => (
            <Collapse.Panel header={item.q} itemKey={item.q} key={item.q}>
              {item.a}
            </Collapse.Panel>
          ))}
        </Collapse>
      </Card>

      <Card bordered={false} className="card" title="提交反馈">
        <div className="field">
          <label className="field-label">反馈类型</label>
          <Select
            value={fbType as any}
            onChange={(v: any) => setFbType(v)}
            optionList={[
              { value: 'bug', label: 'Bug 反馈' },
              { value: 'suggestion', label: '功能建议' },
              { value: 'other', label: '其他' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label className="field-label">反馈内容</label>
          <Input
            value={fbContent}
            onChange={setFbContent}
            placeholder="请详细描述..."
          />
        </div>
        <div className="field">
          <label className="field-label">联系方式（可选）</label>
          <Input
            value={fbContact}
            onChange={setFbContact}
            placeholder="邮箱或微信号"
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <Button theme="solid" type="primary" loading={submitting} onClick={onSubmit}>提交反馈</Button>
        </div>
      </Card>
      </div>
    </div>
  )
}
