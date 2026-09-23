<script setup lang="ts">
import { assetBase } from '@/utils/asset'
/**
 * 注册（移动端 · Phase 5.9）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/auth.go（RegisterReq）
 *
 * 校验规则**逐条对齐后端 v 标签**，不再自己发明：
 *   username  required | length:4,32 | regex:^[a-zA-Z0-9_]+$
 *   password  required | length:8,32
 *   name      required | length:2,20
 *   email     required | email
 *   phone     length:11,11（选了才校验）
 *   device_id required（由 user store 内部注入）
 *
 * ⚠️ 后端**不接受** role 字段（D-03 权限重构：前端自选角色 = 可注册成 admin）。
 *    注册用户一律落内置 user 角色。
 *
 * 注册成功即登录（后端返回 token），直接进首页，不让用户再输一遍密码。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { useUserStore } from '@/stores/user'
import { isEmail, isPhone, isUsername } from '@/utils/validate'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()
const userStore = useUserStore()

const form = reactive({
  username: '',
  password: '',
  confirm: '',
  name: '',
  email: '',
  phone: '',
})

const submitting = ref(false)
const showPassword = ref(false)
const errorText = ref('')

const canSubmit = computed(
  () =>
    !!form.username.trim() &&
    !!form.password &&
    !!form.name.trim() &&
    !!form.email.trim() &&
    !submitting.value
)

/** 逐条对齐后端校验；返回错误文案，空串代表通过 */
function validate(): string {
  const username = form.username.trim()
  if (!username) return '请输入用户名'
  if (username.length < 4 || username.length > 32) return '用户名需为 4-32 位'
  if (!isUsername(username)) return '用户名只能包含字母、数字、下划线'

  if (form.password.length < 8) return '密码至少 8 位'
  if (form.password.length > 32) return '密码最多 32 位'
  if (form.password !== form.confirm) return '两次输入的密码不一致'

  const name = form.name.trim()
  if (name.length < 2 || name.length > 20) return '昵称需为 2-20 个字符'

  const email = form.email.trim()
  if (!email) return '请输入邮箱'
  if (!isEmail(email)) return '邮箱格式不正确'

  const phone = form.phone.trim()
  if (phone && !isPhone(phone)) return '手机号需为 11 位数字'

  return ''
}

async function onSubmit(): Promise<void> {
  errorText.value = ''
  const err = validate()
  if (err) {
    errorText.value = err
    return
  }

  submitting.value = true
  try {
    await userStore.register({
      username: form.username.trim(),
      password: form.password,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
    })
    await router.replace('/home')
  } catch (e) {
    // 响应拦截器已 toast 具体原因（用户名已存在 / 邮箱已注册 / 校验失败），
    // 这里只兜底完全没有 message 的异常
    if (!(e instanceof Error && e.message)) showFailToast('注册失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

function goLogin(): void {
  router.replace({ name: 'Login' })
}
</script>

<template>
  <div class="sub-page auth-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goLogin">‹</button>
      <h2 class="sub-title">创建账号</h2>
    </header>

    <main class="sub-body">
      <div class="auth-hero">
        <!-- 08 §3.2：浅底页面无底 mark（h3「加入 Z1」是页面文案，保留） -->
        <img :src="`${assetBase}brand/z1-mark.svg`" alt="Z1" class="auth-logo" />
        <h3 class="auth-title">加入 Z1</h3>
        <p class="auth-subtitle">任务 · 习惯 · 记账 · 统计，一处管好</p>
      </div>

      <section class="card">
        <div class="field">
          <label class="field-label" for="rg-username">用户名</label>
          <van-field
            id="rg-username"
            v-model="form.username"
            placeholder="4-32 位字母 / 数字 / 下划线"
            maxlength="32"
            clearable
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label class="field-label" for="rg-name">昵称</label>
          <van-field
            id="rg-name"
            v-model="form.name"
            placeholder="2-20 个字符"
            maxlength="20"
            clearable
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label class="field-label" for="rg-email">邮箱</label>
          <van-field
            id="rg-email"
            v-model="form.email"
            type="email"
            placeholder="用于登录与找回密码"
            clearable
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label class="field-label" for="rg-phone">手机号（可选）</label>
          <van-field
            id="rg-phone"
            v-model="form.phone"
            type="tel"
            placeholder="11 位手机号"
            maxlength="11"
            clearable
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label class="field-label" for="rg-password">密码</label>
          <div class="pwd-wrap">
            <van-field
              id="rg-password"
              v-model="form.password"
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
          <label class="field-label" for="rg-confirm">确认密码</label>
          <van-field
            id="rg-confirm"
            v-model="form.confirm"
            :type="showPassword ? 'text' : 'password'"
            placeholder="再次输入密码"
            maxlength="32"
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <p v-if="errorText" class="field-error">{{ errorText }}</p>

        <button
          class="btn btn-primary"
          type="button"
          :disabled="!canSubmit"
          @click="onSubmit"
        >
          {{ submitting ? '注册中…' : '注 册' }}
        </button>

        <p class="auth-foot">
          已有账号？<button class="auth-link" type="button" @click="goLogin">去登录</button>
        </p>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.auth-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-5) 0 var(--space-4);
}
.auth-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
  display: block;
  margin-bottom: var(--space-3);
}
.auth-title {
  margin: 0 0 4px;
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--color-text-primary);
}
.auth-subtitle {
  margin: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

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

.pwd-wrap {
  position: relative;
}
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
