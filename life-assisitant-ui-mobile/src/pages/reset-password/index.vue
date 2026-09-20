<script setup lang="ts">
/**
 * 重置密码（移动端 · Phase 5.10）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/auth.go（ResetPasswordReq）
 *                    life-assisitant-api/internal/controller/router.go
 *
 * 入口：忘记密码页发到用户邮箱的链接里带上 `?token=xxx`，用户点开即落地本页。
 * 也支持在无 token 时手动粘贴重置码（部分邮件客户端会吞掉查询参数）。
 *
 * ⚠️ new_password 后端是 `required|length:8,32`，前端按同一规则校验。
 *    token 是一次性的：重置成功后立即失效，失败重试要用新邮件里的新 token。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast, showSuccessToast } from 'vant'
import { authApi } from '@/api/auth'
import Icon from '@/components/icon/Icon.vue'

const route = useRoute()
const router = useRouter()

/** 重置码优先取 URL query，取不到则允许手动粘贴 */
const token = ref<string>(typeof route.query.token === 'string' ? route.query.token : '')
const password = ref('')
const confirm = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const errorText = ref('')
const done = ref(false)

const canSubmit = computed(
  () => !!token.value.trim() && !!password.value && !!confirm.value && !submitting.value
)

async function onSubmit(): Promise<void> {
  errorText.value = ''
  const tk = token.value.trim()
  if (!tk) {
    errorText.value = '缺少重置码，请从邮件里的链接进入'
    return
  }
  if (password.value.length < 8) {
    errorText.value = '新密码至少 8 位'
    return
  }
  if (password.value.length > 32) {
    errorText.value = '新密码最多 32 位'
    return
  }
  if (password.value !== confirm.value) {
    errorText.value = '两次输入的密码不一致'
    return
  }

  submitting.value = true
  try {
    await authApi.resetPassword({ token: tk, new_password: password.value })
    done.value = true
    showSuccessToast({ message: '密码已重置，请用新密码登录', duration: 1500 })
  } catch (e) {
    // 后端对无效/过期 token 会返回明确的业务错误，拦截器已 toast
    if (!(e instanceof Error && e.message)) showFailToast('重置失败，请重新获取邮件')
  } finally {
    submitting.value = false
  }
}

function goLogin(): void {
  router.replace({ name: 'Login' })
}

function goForgot(): void {
  router.replace({ name: 'ForgotPassword' })
}
</script>

<template>
  <div class="sub-page auth-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goLogin">‹</button>
      <h2 class="sub-title">重置密码</h2>
    </header>

    <main class="sub-body">
      <!-- 成功 -->
      <section v-if="done" class="card sent-card">
        <Icon name="CheckCircle" :size="32" class="sent-icon" />
        <h3 class="sent-title">密码已重置</h3>
        <p class="sent-desc">请使用新密码重新登录。旧密码与已登录的设备均已失效。</p>
        <button class="btn btn-primary" type="button" @click="goLogin">去登录</button>
      </section>

      <!-- 表单 -->
      <section v-else class="card">
        <h3 class="card-title">设置新密码</h3>

        <div class="field">
          <label class="field-label" for="rp-token">重置码</label>
          <van-field
            id="rp-token"
            v-model="token"
            placeholder="通常由邮件链接自动带入"
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
          <p class="field-hint">如果是从邮件链接进来的，这里会自动填好</p>
        </div>

        <div class="field">
          <label class="field-label" for="rp-pwd">新密码</label>
          <div class="pwd-wrap">
            <van-field
              id="rp-pwd"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="8-32 位"
              maxlength="32"
              :border="false"
              class="field-input pwd-input"
              :disabled="submitting"
            />
            <button
              class="eye"
              type="button"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <Icon :name="showPassword ? 'EyeOff' : 'Eye'" :size="16" />
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="rp-confirm">确认新密码</label>
          <van-field
            id="rp-confirm"
            v-model="confirm"
            :type="showPassword ? 'text' : 'password'"
            placeholder="再次输入新密码"
            maxlength="32"
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <p v-if="errorText" class="field-error">{{ errorText }}</p>

        <button class="btn btn-primary" type="button" :disabled="!canSubmit" @click="onSubmit">
          {{ submitting ? '提交中…' : '确认重置' }}
        </button>

        <p class="auth-foot">
          重置码失效？<button class="auth-link" type="button" @click="goForgot">重新获取</button>
        </p>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

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

.pwd-wrap { position: relative; }
.pwd-input :deep(.van-field__control) { padding-right: 44px; }
.eye {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-base);
  background: transparent;
  font-size: var(--fs-h4);

  &:active { background: var(--color-bg-hover); }
}

.sent-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px var(--space-4) 24px;
}
/* 成功态图标：尺寸由 <Icon :size> 控制（原来是 44px 的 emoji） */
.sent-icon {
  display: block;
  margin: 0 auto var(--space-3);
  color: var(--color-success);
}
.sent-title {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--color-text-primary);
}
.sent-desc {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-caption-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

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
