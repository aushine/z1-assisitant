<script setup lang="ts">
/**
 * 隐私与安全（移动端 · 修改密码）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/security.tsx
 * 最后同步：2026-09-18（Phase 5.5）
 *
 * ⚠️ 修正了桌面端的一处校验偏差：
 *    桌面端前端校验写的是「新密码至少 6 位」，但后端 dto.ChangePasswordReq
 *    是 `length:8,32` —— 用户输入 6~7 位时前端放行、后端 400，
 *    表现为「点了没反应地报错」。移动端按要求的最小长度 8 位校验。
 *
 * 成功后强制登出：改密会让后端撤销全部 refresh_token，
 * 继续留着本地 token 只会让后续请求连续 401。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, showSuccessToast } from 'vant'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()
const userStore = useUserStore()

const form = reactive({
  old: '',
  new: '',
  confirm: '',
})

const saving = ref(false)
const errorText = ref('')

const showPwdResetHint = computed(() => !!userStore.user?.pwd_reset_required)

async function onSubmit(): Promise<void> {
  errorText.value = ''
  if (!form.old) {
    errorText.value = '请输入当前密码'
    return
  }
  if (form.new.length < 8) {
    errorText.value = '新密码至少 8 位'
    return
  }
  if (form.new.length > 32) {
    errorText.value = '新密码最多 32 位'
    return
  }
  if (form.new === form.old) {
    errorText.value = '新密码不能与当前密码相同'
    return
  }
  if (form.new !== form.confirm) {
    errorText.value = '两次输入的新密码不一致'
    return
  }

  saving.value = true
  try {
    await authApi.changePassword({ old_password: form.old, new_password: form.new })
    showSuccessToast({ message: '密码已修改，请重新登录', duration: 1500 })
    // 后端已撤销 refresh_token，本地必须清干净
    userStore.clearAuth()
    await router.replace({ name: 'Login' })
  } catch (e) {
    if (!(e instanceof Error && e.message)) showFailToast('修改失败，请稍后重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h2 class="sub-title">隐私与安全</h2>
    </header>

    <main class="sub-body">
      <div v-if="showPwdResetHint" class="reset-hint">
        <Icon name="AlertTriangle" :size="16" class="reset-emoji" />
        <span>当前账号仍在使用管理员分配的初始密码，修改后即可正常使用全部功能。</span>
      </div>

      <section class="card">
        <h3 class="card-title">修改密码</h3>

        <div class="field">
          <label class="field-label" for="sec-old">当前密码</label>
          <van-field
            id="sec-old"
            v-model="form.old"
            type="password"
            placeholder="输入当前密码"
            :border="false"
            class="field-input"
            :disabled="saving"
          />
        </div>

        <div class="field">
          <label class="field-label" for="sec-new">新密码</label>
          <van-field
            id="sec-new"
            v-model="form.new"
            type="password"
            placeholder="至少 8 位"
            maxlength="32"
            :border="false"
            class="field-input"
            :disabled="saving"
          />
          <p class="field-hint">8-32 位，建议包含字母与数字</p>
        </div>

        <div class="field">
          <label class="field-label" for="sec-confirm">确认新密码</label>
          <van-field
            id="sec-confirm"
            v-model="form.confirm"
            type="password"
            placeholder="再次输入新密码"
            maxlength="32"
            :border="false"
            class="field-input"
            :disabled="saving"
          />
        </div>

        <p v-if="errorText" class="field-error">{{ errorText }}</p>

        <button class="btn btn-primary" type="button" :disabled="saving" @click="onSubmit">
          {{ saving ? '提交中…' : '确认修改' }}
        </button>
        <p class="field-hint logout-note">修改成功后需要重新登录</p>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.reset-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px var(--space-4);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-xl);
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
  font-size: var(--fs-caption-sm);
  line-height: 1.5;
}
.reset-emoji { flex-shrink: 0; :deep(svg) { display: block; } }

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

.logout-note { text-align: center; }
</style>
