<script setup lang="ts">
/**
 * 忘记密码（移动端 · Phase 5.10）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/auth.go（ForgotPasswordReq）
 *                    life-assisitant-api/internal/controller/auth.go（ForgotPassword）
 *
 * 后端「防枚举」设计：无论邮箱是否存在，都返回**同一句**提示，避免攻击者用
 * 该接口枚举出系统里有哪些邮箱。因此前端**不能**根据响应判断邮箱是否存在，
 * 一律按成功处理并引导用户查收邮件。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, showSuccessToast } from 'vant'
import { authApi } from '@/api/auth'
import { isEmail } from '@/utils/validate'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()

const email = ref('')
const submitting = ref(false)
const sent = ref(false)
const errorText = ref('')

const canSubmit = computed(() => !!email.value.trim() && !submitting.value)

async function onSubmit(): Promise<void> {
  errorText.value = ''
  const value = email.value.trim()
  if (!value) {
    errorText.value = '请输入邮箱'
    return
  }
  if (!isEmail(value)) {
    errorText.value = '邮箱格式不正确'
    return
  }

  submitting.value = true
  try {
    await authApi.forgotPassword({ email: value })
    sent.value = true
    // spec-20260922-v2 · 05 §2.2 R2 保留：邮件在服务端异步发出，结果不在当前屏
    showSuccessToast({ message: '若该邮箱已注册，重置邮件已发送', duration: 1800 })
  } catch (e) {
    // 只在网络/服务异常时提示；业务层的「邮箱不存在」后端不会返回，也无需暴露
    if (!(e instanceof Error && e.message)) showFailToast('发送失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

function goLogin(): void {
  router.replace({ name: 'Login' })
}

function goReset(): void {
  router.push({ name: 'ResetPassword' })
}
</script>

<template>
  <div class="sub-page auth-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goLogin">‹</button>
      <h2 class="sub-title">忘记密码</h2>
    </header>

    <main class="sub-body">
      <section v-if="sent" class="card sent-card">
        <Icon name="Send" :size="32" class="sent-icon" />
        <h3 class="sent-title">重置邮件已发送</h3>
        <p class="sent-desc">
          如果 <strong>{{ email.trim() }}</strong> 已注册，你会收到一封包含重置链接的邮件。
          请点击邮件里的链接完成重置（链接有时效，请尽快操作）。
        </p>
        <p class="sent-desc muted">没收到？请检查垃圾邮件箱，或稍后重试。</p>

        <button class="btn btn-ghost" type="button" @click="sent = false">换个邮箱重试</button>
        <button class="btn btn-primary sent-btn" type="button" @click="goReset">
          我已有重置码，去重置
        </button>
      </section>

      <section v-else class="card">
        <h3 class="card-title">找回账号</h3>
        <p class="field-hint intro">
          输入注册时使用的邮箱，我们会发送一封重置密码的邮件。
        </p>

        <div class="field">
          <label class="field-label" for="fp-email">邮箱</label>
          <van-field
            id="fp-email"
            v-model="email"
            type="email"
            placeholder="注册时使用的邮箱"
            clearable
            :border="false"
            class="field-input"
            :disabled="submitting"
            @keyup.enter="onSubmit"
          />
          <p v-if="errorText" class="field-error">{{ errorText }}</p>
        </div>

        <button class="btn btn-primary" type="button" :disabled="!canSubmit" @click="onSubmit">
          {{ submitting ? '发送中…' : '发送重置邮件' }}
        </button>

        <p class="auth-foot">
          想起密码了？<button class="auth-link" type="button" @click="goLogin">去登录</button>
        </p>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.intro { margin: 0 0 var(--space-4); }

.field-input {
  padding: 0;
  background: transparent;

  :deep(.van-field__control) {
    height: 42px;
    padding: 0 12px;
    font-size: var(--fs-body-sm);
    background: var(--color-bg-hover);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);

    &::placeholder { color: var(--color-text-placeholder); }
  }
}

.sent-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px var(--space-4) 24px;
}
/* 已发送图标：尺寸由 <Icon :size> 控制（原来是 44px 的 emoji） */
.sent-icon {
  display: block;
  margin: 0 auto var(--space-3);
  color: var(--color-primary);
}
.sent-title {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--color-text-primary);
}
.sent-desc {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-caption-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);

  strong { color: var(--color-text-primary); }
  &.muted { color: var(--color-text-tertiary); }
}
.sent-btn { margin-top: 10px; }

.auth-foot {
  margin: var(--space-4) 0 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.auth-link {
  border: 0;
  background: transparent;
  padding: 0 2px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-primary);
}
</style>
