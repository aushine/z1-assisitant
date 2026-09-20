/**
 * User management page (React 18 + TSX)
 * A1/A2：接入真实 userApi（list/create/update/setStatus/remove），
 * 新增/编辑/禁用/删除 + 搜索 + 分页。PATCH 带乐观锁 version。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Card,
  Tag,
  Table,
  Avatar,
  Button,
  Input,
  Select,
  Modal,
  Pagination,
  Skeleton,
  Toast,
} from '@douyinfe/semi-ui'
import { useDisplayName, useUserRole } from '@/stores/user'
import { userApi } from '@/api/user'
import { roleApi } from '@/api/role'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import ErrorState from '@/components/ErrorState'
import { resolveFileUrl } from '@/utils/avatar'
import type { User, Role, RoleCode, UserStatus, DisableUserReq } from '@/api/types'

// D-03：角色不再是写死三选——内置 admin/user 有专属外观，
// 自定义角色统一徽标样式、名称来自 GET /roles 动态列表
const BUILTIN_ROLE_META: Record<string, { text: string; icon: IconName; tint: TintName }> = {
  admin: { text: '管理员', icon: 'ShieldCheck', tint: 'warning' },
  user: { text: '用户', icon: 'User', tint: 'accent' },
}

const PAGE_SIZE = 10

interface UserFormState {
  username: string
  password: string
  name: string
  email: string
  phone: string
  role: RoleCode
}

// D-03 第九轮：部门字段从本模块 UI 移除（后端列/DTO 兼容保留，前端不再传）
const EMPTY_FORM: UserFormState = {
  username: '',
  password: '',
  name: '',
  email: '',
  phone: '',
  role: 'user', // D-03：新用户默认落内置「用户」角色
}

export default function UserPage() {
  const displayName = useDisplayName()
  const role = useUserRole()

  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')

  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // D-03：角色下拉动态化（本页面能进来即已持有 user_mgmt:view，roleApi 可正常调用）
  const [roles, setRoles] = useState<Role[]>([])
  useEffect(() => {
    roleApi.list().then(setRoles).catch(() => setRoles([]))
  }, [])
  const roleMap = useMemo(() => {
    const m: Record<string, Role> = {}
    roles.forEach((r) => { m[r.code] = r })
    return m
  }, [roles])
  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.code, label: r.is_system ? `${r.name}（内置）` : r.name })),
    [roles]
  )

  const fetchUsers = useCallback(async (p = 1) => {
    setLoading(true)
    setError('')
    try {
      const res = await userApi.list({ page: p, page_size: PAGE_SIZE })
      setUsers(res.items ?? [])
      setTotal(res.total ?? 0)
      setPage(p)
    } catch {
      setUsers([])
      setTotal(0)
      setError('用户列表加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers(1)
  }, [fetchUsers])

  // A2：ListUsersQuery 无 keyword 字段，搜索为「已加载页」的客户端过滤
  const filtered = keyword.trim()
    ? users.filter(
        (u) =>
          u.name.includes(keyword.trim()) ||
          u.username.includes(keyword.trim()) ||
          u.email.includes(keyword.trim())
      )
    : users

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalVisible(true)
  }

  const openEdit = (u: User) => {
    setEditing(u)
    setForm({
      username: u.username,
      password: '',
      name: u.name,
      email: u.email,
      phone: u.phone ?? '',
      role: u.role,
    })
    setModalVisible(true)
  }

  const submitForm = async () => {
    if (!form.name.trim()) { Toast.error('请输入昵称'); return }
    // D-03 第九轮：邮箱/手机号新建与编辑均可见、均非必填（留空落库 NULL）；
    // 填了才校验格式；部门不再维护
    const emailTrimmed = form.email.trim()
    if (emailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      Toast.error('邮箱格式不正确'); return
    }
    if (!editing && !form.username.trim()) { Toast.error('请输入用户名'); return }
    setSaving(true)
    try {
      if (editing) {
        await userApi.update(editing.id, {
          name: form.name.trim(),
          // 空串显式发送 = 清空（后端转 NULL）；undefined 才是「不改」
          email: emailTrimmed,
          phone: form.phone.trim(),
          role: form.role,
          version: editing.version ?? 0,
        })
        Toast.success('用户已更新')
      } else {
        await userApi.create({
          username: form.username.trim(),
          name: form.name.trim(),
          role: form.role,
          // 第九轮回添可选项：留空不传 → 后端落库 NULL
          email: emailTrimmed || undefined,
          phone: form.phone.trim() || undefined,
        })
        Toast.success('用户已创建，初始密码 123456，首次登录将提示修改')
      }
      setModalVisible(false)
      await fetchUsers(page)
    } catch (e) {
      // 拦截器已 Toast 具体原因；刷新列表以同步最新 version
      console.error('[user] 保存失败', e)
      await fetchUsers(page)
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = (u: User) => {
    const next: UserStatus = u.status === 'active' ? 'disabled' : 'active'
    Modal.confirm({
      title: next === 'active' ? '启用用户' : '禁用用户',
      content: `确认${next === 'active' ? '启用' : '禁用'}「${u.name}」？`,
      okText: next === 'active' ? '启用' : '禁用',
      okButtonProps: { type: next === 'active' ? 'primary' : 'warning', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        try {
          // DisableUserReq 只有 status，但后端 PATCH /users/:id/status 要求 version，补上
          await userApi.setStatus(u.id, { status: next, version: u.version ?? 0 } as DisableUserReq & { version: number })
          Toast.success(next === 'active' ? '已启用' : '已禁用')
        } catch (e) {
          console.error('[user] 状态变更失败', e)
        } finally {
          await fetchUsers(page)
        }
      },
    })
  }

  const removeUser = (u: User) => {
    Modal.confirm({
      title: '删除用户',
      content: `确认删除「${u.name}」？此操作不可恢复。`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        try {
          await userApi.remove(u.id)
          Toast.success('已删除')
        } catch (e) {
          console.error('[user] 删除失败', e)
        } finally {
          await fetchUsers(page)
        }
      },
    })
  }

  const columns = [
    {
      title: '成员',
      dataIndex: 'name',
      render: (_v: unknown, record: User) => {
        // D-03 第十轮：渲染真实头像——/uploads/ 相对路径经 resolveFileUrl 拼 origin；
        // 无头像或图片加载失败时 Semi Avatar 自动回落 children（昵称/用户名首字）
        const src = resolveFileUrl(record.avatar)
        return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar
            size="small"
            src={src}
            style={src ? undefined : { backgroundColor: 'var(--color-primary-500)', color: 'white' }}
          >
            {(record.name || record.username).slice(0, 1)}
          </Avatar>
          <div>
            <div style={{ fontWeight: 600 }}>{record.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>@{record.username}</div>
          </div>
        </div>
        )
      },
    },
    { title: '邮箱', dataIndex: 'email' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 120,
      render: (r: RoleCode) => {
        const builtin = BUILTIN_ROLE_META[r]
        const text = builtin?.text ?? roleMap[r]?.name ?? r
        const tint = builtin?.tint ?? ('success' as TintName)
        const icon = builtin?.icon ?? ('Users' as IconName)
        return (
          <Tag style={{ background: TINT_VARS[tint].bg, color: TINT_VARS[tint].fg, border: 'none' }}>
            <Icon name={icon} size={14} style={{ marginRight: 4 }} />{text}
          </Tag>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: UserStatus) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '启用' : '已禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: 200,
      render: (_v: unknown, record: User) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Button
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<Icon name="Pencil" size={16} />}
            onClick={() => openEdit(record)}
          >
            编辑
          </Button>
          <Button
            theme="borderless"
            type={record.status === 'active' ? 'warning' : 'primary'}
            size="small"
            onClick={() => toggleStatus(record)}
          >
            {record.status === 'active' ? '禁用' : '启用'}
          </Button>
          <Button
            theme="borderless"
            type="danger"
            size="small"
            icon={<Icon name="Trash2" size={16} />}
            onClick={() => removeUser(record)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="user-page">
      <div className="page-tip">
        用户管理 · <span className="warn">需要用户管理权限</span>
        <span className="who">· 当前身份：{displayName} ({role})</span>
      </div>

      <Card bordered={false} className="card">
        <div className="user-toolbar">
          <div className="user-toolbar-left">
            <Input
              value={keyword}
              onChange={setKeyword}
              placeholder="搜索昵称 / 用户名 / 邮箱"
              prefix={<Icon name="Search" size={16} />}
              style={{ width: 240 }}
              showClear
            />
          </div>
          <Button theme="solid" type="primary" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreate}>
            新建用户
          </Button>
        </div>

        {loading && users.length === 0 ? (
          <div className="skeleton-wrap"><Skeleton /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchUsers(page)} />
        ) : filtered.length > 0 ? (
          <Table columns={columns as any} dataSource={filtered} pagination={false} size="middle" rowKey="id" />
        ) : (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
            {keyword ? '没有匹配的用户' : '暂无用户，点击「新建用户」添加'}
          </div>
        )}

        {!error && total > PAGE_SIZE && (
          <div className="pager-wrap">
            <Pagination currentPage={page} pageSize={PAGE_SIZE} total={total} onPageChange={(p) => fetchUsers(p)} />
          </div>
        )}
      </Card>

      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={submitForm}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        maskClosable={!saving}
      >
        <div className="field">
          <label className="field-label">用户名 {editing ? '' : <span className="required">*</span>}</label>
          <Input
            value={form.username}
            onChange={(v: string) => setForm((f) => ({ ...f, username: v }))}
            placeholder="登录用户名"
            disabled={!!editing}
          />
        </div>
        {!editing && (
          <div className="field">
            <label className="field-label">初始密码</label>
            <Input value="123456" disabled />
          </div>
        )}
        <div className="field">
          <label className="field-label">昵称 <span className="required">*</span></label>
          <Input
            value={form.name}
            onChange={(v: string) => setForm((f) => ({ ...f, name: v }))}
            placeholder="显示昵称"
          />
        </div>
        {/* D-03 第九轮：邮箱/手机号新建、编辑通用且非必填；编辑态清空并保存即置空 */}
        <div className="field">
          <label className="field-label">邮箱（可选）</label>
          <Input
            value={form.email}
            onChange={(v: string) => setForm((f) => ({ ...f, email: v }))}
            placeholder="邮箱地址，留空不填"
          />
        </div>
        <div className="field">
          <label className="field-label">手机号（可选）</label>
          <Input
            value={form.phone}
            onChange={(v: string) => setForm((f) => ({ ...f, phone: v }))}
            placeholder="手机号，留空不填"
          />
        </div>
        <div className="field">
          <label className="field-label">角色</label>
          <Select
            value={form.role}
            onChange={(v: any) => setForm((f) => ({ ...f, role: v as RoleCode }))}
            optionList={roleOptions}
            style={{ width: '100%' }}
          />
        </div>
      </Modal>

      <Card title="说明" bordered={false} className="card">
        <div className="hint">
          该模块用于管理员维护系统成员。修改用户（PATCH）与启用/禁用（PATCH /users/:id/status）
          均携带乐观锁 version，并发冲突时请刷新后重试。搜索仅作用于当前页。
        </div>
      </Card>
    </div>
  )
}
