<script setup lang="ts">
/**
 * 个人资料（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/profile.tsx
 * 最后同步：2026-09-18（Phase 5.3）
 *
 * 与桌面端一致：头像只展示（换头像入口在「我的」首页点头像），本页负责资料保存。
 * 差异：保存成功后走 store 的 patchUser 落库（桌面端是直接 setState + storage.set 两步）。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { useUserStore } from '@/stores/user'
import { userApi } from '@/api/user'
import { displayNameOf } from '@/utils/avatar'
import UserAvatar from '@/components/UserAvatar.vue'

const router = useRouter()
const userStore = useUserStore()

const displayName = computed(() => displayNameOf(userStore.user))

const form = reactive({
  name: userStore.user?.name || '',
  email: userStore.user?.email || '',
})

const saving = ref(false)
const errorText = ref('')

async function onSave(): Promise<void> {
  errorText.value = ''
  const name = form.name.trim()
  if (!name) {
    errorText.value = '昵称不能为空'
    return
  }
  if (name.length < 2 || name.length > 20) {
    errorText.value = '昵称需为 2-20 个字符'
    return
  }
  const email = form.email.trim()
  if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    errorText.value = '邮箱格式不正确'
    return
  }

  saving.value = true
  try {
    // 后端返回最新用户（含新 version），必须整体合并回本地 ——
    // 否则下次保存会拿旧 version 去 CAS，触发乐观锁冲突（409001）。
    const updated = await userApi.updateProfile({
      name,
      email: email || undefined,
    })
    userStore.patchUser(updated)
  } catch (e) {
    // 响应拦截器已 toast 具体原因（校验 / 邮箱冲突 / 版本冲突），这里只做兜底
    if (!(e instanceof Error && e.message)) showFailToast('保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

function onCancel(): void {
  router.back()
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="onCancel">‹</button>
      <h2 class="sub-title">个人资料</h2>
    </header>

    <main class="sub-body">
      <!-- 头像与账号概览 -->
      <section class="card profile-head">
        <UserAvatar :user="userStore.user" :size="64" />
        <div class="head-info">
          <div class="head-name">{{ displayName }}</div>
          <div class="head-account">@{{ userStore.user?.username || '-' }}</div>
          <div class="head-hint">换头像请回「我的」页点头像</div>
        </div>
      </section>

      <!-- 表单 -->
      <section class="card">
        <div class="field">
          <label class="field-label" for="pf-name">昵称</label>
          <van-field
            id="pf-name"
            v-model="form.name"
            placeholder="输入昵称"
            maxlength="20"
            clearable
            :border="false"
            class="field-input"
            :disabled="saving"
          />
          <p class="field-hint">2-20 个字符</p>
        </div>

        <div class="field">
          <label class="field-label" for="pf-email">邮箱</label>
          <van-field
            id="pf-email"
            v-model="form.email"
            type="email"
            placeholder="输入邮箱"
            clearable
            :border="false"
            class="field-input"
            :disabled="saving"
          />
          <p class="field-hint">用于登录与找回密码</p>
        </div>

        <p v-if="errorText" class="field-error">{{ errorText }}</p>
      </section>

      <!-- 操作 -->
      <div class="actions">
        <button class="btn btn-ghost" type="button" :disabled="saving" @click="onCancel">
          取消
        </button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.profile-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.head-info { flex: 1; min-width: 0; }
.head-name {
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-account {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
  margin-bottom: 4px;
}
.head-hint {
  font-size: var(--fs-micro);
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
  :deep(.van-field__control--error) { border-color: var(--color-danger); }
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: var(--space-2);

  .btn { flex: 1; }
}
</style>
