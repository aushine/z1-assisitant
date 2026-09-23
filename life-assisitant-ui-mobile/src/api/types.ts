/**
 * API 类型定义（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/api/types.ts
 * SYNC-FROM-BACKEND:  life-assisitant-api/internal/model/dto/*.go
 *                   + life-assisitant-api/internal/controller/router.go（端点）
 * 契约变更时必须同步更新本文件与桌面端。最后同步：2026-09-18
 *
 * ⚠️ 裁定基准：**以后端实际返回为准**（见 md/移动端移植方案.md §R2）。
 *    桌面端 types.ts 存在若干与后端不符的字段（如 `BudgetScope='overall'`、
 *    `ReverseTransactionResp` 的扁平结构），本文件不照抄，一律以
 *    `internal/model/dto` 的 struct tag 为准。
 *
 * ⚠️ 列表响应的 `has_more` / `page_size` 取决于 controller 用的是
 *    `response.Page()` 还是直接 `response.Success(struct)`：
 *      - 走 response.Page：/tasks /habits /transactions /users /notifications
 *        → 含 { items, total, page, page_size, has_more }
 *      - 走裸 struct：/accounts /budgets /moods /roles ...
 *        → 不含分页字段，需自行用 items.length 判断
 */

/** 业务错误码：统一从 constants/auth-codes.ts 取，此处再导出一次保持既有 import 路径可用 */
export { ErrorCode } from '@/constants/auth-codes'

/** 健康概览卡色调（normal / neutral），取自指标常量，前端禁止按数值上红绿色 */
import type { HealthCardTone } from '@/constants/health'

/* ============================================================================
 * 通用响应封装（后端 internal/response/response.go 的 Body）
 * ========================================================================== */

/** 统一响应体（成功与错误同构，仅按 code 区分） */
export interface ApiResponse<T = unknown> {
  code: number
  /** 英文错误码（机器可读），仅错误时有 */
  error?: string
  /** 中文消息（用户可读） */
  message?: string
  data?: T
  /** 详细错误（字段级 / cause） */
  details?: Record<string, unknown>
  request_id?: string
}

/** 后端 response.PageBody —— 走 response.Page() 的接口固定返回此结构 */
export interface PagedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

/** 列表查询通用参数 */
export interface PageQuery {
  page?: number
  page_size?: number
}

/* ============================================================================
 * 用户 / 角色 / 权限
 * ========================================================================== */

/**
 * 角色编码：内置 'admin' | 'user'（后端 model.RoleAdmin / RoleUser），
 * 其余为自定义角色（正则 ^[a-z][a-z0-9_]{1,19}$），故类型必须是 string，
 * 由 GET /roles 动态驱动。
 *
 * ⚠️ 旧类型 `'admin' | 'editor' | 'viewer'` 已废弃：editor/viewer 在
 *    后端 260917 迁移中删除，只有 admin / user 两个内置角色。
 */
export type RoleCode = string

/** 用户状态 */
export type UserStatus = 'active' | 'disabled' | 'deleted'

/** 用户对象（后端 dto.UserResp） */
export interface User {
  id: string
  username: string
  name: string
  email: string
  phone?: string
  avatar?: string
  role: RoleCode
  department?: string
  status: UserStatus
  created_at: string
  updated_at?: string
  last_login_at?: string
  last_login_ip?: string
  last_login_device?: string
  /** 乐观锁版本号；UpdateUserReq / UpdateUserStatusReq 必填 */
  version: number
  /** 管理员代建的初始密码（123456）未改 → 主界面提示去安全页改密 */
  pwd_reset_required?: boolean
}

/** 角色对象（后端 dto.RoleResp） */
export interface Role {
  /** 自增排序号：admin=1，user=2，自定义按创建顺序递增（业务主键仍是 code） */
  id: number
  code: RoleCode
  name: string
  description?: string
  is_system: boolean
  user_count: number
}

/** @deprecated 用 Role。旧名字保留以免大范围改动。 */
export type RoleInfo = Role

/**
 * 权限点（后端 dto.PermissionResp）
 * point 格式 = `${module}:${action}`，如 "task:complete"
 */
export interface Permission {
  id: string
  /** 后端权限目录决定（勿在此枚举，会烂）：UI 中文名见权限页 MODULE_NAMES */
  module: string
  /** view / create / update / complete / checkin / write / grant ... */
  action: string
  /** 中文标签，UI 可直接显示 */
  description: string
}

/** 我的有效权限（GET /auth/me/permissions → dto.UserPermissionsResp） */
export interface MyPermissionsResp {
  user_id: string
  role: RoleCode
  permissions: string[]
  /** module -> actions */
  matrix: Record<string, string[]>
}

/** 新建自定义角色（POST /roles → dto.CreateRoleReq） */
export interface CreateRoleReq {
  /** 正则 ^[a-z][a-z0-9_]{1,19}$ */
  code: string
  name: string
  description?: string
}

/** 更新角色元信息（PATCH /roles/:code；编码不可变，矩阵改动走 permissions 端点） */
export interface UpdateRoleReq {
  name?: string
  description?: string
}

/** 角色权限矩阵响应（GET /roles/:code/permissions → dto.PermissionMatrixResp） */
export interface PermissionMatrixResp {
  role: RoleCode
  version: number
  updated_at?: string
  /** module -> actions */
  matrix: Record<string, string[]>
}

/** 覆盖设置角色权限矩阵（PUT /roles/:code/permissions，带乐观锁） */
export interface UpdatePermissionMatrixReq {
  /** 新建角色矩阵为空、版本恒 0，首次保存须能以 0 通过 */
  version: number
  matrix: Record<string, string[]>
}

/** @deprecated 用 UpdatePermissionMatrixReq —— 旧的 {permissions: string[]} 与后端不符 */
export type UpdateRolePermissionsReq = UpdatePermissionMatrixReq

/* ============================================================================
 * 鉴权
 * ========================================================================== */

/** 登录请求（POST /auth/login） */
export interface LoginReq {
  /** 账号或邮箱 */
  username: string
  password: string
  /** 是否记住（7 天免登录，仅当前设备） */
  remember?: boolean
  /** 设备指纹 UUID（必填，后端 v:"required"） */
  device_id: string
}

/** @deprecated 用 LoginReq */
export type LoginInput = LoginReq

/** 登录响应（dto.LoginResp） */
export interface LoginResp {
  access_token: string
  refresh_token: string
  expires_in: number
  /** 固定 "Bearer" */
  token_type?: string
  user: User
}

/** @deprecated 用 LoginResp */
export type LoginResult = LoginResp

/** 注册请求（POST /auth/register；D-03 起不可自选角色） */
export interface RegisterReq {
  username: string
  password: string
  name: string
  email: string
  phone?: string
  device_id: string
}

/** @deprecated 用 RegisterReq */
export type RegisterInput = RegisterReq

/** 注册响应 */
export interface RegisterResp {
  access_token: string
  refresh_token: string
  expires_in: number
  user: User
}

/**
 * 刷新 token 请求（POST /auth/refresh）
 * ⚠️ device_id 是后端必填字段（v:"required"），旧移动端类型漏了它，
 *    会导致刷新必然 400 —— 这是本次移植修掉的一个真实缺陷。
 */
export interface RefreshReq {
  refresh_token: string
  device_id: string
}

/** @deprecated 用 RefreshReq */
export type RefreshInput = RefreshReq

/**
 * 刷新响应（rotation：同时下发新 access + 新 refresh）
 * ⚠️ 旧移动端类型漏了 refresh_token，会导致轮换后拿旧 refresh 再次刷新失败。
 */
export interface RefreshResp {
  access_token: string
  refresh_token: string
  expires_in: number
}

/** @deprecated 用 RefreshResp */
export type RefreshResult = RefreshResp

/** 退出登录请求（POST /auth/logout） */
export interface LogoutReq {
  refresh_token?: string
  all_devices?: boolean
}

/** 修改密码（POST /auth/change-password；new_password 至少 8 位） */
export interface ChangePasswordReq {
  old_password: string
  new_password: string
}

/** @deprecated 用 ChangePasswordReq */
export type ChangePasswordInput = ChangePasswordReq

/** 忘记密码（POST /auth/forgot-password） */
export interface ForgotPasswordReq {
  email: string
}

/** @deprecated 用 ForgotPasswordReq */
export type ForgotPasswordInput = ForgotPasswordReq

/** 重置密码（POST /auth/reset-password，凭邮件 token） */
export interface ResetPasswordReq {
  token: string
  new_password: string
}

/** @deprecated 用 ResetPasswordReq */
export type ResetPasswordInput = ResetPasswordReq

/* ============================================================================
 * 用户管理（admin）
 * ========================================================================== */

export interface ListUsersQuery extends PageQuery {
  /** 按姓名/邮箱/手机号/用户名搜索 */
  keyword?: string
  role?: RoleCode
  status?: UserStatus
}

/** 新建用户（POST /users；密码由后端统一初始化为 123456，首登强制改密） */
export interface CreateUserReq {
  username: string
  name: string
  role: RoleCode
  email?: string
  phone?: string
  department?: string
}

/** 更新用户（PATCH /users/:id；version 必填，乐观锁） */
export interface UpdateUserReq {
  name?: string
  email?: string
  phone?: string
  avatar?: string
  role?: RoleCode
  department?: string
  version: number
}

/**
 * 自更新个人资料（PATCH /users/me）
 * 刻意**不含** role / status / department —— 后端 UpdateMeReq 结构上就没有，
 * 提权面已封死。
 */
export interface UpdateMeReq {
  name?: string
  email?: string
  phone?: string
  /** 允许 data:image/* （128px base64）或 http(s) 外链 */
  avatar?: string
  /** 可选；缺省时后端用服务端当前 version 作 CAS 基准 */
  version?: number
}

/** @deprecated 用 UpdateMeReq */
export type UpdateProfileInput = UpdateMeReq

/** 启用/禁用用户（PATCH /users/:id/status；version 必填） */
export interface UpdateUserStatusReq {
  status: 'active' | 'disabled'
  version: number
}

/** @deprecated 用 UpdateUserStatusReq —— 旧类型缺 version，乐观锁必失败 */
export type SetUserStatusReq = UpdateUserStatusReq

/** 分配角色（PUT /users/:id/role；仅需 role，user_id 走路径） */
export interface AssignRoleReq {
  role: RoleCode
}

/** 用户的有效权限（GET /users/:id/permissions） */
export type UserPermissionsResp = MyPermissionsResp

/* ============================================================================
 * 任务（Tasks）
 * ========================================================================== */

/** 任务优先级 */
export type TaskPriority = 'relaxed' | 'normal' | 'important' | 'urgent'

/** 任务状态 */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'archived'

/** 列表筛选维度 */
export type TaskFilter = 'all' | 'today' | 'upcoming' | 'done' | 'overdue'

/** 排序字段（后端 ListTasksReq.sort 仅接受这三个） */
export type TaskSort = 'due_time' | 'priority' | 'created_at'

/** 子任务 */
export interface Subtask {
  id: string
  title: string
  is_completed: boolean
  order: number
}

/** 子任务请求体（创建 / 全量替换） */
export interface SubtaskReq {
  id?: string
  title: string
  is_completed?: boolean
  order: number
}

/** 任务实体（后端 dto.TaskResp） */
export interface Task {
  id: string
  title: string
  description?: string
  priority: TaskPriority
  status: TaskStatus
  category_id?: string
  category_emoji?: string
  /** 图标引用：lucide:<Name> | <Name> | emoji；空 = 继承分类图标（spec 04 §4.2） */
  icon?: string
  /** YYYY-MM-DD */
  due_date?: string
  /** HH:MM */
  due_time?: string
  /** ISO datetime */
  reminder_at?: string
  /** RRULE，如 FREQ=DAILY */
  recurrence_rule?: string
  parent_task_id?: string
  subtasks_count?: number
  /** 仅 GET /tasks/:id 返回完整列表；列表接口不带 */
  subtasks?: Subtask[]
  created_at: string
  updated_at: string
  completed_at?: string
}

/** 创建任务请求体 */
export interface CreateTaskReq {
  title: string
  description?: string
  priority?: TaskPriority
  category_id?: string
  /** 图标引用：lucide:<Name>；空/省略 = 继承分类图标（spec 04 §4.2） */
  icon?: string
  due_date?: string
  due_time?: string
  reminder_at?: string
  recurrence_rule?: string
  subtasks?: SubtaskReq[]
}

/** 更新任务请求体（部分更新；due_date/due_time/reminder_at/recurrence_rule 传空串表示清空） */
export interface UpdateTaskReq {
  title?: string
  description?: string
  priority?: TaskPriority
  status?: TaskStatus
  category_id?: string
  /** 图标引用：lucide:<Name>；空串 = 清除自选、继承分类图标（spec 04 §4.2） */
  icon?: string
  due_date?: string
  due_time?: string
  reminder_at?: string
  recurrence_rule?: string
  subtasks?: SubtaskReq[]
}

/** 任务列表查询参数（GET /tasks） */
export interface ListTasksQuery extends PageQuery {
  filter?: TaskFilter
  status?: TaskStatus
  priority?: TaskPriority
  keyword?: string
  sort?: TaskSort
}

/** 任务列表响应（走 response.Page，含分页四件套） */
export type ListTasksResp = PagedResponse<Task>

/** 批量操作请求（POST /tasks/batch） */
export interface BatchTaskReq {
  action: 'complete' | 'delete'
  /** 1-100 个 */
  task_ids: string[]
}

/** 批量操作响应 */
export interface BatchTaskResp {
  affected: number
}

/* ============================================================================
 * 习惯（Habits）
 * ========================================================================== */

export type HabitFrequency = 'daily' | 'weekly' | 'monthly'
export type HabitStatus = 'active' | 'archived'
/**
 * 习惯分类 id —— spec 04 §2.3：分类实体化后不再是硬枚举。
 * 内置值仍为 sport/diet/life/study（存量零迁移），用户新建的为 uc_habit_xxx。
 */
export type HabitCategory = string

/** 习惯实体（后端 dto.HabitResp） */
export interface Habit {
  id: string
  title: string
  description?: string
  /** emoji */
  icon: string
  /** 图标底色 hex */
  color: string
  category: HabitCategory
  frequency: HabitFrequency
  target_count: number
  unit?: string
  track_duration?: boolean
  status: HabitStatus

  /** ===== 连续打卡（单位随 frequency：天/周/月，后端打卡时重算落库） ===== */
  current_streak?: number
  longest_streak?: number
  last_check_in_date?: string
  total_check_ins?: number

  created_at: string
  updated_at?: string

  /** ===== 今日相关（仅 List / GetToday 时填充） ===== */
  today_count?: number
  /** 后端字段：今日是否达成目标 */
  today_completed?: boolean
  today_date?: string
  /** Compat alias：normalizeHabit() 从 today_completed 镜像而来，勿在请求体里发 */
  today_done?: boolean
}

/** Compat: today_done 与 today_completed 互为镜像 */
export type HabitWithDone = Habit & { today_done?: boolean }

export interface CreateHabitReq {
  title: string
  description?: string
  icon?: string
  color?: string
  category?: HabitCategory
  frequency?: HabitFrequency
  target_count?: number
  unit?: string
  track_duration?: boolean
}

export interface UpdateHabitReq extends Partial<CreateHabitReq> {
  status?: HabitStatus
}

/** 习惯列表查询参数（GET /habits） */
export interface ListHabitsQuery extends PageQuery {
  status?: HabitStatus | ''
}

/** 习惯列表响应（走 response.Page） */
export type ListHabitsResp = PagedResponse<Habit>

/** 今日习惯响应（GET /habits/today → dto.TodayHabitsResp，**不是**分页结构） */
export interface TodayHabitsResp {
  date: string
  items: Habit[]
  total: number
  done_count: number
}

/** 打卡请求体（POST /habits/:id/log；date 必填，一天一条 upsert count 累加） */
export interface LogHabitReq {
  /** YYYY-MM-DD */
  date: string
  /** 本次打卡次数，1-99，默认 1 */
  count?: number
  note?: string
  /** 0-1440 分钟 */
  duration_minutes?: number
}

/** 把后端的 today_completed 镜像到 today_done，供模板直接读（SYNC-FROM-DESKTOP: utils/normalize） */
export function normalizeHabit(h: Habit): Habit {
  return { ...h, today_done: h.today_completed }
}

/* ============================================================================
 * 心情 / 精力（Moods）
 * ========================================================================== */

/** 心情档位 1–5（很差 / 低落 / 一般 / 不错 / 很好） */
export type MoodValue = 1 | 2 | 3 | 4 | 5

/** 精力档位 1–3（疲惫 / 一般 / 充沛） */
export type EnergyValue = 1 | 2 | 3

/**
 * 心情/精力的最小记录单位：某天的某一个小时（0-23）。
 * 心情/精力读取时后端已做「向前延续」填充，前端直接展示，不要自己算延续。
 */
export interface MoodHourItem {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** 0-23；12 = 经期日记的一天一条槽位（记录模块用不到） */
  hour: number
  /** 1-5；0 = 该小时确无心情（读取时后端已做向前延续，仍无才是 0） */
  mood: MoodValue | 0
  /** 1-3；0 = 不填 */
  energy: EnergyValue | 0
  /** ≤50 字。不延续，只属于写下它的那个小时 */
  note: string
  created_at: string
  updated_at: string
}

/** 某天的心情时间线 */
export interface MoodTimelineResp {
  date: string
  /** 服务器当前小时 0-23 */
  now_hour: number
  /** 按 hour 升序；只含实际存在的行 */
  items: MoodHourItem[]
}

/**
 * 记录/修改某天某个小时（PUT /moods）。
 * 三态语义：**字段缺省 = 不动**（不是清空）；`mood:0` / `energy:0` / `note:''` = 显式清空该字段。
 * 三个字段最终全空 → 后端删掉空行。hour 缺省 = 服务器当前小时。
 */
export interface MoodUpsertReq {
  date: string
  /** 0-23；缺省 = 服务器当前小时 */
  hour?: number
  /** 1-5；0 = 该小时不填心情；缺省 = 不动既有值（新建行时留空，读取时按上一条延续填充） */
  mood?: MoodValue | 0
  /** 1-3；0 = 不填；缺省同 mood */
  energy?: EnergyValue | 0
  /** ≤50；"" = 清空；缺省 = 不动该行既有备注 */
  note?: string
}

/** PUT /moods 响应；item 为 null 表示该格已被清空（后端会删掉空行） */
export interface MoodUpsertResp {
  item: MoodHourItem | null
}

/** 心情区间查询（GET /moods） */
export interface ListMoodsQuery {
  start_date: string
  end_date: string
}

/** 心情列表响应（裸 struct，无分页字段） */
export interface ListMoodsResp {
  items: MoodHourItem[]
}

/* ============================================================================
 * 生活时间线（Timeline）
 * ========================================================================== */

/** 时间线事件类型（后端注释含 milestone，但实际返回以 task/habit/expense/income/mood 为主） */
export type TimelineEventType = 'task' | 'habit' | 'expense' | 'income' | 'mood' | 'milestone'

/** 时间线事件（跨模块聚合，统一结构） */
export interface TimelineEvent {
  id: string
  type: TimelineEventType
  title: string
  detail?: string
  /** 金额（支出为负、收入为正） */
  amount?: number
  /** HH:MM（当天内） */
  time: string
  /** 图标提示（emoji / 任务优先级 / 心情档位） */
  icon_hint?: string
}

/** 时间线查询参数（GET /timeline） */
export interface TimelineQuery extends PageQuery {
  /** YYYY-MM-DD，默认今天 */
  date?: string
}

/** 时间线响应 */
export interface TimelineResp {
  date: string
  items: TimelineEvent[]
  total: number
}

/* ============================================================================
 * 账户 / 交易 / 预算（Finance）
 * ========================================================================== */

/**
 * 账户类型（18 枚举，spec-20260922-v1 · 01 §3.2）。
 * ⚠️ 与 src/constants/account.ts 的 AccountType、后端 account_vocab.go 同源；
 * 此处独立声明为字面量联合（结构相同即兼容），存储值与后端白名单一致。
 */
export type AccountType =
  // ① 资金账户
  | 'cash' | 'saving' | 'alipay' | 'wechat' | 'yuebao' | 'prepaid' | 'ewallet' | 'other_asset'
  // ② 信用账户
  | 'credit' | 'huabei' | 'baitiao' | 'loan' | 'other_credit'
  // ③ 理财账户
  | 'fund' | 'stock' | 'deposit' | 'gold' | 'other_investment'

/** 账户实体（后端 dto.AccountResp） */
export interface Account {
  id: string
  name: string
  type: AccountType
  /** 银行 code（CCB/ICBC 等），'' = 未指定（spec-20260922-v1 · 01 §7.1） */
  institution: string
  /** 图标引用：brand:<slug> | lucide:<Name> | emoji（02 §5.1） */
  icon: string
  /** 图标底色 */
  color: string
  balance: number
  created_at: string
  updated_at?: string
}

export interface CreateAccountReq {
  name: string
  type: AccountType
  /** 银行 code，'' / 缺省 = 未指定（后端只校验长度 ≤20，不校验白名单，D20） */
  institution?: string
  icon?: string
  color?: string
  balance?: number
}

export interface UpdateAccountReq extends Partial<CreateAccountReq> {
  /**
   * ⭐ 余额调整流水开关（Phase 3.4 · 05 §A.5）。
   * 后端语义：**只有显式 true 才生成**余额调整流水（nil/false 都不生成，
   * 老前端只传 balance → 不产生流水，向后兼容 D19）。
   * 新前端：编辑保存默认显式传 true；勾「不记录收支」传 false；新建账户不传。
   */
  record_flow?: boolean
}

/** 账户列表响应（裸 struct：含 total_balance，不分页） */
export interface ListAccountsResp {
  items: Account[]
  total_balance: number
  total: number
  /** ===== spec-20260922-v1 Phase 4：L1 大类归并（与 GET /accounts/total 同口径；加字段不删字段）===== */
  /** 资金组小计（负值原样，透支是事实） */
  assets: number
  /** 理财组小计 */
  investments: number
  /** 信用组小计（⚠️ 负数原值，展示时取绝对值 + 「负债」标签） */
  debts: number
  /** = assets + investments + debts ≡ total_balance（恒等） */
  net_worth: number
}

/**
 * 净资产响应（GET /accounts/total）
 * ⚠️ 后端只返回 total_balance；桌面端类型里的 total_assets / total_liabilities
 *    后端并不下发，属桌面端的错误声明，此处不照抄。
 */
export interface TotalBalanceResp {
  total_balance: number
}

export type TransactionType = 'expense' | 'income' | 'transfer'

/** 交易实体（后端 dto.TransactionResp） */
export interface Transaction {
  id: string
  type: TransactionType
  /** 始终为正；方向由 type 表达 */
  amount: number
  /** ⭐ 分类 id（新版；未迁移的历史数据为空 → 渲染走快照降级，见 05 §3） */
  category_id?: string
  category_emoji?: string
  category_name?: string
  account_id: string
  account_name?: string
  /** transfer 时使用 */
  to_account_id?: string
  to_account_name?: string
  note?: string
  /** ISO datetime */
  happened_at: string
  /** ⭐ 不计入预算（06 §2 口径开关） */
  exclude_budget?: boolean
  /** ⭐ 不计入收支统计（06 §2 口径开关） */
  exclude_stats?: boolean
  /** 来源标记：''=普通 / balance_adjust / reimburse / lend / borrow / refund（v4 挂载点） */
  source?: string
  /** 对方（借出/借入/待报销核销关联用，v4） */
  contact?: string
  /** 关联的原交易 id（退款/报销到账等核销场景，v4） */
  settle_of?: string
  created_at: string
  /** 更新时间（详情页「记录信息」行用） */
  updated_at?: string
  /** 被哪笔交易冲正（非空 = 该笔已被撤销） */
  reversed_by?: string
}

/** 创建交易请求体（POST /transactions；transfer 走独立接口，无 to_account_id） */
export interface CreateTransactionReq {
  type: TransactionType
  amount: number
  /** ⭐ 新版：传 id 后由后端取 full_name 写 category_name 快照（06 §2.1） */
  category_id?: string
  category_emoji?: string
  category_name?: string
  account_id: string
  note?: string
  happened_at?: string
  /** ⭐ 不计入预算（05 §A 口径开关；v2 后端已落库） */
  exclude_budget?: boolean
  /** ⭐ 不计入收支（05 §A 口径开关） */
  exclude_stats?: boolean
  /** ⭐ 性质：''=普通 / reimburse / lend / borrow（⛔ balance_adjust 后端拒绝 400001） */
  source?: string
  /** ⭐ 对方（借出/借入必填、待报销/退款选填；05 §B 统一模型） */
  contact?: string
  /** ⭐ 关联的原交易 id（核销动作；普通录入不传） */
  settle_of?: string
}

/** 更新交易请求体（PATCH /transactions/:id；仅 expense / income） */
export interface UpdateTransactionReq {
  amount?: number
  category_id?: string
  category_emoji?: string
  category_name?: string
  account_id?: string
  happened_at?: string
  note?: string
  /** ⭐ 口径开关：指针语义（缺省 = 不改，05 §A） */
  exclude_budget?: boolean
  exclude_stats?: boolean
  /** ⭐ 仅放开 contact（source / settle_of 禁改） */
  contact?: string
}

/**
 * 转账请求体（POST /transactions/transfer，同时影响两账户）
 * 后端 DTO：dto.TransferReq { from_account_id, to_account_id, amount, happened_at, note }
 */
export interface TransferReq {
  from_account_id: string
  to_account_id: string
  amount: number
  note?: string
  happened_at?: string
}

/** 交易列表查询参数（GET /transactions） */
export interface ListTransactionsQuery extends PageQuery {
  type?: TransactionType
  account_id?: string
  /** 按备注 / 分类名模糊搜索 */
  keyword?: string
  start_date?: string
  end_date?: string
  /** 按对方精确筛选（v4 债权债务聚合） */
  contact?: string
}

/** 交易列表响应（走 response.Page，含分页四件套） */
export type ListTransactionsResp = PagedResponse<Transaction>

/** 撤销交易请求体（POST /transactions/:id/reverse） */
export interface ReverseTransactionReq {
  note?: string
}

/**
 * 撤销/冲正交易响应（后端 dto.ReverseTransactionResp）
 * ⚠️ 后端返回的是**两笔完整交易对象**，不是旧的扁平字段
 *    （original_id / reverse_id / occurred_at 全是桌面端与旧移动端的臆造）。
 */
export interface ReverseTransactionResp {
  original_transaction: Transaction
  reverse_transaction: Transaction
}

/* ==================== 债权债务（GET /finance/debts · Phase 4） ==================== */

/** 按对方聚合的一组未结清（后端聚合 D51：前端聚合会被分页截断） */
export interface DebtItem {
  /** 对方名字（contact 分组键） */
  contact: string
  /** 涉及的性质（⊆ reimburse / lend / borrow） */
  kinds: string[]
  /** 未结清金额（已结清不出现，后端 HAVING open > 0.005） */
  open: number
  /** 未结清的原笔数 */
  count: number
}

/** GET /finance/debts 响应 */
export interface DebtsResp {
  /** 别人欠我（reimburse + lend） */
  owed_to_me: DebtItem[]
  /** 我欠别人（borrow） */
  i_owe: DebtItem[]
  /** 净额 = 别人欠我 − 我欠别人 */
  net: number
}

/* ==================== 收支日历（GET /finance/calendar） ==================== */
/** 月历中的一天（只返回有记录的日期） */
export interface CalendarDay {
  date: string
  income: number
  expense: number
  /** 后端已算好的净额（income - expense，不含转账） */
  net: number
}

/** 月摘要（收入 / 支出 / 结余，结余 = 收入 - 支出） */
export interface CalendarSummary {
  income: number
  expense: number
  net: number
}

/** GET /finance/calendar?month=YYYY-MM 响应 */
export interface CalendarResp {
  month: string
  /** 只含「有记录」的日期（无记录日不返回） */
  days: CalendarDay[]
  summary: CalendarSummary
}

/* ============================================================================
 * 财务自然周期汇总（spec-20260922-v2 · 06 §2 · GET /finance/summary）
 *
 * 给流水页顶部数据块用：一次请求喂 4 个数，**全部服务端口径**（修 S2：
 * 不再「按已加载记录统计」；修 S3：budget 只算 scope=total 且周期匹配）。
 * ⚠️ 与 /stats/finance 的 range=7d/30d/90d（滑动窗口）是两套口径，勿混用。
 * ========================================================================== */

/** 数据块周期（自然周期：周一–周日 / 自然月 / 自然年；与 resolveBudgetRange 同源） */
export type FinanceSummaryPeriod = 'week' | 'month' | 'year'

/** 命中的总预算聚合（⚠️ 只统计 scope=total 且 period=请求周期，D8） */
export interface FinanceSummaryBudget {
  /** 命中的预算条数；0 = 未设总预算（前端显示「未设预算 · 去设置」，不显示 ¥0） */
  count: number
  amount: number
  used: number
  /** = amount − used */
  remaining: number
}

export interface FinanceSummaryResp {
  period: FinanceSummaryPeriod
  /** 本期实际起止（服务端按当前时间推算，供前端展示「本期是哪几天」） */
  start_date: string
  end_date: string
  /** 本期收入（不含 transfer，exclude_stats=0 口径，与统计页一致） */
  income: number
  expense: number
  /** = income − expense（后端算好，避免前端两处减法口径不一） */
  net: number
  budget: FinanceSummaryBudget
}

/* ============================================================================
 * 预算（Budgets）
 * ========================================================================== */

export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly'

/**
 * 预算范围。
 * ⚠️ 后端 model.BudgetScopeTotal = "total"（**不是** "overall"）；
 *    桌面端类型写的 'overall' 会被后端校验拒绝（400505 BUDGET_SCOPE_INVALID）。
 */
export type BudgetScope = 'total' | 'category'

/** 预算实体（后端 dto.BudgetResp） */
export interface Budget {
  id: string
  name: string
  period: BudgetPeriod
  amount: number
  used: number
  scope: BudgetScope
  /** ⭐ 分类 id（scope = category 时必填，且必须是一级分类，见 06 §3） */
  category_id?: string
  category_emoji?: string
  category_name?: string
  start_date: string
  end_date: string
  /** 预警阈值，**0-1 区间**（如 0.8 = 80%），非百分数 */
  alert_threshold: number
  is_alerted: boolean
  created_at: string
}

/** 创建预算请求体（POST /budgets） */
export interface CreateBudgetReq {
  name: string
  period?: BudgetPeriod
  amount: number
  scope?: BudgetScope
  /** scope = category 时必填（一级分类 id） */
  category_id?: string
  category_emoji?: string
  category_name?: string
  start_date?: string
  end_date?: string
  alert_threshold?: number
}

/**
 * 更新预算请求体（PATCH /budgets/:id —— 后端**有** update 端点）
 * ⚠️ period / scope 不可改；分类字段由后端 260921 起支持（06 §3 第 2 条），
 *    因此改分类走这里即可，不必再「删旧建新」。
 */
export interface UpdateBudgetReq {
  name?: string
  amount?: number
  category_id?: string
  category_emoji?: string
  category_name?: string
  start_date?: string
  end_date?: string
  alert_threshold?: number
}

/** 预算列表查询参数（GET /budgets） */
export interface ListBudgetsQuery {
  scope?: BudgetScope
}

/** 预算列表响应（裸 struct，不分页） */
export interface ListBudgetsResp {
  items: Budget[]
}

/* ============================================================================
 * 收支分类（FinanceCategory）—— 2026-09-21 新增
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/finance_category.go
 * 契约文档：md/spec-20260921-v1/06-API规范.md §1
 *
 * 三条约定：
 *   1. **树形返回**（children 内嵌），总量 ~105 条，不分页；
 *   2. 二级的 icon / tint / emoji 可能为 null = **继承父级**（03 §5）。渲染时
 *      二级一律取父级的值，用户显式改过才有自己的值；
 *   3. `full_name` 由后端拼接（一级 = name；二级 = `父-子`），改名时级联更新。
 * ========================================================================== */

/** 分类所属树（与交易类型 expense/income 对齐；transfer 不属于任何树） */
export type FinanceCategoryScope = 'expense' | 'income'

/** 分类实体（后端 dto.FinanceCategoryResp） */
export interface FinanceCategory {
  id: string
  /** "" = 一级分类 */
  parent_id: string
  scope: FinanceCategoryScope
  /** 短名（一级叫「餐饮」，二级叫「三餐」） */
  name: string
  /** 完整名（二级为 `父-子`，如「餐饮-三餐」） */
  full_name: string
  /** 后端存储的 emoji（历史兼容 / 快照用）；null = 继承父级 */
  emoji: string | null
  /** Lucide 图标名（PascalCase）；null = 继承父级，最终兜底 Package */
  icon: string | null
  /** 语义色名（primary/success/...）；null = 继承父级，最终兜底 neutral */
  tint: string | null
  sort: number
  is_builtin: boolean
  children: FinanceCategory[]
}

/** 拉取分类树（GET /finance/categories）；scope 省略 = 返回全部 */
export interface ListFinanceCategoriesQuery {
  scope?: FinanceCategoryScope
}

/**
 * 分类树响应（GET /finance/categories）
 * `seeded` = 本次请求是否触发了后端懒创建播种（`02` §4）
 */
export interface ListFinanceCategoriesResp {
  items: FinanceCategory[]
  seeded: boolean
}

/** 新建分类请求体（POST /finance/categories） */
export interface CreateFinanceCategoryReq {
  /** "" = 一级分类 */
  parent_id: string
  scope: FinanceCategoryScope
  /** 去空白后 1–10 字；同一 user+scope+parent 下不可重名 */
  name: string
  icon?: string | null
  tint?: string | null
  emoji?: string | null
}

/** 更新分类请求体（PATCH /finance/categories/:id；parent_id / scope 不可改） */
export interface UpdateFinanceCategoryReq {
  name?: string
  icon?: string | null
  tint?: string | null
  emoji?: string | null
}

/** 单个分类响应（POST / PATCH 共用） */
export interface FinanceCategoryResp {
  item: FinanceCategory
}

/* ============================================================================
 * 用户分类（UserCategory · 习惯/待办共用）—— spec-20260922-v2/04 & 06 §3
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/user_category.go
 *
 * 三条约定（与收支分类同构，但只有**一级**）：
 *   1. `domain` 区分两域：habit（内置 id = sport/diet/life/study）
 *      task（内置 id = c_work/c_study/c_life/c_health/c_social/c_other）；
 *      新建的 id = uc_<domain>_<10 位随机>（后端生成，前端不造 id）；
 *   2. `icon` 为 `lucide:<Name>` 引用（04 §4.3 落库口径）；空 = 用 emoji 兜底；
 *   3. 无 parent_id / full_name —— 一级平铺，不做两级（D21）。
 * ========================================================================== */

/** 分类所属域（习惯 / 待办） */
export type UserCategoryDomain = 'habit' | 'task'

/** 用户分类实体（后端 dto.UserCategoryResp） */
export interface UserCategory {
  id: string
  domain: UserCategoryDomain
  /** 显示名（≤10 字） */
  name: string
  /** 兼容 emoji（渲染优先 icon；icon 空时用 emoji 反查） */
  emoji?: string | null
  /** 图标引用：lucide:<Name>；空 = 走 emoji 兜底 */
  icon?: string | null
  /** 语义色名（primary/success/...）；空 = neutral */
  tint?: string | null
  sort: number
  is_builtin: boolean
}

/** 拉取分类列表（GET /user-categories?domain=habit|task） */
export interface ListUserCategoriesQuery {
  domain: UserCategoryDomain
}

/** 分类列表响应（`seeded` = 本次请求触发了后端懒创建播种） */
export interface ListUserCategoriesResp {
  items: UserCategory[]
  seeded: boolean
}

/** 单个分类响应（POST / PATCH 共用，同收支分类的 {item} 包装） */
export interface UserCategoryItemResp {
  item: UserCategory
}

/** 新建分类请求体（POST /user-categories） */
export interface CreateUserCategoryReq {
  domain: UserCategoryDomain
  /** 去空白后 1–10 字；同 user+domain 下不可重名（后端行内错误） */
  name: string
  icon?: string | null
  emoji?: string | null
  tint?: string | null
}

/** 更新分类请求体（PATCH /user-categories/:id；⚠️ domain 不可改） */
export interface UpdateUserCategoryReq {
  name?: string
  icon?: string | null
  emoji?: string | null
  tint?: string | null
}

/* ============================================================================
 * 统计（Stats）
 * ========================================================================== */

/** 统计区间（后端 range 参数：7d / 30d / 90d / custom，默认 30d） */
export type StatsRange = '7d' | '30d' | '90d' | 'custom'

/** 区间查询参数 */
export interface StatsRangeQuery {
  range?: StatsRange
  start_date?: string
  end_date?: string
}

/** 统计概览（GET /stats/overview → dto.StatsOverviewResp） */
export interface StatsOverview {
  today_done_tasks: number
  today_total_tasks: number
  /** ⚠️ 0-100（百分比），与其它 rate 的 0-1 口径不同 */
  week_completion_rate: number
  month_expense: number
  month_income: number
  total_balance: number
  habit_today_done: number
  habit_today_total: number
}

/** 按日任务统计 */
export interface TaskDayStat {
  date: string
  total: number
  completed: number
  /** 0-1 */
  rate: number
}

/** 按分类任务统计 */
export interface TaskCategoryStat {
  category: string
  emoji: string
  color: string
  total: number
  completed: number
  /** 0-1 */
  rate: number
}

/** 任务统计响应 */
export interface TaskStats {
  total: number
  completed: number
  pending: number
  overdue: number
  /** 0-1 */
  completion_rate: number
  /** -1~1 */
  completion_rate_change: number
  by_day: TaskDayStat[]
  by_category: TaskCategoryStat[]
}

/** 单个习惯统计 */
export interface HabitStatItem {
  habit_id: string
  name: string
  emoji: string
  color: string
  /** 0-1 */
  completion_rate: number
  current_streak: number
  longest_streak: number
  today_done: number
  today_target: number
}

/** 习惯热力图项 */
export interface HabitHeatmapItem {
  date: string
  completed: number
  total: number
}

/** 习惯统计响应 */
export interface HabitStats {
  total_habits: number
  total_check_ins: number
  daily_average: number
  longest_streak_overall: number
  by_habit: HabitStatItem[]
  heatmap: HabitHeatmapItem[]
}

/** 按日财务统计 */
export interface FinanceDayStat {
  date: string
  expense: number
  income: number
}

/** 按分类财务统计 */
export interface FinanceCategoryStat {
  /** ⭐ 分类 id（06 §2.3；聚合口径已改为按 id） */
  category_id?: string
  category: string
  emoji: string
  color: string
  amount: number
  /** 0-1 */
  percentage: number
  count: number
}

/** 按账户财务统计 */
export interface FinanceAccountStat {
  account: string
  emoji: string
  amount: number
  count: number
}

/** 财务统计响应 */
export interface FinanceStats {
  expense: number
  income: number
  net: number
  /** 同比 % */
  expense_change: number
  income_change: number
  by_day: FinanceDayStat[]
  by_category: FinanceCategoryStat[]
  by_account: FinanceAccountStat[]
}

/** 导出请求参数（GET /stats/export，响应是 CSV 文件流不是 JSON） */
export interface ExportParams extends StatsRangeQuery {
  type: 'tasks' | 'habits' | 'transactions' | 'all'
  format?: 'csv'
}

/** 导出类型 */
export type ExportType = ExportParams['type']

/* ============================================================================
 * 首页聚合（GET /home）
 * ========================================================================== */

/** 首页 KPI（后端 dto.HomeKPI） */
export interface HomeKPI {
  todo_done: number
  todo_total: number
  /** 0-100 */
  todo_rate: number
  habit_done: number
  habit_total: number
  /** 0-100 */
  habit_rate: number
  month_expense: number
  /** 同比 % */
  month_expense_change: number
  month_income: number
  month_income_change: number
}

/** 首页今日任务（轻量对象，**不是**完整 Task） */
export interface HomeTaskItem {
  id: string
  title: string
  priority: TaskPriority
  status: TaskStatus
  category_emoji?: string
  due_time?: string | null
}

/** 首页今日习惯（轻量对象） */
export interface HomeHabitItem {
  id: string
  title: string
  icon: string
  color: string
  target_count: number
  today_count: number
  /** today_count >= target_count */
  completed: boolean
}

/** 首页月度财务 */
export interface HomeMonthFinance {
  expense: number
  income: number
  expense_change: number
  income_change: number
  daily_trend: Array<{ date: string; amount: number }>
  category_pie: Array<{ name: string; value: number; color: string }>
}

/** 首页聚合响应 */
export interface HomeResp {
  greeting: string
  today_date: string
  weekday: string
  kpi: HomeKPI
  today_tasks: HomeTaskItem[]
  today_habits: HomeHabitItem[]
  month_finance: HomeMonthFinance
  unread_notifications: number
}

/* ============================================================================
 * 通知（Notifications）
 * ========================================================================== */

/** 通知对象（后端 dto.NotificationItem） */
export interface Notification {
  id: string
  type: string
  title: string
  body?: string
  is_read: boolean
  read_at?: string
  created_at: string
}

/** 通知列表响应（走 response.Page） */
export type ListNotificationsResp = PagedResponse<Notification>

/** 未读数响应 */
export interface UnreadCountResp {
  count: number
}

/** 标记已读响应 */
export interface MarkReadResp {
  affected: number
}

/* ============================================================================
 * 同步（Sync）
 * ========================================================================== */

/** 模块同步详情 */
export interface SyncModuleDetail {
  last_sync?: string | null
  status?: 'synced' | 'pending' | 'error'
  pending_count?: number
}

/** 同步状态（GET /sync/status） */
export interface SyncStatusResp {
  last_sync_at?: string
  status?: 'synced' | 'syncing' | 'pending' | 'error'
  pending?: number
  details?: Record<string, SyncModuleDetail>
}

/** 触发同步响应（POST /sync） */
export interface SyncTriggerResp {
  status: string
  message: string
}

/* ============================================================================
 * 反馈（Feedback）
 * ========================================================================== */

/** 提交反馈请求体（POST /feedback） */
export interface CreateFeedbackReq {
  type: 'bug' | 'suggestion' | 'other'
  /** 1-2000 字 */
  content: string
  contact?: string
}

/** 反馈响应 */
export interface FeedbackResp {
  id: string
  type: string
  content: string
  contact?: string
  status: string
  created_at: string
}

/* ============================================================================
 * 经期（Period）—— 记录模块的第 5 个维度
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go
 *                     life-assisitant-api/internal/controller/period.go
 * 契约文档：md/spec-260919/05-API规范.md
 *
 * 三条约定：
 *   1. 心情 / 精力 / 备注走既有 mood_logs（mood 1-5 单选、energy 1-3、note ≤50），
 *      **不是**多选 key 数组；拆分后平铺在日记对象上（mood / energy / note）。
 *   2. 预测结果不落表，随所有 period 接口以 prediction 对象返回，前端只渲染不计算。
 *   3. 日期一律 YYYY-MM-DD（本地日期，后端不做时区换算）。
 * ========================================================================== */

/** 预测置信度（03 §4）：insufficient 时一个具体日期都不许显示 */
export type PeriodConfidence = 'high' | 'medium' | 'low' | 'insufficient'

/** 四相阶段 */
export type PeriodPhaseKey = 'menstrual' | 'follicular' | 'ovulation' | 'luteal'

/** 阶段对象 */
export interface PeriodPhase {
  key: PeriodPhaseKey
  label: string
  desc: string
}

/** 当前周期 */
export interface PeriodCurrentCycle {
  start_date: string
  /** 1-based，D1 = 经期第一天 */
  day_index: number
  estimated_length: number
  phase?: PeriodPhase | null
}

/** 下次经期 */
export interface PeriodNextPeriod {
  /** 中心日；high 置信度下前端显示单日，其余显示区间 */
  date: string
  /** [下界, 上界]，high 时两端相同 */
  window: string[]
  length_est: number
  end_est?: string
  days_until: number
  overdue: boolean
}

/** 排卵日 */
export interface PeriodOvulation {
  date: string
  window: string[]
  passed: boolean
}

/** 易孕期 */
export interface PeriodFertileWindow {
  start: string
  end: string
  /** [峰值起, 峰值止] */
  peak: string[]
}

/** 通用日期区间 */
export interface PeriodDateRange {
  start: string
  end: string
}

/** 统计特征（无论置信度都给，供 ⓘ 弹层展示「凭什么」） */
export interface PeriodPredictionStats {
  median_cycle: number
  sigma: number
  recent_cycles: number[]
  median_period: number
  luteal_length: number
}

/** 症状预测项 */
export interface PeriodSymptomItem {
  key: string
  label: string
  rate: number
}

/** 异常提醒（03 §10） */
export interface PeriodAlert {
  code:
    | 'CYCLE_SHORT'
    | 'CYCLE_LONG'
    | 'PERIOD_LONG'
    | 'IRREGULAR'
    | 'NO_PERIOD_90'
    | 'SUSPECT_RECORD'
  level: 'warning' | 'info'
  text: string
}

/** 预测对象（所有 period 接口的公共尾巴） */
export interface PeriodPrediction {
  today: string
  confidence: PeriodConfidence
  confidence_reason: string
  sample_size: number
  current_cycle?: PeriodCurrentCycle | null
  next_period?: PeriodNextPeriod | null
  ovulation?: PeriodOvulation | null
  fertile_window?: PeriodFertileWindow | null
  pms_window?: PeriodDateRange | null
  safe_windows: PeriodDateRange[]
  stats?: PeriodPredictionStats | null
  symptom_forecast: PeriodSymptomItem[]
  alerts: PeriodAlert[]
}

/**
 * 一天的完整日记（period_days ∪ mood_logs）
 * day 为 null 仅当两张表都没有这一天的行。
 */
export interface PeriodDayDetail {
  date: string
  /** 0 未记录 1 点滴 2 量少 3 中等 4 量多 */
  flow: number
  symptoms: string[]
  /** 0-5 */
  pain_level: number
  /** 0 未记录 1 干燥 2 粘稠 3 乳白 4 水样 5 蛋清拉丝 */
  discharge: number
  bbt: number | null
  weight: number | null
  sleep_hours: number | null
  /** 0 未记录 1 有(未避孕) 2 有(避孕) */
  intercourse: number
  /** 来自 mood_logs；该行不存在时为 null */
  mood: number | null
  energy: number | null
  note: string
}

/** 经期设置 */
export interface PeriodSettings {
  avg_cycle_length: number
  avg_period_length: number
  luteal_length: number
  /** 1 仅记录 2 备孕 3 避孕参考 4 围绝经期 */
  goal: number
  /** 0/1 */
  show_fertile_window: number
  /** 0/1 */
  irregular_alert: number
  last_period_start?: string
  disclaimer_accepted_at?: string
}

/** GET /period/overview 响应 */
export interface PeriodOverviewResp {
  /** false = 从没记录过，前端显示引导卡并跳 setup */
  initialized: boolean
  /** false = 数据不足，禁止展示具体日期 */
  has_enough_data: boolean
  today: string
  today_log: PeriodDayDetail | null
  prediction?: PeriodPrediction
  settings: PeriodSettings
  disclaimer_accepted: boolean
}

/** 月历 mark 取值（05 §2） */
export type PeriodMark =
  | 'period'
  | 'period_predicted'
  | 'flow_light'
  | 'flow_medium'
  | 'flow_heavy'
  | 'spotting'
  | 'fertile'
  | 'peak'
  | 'ovulation'
  | 'today'
  | 'logged'

/** 月历中的一天（只返回有标记的日期） */
export interface PeriodCalendarDay {
  date: string
  marks: PeriodMark[]
}

/** GET /period/calendar 响应 */
export interface PeriodCalendarResp {
  month: string
  days: PeriodCalendarDay[]
  prediction?: PeriodPrediction
}

/** 区间日记响应 */
export interface PeriodDaysResp {
  items: PeriodDayDetail[]
  total: number
}

/** 单日详情响应 */
export interface PeriodDayDetailResp {
  day: PeriodDayDetail | null
  /** 近 90 天 Top 6 症状 key；从未记录过则为空数组 */
  recent_symptoms: string[]
  last_values?: { bbt: number | null; weight: number | null } | null
}

/** 写某天日记（PUT /period/days/:date）—— 整体覆盖语义 */
export interface PeriodDayUpsertReq {
  date: string
  flow: number
  symptoms: string[]
  pain_level: number
  discharge: number
  bbt: number | null
  weight: number | null
  sleep_hours: number | null
  intercourse: number
  /** 1-5；0 = 不填 */
  mood: number
  /** 1-3；0 = 不填 */
  energy: number
  /** ≤50 字 */
  note: string
}

/** 写某天日记响应 */
export interface PeriodDayUpsertResp {
  day: PeriodDayDetail | null
  /** true = 周期划分变了，前端需清空月历缓存 */
  cycles_changed: boolean
  prediction?: PeriodPrediction
}

/** 周期项（GET /period/cycles） */
export interface PeriodCycle {
  id: string
  start_date: string
  end_date?: string
  period_length: number
  cycle_length: number | null
  /** end_date 为 NULL（本次经期还没结束） */
  is_ongoing: boolean
  /** 用户手动修正过 start/end */
  is_manual: boolean
  ovulation_date?: string
  /** 0 无 1 算法推算 2 体温法确认 3 用户手动 */
  ovulation_source: number
  /** 与上一次间隔 > 90 天，cycle_length 为 NULL */
  gap: boolean
  /** cycle_length < 15，前端提示复核 */
  suspect: boolean
  note?: string
}

/** 周期列表响应 */
export interface PeriodCyclesResp {
  items: PeriodCycle[]
  total: number
}

/** 人工修正周期请求（PATCH /period/cycles/:id） */
export interface PeriodCyclePatchReq {
  start_date?: string
  /** 不传 = 不改；传空串 = 清空（进行中） */
  end_date?: string
  note?: string
}

/** 人工修正周期响应 */
export interface PeriodCyclePatchResp {
  cycle: PeriodCycle
  prediction?: PeriodPrediction
}

/** 部分更新设置（PATCH /period/settings） */
export interface PeriodSettingsPatchReq {
  avg_cycle_length?: number
  avg_period_length?: number
  luteal_length?: number
  goal?: number
  show_fertile_window?: number
  irregular_alert?: number
  last_period_start?: string
  /** 首次免责确认（写 disclaimer_accepted_at） */
  accept_disclaimer?: boolean
}

/** 引导向导提交（POST /period/setup） */
export interface PeriodSetupReq {
  last_period_start: string
  avg_period_length: number
  avg_cycle_length: number
  goal: number
  show_fertile_window: number
}

/** 引导向导响应 */
export interface PeriodSetupResp {
  prediction?: PeriodPrediction
  created_days: number
}

/** 周期报告请求 */
export interface PeriodReportReq {
  range: '6m' | '12m'
}

/** 报告汇总 */
export interface PeriodReportSummary {
  cycle_count: number
  avg_cycle: number
  median_cycle: number
  min_cycle: number
  max_cycle: number
  sigma: number
  avg_period: number
  regularity: PeriodConfidence
}

/** 周期报告响应（P1） */
export interface PeriodReportResp {
  range: string
  summary: PeriodReportSummary
  cycle_trend: Array<{ start_date: string; cycle_length: number | null; period_length: number }>
  flow_distribution: Array<{ flow: number; days: number }>
  symptom_frequency: Array<{ key: string; label: string; count: number; rate: number }>
  symptom_phase_correlation: Array<{ key: string; dominant_phase: PeriodPhaseKey; rate: number }>
  bbt_series: Array<{ date: string; bbt: number }>
  alerts: PeriodAlert[]
  symptom_forecast: PeriodSymptomItem[]
}

/* ============================================================================
 * 健康（Health）—— 记录模块的第 3 个维度
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/health.go
 *                    life-assisitant-api/internal/controller/health.go
 * 契约文档：md/spec-20260919-v1/05-API规范.md（health 段）
 *
 * 三条约定（与经期同构，但字段语义各自独立）：
 *   1. `tone` 取 `HealthCardTone`（normal / neutral），前端**禁止**按数值上红绿色。
 *   2. 预测结果不落表，随接口以 prediction（PeriodPrediction）返回，前端只读。
 *   3. 日期一律 YYYY-MM-DD（本地日期，后端不做时区换算）。
 *
 * ⚠️ 整体覆盖语义（PUT /health/days/:date）：没给的字段一律置「未记录」；
 *    唯一例外是 period / moods 两个子块**整体不传 = 不触碰既有行**。
 *    → 快捷条（只改饮水）必须先取回当天完整记录再整体提交，否则抹掉其它指标。
 *    → 该合并在 src/stores/health.ts 的 saveDay 内统一封装，页面不各自拼装。
 *
 * ⚠️ 值域（以后端实际校验为准，spec 文档写错的不算数）：
 *    discharge 0–5 / intercourse 0–2 / pain_level 0–5 / flow 0–4。
 * ========================================================================== */

/** 单日经期子块（落在 period 维度下，与经期模块的 PeriodDayDetail 共享词汇但独立成块） */
export interface HealthPeriodBlock {
  /** 0 未记录 1 点滴 2 量少 3 中等 4 量多 */
  flow: number
  symptoms: string[]
  /** 0-5 */
  pain_level: number
  /** 0 未记录 1 干燥 2 粘稠 3 乳白 4 水样 5 蛋清拉丝 */
  discharge: number
  /** 0 未记录 1 有(未避孕) 2 有(避孕) */
  intercourse: number
}

/** 单日心情子块 */
export interface HealthMoodBlock {
  /** 1-5；0 = 不填 */
  mood: number
  /** 1-3；0 = 不填 */
  energy: number
  /** ≤50 字 */
  note: string
}

/** 一天的完整健康记录（health_days ∪ 派生行） */
export interface HealthDayDetail {
  date: string
  /** 饮水（ml），0 = 未记录 */
  water_ml: number
  weight_kg?: number | null
  bbt?: number | null
  sleep_hours?: number | null
  /** 排便次数，0 = 未记录 */
  bowel_count: number
  /** 排便形态（BOWEL_TYPE_*） */
  bowel_type: number
  period: HealthPeriodBlock
  moods: HealthMoodBlock
  /**
   * 当天从 health_events 聚合还原的全部事件（倒序）。
   * 仅 GET /health/overview 的 today_log 与 GET /health/days/:date 带此字段，
   * 用于「今日时间轴」零额外请求渲染（02 §12.8）。
   */
  events?: HealthEventItem[]
}

/** 健康设置（与经期设置解耦，独立表） */
export interface HealthSettings {
  metrics_enabled: string[]
  /** 饮水目标（ml） */
  water_goal_ml: number
  /** 「一杯」的容量 ml —— 快捷加水的步进（50–1000，步进 50） */
  water_step_ml: number
  weight_goal_kg?: number | null
  setup_done_at?: string | null
}

/** 概览卡（后端返回顺序即渲染顺序，tone 只做中性样式） */
export interface HealthCard {
  key: string
  label: string
  value: string
  progress?: number
  delta_text?: string
  tone: HealthCardTone
}

/** 今日完成度 */
export interface HealthTodayProgress {
  /** 已记录的指标数 */
  recorded: number
  /** 启用的指标数 */
  enabled: number
}

/** 月摘要条 */
export interface HealthMonthSummary {
  month: string
  recorded_days: number
  water_goal_days: number
  weight_avg?: number | null
  period_days: number
}

/** 概览响应（GET /health/overview） */
export interface HealthOverviewResp {
  /** false = 从没初始化过，前端显示引导卡并跳 setup */
  initialized: boolean
  today: string
  settings: HealthSettings
  today_log: HealthDayDetail | null
  today_progress: HealthTodayProgress
  cards: HealthCard[]
  month_summary: HealthMonthSummary
  prediction: PeriodPrediction | null
}

/** 月历天（只返回有标记的日期） */
export interface HealthCalendarDay {
  date: string
  /** 取值见 constants/health.ts 的 HEALTH_MARKS */
  marks: string[]
}

/** 月历响应（GET /health/calendar） */
export interface HealthCalendarResp {
  month: string
  days: HealthCalendarDay[]
  prediction?: PeriodPrediction | null
}

/** 区间日记响应（GET /health/days） */
export interface ListHealthDaysResp {
  items: HealthDayDetail[]
  total: number
}

/** 单日详情响应（GET /health/days/:date） */
export interface HealthDayDetailResp {
  day: HealthDayDetail | null
  /** 近 90 天 Top 症状 key；从未记录过则为空数组 */
  recent_symptoms: string[]
  health_last_values?: { bbt?: number | null; weight_kg?: number | null } | null
}

/**
 * 写某天记录（PUT /health/days/:date）—— 整体覆盖语义。
 * 字段缺省 = 置「未记录」；period / moods 子块**整体不传** = 不触碰既有行。
 * ⚠️ 调用方（store.saveDay）必须先取回当天完整记录再整体提交，避免抹掉其它指标。
 */
export interface UpsertHealthDayReq {
  date: string
  water_ml: number
  weight_kg?: number | null
  bbt?: number | null
  sleep_hours?: number | null
  bowel_count: number
  bowel_type: number
  /** 整体不传 = 不触碰既有行 */
  period?: HealthPeriodBlock
  /** 整体不传 = 不触碰既有行 */
  moods?: HealthMoodBlock
}

/** 写某天响应 */
export interface UpsertHealthDayResp {
  day: HealthDayDetail | null
  /** true = 周期划分变了，前端需清空月历缓存 */
  cycles_changed: boolean
  prediction?: PeriodPrediction | null
}

/** 部分更新设置（PATCH /health/settings） */
export interface PatchHealthSettingsReq {
  metrics_enabled?: string[]
  water_goal_ml?: number
  /** 「一杯」的容量 ml；0 / 越界由后端归一到 [50,1000] 的 50 倍数 */
  water_step_ml?: number
  weight_goal_kg?: number | null
}

/** 引导向导提交（POST /health/setup） */
export interface HealthSetupReq {
  metrics_enabled: string[]
  water_goal_ml: number
  /** 「一杯」的容量 ml */
  water_step_ml?: number
  weight_goal_kg?: number | null
  /** 勾选 period 时的经期初始化（复用 /period/setup 的参数）；不传 = 不初始化经期 */
  period?: {
    last_period_start: string
    avg_period_length: number
    avg_cycle_length: number
    goal: number
    show_fertile_window: number
  }
}

/** 引导向导响应 */
export interface HealthSetupResp {
  settings: HealthSettings
  prediction?: PeriodPrediction | null
  created_days: number
}

/** 最近一次的测量值（单日详情 / 沿用「沿用上次」） */
export interface HealthLastValues {
  bbt?: number | null
  weight_kg?: number | null
}

/* ============================================================================
 * 健康 · 时间轴事件（health_events）
 *
 * ⚠️ 2026-09-19 起身体指标（water / bbt / weight / sleep / bowel）改走 events：
 *    一天可记 N 次、每次带时间点（HH:mm）、**不延续**（与 mood_logs 的向前延续相反）。
 *    经期块 period、心情块 moods、备注仍是一天一张，走 PUT /health/days/:date。
 * ========================================================================== */

/** 事件支持的指标 key */
export type HealthEventMetricKey = 'water' | 'bbt' | 'weight' | 'sleep' | 'bowel'

/** 时间轴上的一次记录 */
export interface HealthEventItem {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** "HH:mm"（服务端口径；前端不要自己算） */
  time: string
  metric_key: HealthEventMetricKey
  /** 数值型取值（water / bbt / weight / sleep） */
  value_num?: number
  /** 离散取值（bowel 形态 1-4） */
  value_int?: number
  note: string
  created_at: string
  updated_at: string
}

/** 某天从 events 聚合出来的汇总（与 health_days 的日汇总同源同算法） */
export interface HealthEventDaySummary {
  date: string
  /** SUM(water) */
  water_ml: number
  /** COUNT(water) */
  water_times: number
  /** COUNT(bowel) */
  bowel_times: number
  /** 当天出现过的形态，按时间升序，可重复 */
  bowel_types: number[]
  /** 最后一次 */
  weight_kg?: number | null
  /** 最早一次（基础体温是晨起的） */
  bbt?: number | null
  /** 最后一次 */
  sleep_hours?: number | null
}

/** GET /health/events —— date 与 (start,end) 二选一，都不给默认今天 */
export interface ListHealthEventsResp {
  items: HealthEventItem[]
  total: number
  /** 只有按单日查询时才给 */
  summary?: HealthEventDaySummary
}

/** POST /health/events */
export interface CreateHealthEventReq {
  date: string
  /** 空 = 服务端当前时刻 */
  time?: string
  metric_key: HealthEventMetricKey
  value_num?: number
  value_int?: number
  note?: string
}

export interface CreateHealthEventResp {
  item: HealthEventItem
  summary?: HealthEventDaySummary
  /** 重算后的日汇总，前端概览卡可直接替换，不必二次请求 */
  day?: HealthDayDetail | null
}

/** PATCH /health/events/:id —— date 与 metric_key 不可改 */
export interface PatchHealthEventReq {
  id: string
  time?: string
  value_num?: number
  value_int?: number
  note?: string
}

export interface PatchHealthEventResp {
  item: HealthEventItem
  summary?: HealthEventDaySummary
  day?: HealthDayDetail | null
}

/**
 * 统计模块的分区键。与 stores/stats.ts 的 StatsSection 保持一致，
 * 集中在此便于 usePageChrome 等组合式函数按 API 类型引用。
 */
export type StatsSection = 'overview' | 'health' | 'finance' | 'habit'

/* ============================================================================
 * 纪念日 / 倒数日（md/spec-20260919-v1 06）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/anniversary.go
 * ========================================================================== */

/** 重复规则：1 不重复 / 2 每年 / 3 每月 / 4 每周 */
export type AnniversaryRepeatRule = 1 | 2 | 3 | 4

/** 历法：1 公历 / 2 农历（⚠️ 后端暂未引农历库，农历按公历处理） */
export type AnniversaryCalendarType = 1 | 2

/** 分类 —— 影响默认图标与配色 */
export type AnniversaryCategory = 'birthday' | 'anniversary' | 'countdown' | 'other'

/** 提前提醒天数（子集，可多选，全不选 = 不提醒） */
export type AnniversaryRemindDay = 0 | 1 | 3 | 7

/** 单条纪念日 / 倒数日（含后端推导字段） */
export interface AnniversaryItem {
  id: string
  title: string
  /** 基准日（首次发生那天）YYYY-MM-DD */
  target_date: string
  /** 推导出的下次发生日 YYYY-MM-DD（后端实时算，前端不要自己推） */
  next_date: string
  /** 距 next_date 还有几天；0 = 就是今天，负数 = 已过 */
  days_left: number
  repeat_rule: AnniversaryRepeatRule
  calendar_type: AnniversaryCalendarType
  remind_days: AnniversaryRemindDay[]
  category: AnniversaryCategory
  icon: string
  color: string
  is_pinned: boolean
  note: string
}

/** 首页卡片用的精简版 */
export interface AnniversaryBrief {
  id: string
  title: string
  next_date: string
  days_left: number
  category: AnniversaryCategory
  icon: string
  color: string
  is_pinned: boolean
}

export interface ListAnniversariesResp {
  items: AnniversaryItem[]
  total: number
}

export interface UpcomingAnniversariesResp {
  items: AnniversaryBrief[]
  total: number
}

export interface CreateAnniversaryReq {
  title: string
  target_date: string
  repeat_rule?: AnniversaryRepeatRule
  calendar_type?: AnniversaryCalendarType
  remind_days?: AnniversaryRemindDay[]
  category?: AnniversaryCategory
  icon?: string
  color?: string
  is_pinned?: boolean
  note?: string
}

export interface CreateAnniversaryResp {
  item: AnniversaryItem
}

/** 只传要改的字段；remind_days 传了就是整体覆盖 */
export interface PatchAnniversaryReq {
  id: string
  title?: string
  target_date?: string
  repeat_rule?: AnniversaryRepeatRule
  calendar_type?: AnniversaryCalendarType
  remind_days?: AnniversaryRemindDay[]
  category?: AnniversaryCategory
  icon?: string
  color?: string
  is_pinned?: boolean
  note?: string
}

export interface PatchAnniversaryResp {
  item: AnniversaryItem
}

