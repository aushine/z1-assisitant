// Package consts 全局常量
package consts

// 权限点权威目录（2026-10-01 建立）
//
// 背景（真实事故）：新增模块的权限点**只靠手写 SQL 增量脚本落库**，一旦脚本漏跑
// （或被权限页"全删全插"覆盖回旧目录），路由上的 RequirePermission("xxx:yyy")
// 对任何非 admin 角色都判定失败 → 接口恒返 403001，且现象极像"功能坏了"。
// 典型：260922 新增的 category:view / category:manage 从未落库，
//
//	GET /user-categories 对 user/female 恒 403（db/data_261001_perm_fix.sql）。
//
// 因此把目录升格为**代码里的权威清单**：启动时 EnsureCatalog 以它为准做
// INSERT IGNORE 自愈（只补不删），保证"路由引用到的点一定在目录里"。
//
// ⚠️ 新增权限点时两处必须同步：
//  1. 本文件 PermissionCatalog（启动自愈源）
//  2. db/init_data.sql + manifest/sql/0001_init.sql 的种子（建库/重建基线）
//  3. 桌面端 src/pages/permission/index.tsx 的 MODULE_NAMES（权限页显示名与顺序）
type PermissionPoint struct {
	ID          string // 主键，形如 p_<module>_<action>（与 SQL 种子逐字一致）
	Module      string
	Action      string
	Description string
}

// PermissionCatalog 权限点全量目录（48 条 / 15 模块）
// 顺序与 db/init_data.sql 一致（业务语义序，非字母序）。
var PermissionCatalog = []PermissionPoint{
	// home 首页
	{ID: "p_home_view", Module: "home", Action: "view", Description: "查看首页聚合数据"},
	{ID: "p_home_sync", Module: "home", Action: "sync", Description: "手动同步数据"},
	// task 任务
	{ID: "p_task_view", Module: "task", Action: "view", Description: "查看任务"},
	{ID: "p_task_create", Module: "task", Action: "create", Description: "创建任务"},
	{ID: "p_task_update", Module: "task", Action: "update", Description: "编辑任务(含子任务勾选)"},
	{ID: "p_task_complete", Module: "task", Action: "complete", Description: "完成任务(含批量)"},
	{ID: "p_task_delete", Module: "task", Action: "delete", Description: "删除任务(含批量)"},
	// habit 习惯
	{ID: "p_habit_view", Module: "habit", Action: "view", Description: "查看习惯(含今日)"},
	{ID: "p_habit_create", Module: "habit", Action: "create", Description: "创建习惯"},
	{ID: "p_habit_update", Module: "habit", Action: "update", Description: "编辑习惯"},
	{ID: "p_habit_delete", Module: "habit", Action: "delete", Description: "删除习惯"},
	{ID: "p_habit_checkin", Module: "habit", Action: "checkin", Description: "习惯打卡"},
	// category 习惯/待办分类（260922 新增；两域共用 user_categories，不挂 habit/task 名下）
	{ID: "p_category_view", Module: "category", Action: "view", Description: "查看习惯/待办分类"},
	{ID: "p_category_manage", Module: "category", Action: "manage", Description: "管理习惯/待办分类(增删改)"},
	// mood 心情/精力
	{ID: "p_mood_view", Module: "mood", Action: "view", Description: "查看心情记录"},
	{ID: "p_mood_write", Module: "mood", Action: "write", Description: "记录今日心情/精力"},
	// finance 财务
	{ID: "p_finance_view", Module: "finance", Action: "view", Description: "查看账户/交易/预算"},
	{ID: "p_finance_account", Module: "finance", Action: "account", Description: "管理账户(增删改)"},
	{ID: "p_finance_record", Module: "finance", Action: "record", Description: "记账(收支/转账)"},
	{ID: "p_finance_tx_manage", Module: "finance", Action: "tx_manage", Description: "修改/冲正/删除交易"},
	{ID: "p_finance_budget", Module: "finance", Action: "budget", Description: "管理预算"},
	{ID: "p_finance_category", Module: "finance", Action: "category", Description: "管理收支分类"},
	// period 经期（260919）
	{ID: "p_period_view", Module: "period", Action: "view", Description: "查看经期记录与预测"},
	{ID: "p_period_write", Module: "period", Action: "write", Description: "记录经期日记与修改设置"},
	{ID: "p_period_manage", Module: "period", Action: "manage", Description: "修正周期与重置经期数据"},
	// health 健康（260919-v1）
	{ID: "p_health_view", Module: "health", Action: "view", Description: "查看健康记录与概览"},
	{ID: "p_health_write", Module: "health", Action: "write", Description: "记录健康数据(饮水/体重/体温等)"},
	{ID: "p_health_manage", Module: "health", Action: "manage", Description: "修改健康设置与重置健康数据"},
	// anniversary 纪念日（260919-v1）
	{ID: "p_anniversary_view", Module: "anniversary", Action: "view", Description: "查看纪念日与倒数日"},
	{ID: "p_anniversary_write", Module: "anniversary", Action: "write", Description: "管理纪念日(增删改)"},
	// stat 统计
	{ID: "p_stat_view", Module: "stat", Action: "view", Description: "查看统计"},
	{ID: "p_stat_export", Module: "stat", Action: "export", Description: "导出统计数据"},
	// timeline 时间线
	{ID: "p_timeline_view", Module: "timeline", Action: "view", Description: "查看生活时间线"},
	// notification 通知
	{ID: "p_notification_view", Module: "notification", Action: "view", Description: "查看通知"},
	{ID: "p_notification_handle", Module: "notification", Action: "handle", Description: "标记通知已读"},
	// me 个人中心
	{ID: "p_me_profile", Module: "me", Action: "profile", Description: "编辑个人资料"},
	{ID: "p_me_password", Module: "me", Action: "password", Description: "修改密码"},
	{ID: "p_me_feedback", Module: "me", Action: "feedback", Description: "提交反馈"},
	// user_mgmt 用户管理（管理域：不自动授予普通角色）
	{ID: "p_user_mgmt_view", Module: "user_mgmt", Action: "view", Description: "查看用户列表/详情"},
	{ID: "p_user_mgmt_create", Module: "user_mgmt", Action: "create", Description: "新建用户"},
	{ID: "p_user_mgmt_update", Module: "user_mgmt", Action: "update", Description: "编辑用户(含启用/禁用)"},
	{ID: "p_user_mgmt_delete", Module: "user_mgmt", Action: "delete", Description: "删除用户"},
	{ID: "p_user_mgmt_assign_role", Module: "user_mgmt", Action: "assign_role", Description: "为用户分配角色"},
	// role_mgmt 角色与权限（管理域）
	{ID: "p_role_mgmt_view", Module: "role_mgmt", Action: "view", Description: "查看角色与权限配置"},
	{ID: "p_role_mgmt_create", Module: "role_mgmt", Action: "create", Description: "新建自定义角色"},
	{ID: "p_role_mgmt_update", Module: "role_mgmt", Action: "update", Description: "编辑角色名称/描述"},
	{ID: "p_role_mgmt_delete", Module: "role_mgmt", Action: "delete", Description: "删除自定义角色"},
	{ID: "p_role_mgmt_grant", Module: "role_mgmt", Action: "grant", Description: "配置角色权限（勾选保存）"},
}

// AdminOnlyModules 管理域模块：基线不授予普通角色（user_mgmt / role_mgmt）。
// 见 db/init_data.sql：user = 目录中 module NOT IN ('user_mgmt','role_mgmt') 的全集。
func IsAdminOnlyModule(module string) bool {
	return module == "user_mgmt" || module == "role_mgmt"
}
