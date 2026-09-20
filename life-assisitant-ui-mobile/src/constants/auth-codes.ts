/**
 * 业务错误码常量表（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/api/request.ts (AUTH_ERROR_CODES)
 * SYNC-FROM-BACKEND:  life-assisitant-api/internal/consts/ecode/ecode.go
 * 后端新增/调整错误码时必须同步本文件与桌面端。最后同步：2026-09-18
 *
 * ⚠️ 本文件是**唯一真相**：`api/request.ts`、页面、store 都从这里取码，
 *    不要再在业务代码里散写 401004 之类的裸数字。
 */

/** 业务错误码枚举（与后端 internal/consts/ecode/ecode.go 逐项对齐） */
export enum ErrorCode {
  SUCCESS = 0,

  // ====== 认证 4010xx ======
  AUTH_INVALID_CREDENTIALS = 401001,
  AUTH_TOKEN_MISSING = 401002,
  AUTH_TOKEN_INVALID = 401003,
  AUTH_TOKEN_EXPIRED = 401004,
  AUTH_REFRESH_TOKEN_EXPIRED = 401005,
  AUTH_REFRESH_TOKEN_REVOKED = 401006,
  AUTH_ACCOUNT_LOCKED = 401007,
  AUTH_USER_DISABLED = 401008,
  AUTH_USER_DELETED = 401009,
  AUTH_DEVICE_MISMATCH = 401010,
  AUTH_PASSWORD_TOO_WEAK = 401011,
  AUTH_OLD_PASSWORD_INCORRECT = 401012,
  AUTH_LOGIN_ATTEMPTS_EXCEEDED = 401013,

  // ====== 权限 4030xx ======
  PERMISSION_DENIED = 403001,
  ROLE_INSUFFICIENT = 403002,
  ADMIN_REQUIRED = 403003,
  ACCOUNT_OWNER_ONLY = 403005,
  SELF_PROTECTION = 403006,
  LAST_ADMIN_PROTECTED = 403007,
  USER_HAS_NO_PERMISSION = 403010,

  // ====== 参数 / 资源 400x / 404x ======
  VALIDATION_FAILED = 400001,
  MISSING_REQUIRED_FIELD = 400002,
  INVALID_JSON = 400004,
  PASSWORD_MISMATCH = 400010,
  PASSWORD_SAME_AS_OLD = 400011,
  ROLE_IS_SYSTEM = 400020,
  ROLE_CODE_INVALID = 400021,
  ADMIN_MATRIX_LOCKED = 400022,
  UNKNOWN_PERMISSION_POINT = 400023,
  USER_NOT_FOUND = 404001,
  ROLE_NOT_FOUND = 404003,
  ROLE_IN_USE = 409003,

  // ====== 任务 4001xx / 4031xx / 4041xx ======
  TASK_NOT_FOUND = 404101,
  TASK_TITLE_REQUIRED = 400102,
  TASK_ACCESS_DENIED = 403101,

  // ====== 习惯 ======
  HABIT_NOT_FOUND = 404201,
  HABIT_ACCESS_DENIED = 403201,
  HABIT_LOG_FAILED = 500201,

  // ====== 心情 ======
  MOOD_VALUE_INVALID = 400601,
  MOOD_ENERGY_INVALID = 400602,
  MOOD_NOTE_TOO_LONG = 400603,

  // ====== 通知 ======
  NOTIFICATION_NOT_FOUND = 404701,

  // ====== 账户 / 交易 / 预算 ======
  ACCOUNT_NOT_FOUND = 404301,
  ACCOUNT_ACCESS_DENIED = 403301,
  ACCOUNT_INSUFFICIENT = 400301,
  ACCOUNT_TRANSFER_SAME = 400302,
  ACCOUNT_TYPE_INVALID = 400304,
  ACCOUNT_HAS_TRANSACTIONS = 400305,
  TRANSACTION_NOT_FOUND = 404401,
  TRANSACTION_ACCESS_DENIED = 403401,
  TRANSACTION_ALREADY_REVERSED = 400403,
  BUDGET_NOT_FOUND = 404501,
  BUDGET_ACCESS_DENIED = 403501,
  BUDGET_SCOPE_INVALID = 400505,
  BUDGET_CATEGORY_REQUIRED = 400506,

  // ====== 通用 / 系统 ======
  INTERNAL_ERROR = 500001,
  DATABASE_ERROR = 500002,
  SERVICE_UNAVAILABLE = 503001,
  METHOD_NOT_ALLOWED = 405001,
  VERSION_CONFLICT = 409001,
  DUPLICATE_RESOURCE = 409002,
  RATE_LIMIT_EXCEEDED = 429001,
}

/**
 * 鉴权失败码集合 —— 命中即视为「登录态失效」，统一走 清 token + 跳登录。
 *
 * 与桌面端 `request.ts` 的 `AUTH_ERROR_CODES` 保持一致，取值依据后端
 * ecode.go 的认证段：
 *   401001 账号或密码错误（登录接口专用，这里一并纳入以防误报业务错误）
 *   401002 未提供 token
 *   401003 token 无效
 *   401004 token 已过期
 *   401005 refresh_token 已过期
 *   401006 refresh_token 已被撤销
 *   401009 账号已删除
 *   401010 设备不匹配（换设备后旧 token 失效，同属登录态问题）
 */
export const AUTH_FAILURE_CODES: ReadonlySet<number> = new Set<number>([
  ErrorCode.AUTH_INVALID_CREDENTIALS,
  ErrorCode.AUTH_TOKEN_MISSING,
  ErrorCode.AUTH_TOKEN_INVALID,
  ErrorCode.AUTH_TOKEN_EXPIRED,
  ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED,
  ErrorCode.AUTH_REFRESH_TOKEN_REVOKED,
  ErrorCode.AUTH_USER_DELETED,
  ErrorCode.AUTH_DEVICE_MISMATCH,
])

/**
 * 可触发「静默刷新后重试」的码。
 * 只有 access_token 过期才值得刷新；refresh_token 本身失效则刷新无意义，
 * 直接登出。401006/401009/401010 同属不可恢复，不进此集合。
 */
export const REFRESHABLE_CODES: ReadonlySet<number> = new Set<number>([
  ErrorCode.AUTH_TOKEN_EXPIRED,
  ErrorCode.AUTH_TOKEN_MISSING,
  ErrorCode.AUTH_TOKEN_INVALID,
])

/** 权限类错误码（toast「无访问权限」而不是「操作失败」） */
export const PERMISSION_ERROR_CODES: ReadonlySet<number> = new Set<number>([
  ErrorCode.PERMISSION_DENIED,
  ErrorCode.ROLE_INSUFFICIENT,
  ErrorCode.ADMIN_REQUIRED,
  ErrorCode.ACCOUNT_OWNER_ONLY,
  ErrorCode.SELF_PROTECTION,
  ErrorCode.LAST_ADMIN_PROTECTED,
  ErrorCode.USER_HAS_NO_PERMISSION,
])
