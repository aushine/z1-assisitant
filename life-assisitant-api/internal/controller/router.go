package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/middleware"
)

// RegisterRoutes 注册所有路由
// 全部挂在 /z1/api/v1 前缀下（D-03 第十三轮：/z1 服务前缀防 nginx 路径撞名；
// 静态资源同理 /z1/uploads，见 main.go AddStaticPath）
// 中间件链（在 main.go 绑定到 server）：
//
//	RequestId -> CORS -> Recovery -> AccessLog -> ErrorHandler -> JwtAuth
//
// D-03 权限重构（2026-09-17）：
//   - 路由守卫从「整块 adminOnly」改为**细粒度权限点** RequirePermission("module:action")；
//   - admin 在中间件内代码旁路（全权限不查库）；其余角色按角色矩阵逐点判定；
//   - 会话生命周期路由（me/logout/refresh 等）始终对已登录用户开放，避免无权用户被锁死；
//   - 权限点目录见 db/init_data.sql 与迁移 db/260917_role_permission_v2.sql。
//
// ⚠️ GF v2.6 的 group.GET(pattern, object, params...) 第三参是绑定参数而非中间件
//
//	（D-01 教训：写成 GET("/users", RequireAdmin, User.List) 会把中间件当终点 handler、
//	真 handler 被当 params 丢弃，表现为 404）。路由级中间件必须走 Middleware() 子分组，
//	且 Middleware 原地改接收者——每个权限点各开一个 Group("", ...)，不复用父 group。
func RegisterRoutes(s *ghttp.Server) {
	s.Group(consts.APIPrefix, func(group *ghttp.RouterGroup) {
		// ====== 公开接口（白名单，不需要 token） ======
		group.POST("/auth/login", Auth.Login)
		group.POST("/auth/register", Auth.Register)
		group.POST("/auth/refresh", Auth.RefreshToken)
		group.POST("/auth/forgot-password", Auth.ForgotPassword)
		group.POST("/auth/reset-password", Auth.ResetPassword)

		// ====== 应用级公开配置（白名单，不需要 token） ======
		// 前端启动时探测上传文件对外基址（storage.public_url，可选），
		// 配了 → 用它拼 /z1/uploads/* 绝对地址；没配/不通 → 回落当前后端
		group.GET("/app/uploads-base", App.UploadsBase)

		// ====== 会话生命周期（任何已登录用户，不挂权限点） ======
		group.GET("/auth/me", Auth.Me)
		group.POST("/auth/logout", Auth.Logout)
		group.GET("/auth/me/permissions", Permission.MyPermissions) // 前端据此渲染菜单/按钮
		group.GET("/permissions", Permission.List)                  // 权限点目录（渲染 label 用）
		// D-03 第十一轮：登录设备管理（前端左下角面板）
		group.GET("/auth/sessions", Auth.Sessions)             // 我的活跃会话
		group.DELETE("/auth/sessions/:id", Auth.RevokeSession) // 退出指定设备（归属校验在 service）

		// ====== home 首页 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("home:view"))
			g.GET("/home", Home.Fetch)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("home:sync"))
			g.POST("/sync", Sync.Trigger)
		})
		// 设备同步状态：本地数据是否追平，属会话诊断，保持开放
		group.GET("/sync/status", Sync.Status)

		// ====== me 个人中心 ======
		// 自更新必须在 /users/:id 之前注册，否则 "me" 会被当作 :id 匹配
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("me:profile"))
			g.PATCH("/users/me", User.UpdateMe)
			// D-03 第八轮：头像上传（multipart field=file，落盘 storage.upload_dir/avatars，
			// DB 只存 /z1/uploads/avatars/<name> 短 URL；静态映射见 main.go AddStaticPath）
			g.POST("/users/me/avatar", User.UploadAvatar)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("me:password"))
			g.POST("/auth/change-password", Auth.ChangePassword)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("me:feedback"))
			g.POST("/feedback", Feedback.Create)
		})

		// ====== task 任务 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("task:view"))
			g.GET("/tasks", Task.List)
			g.GET("/tasks/:id", Task.Get)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("task:create"))
			g.POST("/tasks", Task.Create)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("task:update"))
			g.PATCH("/tasks/:id", Task.Update)
			g.PATCH("/tasks/:id/subtasks/:subtaskId", Task.ToggleSubtask)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("task:complete"))
			g.PATCH("/tasks/:id/complete", Task.ToggleComplete)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("task:delete"))
			g.DELETE("/tasks/:id", Task.Delete)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			// batch 按 body.action 分权：中间件 ANY 粗筛，controller 细判（task.go BatchAction）
			g.Middleware(middleware.RequirePermission("task:complete", "task:delete"))
			g.POST("/tasks/batch", Task.BatchAction)
		})

		// ====== habit 习惯 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("habit:view"))
			g.GET("/habits", Habit.List)
			g.GET("/habits/today", Habit.GetToday)
			g.GET("/habits/:id", Habit.Get)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("habit:create"))
			g.POST("/habits", Habit.Create)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("habit:update"))
			g.PATCH("/habits/:id", Habit.Update)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("habit:delete"))
			g.DELETE("/habits/:id", Habit.Delete)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("habit:checkin"))
			g.POST("/habits/:id/log", Habit.Log)
		})

		// ====== mood 心情/精力（260919：按小时记录） ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("mood:view"))
			g.GET("/moods", Mood.List)
			g.GET("/moods/timeline", Mood.Timeline)
			g.GET("/moods/today", Mood.GetByDate)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("mood:write"))
			g.PUT("/moods", Mood.Upsert)
		})

		// ====== finance 财务 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:view"))
			g.GET("/accounts", Finance.ListAccounts)
			g.GET("/accounts/total", Finance.GetTotalBalance)
			g.GET("/transactions", Finance.ListTransactions)
			g.GET("/transactions/:id", Finance.GetTransaction)
			g.GET("/budgets", Finance.ListBudgets)
			// 260921 v2 + v4：收支日历 / 债权债务（沿用 finance:view，不新增权限点）
			g.GET("/finance/calendar", Finance.GetCalendar)
			g.GET("/finance/debts", Finance.GetDebts)
			// 260922：流水页顶部数据块（自然周期收支 + 总预算聚合，沿用 finance:view）
			g.GET("/finance/summary", Finance.GetFinanceSummary)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:account"))
			g.POST("/accounts", Finance.CreateAccount)
			g.PATCH("/accounts/:id", Finance.UpdateAccount)
			g.DELETE("/accounts/:id", Finance.DeleteAccount)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:record"))
			g.POST("/transactions", Finance.CreateTransaction)
			g.POST("/transactions/transfer", Finance.Transfer)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:tx_manage"))
			g.POST("/transactions/:id/reverse", Finance.ReverseTransaction)
			g.PATCH("/transactions/:id", Finance.UpdateTransaction)
			g.DELETE("/transactions/:id", Finance.DeleteTransaction)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:budget"))
			g.POST("/budgets", Finance.CreateBudget)
			g.PATCH("/budgets/:id", Finance.UpdateBudget)
			g.DELETE("/budgets/:id", Finance.DeleteBudget)
		})
		// 收支分类（20260921 新增）：查看走 finance:view，增删改走新权限点 finance:category
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:view"))
			g.GET("/finance/categories", FinanceCategory.List)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("finance:category"))
			g.POST("/finance/categories", FinanceCategory.Create)
			g.PATCH("/finance/categories/:id", FinanceCategory.Update)
			g.DELETE("/finance/categories/:id", FinanceCategory.Delete)
		})
		// 习惯/待办分类（20260922 新增，两域共用 user_categories）：
		// 查看走 category:view，增删改走 category:manage（权限点见 db/data_260922_user_categories.sql）
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("category:view"))
			g.GET("/user-categories", UserCategory.List)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("category:manage"))
			g.POST("/user-categories", UserCategory.Create)
			g.PATCH("/user-categories/:id", UserCategory.Update)
			g.DELETE("/user-categories/:id", UserCategory.Delete)
		})

		// ====== period 经期（记录模块的第 5 个维度）======
		// 权限点 period:view / period:write / period:manage（见 db/data_260919.sql）
		// 设置页与经期 Tab **共用**这三个点，不为设置入口单独造按钮级权限
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("period:view"))
			g.GET("/period/overview", Period.Overview)
			g.GET("/period/calendar", Period.Calendar)
			g.GET("/period/days", Period.ListDays)
			g.GET("/period/days/:date", Period.GetDay)
			g.GET("/period/cycles", Period.ListCycles)
			g.GET("/period/settings", Period.GetSettings)
			g.GET("/period/report", Period.Report)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("period:write"))
			g.PUT("/period/days/:date", Period.UpsertDay)
			g.DELETE("/period/days/:date", Period.DeleteDay)
			g.PATCH("/period/settings", Period.PatchSettings)
			g.POST("/period/setup", Period.Setup)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("period:manage"))
			g.PATCH("/period/cycles/:id", Period.PatchCycle)
			g.POST("/period/reset", Period.Reset)
		})

		// ====== health 健康（260919 v1：指标逐日记录，一次提交写三张表） ======
		// 权限点 health:view / health:write / health:manage（见 db/data_260919_health.sql）
		// 概览 / 月历 / 区间 / 单日 / 设置读取 → view
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("health:view"))
			g.GET("/health/overview", Health.Overview)
			g.GET("/health/calendar", Health.Calendar)
			g.GET("/health/days", Health.ListDays)
			g.GET("/health/days/:date", Health.GetDay)
			g.GET("/health/settings", Health.GetSettings)
			// 时间轴事件（260919 新增：身体指标改为一天多次、不延续）
			g.GET("/health/events", Health.ListEvents)
		})
		// 写入 → write
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("health:write"))
			g.PUT("/health/days/:date", Health.UpsertDay)
			g.DELETE("/health/days/:date", Health.DeleteDay)
			// ⚠️ 身体指标（water/bbt/weight/sleep/bowel）的**唯一写入路径**
			g.POST("/health/events", Health.CreateEvent)
			g.PATCH("/health/events/:id", Health.PatchEvent)
			g.DELETE("/health/events/:id", Health.DeleteEvent)
		})
		// 设置修改与首次引导 → manage
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("health:manage"))
			g.PATCH("/health/settings", Health.PatchSettings)
			g.POST("/health/setup", Health.Setup)
		})

		// ====== anniversary 纪念日 / 倒数日（260919 v1） ======
		// 权限点 anniversary:view / anniversary:write
		// ⚠️ next_date / days_left 由后端实时推导，不落库
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("anniversary:view"))
			g.GET("/anniversaries", Anniversary.List)
			g.GET("/anniversaries/upcoming", Anniversary.Upcoming)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("anniversary:write"))
			g.POST("/anniversaries", Anniversary.Create)
			g.PATCH("/anniversaries/:id", Anniversary.Patch)
			g.DELETE("/anniversaries/:id", Anniversary.Delete)
		})

		// ====== stat 统计 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("stat:view"))
			g.GET("/stats/overview", Stats.GetOverview)
			g.GET("/stats/tasks", Stats.GetTaskStats)
			g.GET("/stats/habits", Stats.GetHabitStats)
			g.GET("/stats/finance", Stats.GetFinanceStats)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("stat:export"))
			g.GET("/stats/export", Stats.Export)
		})

		// ====== timeline 时间线 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("timeline:view"))
			g.GET("/timeline", Timeline.Fetch)
		})

		// ====== notification 通知 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("notification:view"))
			g.GET("/notifications", Notification.List)
			g.GET("/notifications/unread-count", Notification.UnreadCount)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("notification:handle"))
			g.POST("/notifications/mark-read", Notification.MarkRead)
			g.POST("/notifications/:id/read", Notification.MarkReadByID)
		})

		// ====== user_mgmt 用户管理 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("user_mgmt:view"))
			g.GET("/users", User.List)
			g.GET("/users/:id", User.Get)
			g.GET("/users/:id/permissions", Permission.GetUserPermissions)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("user_mgmt:create"))
			g.POST("/users", User.Create)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("user_mgmt:update"))
			g.PATCH("/users/:id", User.Update)
			g.PATCH("/users/:id/status", User.UpdateStatus)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("user_mgmt:delete"))
			g.DELETE("/users/:id", User.Delete)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("user_mgmt:assign_role"))
			g.PUT("/users/:id/role", Role.AssignRole)
		})

		// ====== role_mgmt 角色与权限管理 ======
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("role_mgmt:view"))
			g.GET("/roles", Role.List)
			g.GET("/roles/:code", Role.Get)
			g.GET("/roles/:code/permissions", Role.GetRoleMatrix)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("role_mgmt:create"))
			g.POST("/roles", Role.Create)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("role_mgmt:update"))
			g.PATCH("/roles/:code", Role.Update)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("role_mgmt:delete"))
			g.DELETE("/roles/:code", Role.Delete)
		})
		group.Group("", func(g *ghttp.RouterGroup) {
			g.Middleware(middleware.RequirePermission("role_mgmt:grant"))
			g.PUT("/roles/:code/permissions", Role.UpdateRoleMatrix)
		})
	})

	// 健康检查（v1 不用 Redis，简化）
	s.BindHandler(consts.APIPrefix+"/health", func(r *ghttp.Request) {
		r.Response.WriteJson(map[string]any{
			"code":    0,
			"message": "ok",
			"data":    map[string]any{"status": "up"},
		})
	})
}
