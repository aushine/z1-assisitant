/**
 * Permission management page (D-03 权限重构 · 整页重写)
 *
 * 旧版是「7 模块 × 4 固定 CRUD × 3 角色」大矩阵 + 非当前角色 disabled 复选框（反人类）。
 * 新版为常规系统权限管理：
 *   左侧 —— 角色列表：内置(admin/user)与自定义角色切换，支持新增/重命名/删除；
 *   右侧 —— 当前角色的权限勾选：按模块分组、权限点按真实功能命名（后端 description 直出），
 *            模块头支持全选；保存带乐观锁，冲突提示重载。
 * admin 角色矩阵锁定（后端 400022），UI 呈现全选中 + 不可改。
 * 权限点：新增 role_mgmt:create · 编辑元信息 role_mgmt:update · 删除 role_mgmt:delete ·
 *         勾选保存 role_mgmt:grant · 查看 role_mgmt:view（路由守卫）。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Card,
  Checkbox,
  Tag,
  Button,
  Modal,
  Input,
  Toast,
  Banner,
  Skeleton,
} from '@douyinfe/semi-ui'
import { feedback } from '@/utils/feedback'
import { useUserStore, useUserRole, useHasPermission } from '@/stores/user'
import { permissionApi } from '@/api/permission'
import { roleApi } from '@/api/role'
import { ApiError } from '@/api/request'
import { Icon } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import type { Role, Permission } from '@/api/types'

/** 模块显示名 + 展示顺序（业务语义序，非字母序） */
const MODULE_NAMES: Record<string, string> = {
  home: '首页',
  task: '任务',
  habit: '习惯',
  // 20260922-v2 · 04：习惯/待办分类实体化新增（后端 catalog 里排在 habit 之后）
  category: '分类',
  mood: '心情/精力',
  finance: '财务',
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

/** 与后端 roleCodeRe 同标准 */
const ROLE_CODE_RE = /^[a-z][a-z0-9_]{1,19}$/

function matrixToSet(matrix: Record<string, string[]>): Set<string> {
  const s = new Set<string>()
  Object.entries(matrix ?? {}).forEach(([m, actions]) =>
    (actions ?? []).forEach((a) => s.add(`${m}:${a}`))
  )
  return s
}

/** 勾选集合 → 后端矩阵（以权限目录为准展开，天然排除未知点） */
function setToMatrix(perms: Permission[], checked: Set<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  perms.forEach((p) => {
    if (checked.has(`${p.module}:${p.action}`)) {
      ;(out[p.module] ??= []).push(p.action)
    }
  })
  return out
}

const point = (p: Permission) => `${p.module}:${p.action}`

export default function PermissionPage() {
  const ownRole = useUserRole()

  const [roles, setRoles] = useState<Role[]>([])
  const [perms, setPerms] = useState<Permission[]>([])
  const [current, setCurrent] = useState<string | null>(null)

  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(false)

  const [loadingRoles, setLoadingRoles] = useState(true)
  const [loadingMatrix, setLoadingMatrix] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 新建 / 编辑元信息 Modal
  const [createVisible, setCreateVisible] = useState(false)
  const [createForm, setCreateForm] = useState({ code: '', name: '', description: '' })
  const [editTarget, setEditTarget] = useState<Role | null>(null)
  const [editForm, setEditForm] = useState({ name: '', description: '' })
  const [submitting, setSubmitting] = useState(false)

  // 按模块分组的权限目录（MODULE_NAMES 声明序）
  const moduleGroups = useMemo(() => {
    const byModule: Record<string, Permission[]> = {}
    perms.forEach((p) => (byModule[p.module] ??= []).push(p))
    const order = Object.keys(MODULE_NAMES)
    const keys = [
      ...order.filter((m) => byModule[m]?.length),
      ...Object.keys(byModule).filter((m) => !order.includes(m)),
    ]
    return keys.map((m) => ({ module: m, name: MODULE_NAMES[m] ?? m, items: byModule[m] }))
  }, [perms])

  const selectedRole = useMemo(
    () => roles.find((r) => r.code === current) ?? null,
    [roles, current]
  )
  const isAdminRole = current === 'admin'

  const canCreate = useHasPermission('role_mgmt:create')
  const canUpdate = useHasPermission('role_mgmt:update')
  const canDelete = useHasPermission('role_mgmt:delete')
  const canGrant = useHasPermission('role_mgmt:grant')

  const loadMatrix = useCallback(async (code: string) => {
    setLoadingMatrix(true)
    try {
      const res = await permissionApi.getRolePermissions(code)
      setDraft(matrixToSet(res.matrix))
      setVersion(res.version ?? 0)
      setDirty(false)
    } catch {
      // 拦截器已 Toast
    } finally {
      setLoadingMatrix(false)
    }
  }, [])

  const loadRoles = useCallback(async (): Promise<Role[]> => {
    try {
      const list = await roleApi.list()
      // 后端已按自增 id 排序（admin=1、user=2、自定义按创建序），前端不再二次重排
      list.sort((a, b) => a.id - b.id)
      setRoles(list)
      return list
    } catch {
      return []
    }
  }, [])

  // 初始化：角色列表 + 权限目录，默认选中第一个角色
  useEffect(() => {
    let alive = true
    ;(async () => {
      setError('')
      setLoadingRoles(true)
      try {
        const [list, catalog] = await Promise.all([roleApi.list(), permissionApi.list()])
        if (!alive) return
        list.sort((a, b) => a.id - b.id)
        setRoles(list)
        setPerms(catalog)
        const first = list[0]?.code
        if (first) {
          setCurrent(first)
          await loadMatrix(first)
        }
      } catch {
        if (alive) setError('权限数据加载失败，请重试')
      } finally {
        if (alive) setLoadingRoles(false)
      }
    })()
    return () => { alive = false }
  }, [loadMatrix])

  const switchTo = (code: string) => {
    if (code === current) return
    const doSwitch = () => {
      setCurrent(code)
      loadMatrix(code)
    }
    if (dirty) {
      Modal.confirm({
        title: '有未保存的勾选改动',
        content: '切换角色将丢弃当前未保存的改动，确定切换？',
        okText: '丢弃并切换',
        cancelText: '留下',
        onOk: doSwitch,
      })
    } else {
      doSwitch()
    }
  }

  const togglePoint = (p: Permission, checked: boolean) => {
    setDraft((prev) => {
      const n = new Set(prev)
      if (checked) n.add(point(p))
      else n.delete(point(p))
      return n
    })
    setDirty(true)
  }

  const toggleModule = (items: Permission[], checked: boolean) => {
    setDraft((prev) => {
      const n = new Set(prev)
      items.forEach((p) => (checked ? n.add(point(p)) : n.delete(point(p))))
      return n
    })
    setDirty(true)
  }

  const toggleAll = (checked: boolean) => {
    setDraft(checked ? new Set(perms.map(point)) : new Set())
    setDirty(true)
  }

  const onSave = async () => {
    if (!current) return
    setSaving(true)
    try {
      await permissionApi.updateRolePermissions(current, {
        version,
        matrix: setToMatrix(perms, draft),
      })
      // 改的是自己所属角色 → 刷新本地权限（菜单/按钮即时收敛）
      if (current === ownRole) await useUserStore.getState().fetchPermissions()
      await loadMatrix(current)
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === 'VERSION_CONFLICT') {
        Modal.confirm({
          title: '权限矩阵已被他人修改',
          content: '本次改动未保存。加载该角色最新勾选后重新调整？',
          okText: '加载最新',
          cancelText: '取消',
          onOk: () => loadMatrix(current),
        })
      }
      // 其余错误拦截器已带 cause Toast 外显
    } finally {
      setSaving(false)
    }
  }

  const onCreateRole = async () => {
    const code = createForm.code.trim()
    const name = createForm.name.trim()
    if (!ROLE_CODE_RE.test(code)) {
      Toast.error('角色标识需以小写字母开头，仅含小写字母/数字/下划线，2-20 位')
      return
    }
    if (code === 'admin' || code === 'user') {
      Toast.error('该编码为内置角色保留')
      return
    }
    if (!name) {
      Toast.error('请输入角色名称')
      return
    }
    setSubmitting(true)
    try {
      const created = await roleApi.create({
        code,
        name,
        description: createForm.description.trim() || undefined,
      })
      setCreateVisible(false)
      setCreateForm({ code: '', name: '', description: '' })
      await loadRoles()
      switchTo(created.code)
    } catch {
      // 拦截器已 Toast（重名/编码非法等，cause 已外显）
    } finally {
      setSubmitting(false)
    }
  }

  const openEdit = (r: Role) => {
    setEditTarget(r)
    setEditForm({ name: r.name, description: r.description ?? '' })
  }

  const onSubmitEdit = async () => {
    if (!editTarget) return
    const name = editForm.name.trim()
    if (!name) {
      Toast.error('请输入角色名称')
      return
    }
    setSubmitting(true)
    try {
      await roleApi.update(editTarget.code, {
        name,
        description: editForm.description.trim(),
      })
      setEditTarget(null)
      await loadRoles()
    } catch {
      // 拦截器已 Toast
    } finally {
      setSubmitting(false)
    }
  }

  const onDeleteRole = (r: Role) => {
    Modal.confirm({
      title: `删除角色「${r.name}」？`,
      content: `该自定义角色及其权限配置将被一并删除。角色下仍有用户归属时无法删除。`,
      okText: '删除',
      okButtonProps: { type: 'danger' },
      cancelText: '取消',
      onOk: async () => {
        try {
          await roleApi.remove(r.code)
          feedback.destructiveDone('角色已删除')
          const list = await loadRoles()
          if (current === r.code) {
            const next = list[0]?.code ?? null
            setCurrent(next)
            if (next) await loadMatrix(next)
          }
        } catch {
          // 拦截器已 Toast（内置角色/有用户占用，cause 已外显）
        }
      },
    })
  }

  const totalChecked = draft.size
  const allChecked = perms.length > 0 && totalChecked === perms.length

  return (
    <div className="perm-page">
      <div className="page-tip">
        权限管理 · 左侧选择角色，右侧按模块勾选功能权限，保存后立即生效
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => location.reload()} />
      ) : (
        <div className="perm-layout">
          {/* ===================== 左：角色列表 ===================== */}
          <Card bordered={false} className="card role-panel">
            <div className="role-panel-head">
              <span className="role-panel-title">角色</span>
              {canCreate && (
                <Button
                  size="small"
                  theme="light"
                  type="primary"
                  icon={<Icon name="PlusCircle" size={14} />}
                  onClick={() => {
                    setCreateForm({ code: '', name: '', description: '' })
                    setCreateVisible(true)
                  }}
                >
                  新建角色
                </Button>
              )}
            </div>
            {loadingRoles ? (
              <Skeleton active />
            ) : (
              <div className="role-list">
                {roles.map((r) => (
                  <div
                    key={r.code}
                    className={`role-item${current === r.code ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => switchTo(r.code)}
                    onKeyDown={(e) => e.key === 'Enter' && switchTo(r.code)}
                  >
                    <div className="role-item-main">
                      <span className="role-item-name">{r.name}</span>
                    </div>
                    <div className="role-item-meta">
                      {r.is_system && <Tag size="small" color="blue">内置</Tag>}
                      {r.code === 'admin' && <Tag size="small" color="amber">全权限·锁定</Tag>}
                      <span className="role-item-count">{r.user_count} 用户</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ===================== 右：权限勾选 ===================== */}
          <Card bordered={false} className="card perm-detail">
            {!selectedRole ? (
              <div className="perm-empty">请选择左侧角色</div>
            ) : (
              <>
                <div className="perm-detail-head">
                  <div className="perm-detail-title">
                    <span>{selectedRole.name}</span>
                    {selectedRole.description && (
                      <span className="perm-detail-desc">{selectedRole.description}</span>
                    )}
                  </div>
                  <div className="perm-detail-actions">
                    {canUpdate && !selectedRole.is_system && editTarget === null && (
                      <Button size="small" theme="borderless" type="tertiary" icon={<Icon name="Pencil" size={14} />} onClick={() => openEdit(selectedRole)}>
                        编辑
                      </Button>
                    )}
                    {canDelete && !selectedRole.is_system && (
                      <Button size="small" theme="borderless" type="danger" icon={<Icon name="Trash2" size={14} />} onClick={() => onDeleteRole(selectedRole)}>
                        删除
                      </Button>
                    )}
                  </div>
                </div>

                {isAdminRole ? (
                  <Banner
                    type="warning"
                    description="管理员角色拥有全部权限（服务端代码直通），权限矩阵固定不可修改；如需给他人有限权限，请新建自定义角色。"
                    closeIcon={null}
                    style={{ marginBottom: 12 }}
                  />
                ) : (
                  <div className="perm-selectall">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={!allChecked && totalChecked > 0}
                      disabled={isAdminRole || !canGrant}
                      onChange={(e: any) => toggleAll(e.target.checked)}
                    >
                      全选（已选 {totalChecked} / {perms.length}）
                    </Checkbox>
                  </div>
                )}

                {loadingMatrix ? (
                  <div className="skeleton-wrap"><Skeleton active /></div>
                ) : (
                  <div className="perm-modules">
                    {moduleGroups.map((g) => {
                      const checkedCount = g.items.filter((p) => draft.has(point(p))).length
                      const gAll = checkedCount === g.items.length
                      return (
                        <div key={g.module} className="perm-module">
                          <div className="perm-module-head">
                            <Checkbox
                              checked={gAll}
                              indeterminate={!gAll && checkedCount > 0}
                              disabled={isAdminRole || !canGrant}
                              onChange={(e: any) => toggleModule(g.items, e.target.checked)}
                            >
                              <span className="perm-module-name">{g.name}</span>
                            </Checkbox>
                            <span className="perm-module-count">{checkedCount}/{g.items.length}</span>
                          </div>
                          <div className="perm-module-points">
                            {g.items.map((p) => (
                              <div key={p.id} className="perm-point">
                                <Checkbox
                                  checked={draft.has(point(p))}
                                  disabled={isAdminRole || !canGrant}
                                  onChange={(e: any) => togglePoint(p, e.target.checked)}
                                >
                                  {p.description || p.action}
                                </Checkbox>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {!isAdminRole && (
                  <div className="perm-footer">
                    <span className="perm-footer-hint">
                      {!canGrant
                        ? '你没有「配置角色权限」权限，勾选区为只读'
                        : dirty
                          ? '有未保存改动'
                          : `v${version} · 保存后立即生效`}
                    </span>
                    <Button
                      theme="solid"
                      type="primary"
                      disabled={!dirty || !canGrant}
                      loading={saving}
                      icon={<Icon name="CheckSquare" size={16} />}
                      onClick={onSave}
                    >
                      保存权限
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* ===================== 新建角色 ===================== */}
      <Modal
        title="新建自定义角色"
        visible={createVisible}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={onCreateRole}
        onCancel={() => setCreateVisible(false)}
      >
        <div className="role-form">
          <label>角色标识</label>
          <Input
            placeholder="如 finance_staff（小写字母开头，a-z0-9_，2-20 位，创建后不可改）"
            value={createForm.code}
            onChange={(v: string) => setCreateForm((f) => ({ ...f, code: v }))}
            maxLength={20}
          />
          <label>角色名称</label>
          <Input
            placeholder="如 财务专员"
            value={createForm.name}
            onChange={(v: string) => setCreateForm((f) => ({ ...f, name: v }))}
            maxLength={20}
          />
          <label>描述（可选）</label>
          <Input
            placeholder="这个角色负责什么"
            value={createForm.description}
            onChange={(v: string) => setCreateForm((f) => ({ ...f, description: v }))}
            maxLength={200}
          />
        </div>
      </Modal>

      {/* ===================== 编辑角色信息 ===================== */}
      <Modal
        title={editTarget ? `编辑角色「${editTarget.name}」` : ''}
        visible={!!editTarget}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={onSubmitEdit}
        onCancel={() => setEditTarget(null)}
      >
        <div className="role-form">
          <label>角色名称</label>
          <Input
            value={editForm.name}
            onChange={(v: string) => setEditForm((f) => ({ ...f, name: v }))}
            maxLength={20}
          />
          <label>描述</label>
          <Input
            value={editForm.description}
            onChange={(v: string) => setEditForm((f) => ({ ...f, description: v }))}
            maxLength={200}
          />
        </div>
      </Modal>
    </div>
  )
}
