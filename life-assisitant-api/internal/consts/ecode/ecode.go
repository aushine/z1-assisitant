// Package ecode 业务错误码常量
// 编码规则：{HTTP 段}{3 位业务码}，共 6 位
// 详见 ../life-assisitant/md/spec/06-错误码.md
package ecode

import (
	"fmt"

	"github.com/gogf/gf/v2/errors/gcode"
)

// BusinessCode 业务错误码结构
type BusinessCode struct {
	CodeValue   int
	CodeMessage string // 英文错误码（机器可读）
	CodeDetail  string // 中文消息（人类可读）
}

// 实现 gcode.Code 接口
func (b BusinessCode) Code() int           { return b.CodeValue }
func (b BusinessCode) Message() string     { return b.CodeMessage }
func (b BusinessCode) Detail() interface{} { return b.CodeDetail }

func (b BusinessCode) String() string {
	return fmt.Sprintf("[%d] %s: %s", b.CodeValue, b.CodeMessage, b.CodeDetail)
}

// 编译期断言
var _ gcode.Code = (*BusinessCode)(nil)

// 通用成功
var (
	Success = BusinessCode{CodeValue: 0, CodeMessage: "SUCCESS", CodeDetail: "成功"}
)

// ====== 认证错误 1xx ======
var (
	AuthInvalidCredentials    = BusinessCode{CodeValue: 401001, CodeMessage: "AUTH_INVALID_CREDENTIALS", CodeDetail: "账号或密码错误"}
	AuthTokenMissing          = BusinessCode{CodeValue: 401002, CodeMessage: "AUTH_TOKEN_MISSING", CodeDetail: "未提供认证 token"}
	AuthTokenInvalid          = BusinessCode{CodeValue: 401003, CodeMessage: "AUTH_TOKEN_INVALID", CodeDetail: "token 无效"}
	AuthTokenExpired          = BusinessCode{CodeValue: 401004, CodeMessage: "AUTH_TOKEN_EXPIRED", CodeDetail: "token 已过期"}
	AuthRefreshTokenExpired   = BusinessCode{CodeValue: 401005, CodeMessage: "AUTH_REFRESH_TOKEN_EXPIRED", CodeDetail: "refresh_token 已过期"}
	AuthRefreshTokenRevoked   = BusinessCode{CodeValue: 401006, CodeMessage: "AUTH_REFRESH_TOKEN_REVOKED", CodeDetail: "refresh_token 已被撤销"}
	AuthAccountLocked         = BusinessCode{CodeValue: 401007, CodeMessage: "AUTH_ACCOUNT_LOCKED", CodeDetail: "账号已锁定，请稍后重试"}
	AuthUserDisabled          = BusinessCode{CodeValue: 401008, CodeMessage: "AUTH_USER_DISABLED", CodeDetail: "账号已被禁用，请联系管理员"}
	AuthUserDeleted           = BusinessCode{CodeValue: 401009, CodeMessage: "AUTH_USER_DELETED", CodeDetail: "账号已删除"}
	AuthDeviceMismatch        = BusinessCode{CodeValue: 401010, CodeMessage: "AUTH_DEVICE_MISMATCH", CodeDetail: "设备不匹配"}
	AuthPasswordTooWeak       = BusinessCode{CodeValue: 401011, CodeMessage: "AUTH_PASSWORD_TOO_WEAK", CodeDetail: "密码强度不够"}
	AuthOldPasswordIncorrect  = BusinessCode{CodeValue: 401012, CodeMessage: "AUTH_OLD_PASSWORD_INCORRECT", CodeDetail: "当前密码错误"}
	AuthLoginAttemptsExceeded = BusinessCode{CodeValue: 401013, CodeMessage: "AUTH_LOGIN_ATTEMPTS_EXCEEDED", CodeDetail: "登录尝试次数过多"}
)

// ====== 权限错误 2xx ======
var (
	PermissionDenied    = BusinessCode{CodeValue: 403001, CodeMessage: "PERMISSION_DENIED", CodeDetail: "无访问权限"}
	RoleInsufficient    = BusinessCode{CodeValue: 403002, CodeMessage: "ROLE_INSUFFICIENT", CodeDetail: "当前角色权限不足"}
	AdminRequired       = BusinessCode{CodeValue: 403003, CodeMessage: "ADMIN_REQUIRED", CodeDetail: "需要管理员权限"}
	AccountOwnerOnly    = BusinessCode{CodeValue: 403005, CodeMessage: "ACCOUNT_OWNER_ONLY", CodeDetail: "仅资源所有者可操作"}
	SelfProtection      = BusinessCode{CodeValue: 403006, CodeMessage: "SELF_PROTECTION", CodeDetail: "不能对自己执行该操作"}
	LastAdminProtected  = BusinessCode{CodeValue: 403007, CodeMessage: "LAST_ADMIN_PROTECTED", CodeDetail: "至少保留一名管理员"}
	UserHasNoPermission = BusinessCode{CodeValue: 403010, CodeMessage: "USER_HAS_NO_PERMISSION", CodeDetail: "用户无该操作权限"}
)

// ====== 用户/通用错误 3xx/4xx ======
var (
	UserNotFound           = BusinessCode{CodeValue: 404001, CodeMessage: "USER_NOT_FOUND", CodeDetail: "用户不存在"}
	ResourceNotFound       = BusinessCode{CodeValue: 404001, CodeMessage: "RESOURCE_NOT_FOUND", CodeDetail: "资源不存在"}
	EndpointNotFound       = BusinessCode{CodeValue: 404002, CodeMessage: "ENDPOINT_NOT_FOUND", CodeDetail: "接口不存在"}
	RoleNotFound           = BusinessCode{CodeValue: 404003, CodeMessage: "ROLE_NOT_FOUND", CodeDetail: "角色不存在"}
	UserValidationFailed   = BusinessCode{CodeValue: 400001, CodeMessage: "USER_VALIDATION_FAILED", CodeDetail: "用户信息校验失败"}
	ValidationFailed       = BusinessCode{CodeValue: 400001, CodeMessage: "VALIDATION_FAILED", CodeDetail: "请求参数校验失败"}
	UserUsernameExists     = BusinessCode{CodeValue: 400002, CodeMessage: "USER_USERNAME_EXISTS", CodeDetail: "用户名已被使用"}
	MissingRequiredField   = BusinessCode{CodeValue: 400002, CodeMessage: "MISSING_REQUIRED_FIELD", CodeDetail: "缺少必填字段"}
	UserEmailExists        = BusinessCode{CodeValue: 400003, CodeMessage: "USER_EMAIL_EXISTS", CodeDetail: "邮箱已被注册"}
	InvalidJSON            = BusinessCode{CodeValue: 400004, CodeMessage: "INVALID_JSON", CodeDetail: "JSON 格式错误"}
	UserUsernameInvalid    = BusinessCode{CodeValue: 400005, CodeMessage: "USER_USERNAME_INVALID", CodeDetail: "用户名格式无效"}
	UserEmailInvalid       = BusinessCode{CodeValue: 400006, CodeMessage: "USER_EMAIL_INVALID", CodeDetail: "邮箱格式无效"}
	PasswordMismatch       = BusinessCode{CodeValue: 400010, CodeMessage: "PASSWORD_MISMATCH", CodeDetail: "两次输入的密码不一致"}
	PasswordSameAsOld      = BusinessCode{CodeValue: 400011, CodeMessage: "PASSWORD_SAME_AS_OLD", CodeDetail: "新密码不能与旧密码相同"}
	RoleIsSystem           = BusinessCode{CodeValue: 400020, CodeMessage: "ROLE_IS_SYSTEM", CodeDetail: "系统内置角色不可修改"}
	RoleCodeInvalid        = BusinessCode{CodeValue: 400021, CodeMessage: "ROLE_CODE_INVALID", CodeDetail: "角色标识格式无效（小写字母开头，a-z0-9_，2-20 位）"}
	AdminMatrixLocked      = BusinessCode{CodeValue: 400022, CodeMessage: "ADMIN_MATRIX_LOCKED", CodeDetail: "管理员角色的权限固定为全部权限，不可修改"}
	UnknownPermissionPoint = BusinessCode{CodeValue: 400023, CodeMessage: "UNKNOWN_PERMISSION_POINT", CodeDetail: "包含未定义的权限点"}
	RoleInUse              = BusinessCode{CodeValue: 409003, CodeMessage: "ROLE_IN_USE", CodeDetail: "该角色下仍有用户，无法删除"}
)

// ====== 任务错误 4xx ======
var (
	TaskNotFound       = BusinessCode{CodeValue: 404101, CodeMessage: "TASK_NOT_FOUND", CodeDetail: "任务不存在"}
	TaskTitleEmpty     = BusinessCode{CodeValue: 400102, CodeMessage: "TASK_TITLE_REQUIRED", CodeDetail: "任务标题不能为空"}
	TaskAccessDenied   = BusinessCode{CodeValue: 403101, CodeMessage: "TASK_ACCESS_DENIED", CodeDetail: "无权操作该任务"}
	TaskDueDateInvalid = BusinessCode{CodeValue: 400104, CodeMessage: "TASK_DUE_DATE_INVALID", CodeDetail: "截止日期无效"}
)

// ====== 习惯错误 5xx ======
var (
	HabitNotFound     = BusinessCode{CodeValue: 404201, CodeMessage: "HABIT_NOT_FOUND", CodeDetail: "习惯不存在"}
	HabitAccessDenied = BusinessCode{CodeValue: 403201, CodeMessage: "HABIT_ACCESS_DENIED", CodeDetail: "无权操作该习惯"}
	HabitLogFailed    = BusinessCode{CodeValue: 500201, CodeMessage: "HABIT_LOG_FAILED", CodeDetail: "习惯打卡失败"}
	HabitTitleEmpty   = BusinessCode{CodeValue: 400201, CodeMessage: "HABIT_TITLE_REQUIRED", CodeDetail: "习惯名称不能为空"}
	HabitFreqInvalid  = BusinessCode{CodeValue: 400202, CodeMessage: "HABIT_FREQUENCY_INVALID", CodeDetail: "频率取值无效"}
)

// ====== 心情/精力错误 6xx ======
var (
	MoodValueInvalid  = BusinessCode{CodeValue: 400601, CodeMessage: "MOOD_VALUE_INVALID", CodeDetail: "心情取值无效（1-5）"}
	MoodEnergyInvalid = BusinessCode{CodeValue: 400602, CodeMessage: "MOOD_ENERGY_INVALID", CodeDetail: "精力取值无效（1-3）"}
	MoodNoteTooLong   = BusinessCode{CodeValue: 400603, CodeMessage: "MOOD_NOTE_TOO_LONG", CodeDetail: "备注不能超过 50 字"}
)

// ====== 通知错误 7xx ======
var (
	NotificationNotFound = BusinessCode{CodeValue: 404701, CodeMessage: "NOTIFICATION_NOT_FOUND", CodeDetail: "通知不存在"}
)

// ====== 账户错误 6xx ======
var (
	AccountNotFound        = BusinessCode{CodeValue: 404301, CodeMessage: "ACCOUNT_NOT_FOUND", CodeDetail: "账户不存在"}
	AccountAccessDenied    = BusinessCode{CodeValue: 403301, CodeMessage: "ACCOUNT_ACCESS_DENIED", CodeDetail: "无权操作该账户"}
	AccountInsufficient    = BusinessCode{CodeValue: 400301, CodeMessage: "ACCOUNT_INSUFFICIENT", CodeDetail: "账户余额不足"}
	AccountTransferSame    = BusinessCode{CodeValue: 400302, CodeMessage: "ACCOUNT_TRANSFER_SAME", CodeDetail: "转账不能是同一账户"}
	AccountNameEmpty       = BusinessCode{CodeValue: 400303, CodeMessage: "ACCOUNT_NAME_REQUIRED", CodeDetail: "账户名称不能为空"}
	AccountTypeInvalid     = BusinessCode{CodeValue: 400304, CodeMessage: "ACCOUNT_TYPE_INVALID", CodeDetail: "账户类型无效"}
	AccountHasTransactions = BusinessCode{CodeValue: 400305, CodeMessage: "ACCOUNT_HAS_TRANSACTIONS", CodeDetail: "账户存在关联交易，无法删除"}
)

// ====== 交易错误 7xx ======
var (
	TransactionNotFound        = BusinessCode{CodeValue: 404401, CodeMessage: "TRANSACTION_NOT_FOUND", CodeDetail: "交易不存在"}
	TransactionAccessDenied    = BusinessCode{CodeValue: 403401, CodeMessage: "TRANSACTION_ACCESS_DENIED", CodeDetail: "无权操作该交易"}
	TransactionTypeInvalid     = BusinessCode{CodeValue: 400401, CodeMessage: "TRANSACTION_TYPE_INVALID", CodeDetail: "交易类型无效"}
	TransactionAmountInvalid   = BusinessCode{CodeValue: 400402, CodeMessage: "TRANSACTION_AMOUNT_INVALID", CodeDetail: "交易金额无效"}
	TransactionAlreadyReversed = BusinessCode{CodeValue: 400403, CodeMessage: "TRANSACTION_ALREADY_REVERSED", CodeDetail: "交易已冲正"}
)

// ====== 预算错误 8xx ======
var (
	BudgetNotFound         = BusinessCode{CodeValue: 404501, CodeMessage: "BUDGET_NOT_FOUND", CodeDetail: "预算不存在"}
	BudgetAccessDenied     = BusinessCode{CodeValue: 403501, CodeMessage: "BUDGET_ACCESS_DENIED", CodeDetail: "无权操作该预算"}
	BudgetNameEmpty        = BusinessCode{CodeValue: 400501, CodeMessage: "BUDGET_NAME_REQUIRED", CodeDetail: "预算名称不能为空"}
	BudgetAmountInvalid    = BusinessCode{CodeValue: 400502, CodeMessage: "BUDGET_AMOUNT_INVALID", CodeDetail: "预算金额无效"}
	BudgetDateInvalid      = BusinessCode{CodeValue: 400503, CodeMessage: "BUDGET_DATE_INVALID", CodeDetail: "预算日期无效"}
	BudgetPeriodInvalid    = BusinessCode{CodeValue: 400504, CodeMessage: "BUDGET_PERIOD_INVALID", CodeDetail: "预算周期无效"}
	BudgetScopeInvalid     = BusinessCode{CodeValue: 400505, CodeMessage: "BUDGET_SCOPE_INVALID", CodeDetail: "预算范围无效"}
	BudgetCategoryRequired = BusinessCode{CodeValue: 400506, CodeMessage: "BUDGET_CATEGORY_REQUIRED", CodeDetail: "分类预算必须指定分类"}
)

// ====== 分类错误 9xx（记账分类，20260921 新增；错误码取值对齐 06 §1.2）======
var (
	FinanceCategoryNotFound      = BusinessCode{CodeValue: 404601, CodeMessage: "FINANCE_CATEGORY_NOT_FOUND", CodeDetail: "分类不存在"}
	FinanceCategoryInvalid       = BusinessCode{CodeValue: 400001, CodeMessage: "FINANCE_CATEGORY_INVALID", CodeDetail: "分类参数校验失败"}
	FinanceCategoryNameExists    = BusinessCode{CodeValue: 400002, CodeMessage: "FINANCE_CATEGORY_NAME_EXISTS", CodeDetail: "同层级下已存在同名分类"}
	FinanceCategoryParentInvalid = BusinessCode{CodeValue: 400003, CodeMessage: "FINANCE_CATEGORY_PARENT_INVALID", CodeDetail: "父分类无效（必须是一级分类且收支方向一致）"}
)

// ====== 统计错误 8xx ======
var (
	StatsNotAvailable = BusinessCode{CodeValue: 500501, CodeMessage: "STATS_NOT_AVAILABLE", CodeDetail: "统计数据暂不可用"}
	StatsRangeInvalid = BusinessCode{CodeValue: 400502, CodeMessage: "STATS_RANGE_INVALID", CodeDetail: "range 参数错误"}
	StatsExportFailed = BusinessCode{CodeValue: 400503, CodeMessage: "STATS_EXPORT_FAILED", CodeDetail: "导出失败"}
)

// ====== 经期错误 4xx（8xx 段位，与心情 6xx / 通知 7xx 并列） ======
var (
	PeriodDateOutOfRange     = BusinessCode{CodeValue: 400801, CodeMessage: "PERIOD_DATE_OUT_OF_RANGE", CodeDetail: "日期超出可记录范围"}
	PeriodFlowInvalid        = BusinessCode{CodeValue: 400802, CodeMessage: "PERIOD_FLOW_INVALID", CodeDetail: "经量取值无效（0-4）"}
	PeriodBBTInvalid         = BusinessCode{CodeValue: 400803, CodeMessage: "PERIOD_BBT_INVALID", CodeDetail: "基础体温需在 34.0–42.0 ℃ 之间"}
	PeriodWeightInvalid      = BusinessCode{CodeValue: 400804, CodeMessage: "PERIOD_WEIGHT_INVALID", CodeDetail: "体重需在 20.0–300.0 kg 之间"}
	PeriodSleepInvalid       = BusinessCode{CodeValue: 400805, CodeMessage: "PERIOD_SLEEP_INVALID", CodeDetail: "睡眠时长需在 0–24 小时之间"}
	PeriodPainInvalid        = BusinessCode{CodeValue: 400806, CodeMessage: "PERIOD_PAIN_INVALID", CodeDetail: "痛经等级取值无效（0-5）"}
	PeriodDischargeInvalid   = BusinessCode{CodeValue: 400807, CodeMessage: "PERIOD_DISCHARGE_INVALID", CodeDetail: "分泌物取值无效（0-5）"}
	PeriodIntercourseInvalid = BusinessCode{CodeValue: 400808, CodeMessage: "PERIOD_INTERCOURSE_INVALID", CodeDetail: "性生活取值无效（0-2）"}
	PeriodRangeTooWide       = BusinessCode{CodeValue: 400809, CodeMessage: "PERIOD_RANGE_TOO_WIDE", CodeDetail: "查询跨度不能超过 366 天"}
	PeriodMonthInvalid       = BusinessCode{CodeValue: 400810, CodeMessage: "PERIOD_MONTH_INVALID", CodeDetail: "month 参数格式应为 YYYY-MM"}
	PeriodSettingInvalid     = BusinessCode{CodeValue: 400811, CodeMessage: "PERIOD_SETTING_INVALID", CodeDetail: "设置项取值超出允许范围"}
	PeriodCycleOverlap       = BusinessCode{CodeValue: 400812, CodeMessage: "PERIOD_CYCLE_OVERLAP", CodeDetail: "与已有周期重叠"}
	PeriodResetUnconfirmed   = BusinessCode{CodeValue: 400813, CodeMessage: "PERIOD_RESET_UNCONFIRMED", CodeDetail: "重置操作需要二次确认"}
	PeriodCycleNotFound      = BusinessCode{CodeValue: 404801, CodeMessage: "PERIOD_CYCLE_NOT_FOUND", CodeDetail: "周期不存在"}
	PeriodCycleAccessDenied  = BusinessCode{CodeValue: 403801, CodeMessage: "PERIOD_CYCLE_ACCESS_DENIED", CodeDetail: "无权操作该周期"}
)

// ====== 通用/系统错误 9xx ======
var (
	InternalError      = BusinessCode{CodeValue: 500001, CodeMessage: "INTERNAL_ERROR", CodeDetail: "服务器内部错误"}
	DatabaseError      = BusinessCode{CodeValue: 500002, CodeMessage: "DATABASE_ERROR", CodeDetail: "数据库错误"}
	CacheError         = BusinessCode{CodeValue: 500003, CodeMessage: "CACHE_ERROR", CodeDetail: "缓存服务错误"}
	ServiceUnavailable = BusinessCode{CodeValue: 503001, CodeMessage: "SERVICE_UNAVAILABLE", CodeDetail: "服务暂不可用"}
	MethodNotAllowed   = BusinessCode{CodeValue: 405001, CodeMessage: "METHOD_NOT_ALLOWED", CodeDetail: "HTTP 方法不允许"}
	VersionConflict    = BusinessCode{CodeValue: 409001, CodeMessage: "VERSION_CONFLICT", CodeDetail: "数据版本冲突"}
	DuplicateResource  = BusinessCode{CodeValue: 409002, CodeMessage: "DUPLICATE_RESOURCE", CodeDetail: "资源重复"}
	RateLimitExceeded  = BusinessCode{CodeValue: 429001, CodeMessage: "RATE_LIMIT_EXCEEDED", CodeDetail: "请求频率超限"}
)
