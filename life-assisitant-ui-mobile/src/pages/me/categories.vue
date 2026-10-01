<script setup lang="ts">
/**
 * 分类管理页 —— 习惯 / 待办（移动端 · spec-20260924-v1/04 §2 · R4）
 *
 * 形态**照抄** `me/finance-categories.vue`（行高 / 长按菜单 / 编辑浮层 /
 * 确认弹窗同一份规范），差异只在「树形 + 按 domain 单域展示」两点。
 *
 * ================= 260924 R4 改动（本页 v1 → v2） =================
 *   1. **删掉页内「习惯 / 待办」分段控件**（04 §1 用户反馈）。
 *      domain 改由 `?domain=` **只读**决定：待办入口进来只有待办分类，
 *      习惯入口进来只有习惯分类。⚠️ 不做页内切换 = 不给 domain 写入路径。
 *   2. 列表从「一级平铺」升级为**可展开的两级**（依赖 R3 后端 `parent_id`）：
 *      一级行右侧 `ChevronRight`，展开后跟一排缩进二级行。
 *   3. 二级支持增删改；一级行另给一个「＋ 添加二级」。
 *   4. 页面标题随 domain 变「习惯分类管理 / 待办分类管理」。
 *      ⚠️ 本页是**顶层路由**（不在 HomeLayout 里，不走 usePageChrome），
 *        标题就是下面 `.sub-title` 那一个 <h1>，直接动态化即可 ——
 *        比在 router meta / uiStore 上另开一层覆盖小得多。
 *        （router 里 meta.title 仍是静态「分类管理」，那只影响 document.title；
 *          ⚠️ 若要求 document.title 也分域，需改 router 守卫，本页管不到。）
 *
 * 入口：「我的 → 偏好 → 习惯/待办 分类管理」+ 选择器的「管理 ›」
 *      （带 ?domain=<habit|task> 预选）。
 *
 * ⚠️ 布局铁律：sub-page / sub-header / sub-body 骨架，页面根不写 height；
 * ⚠️ 所有 van-popup 必须 teleport="body"（含嵌套图标选择器）；
 * ⚠️ 移动端行操作 = 长按（行尾 ⋮ 是桌面端行为）；
 * ⚠️ @contextmenu 一律 prevent —— 桌面浏览器右键 / 安卓长按会弹出系统菜单，
 *    盖住我们自己的操作面板（finance-categories 踩过）。
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
/**
 * 域：只读 `?domain=`（R4 §2）。非法 / 缺省 → habit（与旧 initialDomain 同一兜底）。
 * ⚠️ **没有 setter / 没有分段控件** —— 想切域就换入口重进（04 §2）。
 */
const domain = computed<UserCategoryDomain>(() => {
  const q = route.query.domain
  return q === 'task' || q === 'habit' ? q : 'habit'
})

/** 页面标题 / 空态文案随域变（04 §2） */
const domainLabel = computed(() => (domain.value === 'habit' ? '习惯' : '待办'))
const pageTitle = computed(() => `${domainLabel.value}分类管理`)

/** 一级列表（R3 树助手：只取 parent_id === ''），按 sort（store 内已保证） */
const roots = computed(() => catStore.listTopLevel(domain.value))

/** 一级 id → 其二级列表（一次遍历，避免模板里 N 次 filter；R3） */
const childrenMap = computed(() => catStore.childrenByParent(domain.value))

/** 展开的一级 id 集合（纯 UI 态，不落盘）—— 默认全收起 */
const expanded = ref<Set<string>>(new Set())

function isExpanded(id: string): boolean {
  return expanded.value.has(id)
}

/** 展开 / 收起。⚠️ 每次换新 Set —— 直接 mutate 集合不会触发 computed 重算 */
function toggleExpand(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

/** 一级是否**有**二级（决定 ChevronRight 是否出现；无二级 = 不可展开） */
function hasChildren(id: string): boolean {
  return (childrenMap.value.get(id)?.length ?? 0) > 0
}

const isEmptyLoading = computed(
  () => catStore.loading[domain.value] && roots.value.length === 0
)

onMounted(() => {
  // SWR：先拿缓存渲染，再后台静默对一次服务端。
  // ⚠️ 只拉本页这一个域 —— 04 §5「不再需要一次拉两个 domain」。
  void catStore.ensureFresh(domain.value)
})

// ⚠️ domain 是只读 computed（源自 route.query），正常不会变；但用户可能在
//    同一页面被 push 一个不同 domain 的 query（如从选择器「管理 ›」二次进入）。
//    这里 watch 兜底：换域就补拉该域 + 收起所有展开项。
watch(domain, (d) => {
  expanded.value = new Set()
  void catStore.ensureFresh(d)
})

/** 行的图标 / 颜色（store 已加载 ⇒ resolve 必命中；兜底走常量表口径） */
function styleOf(cat: UserCategory): { icon: IconName; tint: TintName } {
  const r = catStore.resolveCategory(cat.domain, cat.id)
  if (r) return { icon: r.icon, tint: r.tint }
  const ref = normalizeIconRef(cat.icon)
  const tint: TintName = cat.tint && (TINT_NAMES as readonly string[]).includes(cat.tint)
    ? (cat.tint as TintName)
    : ref?.tint ?? 'neutral'
  return { icon: ref?.icon ?? (cat.domain === 'habit' ? 'Pin' : 'CircleDashed'), tint }
}

/**
 * 二级颜色**继承父级**（与财务 `finance-categories.vue` 的 childTint 同一口径）：
 * 不给二级单独配色，否则列表变调色板。图标仍取二级自身。
 */
function childTintOf(parent: UserCategory): TintName {
  return styleOf(parent).tint
}

// ==================== 长按快捷菜单（照抄 finance-categories） ====================
// ⚠️ 一级 / 二级共用同一份菜单，只是 menuTarget 指向不同层级的节点。
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

/**
 * 行点击：
 *   - 一级 → 展开/收起（有二级时才响应；无二级点了不做事，避免误开编辑）
 *   - 二级 → 打开编辑浮层
 * ⚠️ 长按后紧跟的那次 click 要吞掉（suppressClick），否则长按=展开+弹菜单。
 */
function onRootClick(node: UserCategory): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (hasChildren(node.id)) toggleExpand(node.id)
}

function onChildClick(node: UserCategory): void {
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

// ==================== 编辑浮层（新建一级 / 新建二级 / 修改共用） ====================
const sheetShow = ref(false)
const editingNode = ref<UserCategory | null>(null)
/** 新建二级时的父（R4 §3.1「一级行另有添加二级」）；编辑态为 null */
const creatingParent = ref<UserCategory | null>(null)

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

const sheetTitle = computed(() => {
  if (editingNode.value) return '编辑分类'
  return creatingParent.value ? '新建二级分类' : '新建分类'
})

/** 新建一级（parent_id 空；spec 04 §3.1） */
function openCreate(): void {
  editingNode.value = null
  creatingParent.value = null
  formName.value = ''
  formIcon.value = null
  formTint.value = null
  formError.value = ''
  sheetShow.value = true
}

/** 新建二级（挂在某个一级下） */
function openCreateChild(parent: UserCategory): void {
  editingNode.value = null
  creatingParent.value = parent
  formName.value = ''
  // 二级图标默认继承父级（置空 → 渲染走 resolveCategory 的父级兜底）
  formIcon.value = null
  formTint.value = parent.tint || null
  formError.value = ''
  sheetShow.value = true
}

function openEdit(node: UserCategory): void {
  editingNode.value = node
  creatingParent.value = null
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

/**
 * 同层级重名检查（R3：唯一索引已含 parent_id ⇒ 「同域不同父下可同名」）。
 * 一级：比 roots；二级：比同一父下的 children。后端行内错误也会拦，这里是即时反馈。
 */
function isDuplicateName(name: string): boolean {
  if (editingNode.value) {
    // 编辑：同父下（含一级）排除自己后比对
    const parentId = editingNode.value.parent_id
    const peers = parentId ? (childrenMap.value.get(parentId) ?? []) : roots.value
    return peers.some((s) => s.name === name && s.id !== editingNode.value?.id)
  }
  if (creatingParent.value) {
    return (childrenMap.value.get(creatingParent.value.id) ?? []).some((s) => s.name === name)
  }
  return roots.value.some((s) => s.name === name)
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
  if (isDuplicateName(name)) {
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
    // R3：parent_id 非空 = 建二级（后端校验父存在 / 父是一级 / 同父不重名）
    const item = await catStore.create({
      domain: domain.value,
      parent_id: creatingParent.value?.id ?? '',
      name,
      icon: formIcon.value,
      tint: formTint.value,
      emoji: null,
    })
    if (item) {
      sheetShow.value = false
      // 新建的二级若看不见，多半是父级收起了 —— 顺手展开，省一次点击
      if (creatingParent.value) {
        const next = new Set(expanded.value)
        next.add(creatingParent.value.id)
        expanded.value = next
      }
      creatingParent.value = null
    }
  } finally {
    saving.value = false
  }
}

/**
 * 删除（R3-1：删一级时后端**级联软删**其二级）。
 * ⚠️ 一级有二级时文案必须显式提示级联 —— 用户以为只删了一行，实际连带删了一组。
 */
async function onDelete(node: UserCategory): Promise<void> {
  const kids = childrenMap.value.get(node.id)?.length ?? 0
  const extra = kids > 0 ? `它下面的 ${kids} 个二级分类也会一起删除。` : ''
  try {
    await showConfirmDialog({
      title: node.parent_id ? '删除二级分类' : '删除分类',
      message: `删除「${node.name}」后，历史记录会保留，只是以后不再出现在选择器里。${extra}`,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  const ok = await catStore.remove(node.id)
  if (ok) {
    // 删一级 → 本地也要把它的二级一起摘掉（后端已级联软删，本地不能留孤儿）
    if (kids > 0) {
      const next = new Set(expanded.value)
      next.delete(node.id)
      expanded.value = next
    }
    if (editingNode.value?.id === node.id) sheetShow.value = false
  }
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h1 class="sub-title">{{ pageTitle }}</h1>
    </header>

    <main class="sub-body">
      <div v-if="isEmptyLoading" class="skeleton" />

      <div v-else-if="roots.length === 0" class="state-empty">
        <Icon name="FolderOpen" :size="34" class="state-icon" />
        <p class="state-text">还没有{{ domainLabel }}分类，点下方新建一个</p>
      </div>

      <div v-else class="cat-card">
        <template v-for="root in roots" :key="root.id">
          <!-- 一级行：点击展开（无二级则点击无反应） -->
          <button
            type="button"
            class="cat-row"
            :class="{ 'is-open': isExpanded(root.id) }"
            @click="onRootClick(root)"
            @contextmenu.prevent
            @touchstart.passive="startPress(root)"
            @touchend="cancelPress"
            @touchmove.passive="cancelPress"
            @touchcancel="cancelPress"
          >
            <IconBox :name="styleOf(root).icon" :tint="styleOf(root).tint" :size="32" />
            <span class="cat-name">{{ root.name }}</span>
            <span v-if="root.is_builtin" class="cat-count">内置</span>
            <span v-if="hasChildren(root.id)" class="cat-kids">{{ childrenMap.get(root.id)?.length }}</span>
            <!-- R4 §3.1：有二级的一级右侧 ChevronRight；无二级留白占位（对齐行宽） -->
            <Icon
              v-if="hasChildren(root.id)"
              name="ChevronRight"
              :size="16"
              class="cat-chevron"
              :class="{ 'is-open': isExpanded(root.id) }"
            />
            <span v-else class="cat-chevron-placeholder" />
          </button>

          <!-- 二级子项（展开后）：缩进 + 长按菜单，点击进编辑 -->
          <template v-if="isExpanded(root.id) && hasChildren(root.id)">
            <button
              v-for="child in childrenMap.get(root.id)"
              :key="child.id"
              type="button"
              class="cat-row cat-row--child"
              @click="onChildClick(child)"
              @contextmenu.prevent
              @touchstart.passive="startPress(child)"
              @touchend="cancelPress"
              @touchmove.passive="cancelPress"
              @touchcancel="cancelPress"
            >
              <IconBox
                :name="styleOf(child).icon"
                :tint="childTintOf(root)"
                :size="28"
              />
              <span class="cat-name">{{ child.name }}</span>
              <span v-if="child.is_builtin" class="cat-count">内置</span>
            </button>

            <!-- 一级行专属：添加二级（R4 §3.1） -->
            <button type="button" class="cat-row cat-row--child cat-row--add" @click="openCreateChild(root)">
              <span class="add-plus">＋</span>
              <span class="cat-name is-add">添加二级分类</span>
            </button>
          </template>
        </template>
      </div>

      <p class="page-hint">
        长按分类可编辑或删除{{ roots.some((r) => hasChildren(r.id)) ? '；点有 ‹ 的一级可展开二级' : '' }}。
        新建的分类排在最后，历史数据不受改名影响。
      </p>

      <button type="button" class="add-child" @click="openCreate">＋ 新建{{ domainLabel }}分类</button>
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
          <!-- 新建二级时显示所属一级（只读，PATCH 不允许改 parent_id） -->
          <p v-if="creatingParent" class="parent-hint">属于「{{ creatingParent.name }}」</p>

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

/* ==================== 分类列表 ==================== */
/* 260924 R4：分段控件 / .scope-seg 整段删除（页内不再切域） */
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
  &.is-open { background: var(--color-bg-hover); }
}
/* 二级子项：缩进一格（图标 32 → 28，行高略矮），视觉上从属一级 */
.cat-row--child {
  padding-left: calc(var(--space-4) + 22px);
  min-height: 46px;
}
.cat-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.is-add { color: var(--color-primary); }
}
.cat-count {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
/* 二级数量角标（展开前就能看出「这个一级里有几个子项」） */
.cat-kids {
  flex-shrink: 0;
  min-width: 18px;
  padding: 1px 6px;
  border-radius: 9px;
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
  font-size: var(--fs-micro);
  text-align: center;
}
.cat-chevron {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform var(--duration-fast) var(--ease-default);
  &.is-open { transform: rotate(90deg); }
}
/* 无二级时占位：保证「有 ChevronRight 的行」与「没有的行」右侧对齐 */
.cat-chevron-placeholder {
  flex-shrink: 0;
  width: 16px;
}
.cat-row--add {
  &:active { background: var(--color-primary-light); }
}
.add-plus {
  flex-shrink: 0;
  width: 28px;
  text-align: center;
  color: var(--color-primary);
  font-size: var(--fs-body);
  line-height: 1;
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

/* 新建二级时的「属于 …」提示（R4） */
.parent-hint {
  margin: 0 0 var(--space-4);
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: var(--color-primary-light);
  color: var(--color-primary-dark);
  font-size: var(--fs-caption-sm);
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
