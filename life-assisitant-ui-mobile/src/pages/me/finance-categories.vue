<script setup lang="ts">
/**
 * 收支分类管理页（移动端 · 2026-09-21 分类体系）
 *
 * 设计：md/spec-20260921-v1/05-交互与页面设计.md §2
 * 入口：「我的 → 偏好 → 收支分类」（pages/me/index.vue）
 *
 * 结构：
 *   一级列表（支出 / 收入分段）→ 点击进入「二级管理」
 *   二级管理：首行「大类本身」→ **点击即编辑大类**（原先是右上角一个「编辑」按钮，
 *             260921 并入本行点击）；二级每行带图标（图标取二级自身、颜色继承大类）
 *   编辑浮层（新建 / 修改共用）：名称 / 图标 / 颜色 / 删除 / 保存
 *
 * ⚠️ 布局铁律（05 §5）：骨架沿用 `sub-page / sub-header / sub-body`，
 *    页面根**不写 height**（由 subpage.scss 的 .sub-page 负责），.sub-body 是唯一滚动容器。
 * ⚠️ 所有 van-popup 必须 `teleport="body"`（含嵌套的图标选择器）。
 * ⚠️ 长按快捷菜单：移动端用长按（行尾 ⋮ 是桌面端的行为）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import IconBox from '@/components/IconBox.vue'
import IconPicker from '@/components/finance/IconPicker.vue'
import { MENU_ACTIONS } from '@/constants/finance'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { TINT_NAMES, getTint, type TintName } from '@/utils/tint'
import type { IconName } from '@/components/icon/names'
import type { FinanceCategory, FinanceCategoryScope } from '@/api/types'

const router = useRouter()
const catStore = useFinanceCategoryStore()

// ==================== 视图状态 ====================
const scope = ref<FinanceCategoryScope>('expense')
/** 一级列表 / 二级管理 */
const view = ref<'roots' | 'children'>('roots')
/** 二级管理当前的一级 */
const activeRoot = ref<FinanceCategory | null>(null)

const roots = computed(() => catStore.rootsOf(scope.value))
const children = computed(() => activeRoot.value?.children ?? [])

/**
 * 二级图标的颜色：**继承大类**，不给二级单独配色（否则列表变调色板）。
 * 与选择器宫格的 `childCells` 完全同一套口径。
 */
const childTint = computed<TintName>(() =>
  activeRoot.value ? styleOf(activeRoot.value).tint : 'neutral'
)

const SCOPES: ReadonlyArray<{ value: FinanceCategoryScope; label: string }> = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
]

onMounted(() => {
  // SWR：先拿缓存渲染（改了分类后本地树也已是新的），再后台静默对一次服务端
  void catStore.ensureFresh()
})

function onScope(v: FinanceCategoryScope): void {
  if (v === scope.value) return
  scope.value = v
  view.value = 'roots'
  activeRoot.value = null
}

function openChildren(root: FinanceCategory): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  activeRoot.value = root
  view.value = 'children'
}

function onBack(): void {
  if (view.value === 'children') {
    view.value = 'roots'
    activeRoot.value = null
    return
  }
  router.back()
}

function styleOf(node: FinanceCategory) {
  return catStore.styleOf(node)
}

/**
 * 分类变更（update/create）后 store 会重拉整棵树（对象被替换），
 * 这里把 activeRoot 重新指向新树里的同一节点，否则二级列表会停在旧快照。
 */
function syncActiveRoot(): void {
  if (!activeRoot.value) return
  activeRoot.value = catStore.byId(activeRoot.value.id) ?? null
}

// ==================== 长按快捷菜单 ====================
const menuShow = ref(false)
const menuTarget = ref<FinanceCategory | null>(null)
let pressTimer: ReturnType<typeof setTimeout> | null = null
let suppressClick = false

function startPress(node: FinanceCategory): void {
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

function onMenuSelect(action: { name: string }): void {
  menuShow.value = false
  const node = menuTarget.value
  menuTarget.value = null
  if (!node) return
  if (action.name === '编辑') openEdit(node)
  else if (action.name === '删除') void onDelete(node)
}

// 菜单关闭（选中 / 取消 / 点遮罩）后一律放掉 click 抑制，
// 否则下一次点击会被误吞。
watch(menuShow, (v) => {
  if (!v) {
    menuTarget.value = null
    suppressClick = false
  }
})

// ==================== 编辑浮层 ====================
const sheetShow = ref(false)
/** 正在编辑的节点（null = 新建） */
const editingNode = ref<FinanceCategory | null>(null)
/** 新建时的父级（null = 新建一级） */
const editingParent = ref<FinanceCategory | null>(null)

const formName = ref('')
const formIcon = ref<string | null>(null)
const formTint = ref<string | null>(null)
const formError = ref('')
const saving = ref(false)
const iconPickerShow = ref(false)

/** 二级编辑时不可改的父级前缀（「餐饮-」） */
const namePrefix = computed(() =>
  editingNode.value?.parent_id ? `${editingParent.value?.name ?? ''}-` : ''
)

const formIconResolved = computed<IconName>(() => {
  if (formIcon.value) return formIcon.value as IconName
  if (editingParent.value?.icon) return editingParent.value.icon as IconName
  if (editingNode.value?.parent_id) return styleOf(activeRoot.value ?? editingNode.value).icon
  return 'Package'
})
const formTintResolved = computed<TintName>(() => {
  if (formTint.value) return formTint.value as TintName
  if (editingParent.value?.tint) return editingParent.value.tint as TintName
  if (editingNode.value?.parent_id && activeRoot.value) return styleOf(activeRoot.value).tint
  return 'neutral'
})

const sheetTitle = computed(() => (editingNode.value ? '编辑分类' : '新建分类'))

function openCreateRoot(): void {
  editingNode.value = null
  editingParent.value = null
  formName.value = ''
  formIcon.value = null
  formTint.value = null
  formError.value = ''
  sheetShow.value = true
}

function openCreateChild(): void {
  if (!activeRoot.value) return
  editingNode.value = null
  editingParent.value = activeRoot.value
  formName.value = ''
  formIcon.value = null
  formTint.value = null
  formError.value = ''
  sheetShow.value = true
}

function openEdit(node: FinanceCategory): void {
  editingNode.value = node
  if (node.parent_id) {
    editingParent.value = roots.value.find((r) => r.id === node.parent_id) ?? activeRoot.value
  } else {
    editingParent.value = null
  }
  formName.value = node.name
  formIcon.value = node.icon
  formTint.value = node.tint
  formError.value = ''
  sheetShow.value = true
}

function closeSheet(): void {
  if (saving.value) return
  sheetShow.value = false
}

function onIconPicked(name: IconName): void {
  formIcon.value = name
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
  // 同级重名（后端 400002 也会拦，这里行内提示）
  const siblings = editingParent.value ? (editingParent.value.children ?? []) : roots.value
  if (siblings.some((s) => s.name === name && s.id !== editingNode.value?.id)) {
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
        syncActiveRoot()
      }
      return
    }
    const item = await catStore.create({
      parent_id: editingParent.value?.id ?? '',
      scope: scope.value,
      name,
      icon: formIcon.value,
      tint: formTint.value,
      emoji: null,
    })
    if (item) {
      sheetShow.value = false
      syncActiveRoot()
    }
  } finally {
    saving.value = false
  }
}

async function onDelete(node: FinanceCategory): Promise<void> {
  const isRoot = !node.parent_id
  const count = node.children?.length ?? 0
  const message = isRoot && count > 0
    ? `「${node.name}」下有 ${count} 个子分类，会一起移除。历史记录会保留，只是以后不再出现在选择器里。`
    : `删除「${node.name}」后，历史记录会保留，只是以后不再出现在选择器里。`
  try {
    await showConfirmDialog({
      title: '删除分类',
      message,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  const ok = await catStore.remove(node.id)
  if (ok) {
    if (editingNode.value?.id === node.id) sheetShow.value = false
    if (activeRoot.value?.id === node.id) {
      activeRoot.value = null
      view.value = 'roots'
    }
  }
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="onBack">‹</button>
      <h1 class="sub-title">{{ view === 'children' ? (activeRoot?.name ?? '分类') : '收支分类' }}</h1>
      <!--
        右上角只有「＋」：二级视图**没有**独立的「编辑」按钮 ——
        编辑大类已并入「大类本身」那一行的点击（见下方 .cat-row.is-self），
        少一个需要先找按钮再点的步骤。
      -->
      <button
        v-if="view === 'roots'"
        class="sub-right"
        type="button"
        @click="openCreateRoot"
      >＋</button>
    </header>

    <main class="sub-body">
      <!-- ==================== 一级列表 ==================== -->
      <template v-if="view === 'roots'">
        <!-- 分段控件（两棵树） -->
        <div class="scope-seg">
          <button
            v-for="s in SCOPES"
            :key="s.value"
            type="button"
            class="scope-btn"
            :class="{ 'is-on': scope === s.value }"
            @click="onScope(s.value)"
          >
            {{ s.label }}
          </button>
        </div>

        <div v-if="catStore.loading && roots.length === 0" class="skeleton" />

        <div v-else-if="roots.length === 0" class="state-empty">
          <Icon name="Package" :size="34" class="state-icon" />
          <p class="state-text">还没有分类，点右上角 ＋ 新建一个</p>
        </div>

        <div v-else class="cat-card">
          <button
            v-for="root in roots"
            :key="root.id"
            type="button"
            class="cat-row"
            @click="openChildren(root)"
            @touchstart.passive="startPress(root)"
            @touchend="cancelPress"
            @touchmove.passive="cancelPress"
            @touchcancel="cancelPress"
          >
            <IconBox :name="styleOf(root).icon" :tint="styleOf(root).tint" :size="32" />
            <span class="cat-name">{{ root.name }}</span>
            <span class="cat-count">{{ (root.children ?? []).length }} 个</span>
            <Icon name="ChevronRight" :size="16" class="cat-arrow" />
          </button>
        </div>

        <p class="page-hint">长按分类可编辑或删除。新建的分类排在最后。</p>
      </template>

      <!-- ==================== 二级管理 ==================== -->
      <template v-else>
        <div v-if="activeRoot" class="cat-card">
          <!-- 大类本身（选择器的首项）：**点击整行 = 打开编辑浮层**。
               原先是右上角一个「编辑」按钮，260921 并入本行点击；
               行尾的 › 就是这个可点状态的提示（原来是占位的「——」）。 -->
          <button
            type="button"
            class="cat-row is-self"
            @click="openEdit(activeRoot)"
          >
            <IconBox :name="styleOf(activeRoot).icon" :tint="styleOf(activeRoot).tint" :size="32" />
            <span class="cat-name">
              {{ activeRoot.name }}
              <span class="cat-self-tag">（大类本身）</span>
            </span>
            <Icon name="ChevronRight" :size="16" class="cat-arrow" />
          </button>

          <button
            v-for="child in children"
            :key="child.id"
            type="button"
            class="cat-row"
            @click="openEdit(child)"
          >
            <!-- 二级自带图标（没配的向上继承大类），颜色继承大类 ——
                 与选择器宫格（CategoryPicker 的 childCells）同一套口径 -->
            <IconBox :name="styleOf(child).icon" :tint="childTint" :size="28" />
            <span class="cat-name">{{ child.name }}</span>
            <span class="cat-more" aria-hidden="true">⋮</span>
          </button>

          <div v-if="children.length === 0" class="cat-child-empty">
            还没有二级分类，点下方新建
          </div>
        </div>

        <button type="button" class="add-child" @click="openCreateChild">＋ 新建二级分类</button>
      </template>
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

    <!-- ==================== 编辑 / 新建浮层 ==================== -->
    <!-- ⚠️ teleport="body" 必留 -->
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
              <span v-if="namePrefix" class="name-prefix">{{ namePrefix }}</span>
              <input
                v-model="formName"
                type="text"
                class="name-input"
                :class="{ 'has-error': !!formError }"
                maxlength="10"
                placeholder="例如：三餐"
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
              <span class="icon-name">{{ formIconResolved }}</span>
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
      :model-value="formIcon"
      @select="onIconPicked"
    />
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

/* ==================== 分段控件 ==================== */
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
  /* 行高 52px（管理场景，不是高频操作，比选择器 44px 略高） */
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
.cat-arrow {
  flex-shrink: 0;
  color: var(--color-text-disabled);
}
.cat-self-tag {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
.cat-more {
  flex-shrink: 0;
  width: 20px;
  text-align: right;
  font-size: var(--fs-h3);
  line-height: 1;
  color: var(--color-text-tertiary);
}
.cat-child-empty {
  padding: 16px var(--space-4);
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
.name-prefix {
  flex-shrink: 0;
  font-size: var(--fs-body);
  color: var(--color-text-tertiary);
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
