<script setup lang="ts">
/**
 * UserEditSheet —— 新建 / 编辑用户底部弹层（移动端 · Phase 6.4）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/user/index.tsx（Modal 表单段）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/user.go
 * 最后同步：2026-09-18（Phase 6）
 *
 * 字段：username / name / email / phone / role
 *  - 用户名：新建必填（后端 `length:4,32` + `regex:^[a-zA-Z0-9_]+$`）；
 *    编辑态**不可改**（桌面端同 —— 用户名是登录凭据，后端也没有改名端点）
 *  - 昵称：必填（后端 `length:2,20`）
 *  - 邮箱 / 手机号：可选。后端是指针字段，**空串显式发送 = 清空转 NULL**，
 *    undefined 才是「不改」—— 所以这里始终发字符串，不把空串转 undefined
 *  - 初始密码：后端统一置 123456 并打 pwd_reset_required，前端**不传**密码
 *  - department：后端列/DTO 兼容保留，前端不再传（对齐桌面端 D-03 第九轮）
 *
 * ⚠️ 角色可编辑性由父组件算好传进来，不在这里二次判断权限：
 *    改角色有两条合法路径 ——
 *      a) `PATCH /users/:id` 带 role      → user_mgmt:update
 *      b) `PUT  /users/:id/role`          → user_mgmt:assign_role
 *    父组件据此决定「能改」还是「只读展示」，本组件只负责呈现与校验。
 *    两者都没有时 role 区禁用，避免用户改完才吃 403。
 */
import { computed, reactive, ref, watch } from 'vue'
import { showToast } from 'vant'
import type { Role, RoleCode, User } from '@/api/types'
import Icon from '@/components/icon/Icon.vue'

interface Props {
  show: boolean
  /** 编辑模式传入；新建传 null */
  user: User | null
  /** 可选角色列表（GET /roles；取不到时父组件给空数组，此时角色区降级为只读文本） */
  roles: Role[]
  /** 能否改资料字段（user_mgmt:update） */
  canEditProfile: boolean
  /** 能否改角色（user_mgmt:update 或 user_mgmt:assign_role） */
  canEditRole: boolean
  /** 提交回调：返回 true=成功（父组件负责 toast 具体结果） */
  onSave: (payload: {
    /** 仅新建时有意义；编辑态父组件会忽略它（后端也不接受改名） */
    username: string
    name: string
    email: string
    phone: string
    role: RoleCode
  }) => Promise<boolean>
}

const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const isEdit = computed(() => !!props.user)
const submitting = ref(false)

// ==================== 表单 ====================
const form = reactive({
  username: '',
  name: '',
  email: '',
  phone: '',
  role: 'user' as RoleCode,
})

/** 后端 username 规则：^[a-zA-Z0-9_]+$，4~32 位 */
const USERNAME_RE = /^[a-zA-Z0-9_]+$/
/** 与后端 `v:"email"` 同口径的宽松校验 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const nameError = ref('')
const emailError = ref('')
const usernameError = ref('')

function clearErrors(): void {
  nameError.value = ''
  emailError.value = ''
  usernameError.value = ''
}

/** 拉取表单初值（打开弹层时调用） */
function syncForm(): void {
  clearErrors()
  if (props.user) {
    form.username = props.user.username
    form.name = props.user.name
    form.email = props.user.email || ''
    form.phone = props.user.phone || ''
    form.role = props.user.role
  } else {
    form.username = ''
    form.name = ''
    form.email = ''
    form.phone = ''
    form.role = 'user'
  }
  rolePickerValue.value = [form.role]
}

watch(
  () => props.show,
  (v) => {
    if (v) syncForm()
  }
)

// ==================== 角色 picker ====================
const rolePickerShow = ref(false)
const rolePickerValue = ref<RoleCode[]>(['user'])

const roleColumns = computed(() =>
  props.roles.map((r) => ({
    text: r.is_system ? `${r.name}（内置）` : r.name,
    value: r.code,
  }))
)

/** 当前角色显示文案（列表还没加载出来时原样回显编码，不崩也不伪装） */
const currentRoleText = computed(() => {
  const hit = props.roles.find((r) => r.code === form.role)
  if (!hit) return form.role
  return hit.is_system ? `${hit.name}（内置）` : hit.name
})

function openRolePicker(): void {
  if (!props.canEditRole || submitting.value) return
  if (roleColumns.value.length === 0) {
    showToast({ message: '角色列表未加载，请稍后重试', duration: 1500 })
    return
  }
  rolePickerValue.value = [form.role]
  rolePickerShow.value = true
}

function onRoleConfirm({ selectedOptions }: { selectedOptions: Array<{ value?: string | number }> }): void {
  const picked = selectedOptions[0]?.value
  if (typeof picked === 'string' && picked) form.role = picked
  rolePickerShow.value = false
}

// ==================== 校验 & 提交 ====================
function validate(): boolean {
  clearErrors()
  let ok = true

  const name = form.name.trim()
  if (name.length < 2 || name.length > 20) {
    nameError.value = '昵称需 2~20 个字符'
    ok = false
  }

  if (!isEdit.value) {
    const username = form.username.trim()
    if (username.length < 4 || username.length > 32) {
      usernameError.value = '用户名需 4~32 位'
      ok = false
    } else if (!USERNAME_RE.test(username)) {
      usernameError.value = '用户名只能包含字母、数字、下划线'
      ok = false
    }
  }

  const email = form.email.trim()
  if (email && !EMAIL_RE.test(email)) {
    emailError.value = '邮箱格式不正确'
    ok = false
  }

  return ok
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return
  if (!validate()) return

  submitting.value = true
  try {
    const ok = await props.onSave({
      username: form.username.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
    })
    if (ok) emit('update:show', false)
  } finally {
    submitting.value = false
  }
}

function onCancel(): void {
  if (submitting.value) return
  emit('update:show', false)
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（iOS 弹层层叠坑，说明见 components/period/PeriodDaySheet.vue） -->
  <van-popup
    :show="show"
    position="bottom"
    round
    teleport="body"
    :style="{ height: '80%' }"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="user-sheet">
      <van-nav-bar
        :title="isEdit ? '编辑用户' : '新建用户'"
        :left-text="submitting ? '' : '取消'"
        :right-text="submitting ? '' : isEdit ? '保存' : '创建'"
        :left-disabled="submitting"
        :right-disabled="submitting"
        @click-left="onCancel"
        @click-right="onSubmit"
      />

      <div class="sheet-body">
        <!-- ====== 新建：初始密码说明 ====== -->
        <div v-if="!isEdit" class="tip-card">
          <Icon name="Key" :size="16" class="tip-icon" />
          <span class="tip-text">
            初始密码固定为 <b>123456</b>，该用户首次登录后会被要求立即修改。
          </span>
        </div>

        <!-- ====== 用户名 ====== -->
        <div class="field-group">
          <div class="group-label">
            用户名 <span v-if="!isEdit" class="required">*</span>
            <span v-else class="group-note">（不可修改）</span>
          </div>
          <van-field
            v-model="form.username"
            placeholder="登录用户名，4~32 位字母/数字/下划线"
            maxlength="32"
            :disabled="isEdit || submitting"
            :error-message="usernameError"
          />
        </div>

        <!-- ====== 昵称 ====== -->
        <div class="field-group">
          <div class="group-label">昵称 <span class="required">*</span></div>
          <van-field
            v-model="form.name"
            placeholder="显示昵称，2~20 个字符"
            maxlength="20"
            :disabled="!canEditProfile || submitting"
            :error-message="nameError"
          />
        </div>

        <!-- ====== 邮箱（可选） ====== -->
        <div class="field-group">
          <div class="group-label">邮箱<span class="group-note">（可选）</span></div>
          <van-field
            v-model="form.email"
            type="text"
            placeholder="留空则不填"
            maxlength="64"
            :disabled="!canEditProfile || submitting"
            :error-message="emailError"
          />
        </div>

        <!-- ====== 手机号（可选） ====== -->
        <div class="field-group">
          <div class="group-label">手机号<span class="group-note">（可选）</span></div>
          <van-field
            v-model="form.phone"
            type="tel"
            placeholder="留空则不填"
            maxlength="20"
            :disabled="!canEditProfile || submitting"
          />
        </div>

        <!-- ====== 角色 ====== -->
        <div class="field-group">
          <div class="group-label">角色</div>
          <button
            class="picker-trigger"
            type="button"
            :disabled="!canEditRole || submitting"
            @click="openRolePicker"
          >
            <span class="picker-value">{{ currentRoleText }}</span>
            <span v-if="canEditRole" class="picker-arrow">›</span>
            <span v-else class="picker-lock">无分配权限</span>
          </button>
          <p v-if="!canEditProfile" class="field-note">
            你没有「编辑用户」权限，本表单仅可修改角色（走分配角色端点）。
          </p>
        </div>
      </div>
    </div>

    <!-- 角色选择器（teleport 必留：父级 .van-popup 自带 overflow-y:auto） -->
    <van-popup v-model:show="rolePickerShow" position="bottom" round teleport="body" :style="{ height: '42%' }">
      <van-picker
        v-model="rolePickerValue"
        :columns="roleColumns"
        title="选择角色"
        @confirm="onRoleConfirm"
        @cancel="rolePickerShow = false"
      />
    </van-popup>
  </van-popup>
</template>

<style lang="scss" scoped>
.user-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}

:deep(.van-nav-bar) {
  flex-shrink: 0;
  background: var(--color-bg-card);
}

.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-4) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
}

/* ====== 初始密码提示 ====== */
.tip-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px var(--space-4);
  margin-bottom: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
}
/* 提示条图标：尺寸由 <Icon :size> 控制 */
.tip-icon {
  flex-shrink: 0;
  display: block;
  margin-top: 2px;
  color: var(--tint-primary-fg);
}
.tip-text {
  flex: 1;
  font-size: var(--fs-caption-sm);
  line-height: 1.5;

  b { font-weight: 700; }
}

/* ====== 字段组 ====== */
.field-group {
  margin-bottom: var(--space-4);
}
.group-label {
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}
.required {
  color: var(--color-danger);
  margin-left: 2px;
}
.group-note {
  font-weight: 400;
  color: var(--color-text-tertiary);
}
.field-note {
  margin: 6px 0 0;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

/* van-field 在本页统一成卡片观感 */
.field-group :deep(.van-field) {
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  padding: 11px var(--space-4);
}
.field-group :deep(.van-field__error-message) {
  font-size: var(--fs-micro);
}

/* ====== 角色选择器触发条 ====== */
.picker-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px var(--space-4);
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  text-align: left;

  &:disabled { opacity: 0.75; }
}
.picker-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-arrow {
  flex-shrink: 0;
  font-size: 20px;
  color: var(--color-text-disabled);
  line-height: 1;
}
.picker-lock {
  flex-shrink: 0;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
</style>
