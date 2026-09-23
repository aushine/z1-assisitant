/**
 * Login page (React 18 + TSX)
 */
import { useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Form, Checkbox, Button, Toast } from '@douyinfe/semi-ui'
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface'
import { IconUser, IconLock, IconEyeOpened, IconEyeClosedStroked, IconGithubLogo, IconPhone, IconSafe, IconChecklistStroked, IconClock, IconHistogram } from '@douyinfe/semi-icons'
import WechatIcon from '@/assets/wechat.svg'
import { useUserStore } from '@/stores/user'
import { storage } from '@/utils/storage'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userStore = useUserStore()

  const [username, setUsername] = useState(storage.getString('login_username', ''))
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(storage.get<boolean>('login_remember') ?? true)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const formRef = useRef<FormApi | null>(null)

  const canSubmit = useMemo(
    () => username.trim().length >= 4 && password.length >= 6 && !submitting,
    [username, password, submitting]
  )

  const onSubmit = useCallback(async () => {
    if (submitting) return
    if (!username.trim() || !password) {
      Toast.error('请输入账号和密码')
      return
    }
    if (username.trim().length < 4) {
      Toast.error('账号至少 4 个字符')
      return
    }
    if (password.length < 6) {
      Toast.error('密码至少 6 个字符')
      return
    }

    setSubmitting(true)
    try {
      // Persist remember-me preferences
      if (remember) {
        storage.setString('login_username', username.trim())
        storage.set('login_remember', true)
      } else {
        storage.remove('login_username')
        storage.set('login_remember', false)
      }

      // Call real API via zustand store
      await userStore.login({
        username: username.trim(),
        password,
        remember,
      })

      const redirect = searchParams.get('redirect') || '/home'
      navigate(redirect)
    } catch (err: any) {
      Toast.error(err?.message || '登录失败，请检查账号密码')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, username, password, remember, navigate, searchParams, userStore])

  const features = [
    {
      icon: <IconChecklistStroked />,
      title: '任务管理',
      desc: '智能任务追踪，优先级分类，让待办事项井井有条'
    },
    {
      icon: <IconClock />,
      title: '习惯养成',
      desc: '每日打卡记录，可视化进度，培养良好生活习惯'
    },
    {
      icon: <IconHistogram />,
      title: '数据统计',
      desc: '多维度数据分析，洞察生活规律，持续优化效率'
    }
  ]

  return (
    <div className="login-page">
      {/* Left Brand */}
      <div className="brand">
        <div className="brand-inner">
          {/* 08 §3.2：横版 lockup = 图形 + slogan 一体，替换原 img + brand-name + brand-tagline
              三件套（⚠️ 手写 name/tagline 必须删，否则出现两个 slogan）。
              lockup-h 比例 2.51:1 ⇒ 内联 width:auto/height:64 覆写 .brand-square 的固定 64×64
              （login.scss 不在本批改动范围）；左栏 480px，64 高对应宽 ~161px，放得下。 */}
          <div className="brand-logo">
            <img
              src={`${import.meta.env.BASE_URL}brand/z1-lockup-h.svg`}
              alt="Z1 · Zero to One"
              className="brand-square"
              style={{ width: 'auto', height: 64 }}
            />
          </div>

          <h1 className="brand-title">
            专注于每一个<br />
            <span>生活瞬间</span>
          </h1>
          <p className="brand-subtitle">任务 · 习惯 · 记账 · 统计，一站式个人效率管理平台</p>

          <div className="brand-features">
            {features.map((feature, index) => (
              <div key={index} className="feature-card">
                <div className="feature-icon">{feature.icon}</div>
                <div className="feature-content">
                  <div className="feature-title">{feature.title}</div>
                  <div className="feature-desc">{feature.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Form */}
      <div className="form-pane">
        <div className="form-card">
          <div className="form-header">
            <div className="form-icon">
              <IconUser size="extra-large" />
            </div>
            <h2 className="form-title">欢迎回来</h2>
            <p className="form-subtitle">请使用你的账号登录</p>
          </div>

          <Form
            getFormApi={(api) => { formRef.current = api }}
            labelPosition="top"
            onSubmit={onSubmit}
          >
            <Form.Input
              field="username"
              label="账号 / 邮箱"
              rules={[{ required: true, message: '请输入账号' }]}
              initValue={username}
              placeholder="admin@life.app"
              size="large"
              autoComplete="username"
              prefix={<IconUser />}
              onChange={(v) => setUsername(v)}
              onEnterPress={() => onSubmit()}
            />

            <Form.Input
              field="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
              initValue={password}
              type={showPassword ? 'text' : 'password'}
              placeholder="请输入密码"
              size="large"
              autoComplete="current-password"
              prefix={<IconLock />}
              suffix={
                <span className="eye-toggle" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <IconEyeClosedStroked /> : <IconEyeOpened />}
                </span>
              }
              onChange={(v) => setPassword(v)}
              onEnterPress={() => onSubmit()}
            />

            <div className="form-row">
              <Checkbox checked={remember} onChange={(e: any) => setRemember(!!e.target?.checked)}>
                记住密码（7 天免登录）
              </Checkbox>
              <a
                className="forgot-link"
                href="#"
                onClick={(e) => { e.preventDefault(); Toast.info('请联系管理员重置密码') }}
              >
                忘记密码？
              </a>
            </div>

            <Button
              block
              size="large"
              theme="solid"
              type="primary"
              loading={submitting}
              disabled={!canSubmit}
              className="login-btn"
              onClick={onSubmit}
            >
              登 录
            </Button>
          </Form>

          <div className="divider">
            <span>其他登录方式</span>
          </div>

          <div className="third-party">
            <div className="tp-icon" title="微信扫码" onClick={() => Toast.info('微信登录开发中')}>
              <img src={WechatIcon} alt="微信" />
            </div>
            <div className="tp-icon" title="GitHub" onClick={() => Toast.info('GitHub 登录开发中')}>
              <IconGithubLogo size="large" />
            </div>
            <div className="tp-icon" title="手机号" onClick={() => Toast.info('手机号登录开发中')}>
              <IconPhone size="large" />
            </div>
            <div className="tp-icon" title="密码保险箱" onClick={() => Toast.info('密码保险箱登录开发中')}>
              <IconSafe size="large" />
            </div>
          </div>

          <div className="register">
            还没有账号？<a href="#" onClick={(e) => { e.preventDefault(); Toast.info('注册功能开发中') }}>立即注册</a>
          </div>

          <div className="hint">
            <strong>演示账号：</strong>
            admin / Admin@123456 (管理员) ·
            editor / Editor@123456 (编辑者) ·
            viewer / Viewer@123456 (查看者)
          </div>
        </div>
      </div>
    </div>
  )
}
