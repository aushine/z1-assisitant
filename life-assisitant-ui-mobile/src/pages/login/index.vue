<script setup lang="ts">
import { assetBase } from '@/utils/asset'
/**
 * 登录页
 * 严格按 spec/20-登录认证.md §3.1 + §8 实现
 * - 顶部渐变 Hero（蓝渐变 + Logo + slogan）
 * - 浮在 Hero 上的表单卡（账号/密码/记住密码/登录按钮/第三方/注册）
 * - 眼睛切换密码可见性
 * - 调用 authApi.login
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showSuccessToast } from 'vant'
import { useUserStore } from '@/stores/user'
import { isEmail, isPhone, isStrongPassword } from '@/utils/validate'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

// ============ 表单状态 ============
const form = reactive({
  username: '',
  password: '',
  remember: false,
})

const showPassword = ref(false)
const submitting = ref(false)

// 表单错误
const errors = reactive({
  username: '',
  password: '',
})

// 预填：上次记住的账号
onMounted(() => {
  const remembered = userStore.getRememberedAccount()
  if (remembered.username) {
    form.username = remembered.username
    form.remember = true
  }
})

// 提交按钮是否可点击
const canSubmit = computed(
  () => !!form.username.trim() && !!form.password && !submitting.value
)

// 验证函数
function validateUsername(v: string): boolean {
  if (!v.trim()) {
    errors.username = '请输入账号'
    return false
  }
  // 允许：邮箱 / 手机号 / 用户名（4-32 字符）
  if (isEmail(v) || isPhone(v)) {
    errors.username = ''
    return true
  }
  if (v.length < 4 || v.length > 32) {
    errors.username = '账号需为 4-32 位字符'
    return false
  }
  errors.username = ''
  return true
}

function validatePassword(v: string): boolean {
  if (!v) {
    errors.password = '请输入密码'
    return false
  }
  if (v.length < 6 || v.length > 32) {
    errors.password = '密码需为 6-32 位'
    return false
  }
  // 前端不强制强度，后端校验（spec/20 §3.2）
  if (!isStrongPassword(v)) {
    // 仅警告，不阻止
  }
  errors.password = ''
  return true
}

// 切换密码可见性
function togglePassword() {
  showPassword.value = !showPassword.value
}

// 提交登录
async function onSubmit() {
  if (!canSubmit.value) return
  if (!validateUsername(form.username)) return
  if (!validatePassword(form.password)) return

  submitting.value = true
  try {
    await userStore.login(form.username.trim(), form.password, form.remember)
    showSuccessToast({ message: '登录成功', duration: 800 })
    // 跳转：优先用 query.redirect，其次回首页
    const redirect = (route.query.redirect as string) || '/home'
    await router.replace(redirect)
  } catch (e) {
    // ApiError 已在 request.ts 里 toast 过，这里只打印日志
    // eslint-disable-next-line no-console
    console.error('[Login]', e)
  } finally {
    submitting.value = false
  }
}

// 第三方登录（占位）
function onThirdPartyLogin(type: 'wechat' | 'apple' | 'phone' | 'keychain') {
  showSuccessToast({ message: `${type} 登录功能即将上线`, duration: 1000 })
}

// 跳转注册（Phase 5.9 起为真实页面）
function goRegister() {
  router.push({ name: 'Register' })
}

// 跳转忘记密码（Phase 5.10 起为真实页面）
function goForgot() {
  router.push({ name: 'ForgotPassword' })
}
</script>

<template>
  <div class="login-page">
    <!-- ========== 渐变 Hero 区 ========== -->
    <header class="hero">
      <div class="hero-bg" aria-hidden="true">
        <div class="blob blob-1" />
        <div class="blob blob-2" />
      </div>
      <div class="hero-content">
        <img :src="`${assetBase}z1-logo.png`" alt="Z1" class="logo" />
        <h1 class="title">Z1</h1>
        <p class="slogan">Zero to One · 从零到一</p>
      </div>
    </header>

    <!-- ========== 浮在 Hero 上的表单卡 ========== -->
    <main class="form-card">
      <h2 class="card-title">欢迎回来</h2>
      <p class="card-subtitle">请登录你的账号</p>

      <form class="form" @submit.prevent="onSubmit">
        <!-- 账号 -->
        <div class="field" :class="{ 'has-error': errors.username }">
          <Icon name="User" :size="20" class="field-icon" aria-hidden="true" />
          <input
            v-model="form.username"
            type="text"
            class="field-input"
            placeholder="账号 / 邮箱 / 手机号"
            autocomplete="username"
            :maxlength="32"
            @blur="validateUsername(form.username)"
            @input="errors.username = ''"
          />
        </div>
        <p v-if="errors.username" class="field-error">{{ errors.username }}</p>

        <!-- 密码 -->
        <div class="field" :class="{ 'has-error': errors.password }">
          <Icon name="Lock" :size="20" class="field-icon" aria-hidden="true" />
          <input
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            class="field-input"
            placeholder="密码"
            autocomplete="current-password"
            :maxlength="32"
            @blur="validatePassword(form.password)"
            @input="errors.password = ''"
          />
          <button
            type="button"
            class="toggle-eye"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            @click="togglePassword"
          >
            <Icon :name="showPassword ? 'EyeOff' : 'Eye'" :size="16" aria-hidden="true" />
          </button>
        </div>
        <p v-if="errors.password" class="field-error">{{ errors.password }}</p>

        <!-- 记住密码 / 忘记密码 -->
        <div class="form-row">
          <label class="checkbox">
            <input
              v-model="form.remember"
              type="checkbox"
              class="checkbox-input"
            />
            <span class="checkbox-box" :class="{ checked: form.remember }">
              <span v-if="form.remember" class="checkbox-tick" aria-hidden="true">✓</span>
            </span>
            <span class="checkbox-label">记住密码</span>
          </label>
          <a class="link" href="javascript:void(0)" @click.prevent="goForgot">忘记密码？</a>
        </div>

        <!-- 登录按钮 -->
        <button
          type="submit"
          class="submit-btn"
          :disabled="!canSubmit"
          :class="{ 'is-loading': submitting }"
        >
          <span v-if="submitting" class="loading-dots">登录中…</span>
          <span v-else>登 录</span>
        </button>

        <!-- 第三方登录 -->
        <div class="third-party">
          <div class="divider">
            <span class="divider-line" />
            <span class="divider-text">其他登录方式</span>
            <span class="divider-line" />
          </div>
          <div class="third-party-icons">
            <button
              type="button"
              class="third-party-btn"
              aria-label="微信登录"
              @click="onThirdPartyLogin('wechat')"
            >
              <Icon name="MessageCircle" :size="20" />
            </button>
            <button
              type="button"
              class="third-party-btn"
              aria-label="Apple 登录"
              @click="onThirdPartyLogin('apple')"
            >
              <Icon name="Apple" :size="20" />
            </button>
            <button
              type="button"
              class="third-party-btn"
              aria-label="手机号登录"
              @click="onThirdPartyLogin('phone')"
            >
              <Icon name="Smartphone" :size="20" />
            </button>
            <button
              type="button"
              class="third-party-btn"
              aria-label="钥匙串登录"
              @click="onThirdPartyLogin('keychain')"
            >
              <Icon name="Key" :size="20" />
            </button>
          </div>
        </div>

        <!-- 注册 -->
        <p class="register">
          还没有账号？<a class="link link-primary" href="javascript:void(0)" @click.prevent="goRegister">立即注册</a>
        </p>
      </form>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  /* 高度取 --app-height（**不要**写 100vh/100dvh，见 styles/reset.scss 注释：
     standalone 下 WebKit 会把动态视口高度少算一个状态栏，页面底部会空一条）。
     用 min-height 是为了保留「内容超出时继续往下长」的能力 ——
     溢出的部分由 body 滚动承担，登录页依旧可滚。 */
  min-height: var(--app-height);
  background: var(--color-bg-app);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* ========== Hero ========== */
.hero {
  position: relative;
  height: 340px;
  background: linear-gradient(135deg, #014DB2 0%, #2563EB 50%, #0EA5E9 100%);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  padding-top: env(safe-area-inset-top, 0px);
}

.hero-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.5;
}
.blob-1 {
  width: 280px;
  height: 280px;
  background: #60A5FA;
  top: -60px;
  right: -60px;
}
.blob-2 {
  width: 200px;
  height: 200px;
  background: #38BDF8;
  bottom: -40px;
  left: -40px;
  opacity: 0.4;
}

.hero-content {
  position: relative;
  text-align: center;
  z-index: 1;
}

.logo {
  width: 96px;
  height: 96px;
  margin: 0 auto 16px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.3));
}

.title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px;
  letter-spacing: 1px;
  color: #FFFFFF;
}

.slogan {
  font-size: var(--fs-body-sm);
  margin: 0;
  opacity: 0.85;
  color: #FFFFFF;
}

/* ========== 表单卡（浮在 Hero 上） ========== */
.form-card {
  position: relative;
  margin: -110px 20px 0;
  padding: 28px 24px 24px;
  background: var(--color-bg-card);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-lg);
  z-index: 2;
}

.card-title {
  font-size: var(--fs-h2);
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  text-align: center;
}

.card-subtitle {
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  margin: 0 0 24px;
  text-align: center;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ========== Field ========== */
.field {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 12px;
  margin-top: 16px;
  background: #F9FAFB;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  transition: all var(--duration-fast) var(--ease-default);

  &:focus-within {
    border-color: var(--color-primary);
    background: #FFFFFF;
    box-shadow: var(--shadow-input-focus);
  }

  &.has-error {
    border-color: var(--color-danger);
    background: #FEF2F2;

    .field-icon { color: var(--color-danger); }
  }
}

.field-icon {
  display: block;
  margin-right: 8px;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: color var(--duration-fast);
}

.field:focus-within .field-icon { color: var(--color-primary); }

.field-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: transparent;
  border: 0;
  outline: 0;
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  padding: 0;
  letter-spacing: 0.3px;

  &::placeholder {
    color: var(--color-text-placeholder);
  }
}

.toggle-eye {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--color-text-tertiary);
  font-size: var(--fs-h3);
  border-radius: 8px;
  transition: background var(--duration-fast);
  flex-shrink: 0;

  &:active { background: var(--color-bg-hover); }
}

.field-error {
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
  margin: 4px 0 0;
  padding-left: 4px;
  min-height: 16px;
}

/* ========== 记住密码 / 忘记密码 ========== */
.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.checkbox-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.checkbox-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: #FFFFFF;
  border: 1.5px solid var(--color-border-strong);
  border-radius: 6px;
  transition: all var(--duration-fast);
  flex-shrink: 0;

  &.checked {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
}

.checkbox-tick {
  font-size: 12px;
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1;
}

.checkbox-label {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}

.link {
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  text-decoration: none;
  transition: color var(--duration-fast);

  &.link-primary { color: var(--color-primary); font-weight: 500; }
  &:active { opacity: 0.6; }
}

/* ========== 登录按钮 ========== */
.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  margin-top: 24px;
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-h4);
  font-weight: 600;
  letter-spacing: 4px;
  border-radius: 12px;
  border: 0;
  box-shadow: var(--shadow-button);
  transition: all var(--duration-fast) var(--ease-default);
  cursor: pointer;

  &:active:not(:disabled) {
    transform: scale(0.98);
    background: var(--color-primary-dark);
  }

  &:disabled {
    background: var(--color-bg-hover);
    color: var(--color-text-disabled);
    box-shadow: none;
    cursor: not-allowed;
  }

  &.is-loading {
    background: var(--color-primary-dark);
    cursor: wait;
  }
}

.loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  letter-spacing: 1px;

  &::after {
    content: '...';
    display: inline-block;
    animation: dot 1.2s steps(4, end) infinite;
    width: 1.2em;
    text-align: left;
  }
}

@keyframes dot {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}

/* ========== 第三方登录 ========== */
.third-party {
  margin-top: 28px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
}

.divider-line {
  flex: 1;
  height: 1px;
  background: var(--color-border-light);
}

.divider-text {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.third-party-icons {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-top: 16px;
}

.third-party-btn {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  background: var(--color-bg-app);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-pill);
  transition: all var(--duration-fast);
  cursor: pointer;

  &:active {
    transform: scale(0.92);
    background: var(--color-bg-hover);
  }
}

/* ========== 注册 ========== */
.register {
  text-align: center;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  margin: 20px 0 0;
}
</style>
