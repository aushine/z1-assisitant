// ============================================================================
// 通用 API 类型
// 与 md/spec/04-API规范.md · 4 响应格式 一致
// ============================================================================

import type { HealthCardTone } from '@/constants/health'

/** 服务端统一成功响应 */
export interface ApiOk<T> {
  code: 0
  message: string
  data: T
}

/** 服务端统一错误响应 */
export interface ApiErr {
  code: number
  error: string
  message: string
  details?: Record<string, unknown>
  request_id?: string
}

export type ApiResponse<T> = ApiOk<T> | ApiErr

/** 列表查询参数 */
export interface PageQuery {
  page?: number
  page_size?: number
  sort?: string
}

/** 列表分页响应（后端 response.Page 格式） */
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

// ============================================================================
// 用户 / 角色 / 权限
// ============================================================================

/**
 * 角色编码（D-03 权限重构）：
 * 内置 'admin' | 'user'，其余为自定义角色（^[a-z][a-z0-9_]{1,19}$），
 * 因此类型放开为 string，由 GET /roles 动态驱动。
 */
export type RoleCode = string
export type UserStatus = 'active' | 'disabled' | 'deleted'

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
  /** 上次登录客户端 IP / 设备类型（desktop|mobile）。后端 /auth/me 一直在返回，此前前端类型没声明 */
  last_login_ip?: string
  last_login_device?: string
  version?: number       // 乐观锁版本号（后端 UpdateUserReq 必填）
  /** D-03 第六轮：管理员代建的初始密码（123456）未改 → 主界面提示去安全页改密 */
  pwd_reset_required?: boolean
}

export interface Role {
  id: number  // 自增排序号：admin=1，user=2，自定义按创建顺序递增（业务主键仍是 code）
  code: RoleCode
  name: string
  description?: string
  is_system: boolean
  user_count: number
}

/**
 * 权限点（对齐后端 GET /permissions 返回，D-03 重写）
 * point 格式 = `${module}:${action}`，如 "task:complete"
 */
export interface Permission {
  id: string                 // e.g. "p_task_complete"
  module: string             // home / task / habit / mood / finance / stat / timeline / notification / me / user_mgmt / role_mgmt
  action: string             // view / create / update / complete / checkin / write / grant ...（按模块实际功能）
  description: string        // 中文标签，UI 直接显示
}

/** 我的有效权限（GET /auth/me/permissions） */
export interface MyPermissionsResp {
  user_id: string
  role: RoleCode
  permissions: string[]                 // ["task:view", ...]
  matrix: Record<string, string[]>      // module -> actions
}

/** 新建自定义角色（POST /roles） */
export interface CreateRoleReq {
  code: string
  name: string
  description?: string
}

/** 更新角色元信息（PATCH /roles/:code；编码不可变，矩阵改动走 permissions 端点） */
export interface UpdateRoleReq {
  name?: string
  description?: string
}

// ============================================================================
// 鉴权
// ============================================================================

export interface LoginReq {
  username: string
  password: string
  remember?: boolean
  device_id?: string
}

export interface LoginResp {
  access_token: string
  refresh_token: string
  expires_in: number
  user: User
}

export interface RegisterReq {
  username: string
  password: string
  name: string
  email: string
}

export interface RefreshReq {
  refresh_token: string
  device_id: string
}

export interface RefreshResp {
  access_token: string
  expires_in: number
}

export interface ChangePasswordReq {
  old_password: string
  new_password: string
}

/**
 * 退出登录请求体。两个字段都可选，但至少要给一个，
 * 否则后端不撤销任何会话（详见 api/auth.ts#logout 的说明）。
 */
export interface LogoutReq {
  /** 要撤销的 refresh_token；不带则本次会话不会被服务端吊销 */
  refresh_token?: string
  /** true = 撤销该用户全部未过期 refresh_token（退出所有设备） */
  all_devices?: boolean
}

/**
 * 一条活跃登录会话（对应后端 GET /auth/sessions → dto.SessionResp）
 * token_hash 不出网关；device_id 供前端标记「当前设备」（与 localStorage 的 device_id 比对）。
 */
export interface SessionInfo {
  id: string
  device_id: string
  /** desktop | mobile，后端按 device_id 前缀推断 */
  platform: string
  ip?: string
  login_at: string
  expires_at: string
}

export interface SessionListResp {
  items: SessionInfo[]
}

export interface ForgotPasswordReq {
  email: string
}

// ============================================================================
// 用户管理
// ============================================================================

export interface ListUsersQuery extends PageQuery {
  role?: RoleCode
  status?: UserStatus
}

export interface CreateUserReq {
  username: string
  name: string
  role: RoleCode
  /** D-03 第六轮：前端不再传——后端统一初始密码 123456，首登提示改密 */
  password?: string
  /** D-03 第九轮：邮箱/手机号回添为可选项，留空落库 NULL */
  email?: string
  phone?: string
  /** 部门字段已从用户管理 UI 移除（后端仍兼容，前端不再传） */
  department?: string
}

export interface UpdateUserReq {
  name?: string
  email?: string
  phone?: string
  avatar?: string
  role?: RoleCode
  department?: string
  version?: number       // 乐观锁版本号（后端必填；updateProfile 会自动注入当前用户 version）
}

/**
 * 自更新个人资料（PATCH /users/me）
 * 刻意**不含** role / status / department —— 后端 UpdateMeReq 结构上就没有这些字段
 * （提权面已封死），前端类型同步收紧，避免误传。
 */
export interface UpdateMeReq {
  name?: string
  email?: string
  phone?: string
  avatar?: string
  /** 可选。缺省时后端用服务端当前 version 作 CAS 基准，不会因拿不到 version 而失败 */
  version?: number
}

export interface DisableUserReq {
  status: 'active' | 'disabled'
}

// ============================================================================
// 角色 / 权限
// ============================================================================

export interface AssignRoleReq {
  role: RoleCode          // 后端 PUT /users/:id/role 的请求体，仅需 role
}

/** 角色权限矩阵响应（GET /roles/:code/permissions） */
export interface PermissionMatrixResp {
  role: RoleCode
  version: number
  updated_at?: string
  matrix: Record<string, string[]>   // module -> actions
}

/** 覆盖设置角色权限矩阵（PUT /roles/:code/permissions，带乐观锁） */
export interface UpdatePermissionMatrixReq {
  version: number
  matrix: Record<string, string[]>   // module -> actions
}

// ============================================================================
// 任务（Tasks）
// 规范：md/spec/11-任务.md · 4 字段定义 / 6 状态机
// ============================================================================

/** 任务优先级 */
export type TaskPriority = 'relaxed' | 'normal' | 'important' | 'urgent'

/** 任务状态 */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'archived'

/** 列表筛选维度 */
export type TaskFilter = 'all' | 'today' | 'upcoming' | 'done' | 'overdue'

/** 子任务 */
export interface Subtask {
  id: string
  title: string
  is_completed: boolean
  order: number
}

/** 任务实体 */
export interface Task {
  id: string
  title: string
  description?: string
  priority: TaskPriority
  status: TaskStatus
  category_id?: string
  category_emoji?: string
  due_date?: string
  due_time?: string
  reminder_at?: string
  recurrence_rule?: string
  parent_task_id?: string
  subtasks_count?: number
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
  due_date?: string
  due_time?: string
  reminder_at?: string
  recurrence_rule?: string
  subtasks?: Array<{ title: string; order: number }>
}

/** 更新任务请求体 */
export interface UpdateTaskReq extends Partial<CreateTaskReq> {
  status?: TaskStatus
  subtasks?: Array<{ id?: string; title: string; is_completed?: boolean; order: number }>
}

/** 批量操作请求 */
export interface BatchTaskReq {
  action: 'complete' | 'delete'
  task_ids: string[]
}

/** 批量操作响应 */
export interface BatchTaskResp {
  affected: number
}

/** 列表查询参数 */
export interface ListTasksQuery extends PageQuery {
  filter?: TaskFilter
  priority?: TaskPriority
  category_id?: string
  keyword?: string
}

/** 列表响应 */
export interface ListTasksResp {
  items: Task[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

// ============================================================================
// 习惯（Habits）
// 规范：md/spec/12-记录.md · 4.1 习惯对象
// ============================================================================

/** 习惯频率 */
export type HabitFrequency = 'daily' | 'weekly' | 'monthly'

/** 习惯状态 */
export type HabitStatus = 'active' | 'archived'

/** 习惯分类 */
export type HabitCategory = 'sport' | 'diet' | 'life' | 'study'

/** 习惯实体 */
export interface Habit {
  id: string
  title: string
  description?: string
  icon: string            // emoji
  color: string           // 图标底色 hex
  category: HabitCategory // 分类
  frequency: HabitFrequency
  target_count: number    // 目标次数
  unit: string            // 单位（次/杯/分钟…）
  track_duration?: boolean // 是否记录打卡时长
  status: HabitStatus
  today_count?: number    // 今日累计打卡次数（来自后端聚合）
  today_completed?: boolean  // 今日是否已完成目标（后端字段 today_completed）
  today_done?: boolean    // Compat alias for today_completed, set by normalizeHabit()
  today_date?: string     // 今日日期 YYYY-MM-DD（仅 GetToday 填充）
  // 连续打卡（单位随 frequency：天 / 周 / 月，后端打卡时重算落库）
  current_streak?: number
  longest_streak?: number
  last_check_in_date?: string  // 最后打卡日 YYYY-MM-DD
  total_check_ins?: number     // 累计打卡次数（SUM(count)）
  created_at: string
  updated_at?: string
}

/** Compat: today_done mirrors today_completed for convenience */
export type HabitWithDone = Habit & { today_done?: boolean }

/** 创建习惯请求体 */
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

/** 更新习惯请求体（与 CreateHabitReq 字段一致） */
export interface UpdateHabitReq extends Partial<CreateHabitReq> {
  status?: HabitStatus
}

/** 习惯列表查询参数 */
export interface ListHabitsQuery {
  status?: HabitStatus | ''
}

/** 习惯列表响应 */
export interface ListHabitsResp {
  items: Habit[]
  total: number
  page: number
}

/** 打卡请求体 */
export interface LogHabitReq {
  date: string        // YYYY-MM-DD
  count?: number      // 累加次数，默认 1
  note?: string
  duration_minutes?: number  // 打卡时长（分钟），默认 0
}

// ============================================================================
// 心情 / 精力（Moods）
// 规范：md/design-260917/04-功能深化-私人管家.md · §3
// ============================================================================

/** 心情档位 1–5（很差 / 低落 / 一般 / 不错 / 很好） */
export type MoodValue = 1 | 2 | 3 | 4 | 5

/** 精力档位 1–3（疲惫 / 一般 / 充沛） */
export type EnergyValue = 1 | 2 | 3

/**
 * 心情/精力的最小记录单位：某天的某一个小时（0-23）。
 *
 * 260919：由「一天一条」改为按小时记录。心情/精力读取时后端已做**向前延续**
 * 填充，前端直接展示，不要自己算延续。
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
  /** ≤50；'' = 清空；缺省 = 不动该行既有备注 */
  note?: string
}

/** PUT /moods 响应；item 为 null 表示该格已被清空（后端会删掉空行） */
export interface MoodUpsertResp {
  item: MoodHourItem | null
}

/** 心情列表查询参数（区间，两端必填） */
export interface ListMoodsQuery {
  start_date: string
  end_date: string
}

/** 心情列表响应（区间内全部小时行，每天内部延续，不跨天延续） */
export interface ListMoodsResp {
  items: MoodHourItem[]
}

// ============================================================================
// 生活时间线（Timeline）
// 规范：md/design-260917/04-功能深化-私人管家.md · §4
// ============================================================================

/** 时间线事件类型（后端已排除 transfer / milestone） */
export type TimelineEventType = 'task' | 'habit' | 'expense' | 'income' | 'mood'

/** 时间线事件（跨模块聚合，统一结构） */
export interface TimelineEvent {
  id: string
  type: TimelineEventType
  title: string
  detail?: string
  amount?: number       // 金额（支出为负、收入为正）
  time: string          // HH:MM（当天内）
  icon_hint?: string    // 图标提示（emoji / 任务优先级 / 心情档位）
}

/** 时间线查询参数 */
export interface TimelineQuery {
  date?: string         // YYYY-MM-DD，默认今天
  page?: number
  page_size?: number
}

/** 时间线响应（按完整时间戳倒序） */
export interface TimelineResp {
  date: string
  items: TimelineEvent[]
  total: number
}

// ============================================================================
// 账户 / 交易（Finance）
// 规范：md/spec/12-记录.md · 4.2 / 4.3
// ============================================================================

/** 账户类型 */
/**
 * 账户类型（spec-20260922-v1 扩到 18 值，唯一真源在 constants/account.ts，
 * 与后端 account_vocab.go 同源；此处 re-export 保持既有 import 路径可用）
 */
import type { AccountType } from '@/constants/account'
export type { AccountType }

/** 账户实体 */
export interface Account {
  id: string
  name: string
  type: AccountType
  icon: string            // 图标引用三态：brand:<slug> | lucide:<Name> | emoji（存量）
  color: string           // 图标底色
  /** 银行 code（spec-20260922-v1 新增；'' = 未指定） */
  institution?: string
  balance: number
  created_at: string
  updated_at?: string
}

/** 创建账户请求体 */
export interface CreateAccountReq {
  name: string
  type: AccountType
  icon?: string
  color?: string
  /** 银行 code，'' = 未指定（后端只校验长度 ≤20，不校验白名单，01 §8.3 D20） */
  institution?: string
  balance?: number
}

/** 更新账户请求体 */
export interface UpdateAccountReq extends Partial<CreateAccountReq> {
  /**
   * 余额调整流水（v2，05 §5.3 约束 3）：**只有显式 true 才生成**（nil/false 都不生成，
   * 向后兼容老前端）。新前端「默认记录」= 编辑保存时显式传 true；
   * 勾「不记录收支」则不传（不生成）。新建账户永不生成。
   */
  record_flow?: boolean
}

/** 账户列表响应 */
export interface ListAccountsResp {
  items: Account[]
  total_balance: number
}

/** 交易类型 */
export type TransactionType = 'expense' | 'income' | 'transfer'

/** 交易实体 */
export interface Transaction {
  id: string
  type: TransactionType
  amount: number          // 始终为正
  category_id?: string | null     // ⭐ 新增：分类身份（按 id 渲染图标/色，失败再走快照）
  category_emoji: string
  category_name: string
  account_id: string
  account_name?: string
  to_account_id?: string  // transfer 时使用
  to_account_name?: string
  note?: string
  happened_at: string     // ISO datetime
  created_at: string
  // ===== v2 后端新增字段（04 §2.3 / 07 §3 Phase 1）=====
  /** 不计入预算（口径开关一） */
  exclude_budget?: boolean
  /** 不计入收支（口径开关二） */
  exclude_stats?: boolean
  /** 来源：''=普通 / balance_adjust / reimburse / lend / borrow / refund */
  source?: string
  /** 对方（待报销 / 借入借出 / 退款） */
  contact?: string
  /** 关联的原交易 id（核销笔指向原笔） */
  settle_of?: string
  /** 更新时间（v2 补 TransactionResp 缺失字段，见 09-schedule §B4） */
  updated_at?: string
  /** 该笔已被撤销时，指向撤销生成的反向交易 id */
  reversed_by?: string
}

/** 创建交易请求体 */
export interface CreateTransactionReq {
  type: TransactionType
  amount: number
  category_id?: string | null    // ⭐ 新增（可选，向后兼容）：分类身份
  category_emoji?: string
  category_name?: string
  account_id: string
  /** 注意: transfer 类型请走 /transactions/transfer 接口，不走此字段 */
  to_account_id?: string
  note?: string
  happened_at?: string
  // ===== v2/v4 后端已支持（05 §统一模型；前端不许传 source='balance_adjust'，400001）=====
  /** 不计入预算（口径开关一） */
  exclude_budget?: boolean
  /** 不计入收支（口径开关二） */
  exclude_stats?: boolean
  /** 性质：''=普通 / reimburse / lend / borrow / refund（⛔ balance_adjust 由后端余额调整专用） */
  source?: string
  /** 对方（待报销=报销对象选填；借出/借入必填；退款=商家选填） */
  contact?: string
  /** 核销关联的原笔 id（核销动作从详情抽屉发起时携带） */
  settle_of?: string
}

/** 转账请求体（同时影响两账户）
 *  后端路由: POST /transactions/transfer
 *  后端 DTO: dto.TransferReq { from_account_id, to_account_id, amount, happened_at, note }
 */
export interface TransferReq {
  from_account_id: string
  to_account_id: string
  amount: number
  note?: string
  happened_at?: string
}

/** 撤销交易请求体 */
export interface ReverseTransactionReq {
  note?: string
}

/** 撤销交易响应 */
export interface ReverseTransactionResp {
  original_id: string
  reverse_id: string
  type: TransactionType
  amount: number
  note: string
  occurred_at: string
}

/** 交易列表查询参数 */
export interface ListTransactionsQuery {
  type?: TransactionType
  account_id?: string
  keyword?: string        // 按备注 / 分类名模糊搜索（后端 note LIKE ? OR category_name LIKE ?）
  contact?: string         // v2：按对方筛选（等值）
  start_date?: string
  end_date?: string
  page?: number
  page_size?: number
}

/** 交易列表响应 */
export interface ListTransactionsResp {
  items: Transaction[]
  total: number
  has_more: boolean
}

/**
 * 更新交易请求体（PUT /transactions/:id）
 * ⚠️ 后端 `UpdateTransactionReq` **不含 `type`**（注释明写「仅 expense / income」），
 *    故此处也不带 type；转账编辑大概率走不通（09-schedule §B3 / Q6），前端对转账隐藏编辑。
 *    可选字段沿用后端 7 个 + v2 的口径/对方字段；指针语义不在此（创建时才定）。
 */
export interface UpdateTransactionReq {
  amount?: number
  category_id?: string | null
  category_emoji?: string
  category_name?: string
  account_id?: string
  to_account_id?: string
  note?: string
  happened_at?: string
  exclude_budget?: boolean
  exclude_stats?: boolean
  contact?: string
}

// ===== 收支日历（GET /finance/calendar，07 §3 / 03 §B）=====
/** 月历中的一天（只返回有记录的日期） */
export interface CalendarDay {
  date: string            // YYYY-MM-DD
  income: number
  expense: number
}

/** 该月汇总（net 后端已算） */
export interface CalendarSummary {
  income: number
  expense: number
  net: number
}

/** GET /finance/calendar 响应 */
export interface CalendarResp {
  month: string           // YYYY-MM
  days: CalendarDay[]
  summary: CalendarSummary
}

// ===== 债权债务（GET /finance/debts，05 §C3 / 06 §4）=====
/** 交易性质（与后端 source 白名单一致；'' = 普通） */
export type TxSource = '' | 'balance_adjust' | 'reimburse' | 'lend' | 'borrow' | 'refund'

/** 按对方聚合的未结清项（open 后端已算：Σ原笔 amount − Σ核销，HAVING open > 0.005） */
export interface DebtItem {
  /** 对方（contact 原值，无实体） */
  contact: string
  /** 该对方名下涉及的性质 ⊆ reimburse / lend / borrow */
  kinds: string[]
  /** 未结清金额 */
  open: number
  /** 未结清原笔数 */
  count: number
}

/** GET /finance/debts 响应 */
export interface DebtsResp {
  /** 别人欠我（reimburse + lend） */
  owed_to_me: DebtItem[]
  /** 我欠别人（borrow） */
  i_owe: DebtItem[]
  /** 净额 = Σowed_to_me − Σi_owe */
  net: number
}

// ============================================================================
// 预算（Budgets）
// 规范：md/spec/12-记录.md · 4.4
// ============================================================================

/** 预算周期 */
export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly'

/** 预算范围 */
export type BudgetScope = 'overall' | 'category'

/** 预算实体 */
export interface Budget {
  id: string
  name: string
  period: BudgetPeriod
  amount: number
  used: number
  start_date: string
  end_date: string
  alert_threshold: number
  is_alerted: boolean
  scope?: BudgetScope
  category_id?: string | null    // ⭐ 新增：分类预算绑定的大类 id（scope=category 时必填）
  category_emoji?: string
  category_name?: string
  created_at: string
}

/** 创建预算请求体 */
export interface CreateBudgetReq {
  name: string
  period?: BudgetPeriod
  amount: number
  start_date?: string
  end_date?: string
  alert_threshold?: number
  scope?: BudgetScope
  category_id?: string | null    // ⭐ 新增（scope=category 时必填，且必须是一级分类）
  category_emoji?: string
  category_name?: string
}

/** 更新预算请求体（06 §3.2：补齐分类字段，原 dto 完全不含分类字段） */
export interface UpdateBudgetReq {
  name?: string
  period?: BudgetPeriod
  amount?: number
  start_date?: string
  end_date?: string
  alert_threshold?: number
  scope?: BudgetScope
  category_id?: string | null
  category_name?: string
  category_emoji?: string
}

/** 预算列表查询参数 */
export interface ListBudgetsQuery {
  scope?: BudgetScope
}

/** 预算列表响应 */
export interface ListBudgetsResp {
  items: Budget[]
}

// ============================================================================
// 收支分类（Finance Categories）—— 用户级实体（记账分类体系升级）
// 规范：md/spec-20260921-v1/06-API规范.md §1 / 04-图标分组与自选.md
//
// 分类从「前端写死的 12 个枚举」升级为「数据库里的用户级实体」：
// 两级（大类 + 明细）、可增删改、自选图标颜色。每个分类有唯一 id，
// 所有渲染 / 统计 / 预算都按 id，不再按 name / emoji 比对。
// ============================================================================

/** 分类作用域（与交易 type 对齐：expense ↔ expense / income ↔ income） */
export type CategoryScope = 'expense' | 'income'

/** 语义色（与 TINT_NAMES 对齐）：二级可继承父级时该字段为 null */
export type CategoryTint = 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral' | null

/**
 * 单个分类节点（树形返回，children 内嵌二级）。
 * icon / tint 在二级上可能为 null = 继承父级（04 §5）。
 */
export interface FinanceCategory {
  id: string
  parent_id: string          // '' = 一级分类
  scope: CategoryScope
  name: string
  full_name: string         // 二级为「父-子」拼接，如「餐饮-三餐」
  emoji: string | null      // 兼容旧客户端 / 历史数据，渲染层不使用
  icon: string | null       // PascalCase Lucide 图标名（如 'Utensils'），null = 继承父级
  tint: CategoryTint        // 语义色，null = 继承父级
  sort: number
  is_builtin: boolean
  is_deleted?: boolean      // 软删除标记（前端降级用，正常接口不返回已删除）
  children: FinanceCategory[]
}

/** 拉取分类树响应（06 §1.1） */
export interface ListCategoriesResp {
  items: FinanceCategory[]
  seeded: boolean
}

/** 创建分类请求（06 §1.2）。parent_id '' = 一级 */
export interface CreateCategoryReq {
  parent_id?: string
  scope: CategoryScope
  name: string
  icon?: string | null
  tint?: CategoryTint
  emoji?: string | null
}

/** 更新分类请求（06 §1.3）。只改 name / icon / tint / emoji；parent_id / scope 不可改 */
export interface PatchCategoryReq {
  name?: string
  icon?: string | null
  tint?: CategoryTint
  emoji?: string | null
}

// ============================================================================
// 统计（Stats）
// 规范：md/spec/13-统计.md · 4 / 8
// ============================================================================

/** 首页 / 概览聚合 */
export interface StatsOverview {
  today_done_tasks: number
  today_total_tasks: number
  week_completion_rate: number   // 0-100 (后端返回的是百分比 0-100)
  month_expense: number
  month_income: number
  total_balance: number
  habit_today_done: number
  habit_today_total: number
}

// ====== 任务统计 ======

/** 按日任务统计 */
export interface TaskDayStat {
  date: string       // YYYY-MM-DD
  total: number
  completed: number
  rate: number       // 0-1
}

/** 按分类任务统计 */
export interface TaskCategoryStat {
  category: string
  emoji: string
  color: string
  total: number
  completed: number
  rate: number       // 0-1
}

/** 任务统计响应 */
export interface TaskStats {
  total: number
  completed: number
  pending: number
  overdue: number
  completion_rate: number         // 0-1
  completion_rate_change: number  // -1~1
  by_day: TaskDayStat[]
  by_category: TaskCategoryStat[]
}

// ====== 习惯统计 ======

/** 单个习惯统计 */
export interface HabitStatItem {
  habit_id: string
  name: string
  emoji: string
  color: string
  completion_rate: number  // 0-1
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

// ====== 财务统计 ======

/** 按日财务统计 */
export interface FinanceDayStat {
  date: string
  expense: number
  income: number
}

/** 按分类财务统计 */
export interface FinanceCategoryStat {
  category_id?: string | null   // ⭐ 新增：聚合口径按 id（前端按 id 查图标/色，name 兜底）
  category: string
  emoji: string
  color: string
  amount: number
  percentage: number  // 0-1
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
  expense_change: number  // 同比 %
  income_change: number
  by_day: FinanceDayStat[]
  by_category: FinanceCategoryStat[]
  by_account: FinanceAccountStat[]
}

// ====== 导出 ======

/** 导出请求参数 */
export interface ExportParams {
  range: string            // 7d / 30d / 90d / custom
  start_date?: string      // custom 时必填
  end_date?: string        // custom 时必填
  type: 'tasks' | 'habits' | 'transactions' | 'all'
  format: 'csv'
}

// ============================================================================
// 首页聚合（Home）
// 规范：md/plan-260807/00-plan-overview.md · 4.3
// ============================================================================

/** 首页 KPI */
export interface HomeKPI {
  todo_done: number
  todo_total: number
  todo_rate: number
  habit_done: number
  habit_total: number
  habit_rate: number
  month_expense: number
  month_expense_change: number
  month_income: number
  month_income_change: number
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
  today_tasks: Task[]
  today_habits: Habit[]
  month_finance: HomeMonthFinance
  unread_notifications: number
}

// ============================================================================
// 通知（Notifications）
// 规范：md/plan-260807/00-plan-overview.md · 4.3
// ============================================================================

export interface Notification {
  id: string
  type: string
  title: string
  body?: string
  is_read: boolean
  read_at?: string
  created_at: string
}

export interface UnreadCountResp {
  count: number
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
 * 健康（Health）—— 记录模块第 3 个维度
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/health.go
 *                    life-assisitant-api/internal/controller/health.go
 * SYNC-FROM-MOBILE:  life-assisitant-ui-mobile/src/api/types.ts（Health 段，逐字对齐）
 * 契约文档：md/spec-20260919-v1/05-API规范.md（health 段）
 *
 * 三条约定（与经期同构，但字段语义各自独立）：
 *   1. `tone` 取 `HealthCardTone`（normal / neutral），前端**禁止**按数值上红绿色。
 *   2. 预测结果不落表，随接口以 prediction（PeriodPrediction，已在上方定义）返回，前端只读。
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
  /** 当天从 health_events 聚合的事件列表（GET /health/overview 一并返回，零额外请求；见 02 §12.2） */
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

/* ============================================================================
 * 纪念日 / 倒数日（md/spec-20260919-v1 06）
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/api/types.ts
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
