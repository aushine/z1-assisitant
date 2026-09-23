// Package service 业务逻辑层
// 规范见 ../life-assisitant/md/spec/30-后端架构.md §5
//
// 设计要点：
//  1. 每个 service 一个 interface + 一个实现
//  2. 业务校验、事务边界、跨 DAO 编排都在这一层
//  3. controller 不直接调 DAO，必须经 service
package service

var (
	localAuth         IAuthService
	localUser         IUserService
	localRole         IRoleService
	localPermission   IPermissionService
	localTask         ITaskService
	localHabit        IHabitService
	localFinance      IFinanceService
	localStats        IStatsService
	localFeedback     IFeedbackService
	localSync         ISyncService
	localHome         IHomeService
	localNotification INotificationService
	localMood         IMoodService
	localTimeline     ITimelineService
	localPeriod       IPeriodService
	// 260919 v1：健康模块（三表事务）与纪念日（next_date 实时推导）
	localHealth      IHealthService
	localAnniversary IAnniversaryService
	// 260921：记账分类（用户级，内置种子懒创建）
	localFinanceCategory IFinanceCategoryService
	// 260922：习惯/待办分类（用户级两域共用，内置种子懒创建）
	localUserCategory IUserCategoryService
)

// 注册器：main.go 启动时调用 impl.Register() 自动注入
// 这里只暴露 setter，impl 包通过 init() 或 Register() 注入

func SetAuth(s IAuthService)                 { localAuth = s }
func SetUser(s IUserService)                 { localUser = s }
func SetRole(s IRoleService)                 { localRole = s }
func SetPermission(s IPermissionService)     { localPermission = s }
func SetTask(s ITaskService)                 { localTask = s }
func SetHabit(s IHabitService)               { localHabit = s }
func SetFinance(s IFinanceService)           { localFinance = s }
func SetStats(s IStatsService)               { localStats = s }
func SetFeedback(s IFeedbackService)         { localFeedback = s }
func SetSync(s ISyncService)                 { localSync = s }
func SetHome(s IHomeService)                 { localHome = s }
func SetNotification(s INotificationService) { localNotification = s }
func SetMood(s IMoodService)                 { localMood = s }
func SetTimeline(s ITimelineService)         { localTimeline = s }
func SetPeriod(s IPeriodService)             { localPeriod = s }
func SetHealth(s IHealthService)             { localHealth = s }
func SetAnniversary(s IAnniversaryService)   { localAnniversary = s }

func SetFinanceCategory(s IFinanceCategoryService) { localFinanceCategory = s }
func SetUserCategory(s IUserCategoryService)       { localUserCategory = s }

func Auth() IAuthService                 { return localAuth }
func User() IUserService                 { return localUser }
func Role() IRoleService                 { return localRole }
func Permission() IPermissionService     { return localPermission }
func Task() ITaskService                 { return localTask }
func Habit() IHabitService               { return localHabit }
func Finance() IFinanceService           { return localFinance }
func Stats() IStatsService               { return localStats }
func Feedback() IFeedbackService         { return localFeedback }
func Sync() ISyncService                 { return localSync }
func Home() IHomeService                 { return localHome }
func Notification() INotificationService { return localNotification }
func Mood() IMoodService                 { return localMood }
func Timeline() ITimelineService         { return localTimeline }
func Period() IPeriodService             { return localPeriod }
func Health() IHealthService             { return localHealth }
func Anniversary() IAnniversaryService   { return localAnniversary }

func FinanceCategory() IFinanceCategoryService { return localFinanceCategory }

func UserCategory() IUserCategoryService { return localUserCategory }
