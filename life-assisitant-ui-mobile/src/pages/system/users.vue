<script setup lang="ts">
/**
 * 用户管理（移动端 · Phase 6.3~6.5）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/user/index.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/router.go（user_mgmt 段）
 *                    life-assisitant-api/internal/model/dto/user.go
 * 最后同步：2026-09-18（Phase 6）
 *
 * 桌面端 → 移动端 交互映射：
 *   表格行 + 行内按钮  → 卡片 + 左滑「启停 / 删除」+ 点卡片进编辑
 *   Input 搜索         → van-search（**服务端**搜索）
 *   Pagination 翻页    → van-list 上拉加载
 *   Modal 表单         → UserEditSheet 底部弹层
 *
 * ⚠️ 搜索口径与桌面端**不同**，这是有意的：
 *    桌面端注释写「ListUsersQuery 无 keyword 字段，只能客户端过滤当前页」，
 *    但后端 `dto.ListUsersReq` 明确有 `Keyword string \`json:"keyword"\``，
 *    且 service 层是跨站查询。按「以后端实际返回为准」的裁定，移动端走
 *    **服务端搜索** —— 客户端过滤当前页在分页场景下会漏结果（第 2 页的匹配项搜不到），
 *    是功能性缺陷而非风格差异。
 *
 * ⚠️ 改角色有两条端点，权限点不同（后端 router.go 197~220 行）：
 *    PATCH /users/:id（带 role） → user_mgmt:update
 *    PUT   /users/:id/role       → user_mgmt:assign_role
 *    只有后者时，本页进入「仅可改角色」模式（资料字段全部只读）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'
import { userApi } from '@/api/user'
import { roleApi } from '@/api/role'
import { ApiError } from '@/api/request'
import { ErrorCode } from '@/constants/auth-codes'
import { getTint } from '@/utils/tint'
import {
  USER_MGMT_ASSIGN_ROLE,
  USER_MGMT_CREATE,
  USER_MGMT_DELETE,
  USER_MGMT_UPDATE,
  USER_MGMT_VIEW,
} from '@/utils/permissions'
import { useUserStore } from '@/stores/user'
import UserAvatar from '@/components/UserAvatar.vue'
import UserEditSheet from '@/components/UserEditSheet.vue'
import Icon from '@/components/icon/Icon.vue'
import type { Role, RoleCode, UpdateUserReq, User, UserStatus } from '@/api/types'

const router = useRouter()
const userStore = useUserStore()

const PAGE_SIZE = 10

// ==================== 权限（按钮显隐 + 端点选择） ====================
const canView = computed(() => userStore.hasPermission(USER_MGMT_VIEW))
const canCreate = computed(() => userStore.hasPermission(USER_MGMT_CREATE))
const canUpdate = computed(() => userStore.hasPermission(USER_MGMT_UPDATE))
const canDelete = computed(() => userStore.hasPermission(USER_MGMT_DELETE))
const canAssignRole = computed(() => userStore.hasPermission(USER_MGMT_ASSIGN_ROLE))
/** 能进编辑弹层：改资料或改角色，任一即可 */
const canEdit = computed(() => canUpdate.value || canAssignRole.value)
/** 只拿到 assign_role 时，弹层里除角色外全部只读 */
const roleOnlyMode = computed(() => !canUpdate.value && canAssignRole.value)

/** 角色列表（GET /roles 需要 role_mgmt:view；拿不到就降级为只回显编码） */
const roles = ref<Role[]>([])

// ==================== 列表 ====================
const users = ref<User[]>([])
const total = ref(0)
const page = ref(0)
const listLoading = ref(false)
const finished = ref(false)
const error = ref('')
const keyword = ref('')

async function loadPage(p: number, replace: boolean): Promise<void> {
  const res = await userApi.list({
    page: p,
    page_size: PAGE_SIZE,
    keyword: keyword.value.trim() || undefined,
  })
  const items = res.items ?? []
  users.value = replace ? items : [...users.value, ...items]
  total.value = res.total ?? 0
  page.value = p
  // 后端 response.Page 恒带 has_more（见 controller/user.go 用 response.Page 封装）
  finished.value = !res.has_more
}

/** van-list 的 @load：首屏与上拉共用一路 */
async function onLoad(): Promise<void> {
  error.value = ''
  try {
    if (page.value === 0) await loadPage(1, true)
    else await loadPage(page.value + 1, false)
  } catch {
    // 拦截器已 toast 具体原因；这里给页面态并停掉 van-list 的自动重试
    error.value = '用户列表加载失败，请重试'
    finished.value = true
  } finally {
    listLoading.value = false
  }
}

/** 重置到第一页重新拉（搜索 / 增删改后调用） */
async function reloadFirst(): Promise<void> {
  users.value = []
  page.value = 0
  finished.value = false
  error.value = ''
  listLoading.value = true
  await onLoad()
}

/** 保持当前已加载页数，重新从第 1 页拉（用于 last_admin 之类的失败后同步 version） */
async function reloadKeepPages(): Promise<void> {
  const pages = Math.max(page.value, 1)
  const keep = Math.min(pages * PAGE_SIZE, PAGE_SIZE * pages)
  const res = await userApi.list({
    page: 1,
    page_size: Math.min(Math.max(keep, PAGE_SIZE), 100),
    keyword: keyword.value.trim() || undefined,
  }).catch(() => null)
  if (!res) return
  users.value = res.items ?? []
  total.value = res.total ?? 0
  finished.value = !res.has_more
  page.value = 1
}

async function onRetry(): Promise<void> {
  finished.value = false
  listLoading.value = true
  await onLoad()
}

// ==================== 搜索（服务端 + 防抖） ====================
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onKeywordInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void reloadFirst()
  }, 350)
}

function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  void reloadFirst()
}

// ==================== 角色展示 ====================
const roleMap = computed(() => {
  const m: Record<string, Role> = {}
  roles.value.forEach((r) => {
    m[r.code] = r
  })
  return m
})

interface Meta {
  text: string
  bg: string
  fg: string
}

/** 内置 admin/user 有专属外观；自定义角色统一走 success 色 + 动态名称 */
function roleMeta(code: RoleCode): Meta {
  if (code === 'admin') return { text: '管理员', ...getTint('warning') }
  if (code === 'user') return { text: '用户', ...getTint('accent') }
  return { text: roleMap.value[code]?.name ?? code, ...getTint('success') }
}

function statusMeta(status: UserStatus): Meta {
  return status === 'active'
    ? { text: '启用', ...getTint('success') }
    : { text: '已禁用', ...getTint('danger') }
}

/** 是否是自己 —— 后端有 SELF_PROTECTION(403006)，前端先做软提示少一次失败往返 */
function isSelf(u: User): boolean {
  return u.id === userStore.user?.id
}

// ==================== 编辑 / 新建（Phase 6.4） ====================
const sheetShow = ref(false)
const editing = ref<User | null>(null)

function openCreate(): void {
  editing.value = null
  sheetShow.value = true
}

function openEdit(u: User): void {
  if (!canEdit.value) {
    showToast({ message: '你没有编辑用户的权限', duration: 1500 })
    return
  }
  editing.value = u
  sheetShow.value = true
}

async function handleSave(payload: {
  username: string
  name: string
  email: string
  phone: string
  role: RoleCode
}): Promise<boolean> {
  const target = editing.value
  try {
    if (target) {
      const roleChanged = payload.role !== target.role
      if (canUpdate.value) {
        const body: UpdateUserReq = {
          name: payload.name,
          // 空串显式发送 = 清空（后端指针字段转 NULL）；undefined 才是「不改」
          email: payload.email,
          phone: payload.phone,
          version: target.version ?? 0,
        }
        if (roleChanged) body.role = payload.role
        await userApi.update(target.id, body)
        showSuccessToast('用户已更新')
      } else if (roleChanged && canAssignRole.value) {
        // 只有 assign_role：资料字段后端不让改，这里只提交角色
        await roleApi.assignRole(target.id, payload.role)
        showSuccessToast('角色已更新')
      } else {
        showToast({ message: '没有可提交的改动', duration: 1500 })
        return false
      }
      await reloadKeepPages()
      return true
    }

    await userApi.create({
      username: payload.username,
      name: payload.name,
      role: payload.role,
      email: payload.email || undefined,
      phone: payload.phone || undefined,
    })
    showSuccessToast('用户已创建，初始密码 123456')
    await reloadFirst()
    return true
  } catch (e) {
    // 乐观锁冲突：单独弹确认框（与桌面端 Modal.confirm「加载最新」同语义）
    if (e instanceof ApiError && e.code === ErrorCode.VERSION_CONFLICT) {
      const ok = await showConfirmDialog({
        title: '该用户已被他人修改',
        message: '本次改动未保存，是否加载最新数据后重新编辑？',
        confirmButtonText: '加载最新',
        cancelButtonText: '取消',
      }).then(() => true).catch(() => false)
      if (ok) await reloadKeepPages()
      return false
    }
    // 其余错误拦截器已 toast（自保护 403006 / 末位管理员 403007 / 重名 409002 等）
    await reloadKeepPages().catch(() => undefined)
    return false
  }
}

// ==================== 启停 / 删除（Phase 6.5） ====================
async function toggleStatus(u: User): Promise<void> {
  const next: UserStatus = u.status === 'active' ? 'disabled' : 'active'
  const verb = next === 'active' ? '启用' : '禁用'
  try {
    await showConfirmDialog({
      title: `${verb}用户`,
      message: `确认${verb}「${u.name}」？`,
      confirmButtonText: verb,
      cancelButtonText: '取消',
      confirmButtonColor:
        next === 'active' ? 'var(--color-primary)' : 'var(--color-warning)',
    })
  } catch {
    return
  }

  try {
    // PATCH /users/:id/status 要求 version 乐观锁
    await userApi.setStatus(u.id, { status: next, version: u.version ?? 0 })
    showSuccessToast(next === 'active' ? '已启用' : '已禁用')
  } catch (e) {
    if (e instanceof ApiError && e.code === ErrorCode.VERSION_CONFLICT) {
      showToast({ message: '该用户已被他人修改，已刷新', duration: 1800 })
    }
  } finally {
    await reloadKeepPages().catch(() => undefined)
  }
}

async function removeUser(u: User): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除用户',
      message: `确认删除「${u.name}」？此操作不可恢复。`,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }

  try {
    await userApi.remove(u.id)
    showSuccessToast('已删除')
  } catch {
    // 拦截器已 toast（自保护 / 末位管理员等）
  } finally {
    await reloadKeepPages().catch(() => undefined)
  }
}

// ==================== 初始化 ====================
onMounted(async () => {
  // 角色列表用于 picker 与标签翻译；失败不阻断页面（降级为回显编码）
  roleApi
    .list()
    .then((list) => {
      roles.value = [...list].sort((a, b) => a.id - b.id)
    })
    .catch(() => {
      roles.value = []
    })
})

function goBack(): void {
  router.back()
}

/** 供模板判断是否要展示「左滑操作」提示 */
const hasRowActions = computed(() => canUpdate.value || canDelete.value)
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="goBack">‹</button>
      <span class="sub-title">用户管理</span>
      <button v-if="canCreate" class="sub-add" type="button" @click="openCreate">
        <span class="sub-add-emoji">＋</span>新建
      </button>
    </header>

    <div class="sub-body">
      <!-- 搜索（服务端） -->
      <van-search
        v-model="keyword"
        placeholder="搜索昵称 / 用户名 / 邮箱 / 手机号"
        shape="round"
        @update:model-value="onKeywordInput"
        @search="onSearch"
        @clear="onSearch"
      />

      <div class="list-meta">
        <span class="meta-count">共 {{ total }} 位成员</span>
        <span v-if="hasRowActions" class="meta-hint">左滑可启停 / 删除</span>
      </div>

      <!-- 无查看权限的兜底（正常进不来，守卫已拦） -->
      <div v-if="!canView" class="state-empty">
        <Icon name="Lock" :size="32" class="state-icon" />
        <p class="state-text">你没有查看用户列表的权限</p>
      </div>

      <van-list
        v-else
        v-model:loading="listLoading"
        :finished="finished"
        :finished-text="users.length > 0 ? '没有更多了' : ''"
        error-text="加载失败，点击重试"
        @load="onLoad"
      >
        <!-- 首屏骨架 -->
        <div v-if="listLoading && users.length === 0" class="skel-wrap">
          <div v-for="i in 3" :key="i" class="skel-card" />
        </div>

        <!-- 错误态 -->
        <div v-else-if="error && users.length === 0" class="state-error">
          <span>{{ error }}</span>
          <button class="retry-btn" type="button" @click="onRetry">重试</button>
        </div>

        <!-- 空态 -->
        <div v-else-if="users.length === 0" class="state-empty">
          <Icon name="Users" :size="32" class="state-icon" />
          <p class="state-text">
            {{ keyword.trim() ? '没有匹配的用户' : '暂无用户，点右上角「新建」添加' }}
          </p>
        </div>

        <!-- 用户卡列表 -->
        <template v-else>
          <van-swipe-cell v-for="u in users" :key="u.id">
            <button class="user-card" type="button" @click="openEdit(u)">
              <UserAvatar :user="u" :size="44" />

              <span class="card-body">
                <span class="card-line1">
                  <span class="card-name">{{ u.name }}</span>
                  <span
                    class="badge"
                    :style="{ background: roleMeta(u.role).bg, color: roleMeta(u.role).fg }"
                  >
                    {{ roleMeta(u.role).text }}
                  </span>
                  <span
                    class="badge"
                    :style="{ background: statusMeta(u.status).bg, color: statusMeta(u.status).fg }"
                  >
                    {{ statusMeta(u.status).text }}
                  </span>
                  <span v-if="isSelf(u)" class="badge badge-self">我</span>
                </span>
                <span class="card-line2">@{{ u.username }}</span>
                <span v-if="u.email" class="card-line3">{{ u.email }}</span>
              </span>

              <span v-if="canEdit" class="card-arrow">›</span>
            </button>

            <template v-if="hasRowActions" #right>
              <button
                v-if="canUpdate"
                class="swipe-btn swipe-toggle"
                type="button"
                @click="toggleStatus(u)"
              >
                {{ u.status === 'active' ? '禁用' : '启用' }}
              </button>
              <button
                v-if="canDelete"
                class="swipe-btn swipe-delete"
                type="button"
                @click="removeUser(u)"
              >
                删除
              </button>
            </template>
          </van-swipe-cell>
        </template>
      </van-list>
    </div>

    <!-- 新建 / 编辑弹层 -->
    <UserEditSheet
      v-model:show="sheetShow"
      :user="editing"
      :roles="roles"
      :can-edit-profile="canUpdate"
      :can-edit-role="canEdit"
      :on-save="handleSave"
    />

    <!-- 只读提示：仅分配角色权限时说明清楚，避免用户以为资料没保存上 -->
    <div v-if="roleOnlyMode" class="role-only-hint">
      当前账号只有「分配角色」权限，编辑弹层中资料字段为只读。
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

/* 右上角「新建」按钮（sub-header 的第三段） */
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
.sub-add-emoji {
  font-size: 13px;
  line-height: 1;
}

/* van-search 融入页面底色 */
:deep(.van-search) {
  background: transparent;
  padding: 0 0 var(--space-2);
}
:deep(.van-search__content) {
  background: var(--color-bg-card);
}

/* 计数条 */
.list-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px var(--space-2);
}
.meta-count {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
.meta-hint {
  font-size: var(--fs-micro);
  color: var(--color-text-disabled);
}

/* ====== 用户卡 ====== */
.user-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: var(--space-4);
  margin-bottom: var(--space-2);
  border: 0;
  border-radius: var(--radius-xl);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-xs);
  text-align: left;

  &:active { background: var(--color-bg-hover); }
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.card-line1 {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.card-name {
  font-size: var(--fs-body-sm);
  font-weight: 700;
  color: var(--color-text-primary);
  max-width: 45%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge-self {
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
}
.card-line2 {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-num);
}
.card-line3 {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-arrow {
  flex-shrink: 0;
  font-size: 20px;
  line-height: 1;
  color: var(--color-text-disabled);
}

/* ====== 左滑操作按钮 ====== */
.swipe-btn {
  height: 100%;
  min-width: 68px;
  border: 0;
  color: #FFFFFF;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  padding: 0 14px;

  &:active { opacity: 0.85; }
}
.swipe-toggle {
  background: var(--color-warning);
}
.swipe-delete {
  background: var(--color-danger);
}

/* ====== 骨架 / 提示 ====== */
.skel-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.skel-card {
  height: 78px;
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

.role-only-hint {
  margin-top: var(--space-3);
  padding: 10px var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
  font-size: var(--fs-micro);
  line-height: 1.5;
}
</style>
