<script setup lang="ts">
/**
 * CategoryPicker —— 分类选择器（移动端 · 260921 三轮定稿）
 *
 * 规格：md/spec-20260921-v1/05-交互与页面设计.md §1（核心）／§2.6（选择器内增删）
 *
 * ⚠️【形式 · 260921 三轮】与一版的差别只有一处：
 *    ① **一级宫格从弹窗里搬出来，内联常驻在记账表单的「类别」区块里**（平铺，永不消失）；
 *    ② **弹窗只保留二级**（`stage` 由 `root ⇄ child ⇄ create` 收为 **`child ⇄ create`**），
 *       而且**只在点「有二级」的一级时才打开**。
 *    代价对比：二级放进弹层后，点开二级**不再把下面的「账户 / 备注 / 日期」推走**（05 §1.1）。
 *
 * 四条铁律语义：
 *   1. **一级常驻可见** —— 打开记账就能看到全部大类，不用"点开才能看见"；
 *   2. **点「有二级」的一级 → 弹二级弹窗、不立即选中**；**点「无二级」的一级 → 直接选中、不弹空弹窗**；
 *   3. **二级列表首项 = 一级本身** —— 「只想记大类」的用户点一下即可（标注「只记大类」）；
 *   4. **选中后立即回填并关闭，不弹 toast** —— 高频操作弹 toast 会烦（05 §7.3）；
 *      弹窗内新建分类 → 保存后**自动选中并关闭**（05 §1.5）。
 *
 * ⚠️ **选择器自身只占一层 `van-popup`**：内部用 `stage` 在 `child` ⇄ `create` 间切换，
 *    绝不叠第二个分类弹窗。`IconPicker` / 长按操作菜单是既有的独立浮层（各自 `teleport="body"`），不算叠层。
 *
 * ⚠️ 选择器内也能增删（05 §2.6）：**长按一级格子 / 长按二级项（500ms）** → 「编辑 / 删除」菜单。
 *    长按手势**必须走 `composables/useLongPress.ts`**，**绝不要用 `@contextmenu`**
 *    （移动端浏览器长按不派发该事件，真机上等于没有入口 —— 该文件头记着的既有教训）。
 *    菜单与 `pages/me/finance-categories.vue` **复用同一份 `MENU_ACTIONS`**（`constants/finance.ts`）。
 *
 * 切换动效 ≤ 200ms 且有方向感：进表单 = 右入，返回 = 左出（05 §7.2）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import IconBox from '@/components/IconBox.vue'
import IconPicker from '@/components/finance/IconPicker.vue'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { MENU_ACTIONS } from '@/constants/finance'
import { TINT_NAMES, getTint, type TintName } from '@/utils/tint'
import { useLongPress } from '@/composables/useLongPress'
import type { IconName } from '@/components/icon/names'
import type { FinanceCategory, FinanceCategoryScope } from '@/api/types'

interface Props {
  /** 当前记账方向对应的分类树 */
  scope: FinanceCategoryScope
  /** 已选分类 id */
  modelValue?: string | null
  /**
   * 仅一级模式（预算用）：点一级**直接选中**，**永不弹出二级弹窗**（预算必须挂在一级分类上）。
   * 语义与「无二级的一级」一致 ⇒ 此时一级格子**也不显示 `›` 标记**（标记与行为一致）。
   */
  rootOnly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  rootOnly: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'select', v: FinanceCategory): void
}>()

const router = useRouter()
const route = useRoute()
const catStore = useFinanceCategoryStore()

// ==================== 视图状态 ====================
/** ⚠️ 三级已收敛为两态：一级宫格内联在组件根，弹窗里只可能是「二级列表」或「表单」 */
type Stage = 'child' | 'create'
const stage = ref<Stage>('child')
/** 二级弹窗显隐（只由「点有二级的一级」、新建、编辑触发） */
const popupShow = ref(false)
/** 二级弹窗当前的一级 */
const activeRoot = ref<FinanceCategory | null>(null)
/** 表单的父级（null = 操作一级） */
const createParent = ref<FinanceCategory | null>(null)
/** 正在编辑的节点（null = 新建） */
const editingNode = ref<FinanceCategory | null>(null)
/** 动效方向 */
const direction = ref<'forward' | 'back'>('forward')

const transitionName = computed(() => (direction.value === 'forward' ? 'cp-fwd' : 'cp-back'))

const roots = computed(() => catStore.rootsOf(props.scope))

/** 一级格子（带解析后的图标 / 色） */
const rootCells = computed(() =>
  roots.value.map((node) => ({ node, style: catStore.styleOf(node) }))
)

/** 二级弹窗首项（一级本身）的渲染信息 */
const activeRootStyle = computed(() => (activeRoot.value ? catStore.styleOf(activeRoot.value) : null))

/**
 * 二级格子：带图标（05 §1.4）。
 * - 图标取值 `二级.icon ?? 父级.icon` —— 走 `styleOf` 的向上继承（含失联降级）兜底**必须保留**；
 * - ⚠️ 颜色仍**继承父级 tint**（不给二级单独配色，否则宫格变调色板）。
 */
const childCells = computed(() => {
  const root = activeRoot.value
  if (!root) return []
  const parentTint = (activeRootStyle.value?.tint ?? 'neutral') as TintName
  return (root.children ?? []).map((node) => ({
    node,
    icon: catStore.styleOf(node).icon,
    tint: parentTint,
  }))
})

/** 该一级是否可展开二级（⚠️ 以未删除的子分类数为准，删光后 `›` 自动消失，05 §1.2.1） */
function hasChildren(node: FinanceCategory): boolean {
  return (node.children ?? []).length > 0
}

/** 一级高亮：本身被选中，或其任一二级被选中（05 §1.3） */
function isRootActive(root: FinanceCategory): boolean {
  if (props.modelValue === root.id) return true
  return (root.children ?? []).some((c) => c.id === props.modelValue)
}

const headerTitle = computed(() => {
  // child 态标题 = 该一级名（⚠️ 已删掉无用的「选择分类」标题 —— root 态不复存在）
  if (stage.value === 'child') return activeRoot.value?.name ?? ''
  return editingNode.value ? '编辑分类' : '新建分类'
})

// ==================== 生命周期：挂载即加载 + 切换方向重置 ====================
onMounted(() => {
  void ensureLoaded()
})

// 记账方向切换（支出 ⇄ 收入）：清状态 + 补拉另一棵树
watch(
  () => props.scope,
  () => {
    activeRoot.value = null
    createParent.value = null
    editingNode.value = null
    stage.value = 'child'
    popupShow.value = false
    void ensureLoaded()
  }
)

/**
 * SWR：有缓存就**立即返回**（下面直接用旧分类渲染），后台静默刷新；
 * 只有真·冷启动（无缓存）才 await 一次全量。
 *
 * ⚠️ 不要再传 `props.scope` —— 按 scope 请求只会拿到一侧，另一侧留空，
 *    切到另一侧又得等（这正是「切换支出/收入时弹『正在准备默认分类…』」的成因）。
 */
async function ensureLoaded(): Promise<void> {
  await catStore.ensureFresh()
}

// ==================== 选中 / 导航 ====================
function selectNode(node: FinanceCategory): void {
  emit('update:modelValue', node.id)
  emit('select', node)
  popupShow.value = false
}

/**
 * 点一级：
 * - `rootOnly` / **无二级** → 直接选中（不弹只有一项的空弹窗）；
 * - **有二级** → 打开二级弹窗（⚠️ **不立即选中**，三轮关键行为）。
 * ⚠️ 长按弹出菜单后紧随的 click 必须丢弃 —— 否则长按会顺带改掉选中值（手势冲突）。
 */
function onRootClick(root: FinanceCategory): void {
  if (lp.consumeClick()) return
  if (props.rootOnly || !hasChildren(root)) {
    selectNode(root)
    return
  }
  direction.value = 'forward'
  activeRoot.value = root
  stage.value = 'child'
  popupShow.value = true
}

/** 二级弹窗：点「一级本身」（只记大类） */
function onSelfClick(root: FinanceCategory): void {
  if (lp.consumeClick()) return
  selectNode(root)
}

/** 二级弹窗：点某一项二级 */
function onChildClick(node: FinanceCategory): void {
  if (lp.consumeClick()) return
  selectNode(node)
}

/** 表单「‹ 返回」：从二级进来的 → 回二级列表；从一级入口进来的 → 直接关闭 */
function onBack(): void {
  direction.value = 'back'
  if (createParent.value) {
    stage.value = 'child'
    return
  }
  popupShow.value = false
}

// ==================== 长按 → 操作菜单（编辑 / 删除）====================
const pendingNode = ref<FinanceCategory | null>(null)
const menuShow = ref(false)
const menuTarget = ref<FinanceCategory | null>(null)

const lp = useLongPress(() => {
  const node = pendingNode.value
  if (!node) return
  menuTarget.value = node
  menuShow.value = true
})

/** 所有可长按的格子共用同一个长按实例，回调靠 `pendingNode` 取目标 */
function onCellTouchStart(node: FinanceCategory, e: TouchEvent): void {
  pendingNode.value = node
  lp.handlers.onTouchstart(e)
}

watch(menuShow, (v) => {
  if (!v) {
    menuTarget.value = null
    pendingNode.value = null
  }
})

function onMenuSelect(action: { name: string }): void {
  menuShow.value = false
  const node = menuTarget.value
  menuTarget.value = null
  if (!node) return
  if (action.name === '编辑') openEdit(node)
  else if (action.name === '删除') void onDelete(node)
}

async function onDelete(node: FinanceCategory): Promise<void> {
  const isRoot = !node.parent_id
  const count = node.children?.length ?? 0
  // ⚠️ 文案必须说明「历史记录会保留」（05 §2.4 / §2.7）；删一级额外带子分类数量
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
  if (!ok) return
  // 删掉的正是当前二级弹窗的一级 → 关掉弹窗；否则把 activeRoot 指回新树里的同一节点
  if (activeRoot.value?.id === node.id) {
    activeRoot.value = null
    stage.value = 'child'
    popupShow.value = false
    return
  }
  syncActive()
}

/**
 * 分类变更后 store 可能重拉整棵树（对象被替换），
 * 这里把 activeRoot 重新指向新树里的同一节点，否则二级列表会停在旧快照。
 */
function syncActive(): void {
  if (!activeRoot.value) return
  const fresh = catStore.byId(activeRoot.value.id)
  activeRoot.value = fresh ?? null
  if (!fresh) {
    stage.value = 'child'
    popupShow.value = false
  }
}

// ==================== 跳管理页 ====================
/**
 * 「管理 ›」。
 *
 * ⚠️ 首选记录模块的**覆盖层**子路由 `/record/finance-categories`（不是顶层
 *    `/me/finance-categories`）：覆盖层不会卸载记录页，所以返回 —— 无论是点
 *    「‹ 返回」还是 iOS 左滑 —— 时「记一笔」浮层与已填内容原样还在，
 *    页面也不会重建重播动画（原先 push 顶层路由的写法两者都会丢）。
 *
 * 兜底：选择器若将来被用在记录模块之外（那时没有宿主要保留），
 *      回落到普通的二级页。
 */
function goManage(): void {
  const inRecordModule = route.matched.some((r) => r.name === 'Record')
  void router.push(inRecordModule ? { name: 'RecordFinanceCategories' } : '/me/finance-categories')
}

// ==================== 新建 / 编辑表单 ====================
const formName = ref('')
const formIcon = ref<string | null>(null)
const formTint = ref<string | null>(null)
const formError = ref('')
const saving = ref(false)
const iconPickerShow = ref(false)

/** 图标默认值：二级继承父级；一级默认 Package */
const formIconResolved = computed<IconName>(() => {
  if (formIcon.value) return formIcon.value as IconName
  if (createParent.value?.icon) return createParent.value.icon as IconName
  return 'Package'
})
/** 颜色默认值：二级继承父级；一级默认 neutral */
const formTintResolved = computed<TintName>(() => {
  if (formTint.value) return formTint.value as TintName
  if (createParent.value?.tint) return createParent.value.tint as TintName
  return 'neutral'
})

/** 新建（父级为空 = 一级；父级非空 = 该一级的二级） */
function openCreate(parent: FinanceCategory | null): void {
  editingNode.value = null
  createParent.value = parent
  formName.value = ''
  formIcon.value = null
  formTint.value = null
  formError.value = ''
  direction.value = 'forward'
  stage.value = 'create'
  popupShow.value = true
}

/** 编辑（长按 → 编辑）：预填该分类 */
function openEdit(node: FinanceCategory): void {
  editingNode.value = node
  createParent.value = node.parent_id
    ? (catStore.byId(node.parent_id) ?? activeRoot.value)
    : null
  formName.value = node.name
  formIcon.value = node.icon
  formTint.value = node.tint
  formError.value = ''
  direction.value = 'forward'
  stage.value = 'create'
  popupShow.value = true
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
  // 同级重名（后端 400002 也会拦，这里走**行内报错**而非 toast，05 §1.5）
  const siblings = createParent.value ? (createParent.value.children ?? []) : roots.value
  if (siblings.some((s) => s.name === name && s.id !== editingNode.value?.id)) {
    formError.value = '该名称已存在'
    return
  }

  saving.value = true
  try {
    if (editingNode.value) {
      const wasChild = !!editingNode.value.parent_id
      const ok = await catStore.update(editingNode.value.id, {
        name,
        icon: formIcon.value,
        tint: formTint.value,
      })
      if (!ok) return
      editingNode.value = null
      syncActive()
      if (wasChild) {
        direction.value = 'back'
        stage.value = 'child'
      } else {
        popupShow.value = false
      }
      return
    }

    const item = await catStore.create({
      parent_id: createParent.value?.id ?? '',
      scope: props.scope,
      name,
      icon: formIcon.value,
      tint: formTint.value,
      emoji: null,
    })
    // 保存后**直接选中该新分类并关闭**（不让用户再点一次）
    if (item) {
      syncActive()
      selectNode(item)
    }
  } finally {
    saving.value = false
  }
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
</script>

<template>
  <div class="cat-picker-inline">
    <!-- ==================== 一级宫格（内联常驻，永不消失）==================== -->
    <!--
      只有**真·冷启动 + 无缓存**才会走到这里：有缓存时 `ensureFresh()` 不置
      `loading`，直接拿缓存的分类渲染，同时后台静默刷新（260921）。
    -->
    <div v-if="catStore.loading && roots.length === 0" class="cp-loading">加载分类…</div>

    <template v-else-if="roots.length === 0">
      <div class="cp-empty">
        <Icon name="Package" :size="32" class="cp-empty-icon" aria-hidden="true" />
        <p class="cp-empty-text">还没有分类，先新建一个吧</p>
      </div>
      <div class="cp-actions">
        <button type="button" class="cp-add-link" @click="openCreate(null)">＋ 新建分类</button>
      </div>
    </template>

    <template v-else>
      <div class="cp-grid cp-grid--root">
        <button
          v-for="cell in rootCells"
          :key="cell.node.id"
          type="button"
          class="cp-cell"
          :class="{ 'is-active': isRootActive(cell.node) }"
          @click="onRootClick(cell.node)"
          @touchstart="onCellTouchStart(cell.node, $event)"
          @touchmove="lp.handlers.onTouchmove"
          @touchend="lp.handlers.onTouchend"
          @touchcancel="lp.handlers.onTouchcancel"
          @contextmenu="lp.handlers.onContextmenu"
        >
          <IconBox :name="cell.style.icon" :tint="cell.style.tint" :size="32" />
          <span class="cp-cell-name-row">
            <span class="cp-cell-name">{{ cell.node.name }}</span>
            <!-- ⚠️ `›` 标记：判断依据是「未删除的子分类数 > 0」，不用数字（05 §1.2.1） -->
            <Icon
              v-if="!rootOnly && hasChildren(cell.node)"
              name="ChevronRight"
              :size="12"
              class="cp-cell-chev"
              aria-hidden="true"
            />
          </span>
        </button>
      </div>

      <!-- 动作行：左 = 加一个；右 = 进分类管理页 -->
      <div class="cp-actions">
        <button type="button" class="cp-add-link" @click="openCreate(null)">＋ 新建分类</button>
        <button type="button" class="cp-manage" @click="goManage">管理 ›</button>
      </div>
    </template>

    <!-- ==================== 二级弹窗（唯一一层 van-popup）==================== -->
    <!-- ⚠️ teleport="body" 必留（iOS 弹层层叠坑） -->
    <van-popup
      v-model:show="popupShow"
      position="bottom"
      :style="{ height: '60%' }"
      round
      teleport="body"
      :duration="0.2"
      :close-on-click-overlay="!saving"
    >
      <div class="cat-popup">
        <!-- Header -->
        <div class="cp-header">
          <button
            v-if="stage === 'create'"
            type="button"
            class="cp-back"
            aria-label="返回"
            @click="onBack"
          >‹</button>
          <div class="cp-head-main">
            <span class="cp-title">{{ headerTitle }}</span>
          </div>
          <button
            v-if="stage !== 'create'"
            type="button"
            class="cp-head-close"
            @click="popupShow = false"
          >取消</button>
        </div>

        <!-- 内容：child ⇄ create 两态切换 -->
        <div class="cp-body">
          <transition :name="transitionName" mode="out-in">
            <!-- 状态 1 · 二级列表 -->
            <div v-if="stage === 'child'" key="child" class="cp-stage">
              <!-- 首项 = 一级本身（只记大类，操作次数不增加） -->
              <button
                v-if="activeRoot && activeRootStyle"
                type="button"
                class="cp-self"
                :class="{ 'is-active': modelValue === activeRoot.id }"
                @click="onSelfClick(activeRoot)"
                @touchstart="onCellTouchStart(activeRoot, $event)"
                @touchmove="lp.handlers.onTouchmove"
                @touchend="lp.handlers.onTouchend"
                @touchcancel="lp.handlers.onTouchcancel"
                @contextmenu="lp.handlers.onContextmenu"
              >
                <IconBox :name="activeRootStyle.icon" :tint="activeRootStyle.tint" :size="32" />
                <span class="cp-self-main">
                  <span class="cp-self-name">{{ activeRoot.name }}</span>
                  <span class="cp-self-hint">只记大类</span>
                </span>
                <Icon name="ChevronRight" :size="16" class="cp-self-arrow" aria-hidden="true" />
              </button>

              <!-- 二级 3 列宫格，各带图标（sm 24px，比一级小一档形成层级） -->
              <div v-if="childCells.length === 0" class="cp-child-empty">该大类暂无二级</div>
              <div v-else class="cp-grid cp-grid--child">
                <button
                  v-for="cell in childCells"
                  :key="cell.node.id"
                  type="button"
                  class="cp-cell cp-cell--child"
                  :class="{ 'is-active': modelValue === cell.node.id }"
                  @click="onChildClick(cell.node)"
                  @touchstart="onCellTouchStart(cell.node, $event)"
                  @touchmove="lp.handlers.onTouchmove"
                  @touchend="lp.handlers.onTouchend"
                  @touchcancel="lp.handlers.onTouchcancel"
                  @contextmenu="lp.handlers.onContextmenu"
                >
                  <IconBox :name="cell.icon" :tint="cell.tint" :size="24" :icon-size="14" />
                  <span class="cp-cell-name">{{ cell.node.name }}</span>
                </button>
              </div>

              <div class="cp-foot">
                <button type="button" class="cp-add" @click="openCreate(activeRoot)">
                  ＋ 新建二级分类
                </button>
              </div>
            </div>

            <!-- 状态 2 · 新建 / 编辑表单 -->
            <div v-else key="create" class="cp-stage">
              <div class="cp-form">
                <label class="cp-label">名称</label>
                <input
                  v-model="formName"
                  type="text"
                  class="cp-input"
                  :class="{ 'has-error': !!formError }"
                  maxlength="10"
                  placeholder="例如：健身"
                  :disabled="saving"
                  @input="formError = ''"
                >
                <p v-if="formError" class="cp-error">{{ formError }}</p>

                <label class="cp-label">图标</label>
                <button type="button" class="cp-row" :disabled="saving" @click="iconPickerShow = true">
                  <IconBox :name="formIconResolved" :tint="formTintResolved" :size="32" />
                  <span class="cp-row-name">{{ formIconResolved }}</span>
                  <span class="cp-row-action">更换 ›</span>
                </button>

                <label class="cp-label">颜色</label>
                <div class="cp-tints">
                  <button
                    v-for="t in TINT_NAMES"
                    :key="t"
                    type="button"
                    class="cp-tint"
                    :class="{ 'is-on': formTintResolved === t }"
                    :style="{ background: tintSwatch(t) }"
                    :aria-label="t"
                    :disabled="saving"
                    @click="pickTint(t)"
                  />
                </div>

                <p v-if="createParent" class="cp-hint cp-hint--inline">
                  将作为「{{ createParent.name }}」的二级分类
                </p>
              </div>

              <div class="cp-foot">
                <button type="button" class="cp-save" :disabled="saving" @click="onSave">
                  {{ saving ? '保存中…' : '保存' }}
                </button>
              </div>
            </div>
          </transition>
        </div>
      </div>
    </van-popup>

    <!-- ==================== 长按操作菜单（编辑 / 删除）==================== -->
    <van-action-sheet
      v-model:show="menuShow"
      :actions="MENU_ACTIONS"
      cancel-text="取消"
      teleport="body"
      @select="onMenuSelect"
    />

    <!-- ⚠️ 嵌套的图标选择器同样是 van-popup + teleport="body" -->
    <IconPicker
      v-model:show="iconPickerShow"
      :model-value="formIcon"
      @select="onIconPicked"
    />
  </div>
</template>

<style lang="scss" scoped>
/* ==================== 一级宫格（内联）==================== */
.cat-picker-inline {
  padding: 0 var(--space-4) var(--space-3);
}
.cp-grid {
  display: grid;
  gap: 8px;
}
.cp-grid--root {
  grid-template-columns: repeat(3, 1fr);
}
/* 二级 3 列（与大类一致，05 §1.4） */
.cp-grid--child {
  grid-template-columns: repeat(3, 1fr);
}
.cp-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  min-height: 44px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  /* 长按不弹系统菜单 / 不选中文字（否则 iOS 长按会出系统拷贝菜单） */
  -webkit-touch-callout: none;
  user-select: none;
  &:active { transform: scale(0.96); }
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
}
.cp-cell--child {
  gap: 4px;
  min-height: 44px;
  padding: 10px 4px;
}
.cp-cell-name-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  max-width: 100%;
  min-width: 0;
}
.cp-cell-name {
  min-width: 0;
  font-size: var(--fs-micro);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* `›` 标记：12px / --color-text-tertiary，选中态跟随名字变 primary */
.cp-cell-chev {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}
.cp-cell.is-active .cp-cell-name {
  color: var(--color-primary);
  font-weight: 600;
}
.cp-cell.is-active .cp-cell-chev {
  color: var(--color-primary);
}

/* ==================== 动作行 ==================== */
.cp-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-3);
}
.cp-add-link {
  border: 0;
  padding: 4px 0;
  background: transparent;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-primary);
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
.cp-manage {
  border: 0;
  padding: 4px 0;
  background: transparent;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}

/* ==================== 空态 / 加载 ==================== */
.cp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 0 8px;
}
.cp-empty-icon {
  color: var(--color-text-tertiary);
  opacity: 0.6;
  margin-bottom: 8px;
}
.cp-empty-text {
  margin: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.cp-loading {
  padding: 32px 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ==================== 二级弹窗 ==================== */
.cat-popup {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}
.cp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px var(--space-4) 10px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-light);
}
.cp-back {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  font-size: var(--fs-h2);
  line-height: 1;
  color: var(--color-text-primary);
  border-radius: var(--radius-base);
  &:active { background: var(--color-bg-hover); }
}
.cp-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.cp-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.cp-head-close {
  flex-shrink: 0;
  width: 40px;
  border: 0;
  background: transparent;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  text-align: right;
  padding: 4px 0;
  &:active { opacity: 0.7; }
}

/* 内容区（唯一滚动容器；滚动不传导到外层） */
.cp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
.cp-stage {
  padding: var(--space-4) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}

/* 二级列表首项 = 一级本身 */
.cp-self {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: var(--space-3);
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  user-select: none;
  &:active { transform: scale(0.98); }
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
}
.cp-self-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cp-self-name {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.cp-self-hint {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
.cp-self-arrow {
  flex-shrink: 0;
  color: var(--color-text-disabled);
}
.cp-child-empty {
  padding: 16px 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ==================== 底部动作 ==================== */
.cp-foot {
  margin-top: var(--space-4);
}
.cp-add {
  width: 100%;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-primary);
  font-size: var(--fs-body-sm);
  font-weight: 500;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-primary-light); }
}

/* ==================== 表单态 ==================== */
.cp-form {
  display: flex;
  flex-direction: column;
}
.cp-label {
  margin: 0 0 6px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  & + .cp-label { margin-top: var(--space-4); }
}
.cp-input {
  width: 100%;
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
.cp-error {
  margin: 6px 0 0;
  font-size: var(--fs-micro);
  color: var(--color-danger);
}
.cp-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-bg-hover); }
  &:disabled { opacity: 0.5; }
}
.cp-row-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-row-action {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
}
.cp-tints {
  display: flex;
  gap: 14px;
  padding: 6px 4px;
}
.cp-tint {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: 0 0 0 1px var(--color-border-light);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &.is-on {
    border-color: var(--color-bg-card);
    box-shadow: 0 0 0 2px var(--color-text-primary);
  }
}
.cp-hint {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.cp-hint--inline {
  margin: var(--space-3) 0 0;
}
.cp-save {
  width: 100%;
  height: 46px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  box-shadow: var(--shadow-button);
  -webkit-tap-highlight-color: transparent;
  &:active:not(:disabled) { background: var(--color-primary-dark); }
  &:disabled { background: var(--color-bg-hover); color: var(--color-text-disabled); box-shadow: none; }
}

/* ==================== 方向感动效（≤200ms 总计）==================== */
.cp-fwd-enter-active,
.cp-fwd-leave-active,
.cp-back-enter-active,
.cp-back-leave-active {
  transition: opacity var(--duration-instant) var(--ease-out),
    transform var(--duration-instant) var(--ease-out);
}
.cp-fwd-enter-from { opacity: 0; transform: translateX(24px); }
.cp-fwd-leave-to { opacity: 0; transform: translateX(-24px); }
.cp-back-enter-from { opacity: 0; transform: translateX(-24px); }
.cp-back-leave-to { opacity: 0; transform: translateX(24px); }
</style>
