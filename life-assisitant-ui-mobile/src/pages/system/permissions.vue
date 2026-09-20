<script setup lang="ts">
/**
 * 角色与权限管理（移动端 · Phase 6.6~6.10）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/permission/index.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/router.go（role_mgmt 段）
 *                    life-assisitant-api/internal/model/dto/user.go（Role / Permission 段）
 * 最后同步：2026-09-18（Phase 6）
 *
 * 桌面端是「左角色列表 + 右权限矩阵」两栏；移动端没有横向空间，
 * 拆成「角色 chips 横滚条 + 下方单角色矩阵」，信息不降级。
 *
 * 端点到权限点映射（权限矩阵的读写都是 role_mgmt 段）：
 *   GET  /roles                        role_mgmt:view
 *   GET  /roles/:code/permissions      role_mgmt:view
 *   POST /roles                        role_mgmt:create
 *   PATCH/DELETE /roles/:code          role_mgmt:update / delete
 *   PUT  /roles/:code/permissions      role_mgmt:grant   ← 保存矩阵
 *
 * ⚠️ admin 矩阵只读锁定：后端对该角色改矩阵直接返 400022（ADMIN_MATRIX_LOCKED），
 *    因为管理员是**代码直通**全权限（middleware/rbac.go 旁路），矩阵存了也不生效。
 *    前端因此呈现「全选中 + 全部禁用 + 无保存条」，与桌面端一致。
 *
 * ⚠️ 乐观锁：矩阵带 version，PUT 必须回传。冲突（409001）不静默重试 ——
 *    弹确认框让用户选择「加载最新」，否则会把他人改动覆盖掉。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast } from 'vant'
import { roleApi } from '@/api/role'
import { permissionApi } from '@/api/permission'
import { ApiError } from '@/api/request'
import { ErrorCode } from '@/constants/auth-codes'
import { getTint } from '@/utils/tint'
import {
  ROLE_MGMT_CREATE,
  ROLE_MGMT_DELETE,
  ROLE_MGMT_GRANT,
  ROLE_MGMT_UPDATE,
} from '@/utils/permissions'
import { useUserStore } from '@/stores/user'
import RoleEditSheet from '@/components/RoleEditSheet.vue'
import Icon from '@/components/icon/Icon.vue'
import type { Permission, Role, RoleCode } from '@/api/types'

const router = useRouter()
const userStore = useUserStore()

// ==================== 权限 ====================
const canCreate = computed(() => userStore.hasPermission(ROLE_MGMT_CREATE))
const canUpdate = computed(() => userStore.hasPermission(ROLE_MGMT_UPDATE))
const canDelete = computed(() => userStore.hasPermission(ROLE_MGMT_DELETE))
const canGrant = computed(() => userStore.hasPermission(ROLE_MGMT_GRANT))

// ==================== 数据 ====================
const roles = ref<Role[]>([])
const perms = ref<Permission[]>([])
const current = ref<RoleCode | null>(null)

const draft = ref<Set<string>>(new Set())
const version = ref(0)
const dirty = ref(false)

const loadingRoles = ref(true)
const loadingMatrix = ref(false)
const error = ref('')
const saving = ref(false)

// ==================== 模块展示名 + 业务序 ====================
/** 与桌面端 MODULE_NAMES 逐字一致（同一后端权限目录，不要各自起名） */
const MODULE_NAMES: Record<string, string> = {
  home: '首页',
  task: '待办',
  habit: '习惯',
  mood: '心情 / 精力',
  finance: '财务',
  // ⚠️ period 此前漏了（桌面端有、移动端没有 → 权限页显示裸 key "period"），20260919 补齐
  period: '经期',
  // 20260919-v1：健康模块 + 纪念日
  health: '健康',
  anniversary: '纪念日',
  stat: '统计',
  timeline: '时间线',
  notification: '通知',
  me: '个人中心',
  user_mgmt: '用户管理',
  role_mgmt: '角色与权限管理',
}

// ==================== 矩阵互转 ====================
const point = (p: Permission): string => `${p.module}:${p.action}`

function matrixToSet(matrix: Record<string, string[]>): Set<string> {
  const s = new Set<string>()
  Object.entries(matrix ?? {}).forEach(([m, actions]) =>
    (actions ?? []).forEach((a) => s.add(`${m}:${a}`))
  )
  return s
}

/** 勾选集合 → 后端矩阵（以权限目录为准展开，天然排除未知权限点） */
function setToMatrix(catalog: Permission[], checked: Set<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  catalog.forEach((p) => {
    if (!checked.has(point(p))) return
    if (!out[p.module]) out[p.module] = []
    out[p.module].push(p.action)
  })
  return out
}

// ==================== 分组 ====================
const moduleGroups = computed(() => {
  const byModule: Record<string, Permission[]> = {}
  perms.value.forEach((p) => {
    if (!byModule[p.module]) byModule[p.module] = []
    byModule[p.module].push(p)
  })
  const order = Object.keys(MODULE_NAMES)
  const keys = [
    ...order.filter((m) => byModule[m]?.length),
    ...Object.keys(byModule).filter((m) => !order.includes(m)),
  ]
  return keys.map((m) => ({ module: m, name: MODULE_NAMES[m] ?? m, items: byModule[m] }))
})

/** 展开的模块（默认全展开，与桌面端「一眼看全矩阵」一致） */
const activeModules = ref<string[]>([])

const selectedRole = computed(() => roles.value.find((r) => r.code === current.value) ?? null)
const isAdminRole = computed(() => current.value === 'admin')
/** 内置角色不可改名/删除（后端 400020 ROLE_IS_SYSTEM） */
const isSystemRole = computed(() => !!selectedRole.value?.is_system)

const totalChecked = computed(() => draft.value.size)
const allChecked = computed(
  () => perms.value.length > 0 && totalChecked.value === perms.value.length
)

// ==================== 加载 ====================
async function loadMatrix(code: RoleCode): Promise<void> {
  loadingMatrix.value = true
  try {
    const res = await roleApi.getMatrix(code)
    draft.value = matrixToSet(res.matrix)
    version.value = res.version ?? 0
    dirty.value = false
  } catch {
    // 拦截器已 toast
  } finally {
    loadingMatrix.value = false
  }
}

async function loadRoles(): Promise<Role[]> {
  const list = await roleApi.list()
  // 后端已按自增 id 排序（admin=1、user=2、自定义按创建序），前端仅做一次稳定排序
  const sorted = [...list].sort((a, b) => a.id - b.id)
  roles.value = sorted
  return sorted
}

onMounted(async () => {
  error.value = ''
  loadingRoles.value = true
  try {
    const [list, catalog] = await Promise.all([roleApi.list(), permissionApi.list()])
    const sorted = [...list].sort((a, b) => a.id - b.id)
    roles.value = sorted
    perms.value = catalog
    activeModules.value = moduleGroups.value.map((g) => g.module)

    const first = sorted[0]?.code
    if (first) {
      current.value = first
      await loadMatrix(first)
    }
  } catch {
    error.value = '权限数据加载失败，请重试'
  } finally {
    loadingRoles.value = false
  }
})

function onRetry(): void {
  // 一次性把角色 + 目录 + 矩阵重来，避免半残状态
  void (async () => {
    error.value = ''
    loadingRoles.value = true
    try {
      const [list, catalog] = await Promise.all([roleApi.list(), permissionApi.list()])
      const sorted = [...list].sort((a, b) => a.id - b.id)
      roles.value = sorted
      perms.value = catalog
      activeModules.value = moduleGroups.value.map((g) => g.module)
      const first = sorted[0]?.code
      if (first) {
        current.value = first
        await loadMatrix(first)
      }
    } catch {
      error.value = '权限数据加载失败，请重试'
    } finally {
      loadingRoles.value = false
    }
  })()
}

// ==================== 切换角色（Phase 6.6：脏数据确认） ====================
async function switchTo(code: RoleCode): Promise<void> {
  if (code === current.value) return

  if (dirty.value) {
    try {
      await showConfirmDialog({
        title: '有未保存的勾选改动',
        message: '切换角色将丢弃当前未保存的改动，确定切换？',
        confirmButtonText: '丢弃并切换',
        cancelButtonText: '留下',
        confirmButtonColor: 'var(--color-warning)',
      })
    } catch {
      return
    }
  }

  current.value = code
  await loadMatrix(code)
}

// ==================== 勾选（Phase 6.7） ====================
function editablePoint(): boolean {
  return !isAdminRole.value && canGrant.value
}

function togglePoint(p: Permission, checked: boolean): void {
  if (!editablePoint()) return
  const next = new Set(draft.value)
  if (checked) next.add(point(p))
  else next.delete(point(p))
  draft.value = next
  dirty.value = true
}

function toggleModule(items: Permission[], checked: boolean): void {
  if (!editablePoint()) return
  const next = new Set(draft.value)
  items.forEach((p) => {
    if (checked) next.add(point(p))
    else next.delete(point(p))
  })
  draft.value = next
  dirty.value = true
}

function toggleAll(checked: boolean): void {
  if (!editablePoint()) return
  draft.value = checked ? new Set(perms.value.map(point)) : new Set<string>()
  dirty.value = true
}

// ==================== 保存（Phase 6.8） ====================
async function onSave(): Promise<void> {
  const code = current.value
  if (!code || !dirty.value || !canGrant.value) return

  saving.value = true
  try {
    await roleApi.updateMatrix(code, {
      version: version.value,
      matrix: setToMatrix(perms.value, draft.value),
    })
    showSuccessToast('权限已保存，立即生效')
    // 改的是自己所属角色 → 立刻刷新本地权限，菜单/按钮即时收敛
    if (code === userStore.roleCode) {
      await userStore.fetchPermissions().catch(() => undefined)
    }
    await loadMatrix(code)
  } catch (e) {
    if (e instanceof ApiError && e.code === ErrorCode.VERSION_CONFLICT) {
      const ok = await showConfirmDialog({
        title: '权限矩阵已被他人修改',
        message: '本次改动未保存。是否加载该角色最新的勾选后重新调整？',
        confirmButtonText: '加载最新',
        cancelButtonText: '取消',
      })
        .then(() => true)
        .catch(() => false)
      if (ok) await loadMatrix(code)
    }
    // 其余错误拦截器已 toast（如 400022 admin 锁定）
  } finally {
    saving.value = false
  }
}

// ==================== 角色元信息（Phase 6.9） ====================
const roleSheetShow = ref(false)
const sheetRole = ref<Role | null>(null)

function openCreateRole(): void {
  sheetRole.value = null
  roleSheetShow.value = true
}

function openEditRole(): void {
  if (!selectedRole.value) return
  sheetRole.value = selectedRole.value
  roleSheetShow.value = true
}

async function handleRoleSave(payload: {
  code: string
  name: string
  description: string
}): Promise<boolean> {
  const target = sheetRole.value
  try {
    if (target) {
      await roleApi.update(target.code, {
        name: payload.name,
        description: payload.description,
      })
      showSuccessToast('角色信息已更新')
      await loadRoles()
      return true
    }

    const created = await roleApi.create({
      code: payload.code,
      name: payload.name,
      description: payload.description || undefined,
    })
    showSuccessToast(`角色「${created.name}」已创建，请勾选权限后保存`)
    await loadRoles()
    // 新建角色矩阵为空、version=0，直接切过去让用户勾
    current.value = created.code
    await loadMatrix(created.code)
    return true
  } catch {
    // 拦截器已 toast（编码非法 400021 / 重名 409002 等）
    return false
  }
}

async function onDeleteRole(): Promise<void> {
  const role = selectedRole.value
  if (!role || role.is_system) return

  try {
    await showConfirmDialog({
      title: `删除角色「${role.name}」？`,
      message: '该自定义角色及其权限配置将被一并删除。角色下仍有用户归属时无法删除。',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }

  try {
    await roleApi.remove(role.code)
    showSuccessToast('角色已删除')
    const list = await loadRoles()
    const next = list[0]?.code ?? null
    current.value = next
    if (next) await loadMatrix(next)
    else {
      draft.value = new Set<string>()
      version.value = 0
      dirty.value = false
    }
  } catch {
    // 拦截器已 toast（内置角色 400020 / 仍被占用 409003）
  }
}

// ==================== 杂项 ====================
function goBack(): void {
  router.back()
}

function roleTint(role: Role): { bg: string; fg: string } {
  if (role.code === 'admin') return getTint('warning')
  if (role.code === 'user') return getTint('accent')
  return getTint('success')
}

/** 底部操作条提示文案 */
const footerHint = computed(() => {
  if (isAdminRole.value) return '管理员为代码直通全权限，矩阵锁定'
  if (!canGrant.value) return '你没有「配置角色权限」权限，勾选区只读'
  if (dirty.value) return '有未保存改动'
  return `v${version.value} · 保存后立即生效`
})
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goBack">‹</button>
      <span class="sub-title">角色与权限</span>
      <button v-if="canCreate" class="sub-add" type="button" @click="openCreateRole">
        <span class="sub-add-emoji">＋</span>角色
      </button>
    </header>

    <div class="sub-body">
      <!-- 错误态 -->
      <div v-if="error" class="state-error">
        <span>{{ error }}</span>
        <button class="retry-btn" type="button" @click="onRetry">重试</button>
      </div>

      <template v-else>
        <!-- ====== 角色 chips 横滚（Phase 6.6） ====== -->
        <div v-if="loadingRoles" class="skel-chips">
          <div v-for="i in 3" :key="i" class="skel-chip" />
        </div>
        <div v-else class="chips-scroll">
          <button
            v-for="r in roles"
            :key="r.code"
            class="role-chip"
            :class="{ 'is-active': current === r.code }"
            type="button"
            @click="switchTo(r.code)"
          >
            <span class="chip-name">{{ r.name }}</span>
            <span class="chip-count">{{ r.user_count }}</span>
            <span v-if="r.is_system" class="chip-flag">内置</span>
          </button>
        </div>

        <!-- ====== 当前角色头 ====== -->
        <section v-if="selectedRole" class="card role-head">
          <div class="head-main">
            <div class="head-title-row">
              <span class="head-name">{{ selectedRole.name }}</span>
              <span
                class="badge"
                :style="{ background: roleTint(selectedRole).bg, color: roleTint(selectedRole).fg }"
              >
                {{ selectedRole.is_system ? '内置角色' : '自定义' }}
              </span>
              <span class="head-code">{{ selectedRole.code }}</span>
            </div>
            <p v-if="selectedRole.description" class="head-desc">
              {{ selectedRole.description }}
            </p>
            <p class="head-count">{{ selectedRole.user_count }} 位用户使用该角色</p>
          </div>

          <div v-if="!isSystemRole" class="head-actions">
            <button v-if="canUpdate" class="mini-btn" type="button" @click="openEditRole">
              编辑
            </button>
            <button v-if="canDelete" class="mini-btn mini-danger" type="button" @click="onDeleteRole">
              删除
            </button>
          </div>
        </section>

        <!-- ====== admin 锁定横幅（Phase 6.10） ====== -->
        <div v-if="isAdminRole" class="lock-banner">
          <Icon name="ShieldCheck" :size="16" class="lock-icon" />
          <span class="lock-text">
            管理员角色拥有全部权限（服务端代码直通），权限矩阵固定不可修改。
            如需给他人有限权限，请新建自定义角色。
          </span>
        </div>

        <!-- ====== 已选计数（admin 走上面的锁定横幅，不显示计数） ====== -->
        <div v-else class="count-row">
          <span class="count-label">已选权限</span>
          <span class="count-value">{{ totalChecked }} / {{ perms.length }}</span>
        </div>

        <!-- ====== 权限矩阵（Phase 6.7） ====== -->
        <div v-if="loadingMatrix" class="skel-wrap">
          <div v-for="i in 3" :key="i" class="skel-card" />
        </div>

        <van-collapse v-else v-model="activeModules" class="matrix">
          <van-collapse-item
            v-for="g in moduleGroups"
            :key="g.module"
            :name="g.module"
            class="matrix-group"
          >
            <template #title>
              <span class="group-title" @click.stop>
                <van-checkbox
                  :model-value="g.items.every((p) => draft.has(point(p)))"
                  :indeterminate="
                    !g.items.every((p) => draft.has(point(p))) &&
                    g.items.some((p) => draft.has(point(p)))
                  "
                  :disabled="!editablePoint()"
                  @update:model-value="
                    (v: boolean) => toggleModule(g.items, v)
                  "
                >
                  <span class="group-name">{{ g.name }}</span>
                </van-checkbox>
              </span>
            </template>

            <template #right-icon>
              <span class="group-count">
                {{ g.items.filter((p) => draft.has(point(p))).length }}/{{ g.items.length }}
              </span>
            </template>

            <div class="point-list">
              <div v-for="p in g.items" :key="p.id" class="point-item">
                <van-checkbox
                  :model-value="draft.has(point(p))"
                  :disabled="!editablePoint()"
                  @update:model-value="(v: boolean) => togglePoint(p, v)"
                >
                  {{ p.description || p.action }}
                </van-checkbox>
                <span class="point-code">{{ point(p) }}</span>
              </div>
            </div>
          </van-collapse-item>
        </van-collapse>

        <!-- ====== sticky 操作条（Phase 6.8：全选 / 清空 / 保存） ====== -->
        <div v-if="!isAdminRole" class="save-bar">
          <div class="save-bar-top">
            <span
              class="save-hint"
              :class="{ 'is-dirty': dirty && canGrant, 'is-locked': !canGrant }"
            >
              {{ footerHint }}
            </span>
          </div>

          <div class="save-bar-actions">
            <button
              class="bulk-btn"
              type="button"
              :disabled="!canGrant || allChecked"
              @click="toggleAll(true)"
            >
              全选
            </button>
            <button
              class="bulk-btn"
              type="button"
              :disabled="!canGrant || totalChecked === 0"
              @click="toggleAll(false)"
            >
              清空
            </button>
            <button
              class="save-btn"
              type="button"
              :disabled="!dirty || !canGrant || saving"
              @click="onSave"
            >
              {{ saving ? '保存中…' : '保存权限' }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 新建 / 编辑角色 -->
    <RoleEditSheet v-model:show="roleSheetShow" :role="sheetRole" :on-save="handleRoleSave" />
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

/* ====== 右上角「新建角色」 ====== */
.sub-add {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-caption-sm);
  font-weight: 600;

  &:active { opacity: 0.85; }
}
.sub-add-emoji { font-size: 13px; line-height: 1; }

/* ====== 角色 chips 横滚 ====== */
.chips-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: var(--space-3);
  scrollbar-width: none;

  &::-webkit-scrollbar { display: none; }
}
.role-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  white-space: nowrap;
  transition: all var(--duration-fast) var(--ease-default);

  &.is-active {
    border-color: var(--color-primary);
    background: var(--tint-primary-bg);
    color: var(--tint-primary-fg);
    font-weight: 700;
  }
  &:active { opacity: 0.85; }
}
.chip-name { line-height: 1; }
.chip-count {
  font-size: var(--fs-tab);
  font-family: var(--font-num);
  opacity: 0.75;
}
.chip-flag {
  font-size: var(--fs-nano);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
}

.skel-chips {
  display: flex;
  gap: 8px;
  padding-bottom: var(--space-3);
}
.skel-chip {
  flex-shrink: 0;
  width: 84px;
  height: 34px;
  border-radius: var(--radius-pill);
  background: linear-gradient(
    90deg,
    var(--color-bg-hover) 25%,
    var(--color-border) 50%,
    var(--color-bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: sub-shimmer 1.5s infinite;
}

/* ====== 当前角色头 ====== */
.role-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.head-main { flex: 1; min-width: 0; }
.head-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.head-name {
  font-size: var(--fs-h4);
  font-weight: 700;
  color: var(--color-text-primary);
}
.head-code {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.head-desc {
  margin: 6px 0 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.head-count {
  margin: 6px 0 0;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
.head-actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mini-btn {
  border: 0;
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: var(--fs-micro);
  font-weight: 600;
  padding: 5px 12px;

  &:active { opacity: 0.85; }
}
.mini-danger {
  background: var(--tint-danger-bg);
  color: var(--tint-danger-fg);
}

/* ====== admin 锁定横幅 ====== */
.lock-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px var(--space-4);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
}
/* 锁定横幅图标：尺寸由 <Icon :size> 控制，这里只管对齐与不缩放 */
.lock-icon { flex-shrink: 0; display: block; margin-top: 2px; color: var(--tint-warning-fg); }
.lock-text { flex: 1; font-size: var(--fs-caption-sm); line-height: 1.55; }

/* ====== 已选计数行 ====== */
.count-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-2);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-xs);
}
.count-label {
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
}
.count-value {
  font-size: var(--fs-caption-sm);
  font-family: var(--font-num);
  font-weight: 700;
  color: var(--color-primary);
}

/* ====== 矩阵 ====== */
.matrix {
  background: transparent;
}
.matrix-group {
  margin-bottom: var(--space-2);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: var(--shadow-xs);
}
.matrix-group :deep(.van-collapse-item__title) {
  background: var(--color-bg-card);
}
.matrix-group :deep(.van-cell) {
  background: var(--color-bg-card);
}
.matrix-group :deep(.van-collapse-item__content) {
  background: var(--color-bg-card);
  padding: 0 var(--space-4) var(--space-3);
}

.group-title {
  display: inline-flex;
  align-items: center;
}
.group-name {
  font-size: var(--fs-body-sm);
  font-weight: 700;
  color: var(--color-text-primary);
}
.group-count {
  margin-right: 6px;
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}

.point-list {
  display: flex;
  flex-direction: column;
}
.point-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;

  & + .point-item { border-top: 1px solid var(--color-border-light); }
}
.point-code {
  flex-shrink: 0;
  font-size: var(--fs-tab);
  font-family: var(--font-num);
  color: var(--color-text-disabled);
}

/* ====== 保存条（吸底） ====== */
.save-bar {
  position: sticky;
  bottom: 0;
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: var(--space-3);
  padding: 10px var(--space-4);
  border-radius: var(--radius-xl);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-md);
}
.save-bar-top {
  display: flex;
  align-items: center;
}
.save-hint {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  line-height: 1.4;

  &.is-dirty { color: var(--color-warning); font-weight: 600; }
  &.is-locked { color: var(--color-text-disabled); }
}
.save-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bulk-btn {
  flex-shrink: 0;
  height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 600;

  &:disabled { opacity: 0.45; }
  &:active:not(:disabled) { opacity: 0.85; }
}
.save-btn {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-caption-sm);
  font-weight: 700;

  &:disabled {
    background: var(--color-bg-hover);
    color: var(--color-text-disabled);
  }
  &:active:not(:disabled) { opacity: 0.85; }
}

/* ====== 骨架 ====== */
.skel-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.skel-card {
  height: 84px;
  border-radius: var(--radius-xl);
  background: linear-gradient(
    90deg,
    var(--color-bg-hover) 25%,
    var(--color-border) 50%,
    var(--color-bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: sub-shimmer 1.5s infinite;
}
</style>
