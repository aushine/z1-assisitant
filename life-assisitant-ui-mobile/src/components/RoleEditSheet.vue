<script setup lang="ts">
/**
 * RoleEditSheet —— 新建 / 编辑角色元信息底部弹层（移动端 · Phase 6.9）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/permission/index.tsx
 *                    （「新建自定义角色」+「编辑角色信息」两个 Modal）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/user.go（Role 段）
 * 最后同步：2026-09-18（Phase 6）
 *
 * 桌面端把「新建」和「编辑」拆成两个 Modal，字段其实高度重合，
 * 移动端合成一个弹层按 `role` 是否为空分模式，少一套模板少一处漂移。
 *
 * 校验（与后端 roleCodeRe 同标准）：
 *  - 编码：^[a-z][a-z0-9_]{1,19}$，且不得占用内置编码 admin / user
 *  - 编码创建后不可改（后端 PATCH 也不接受 code，只改 name/description）
 *  - 名称必填
 *
 * ⚠️ 本弹层**只改元信息**，不碰权限矩阵 —— 勾选保存是权限页主区的事，
 *    混在一起会让「改个名字」也带上乐观锁 version 冲突的风险。
 */
import { computed, reactive, ref, watch } from 'vue'
import type { Role } from '@/api/types'
import Icon from '@/components/icon/Icon.vue'

interface Props {
  show: boolean
  /** 编辑模式传入；新建传 null */
  role: Role | null
  /** 提交回调：返回 true=成功 */
  onSave: (payload: { code: string; name: string; description: string }) => Promise<boolean>
}

const props = defineProps<Props>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const isEdit = computed(() => !!props.role)
const submitting = ref(false)

/** 与后端 roleCodeRe 同标准 */
const ROLE_CODE_RE = /^[a-z][a-z0-9_]{1,19}$/
/** 内置保留编码 */
const RESERVED = new Set(['admin', 'user'])

const form = reactive({
  code: '',
  name: '',
  description: '',
})

const codeError = ref('')
const nameError = ref('')

function syncForm(): void {
  codeError.value = ''
  nameError.value = ''
  if (props.role) {
    form.code = props.role.code
    form.name = props.role.name
    form.description = props.role.description ?? ''
  } else {
    form.code = ''
    form.name = ''
    form.description = ''
  }
}

watch(
  () => props.show,
  (v) => {
    if (v) syncForm()
  }
)

function validate(): boolean {
  codeError.value = ''
  nameError.value = ''
  let ok = true

  if (!isEdit.value) {
    const code = form.code.trim()
    if (!ROLE_CODE_RE.test(code)) {
      codeError.value = '需以小写字母开头，仅含小写字母/数字/下划线，2~20 位'
      ok = false
    } else if (RESERVED.has(code)) {
      codeError.value = '该编码为内置角色保留'
      ok = false
    }
  }

  if (!form.name.trim()) {
    nameError.value = '请输入角色名称'
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
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
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
    :style="{ height: '66%' }"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="role-sheet">
      <van-nav-bar
        :title="isEdit ? '编辑角色' : '新建自定义角色'"
        :left-text="submitting ? '' : '取消'"
        :right-text="submitting ? '' : isEdit ? '保存' : '创建'"
        :left-disabled="submitting"
        :right-disabled="submitting"
        @click-left="onCancel"
        @click-right="onSubmit"
      />

      <div class="sheet-body">
        <!-- 编码 -->
        <div class="field-group">
          <div class="group-label">
            角色标识 <span v-if="!isEdit" class="required">*</span>
            <span v-else class="group-note">（创建后不可修改）</span>
          </div>
          <van-field
            v-model="form.code"
            placeholder="如 finance_staff"
            maxlength="20"
            :disabled="isEdit || submitting"
            :error-message="codeError"
          />
          <p class="field-note">小写字母开头，仅含小写字母/数字/下划线，2~20 位</p>
        </div>

        <!-- 名称 -->
        <div class="field-group">
          <div class="group-label">角色名称 <span class="required">*</span></div>
          <van-field
            v-model="form.name"
            placeholder="如 财务专员"
            maxlength="20"
            :disabled="submitting"
            :error-message="nameError"
          />
        </div>

        <!-- 描述 -->
        <div class="field-group">
          <div class="group-label">描述<span class="group-note">（可选）</span></div>
          <van-field
            v-model="form.description"
            type="textarea"
            rows="3"
            autosize
            placeholder="这个角色负责什么"
            maxlength="200"
            show-word-limit
            :disabled="submitting"
          />
        </div>

        <!-- 新建提示：矩阵要另去权限页勾 -->
        <div v-if="!isEdit" class="tip-card">
          <Icon name="Lightbulb" :size="16" class="tip-icon" />
          <span class="tip-text">
            新建后权限矩阵为空。请到右侧「角色与权限」页为该角色勾选功能权限并保存。
          </span>
        </div>
      </div>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.role-sheet {
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

.field-group :deep(.van-field) {
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  padding: 11px var(--space-4);
}
.field-group :deep(.van-field__error-message) {
  font-size: var(--fs-micro);
}

.tip-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--tint-primary-bg);
  color: var(--tint-primary-fg);
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
}
</style>
