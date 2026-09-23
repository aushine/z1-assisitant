<script setup lang="ts">
/**
 * 分类管理页 —— 习惯 / 待办（移动端 · spec-20260922-v2/04 §4.4）
 *
 * 形态**完全照抄** `me/finance-categories.vue`（行高 / 长按菜单 / 编辑浮层 /
 * 确认弹窗同一份规范），只减掉两级树：一级平铺 ⇒ 点行即编辑。
 * 一页两分段（「习惯 / 待办」）而不是两页 —— 两域界面逐像素相同（04 §4.4）。
 *
 * 入口：「我的 → 偏好 → 分类管理」+ 编辑浮层里的「管理 ›」（带 ?domain= 预选分段）
 *
 * ⚠️ 布局铁律：sub-page / sub-header / sub-body 骨架，页面根不写 height；
 * ⚠️ 所有 van-popup 必须 teleport="body"（含嵌套图标选择器）；
 * ⚠️ 移动端行操作 = 长按（行尾 ⋮ 是桌面端行为）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import IconBox from '@/components/IconBox.vue'
import IconPicker from '@/components/finance/IconPicker.vue'
import { MENU_ACTIONS } from '@/constants/finance'
import { useUserCategoryStore, normalizeIconRef } from '@/stores/user-category'
import { TINT_NAMES, getTint, type TintName } from '@/utils/tint'
import type { IconName } from '@/components/icon/names'
import type { UserCategory, UserCategoryDomain } from '@/api/types'

const route = useRoute()
const router = useRouter()
const catStore = useUserCategoryStore()

// ==================== 视图状态 ====================
const DOMAINS: ReadonlyArray<{ value: UserCategoryDomain; label: string }> = [
  { value: 'habit', label: '习惯' },
  { value: 'task', label: '待办' },
]

/** 分段：初始取 ?domain=（CategoryTiles「管理 ›」带入），非法值回落 habit */
function initialDomain(): UserCategoryDomain {
  const q = route.query.domain
  return q === 'task' || q === 'habit' ? q : 'habit'
}
const domain = ref<UserCategoryDomain>(initialDomain())

const categories = computed(() => catStore.listByDomain(domain.value))
const isEmptyLoading = computed(() => catStore.loading[domain.value] && categories.value.length === 0)

onMounted(() => {
  // SWR：先拿缓存渲染，再后台静默对一次服务端（两域一起，切分段不用再等）
  void catStore.ensureFresh()
})

function onDomain(v: UserCategoryDomain): void {
  if (v === domain.value) return
  domain.value = v
}

/** 行的图标 / 颜色（store 已加载 ⇒ resolve 必命中；兜底走常量表） */
function styleOf(cat: UserCategory): { icon: IconName; tint: TintName } {
  const r = catStore.resolveCategory(cat.domain, cat.id)
  if (r) return { icon: r.icon, tint: r.tint }
  const ref = normalizeIconRef(cat.icon)
  const tint: TintName = cat.tint && (TINT_NAMES as readonly string[]).includes(cat.tint)
    ? (cat.tint as TintName)
    : ref?.tint ?? 'neutral'
  return { icon: ref?.icon ?? (cat.domain === 'habit' ? 'Pin' : 'CircleDashed'), tint }
}

// ==================== 长按快捷菜单（照抄 finance-categories） ====================
const menuShow = ref(false)
const menuTarget = ref<UserCategory | null>(null)
let pressTimer: ReturnType<typeof setTimeout> | null = null
let suppressClick = false

function startPress(node: UserCategory): void {
  cancelPress()
  suppressClick = false
  pressTimer = setTimeout(() => {
    pressTimer = null
    suppressClick = true
    menuTarget.value = node
    menuShow.value = true
  }, 500)
}

function cancelPress(): void {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onRowClick(node: UserCategory): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  openEdit(node)
}

function onMenuSelect(action: { name: string }): void {
  menuShow.value = false
  const node = menuTarget.value
  menuTarget.value = null
  if (!node) return
  if (action.name === '编辑') openEdit(node)
  else if (action.name === '删除') void onDelete(node)
}

// 菜单关闭后一律放掉 click 抑制，否则下一次点击会被误吞
watch(menuShow, (v) => {
  if (!v) {
    menuTarget.value = null
    suppressClick = false
  }
})

// ==================== 编辑浮层（新建 / 修改共用） ====================
const sheetShow = ref(false)
const editingNode = ref<UserCategory | null>(null)

const formName = ref('')
/** 落库口径的图标引用（`lucide:<Name>`）；null = 未选（渲染 emoji / 默认兜底） */
const formIcon = ref<string | null>(null)
const formTint = ref<string | null>(null)
const formError = ref('')
const saving = ref(false)
const iconPickerShow = ref(false)

/** IconPicker 要裸名 */
const pickerIcon = computed<string | null>(() => {
  const raw = formIcon.value
  if (!raw) return null
  return raw.startsWith('lucide:') ? raw.slice(7) : raw
})

const formIconResolved = computed<IconName>(() => normalizeIconRef(formIcon.value)?.icon ?? 'HelpCircle')
const formTintResolved = computed<TintName>(() =>
  (formTint.value as TintName) ?? normalizeIconRef(formIcon.value)?.tint ?? 'neutral'
)

const sheetTitle = computed(() => (editingNode.value ? '编辑分类' : '新建分类'))

function openCreate(): void {
  editingNode.value = null
  formName.value = ''
  formIcon.value = null
  formTint.value = null
  formError.value = ''
  sheetShow.value = true
}

function openEdit(node: UserCategory): void {
  editingNode.value = node
  formName.value = node.name
  formIcon.value = node.icon || null
  formTint.value = node.tint || null
  formError.value = ''
  sheetShow.value = true
}

function closeSheet(): void {
  if (saving.value) return
  sheetShow.value = false
}

function onIconPicked(name: IconName): void {
  formIcon.value = `lucide:${name}`
  iconPickerShow.value = false
}

function pickTint(t: TintName): void {
  formTint.value = t
}

function tintSwatch(t: TintName): string {
  return getTint(t).fg
}

async function onSave(): Promise<void> {
  const name = formName.value.trim()
  if (!name) {
    formError.value = '请输入分类名称'
    return
  }
  if (name.length > 10) {
    formError.value = '名称最多 10 个字'
    return
  }
  // 同域重名（后端行内错误也会拦，这里行内提示，口径照抄财务）
  if (categories.value.some((s) => s.name === name && s.id !== editingNode.value?.id)) {
    formError.value = '该名称已存在'
    return
  }

  saving.value = true
  try {
    if (editingNode.value) {
      const ok = await catStore.update(editingNode.value.id, {
        name,
        icon: formIcon.value,
        tint: formTint.value,
      })
      if (ok) {
        sheetShow.value = false
        editingNode.value = null
      }
      return
    }
    const item = await catStore.create({
      domain: domain.value,
      name,
      icon: formIcon.value,
      tint: formTint.value,
      emoji: null,
    })
    if (item) {
      sheetShow.value = false
    }
  } finally {
    saving.value = false
  }
}

async function onDelete(node: UserCategory): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除分类',
      message: `删除「${node.name}」后，历史记录会保留，只是以后不再出现在选择器里。`,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  const ok = await catStore.remove(node.id)
  if (ok && editingNode.value?.id === node.id) sheetShow.value = false
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h1 class="sub-title">分类管理</h1>
    </header>

    <main class="sub-body">
      <!-- 分段控件（习惯 / 待办 —— 一页两分段，04 §4.4） -->
      <div class="scope-seg">
        <button
          v-for="d in DOMAINS"
          :key="d.value"
          type="button"
          class="scope-btn"
          :class="{ 'is-on': domain === d.value }"
          @click="onDomain(d.value)"
        >
          {{ d.label }}分类
        </button>
      </div>

      <div v-if="isEmptyLoading" class="skeleton" />

      <div v-else-if="categories.length === 0" class="state-empty">
        <Icon name="FolderOpen" :size="34" class="state-icon" />
        <p class="state-text">还没有分类，点下方新建一个</p>
      </div>

      <div v-else class="cat-card">
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          class="cat-row"
          @click="onRowClick(cat)"
          @touchstart.passive="startPress(cat)"
          @touchend="cancelPress"
          @touchmove.passive="cancelPress"
          @touchcancel="cancelPress"
        >
          <IconBox :name="styleOf(cat).icon" :tint="styleOf(cat).tint" :size="32" />
          <span class="cat-name">{{ cat.name }}</span>
          <span v-if="cat.is_builtin" class="cat-count">内置</span>
        </button>
      </div>

      <p class="page-hint">长按分类可编辑或删除。新建的分类排在最后，历史数据不受改名影响。</p>

      <button type="button" class="add-child" @click="openCreate">＋ 新建分类</button>
    </main>

    <!-- ==================== 长按快捷菜单 ==================== -->
    <van-action-sheet
      v-model:show="menuShow"
      :actions="MENU_ACTIONS"
      cancel-text="取消"
      teleport="body"
      @select="onMenuSelect"
      @cancel="menuTarget = null"
    />

    <!-- ==================== 编辑 / 新建浮层（⚠️ teleport="body" 必留） ==================== -->
    <van-popup
      v-model:show="sheetShow"
      position="bottom"
      :style="{ height: '58%' }"
      round
      teleport="body"
      :close-on-click-overlay="!saving"
    >
      <div class="edit-sheet">
        <van-nav-bar
          :title="sheetTitle"
          :left-text="saving ? '' : '取消'"
          :left-arrow="false"
          :border="false"
          @click-left="closeSheet"
        >
          <template #right>
            <span class="save-btn" :class="{ 'is-disabled': saving }" @click="onSave">
              {{ saving ? '保存中…' : '保存' }}
            </span>
          </template>
        </van-nav-bar>

        <div class="edit-body">
          <div class="field">
            <label class="field-label">名称</label>
            <div class="name-row">
              <input
                v-model="formName"
                type="text"
                class="name-input"
                :class="{ 'has-error': !!formError }"
                maxlength="10"
                placeholder="例如：阅读"
                :disabled="saving"
                @input="formError = ''"
              >
            </div>
            <p v-if="formError" class="field-error">{{ formError }}</p>
          </div>

          <div class="field">
            <label class="field-label">图标</label>
            <button type="button" class="icon-row" :disabled="saving" @click="iconPickerShow = true">
              <IconBox :name="formIconResolved" :tint="formTintResolved" :size="32" />
              <span class="icon-name">{{ pickerIcon || '未选择' }}</span>
              <span class="icon-action">更换 ›</span>
            </button>
          </div>

          <div class="field">
            <label class="field-label">颜色</label>
            <div class="tints">
              <button
                v-for="t in TINT_NAMES"
                :key="t"
                type="button"
                class="tint"
                :class="{ 'is-on': formTintResolved === t }"
                :style="{ background: tintSwatch(t) }"
                :aria-label="t"
                :disabled="saving"
                @click="pickTint(t)"
              />
            </div>
          </div>
        </div>

        <div class="edit-foot">
          <button
            v-if="editingNode"
            type="button"
            class="btn-del"
            :disabled="saving"
            @click="editingNode && onDelete(editingNode)"
          >删除</button>
          <button type="button" class="btn-save" :disabled="saving" @click="onSave">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </van-popup>

    <!-- ⚠️ 嵌套图标选择器（自身 teleport="body"） -->
    <IconPicker
      v-model:show="iconPickerShow"
      :model-value="pickerIcon"
      @select="onIconPicked"
    />
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

/* ==================== 分段控件（照抄 finance-categories） ==================== */
.scope-seg {
  display: flex;
  gap: 6px;
  padding: 3px;
  margin-bottom: var(--space-3);
  background: var(--color-bg-hover);
  border-radius: var(--radius-lg);
}
.scope-btn {
  flex: 1;
  padding: 8px 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  &.is-on {
    background: var(--color-bg-card);
    color: var(--color-primary);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
}

/* ==================== 分类列表 ==================== */
.cat-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.cat-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  /* 行高 52px（管理场景，与收支分类页一致） */
  min-height: 52px;
  padding: 8px var(--space-4);
  border: 0;
  background: transparent;
  text-align: left;

  & + .cat-row { border-top: 1px solid var(--color-border-light); }
  &:active { background: var(--color-bg-hover); }
}
.cat-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-count {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

.page-hint {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

.add-child {
  width: 100%;
  height: 42px;
  margin-top: var(--space-3);
  border: 1.5px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-primary);
  font-size: var(--fs-body-sm);
  font-weight: 500;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-primary-light); }
}

/* ==================== 编辑浮层 ==================== */
.edit-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}
:deep(.van-nav-bar) {
  flex-shrink: 0;
  background: var(--color-bg-card);
}
:deep(.van-nav-bar__title) {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
:deep(.van-nav-bar__text) {
  color: var(--color-text-secondary);
  font-size: var(--fs-body);
}
.save-btn {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-primary);
  padding: 4px 8px;
  &.is-disabled { color: var(--color-text-disabled); }
}

.edit-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4) var(--space-4) 0;
}
.field { margin-bottom: var(--space-4); }
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}
.field-error {
  margin: 6px 0 0;
  font-size: var(--fs-micro);
  color: var(--color-danger);
}
.name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.name-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0 12px;
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  outline: none;
  &::placeholder { color: var(--color-text-disabled); }
  &:focus { border-color: var(--color-primary); }
  &.has-error { border-color: var(--color-danger); }
}
.icon-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  text-align: left;
  &:active { background: var(--color-bg-hover); }
  &:disabled { opacity: 0.5; }
}
.icon-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-action {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
}
.tints {
  display: flex;
  gap: 14px;
  padding: 4px 2px;
}
.tint {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: 0 0 0 1px var(--color-border-light);
  -webkit-tap-highlight-color: transparent;
  &.is-on {
    border-color: var(--color-bg-card);
    box-shadow: 0 0 0 2px var(--color-text-primary);
  }
}

.edit-foot {
  flex-shrink: 0;
  display: flex;
  gap: 10px;
  padding: var(--space-3) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  background: var(--color-bg-card);
  border-top: 1px solid var(--color-border-light);
}
.btn-del {
  flex: 0 0 96px;
  height: 46px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-danger-light);
  color: var(--color-danger-dark);
  font-size: var(--fs-body);
  font-weight: 600;
  &:active:not(:disabled) { opacity: 0.85; }
  &:disabled { opacity: 0.5; }
}
.btn-save {
  flex: 1;
  height: 46px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  box-shadow: var(--shadow-button);
  &:active:not(:disabled) { background: var(--color-primary-dark); }
  &:disabled { background: var(--color-bg-hover); color: var(--color-text-disabled); box-shadow: none; }
}
</style>
