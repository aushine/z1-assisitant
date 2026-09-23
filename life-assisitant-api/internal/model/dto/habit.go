// Package dto 习惯模块 DTO
package dto

// ====== 创建习惯 ======

// CreateHabitReq 创建习惯请求
type CreateHabitReq struct {
	Title       string `json:"title"        v:"required|length:1,200" dc:"习惯名，1-200 字符"`
	Description string `json:"description"  v:"length:0,500"          dc:"详细描述"`
	// Icon 空 = 继承分类图标（20260922 新优先级链）；长度 40 与 habits.icon 列同规格（lucide: 前缀）
	Icon  string `json:"icon"         v:"length:0,40"           dc:"图标引用 lucide:<Name> / emoji；空=继承分类图标"`
	Color string `json:"color"        v:"length:0,20"  d:"#014DB2" dc:"图标底色 hex"`
	// ⚠️ 20260922：删除 v:"in:,sport,diet,life,study" 硬枚举 —— 用户自建分类会被 400001 挡死；
	// 合法性改由 service 层做「归属校验」（id ∈ 当前用户 domain=habit 且未删，见 06 §3.4）
	Category      string `json:"category"     v:"length:0,20" d:"life" dc:"分类 id（user_categories.domain=habit）"`
	Frequency     string `json:"frequency"    v:"in:daily,weekly,monthly" d:"daily"  dc:"频率"`
	TargetCount   int    `json:"target_count" v:"between:1,999" d:"1"    dc:"每周期目标次数"`
	Unit          string `json:"unit"         v:"length:0,20"           dc:"单位（分钟/次/杯...）"`
	TrackDuration bool   `json:"track_duration" v:"" d:"false"          dc:"是否记录打卡时长"`
}

// ====== 部分更新 ======

// UpdateHabitReq 更新习惯
type UpdateHabitReq struct {
	Title       *string `json:"title"        v:"length:1,200"          dc:"习惯名"`
	Description *string `json:"description"  v:"length:0,500"          dc:"详细描述；空字符串清空"`
	Icon        *string `json:"icon"         v:"length:0,40"           dc:"图标引用 lucide:<Name> / emoji；空串=继承分类图标"`
	Color       *string `json:"color"        v:"length:0,20"           dc:"图标底色 hex"`
	// ⚠️ 20260922：删除硬枚举，改为 service 层归属校验（见 06 §3.4）
	Category      *string `json:"category"     v:"length:0,20" dc:"分类 id（须属于当前用户 domain=habit 且未删）"`
	Frequency     *string `json:"frequency"    v:"in:daily,weekly,monthly" dc:"频率"`
	TargetCount   *int    `json:"target_count" v:"between:1,999"         dc:"每周期目标次数"`
	Unit          *string `json:"unit"         v:"length:0,20"           dc:"单位；空字符串清空"`
	TrackDuration *bool   `json:"track_duration" v:""                   dc:"是否记录打卡时长"`
	Status        *string `json:"status"       v:"in:active,archived"    dc:"状态"`
}

// ====== 列表查询 ======

// ListHabitsReq 习惯列表查询
type ListHabitsReq struct {
	Status   string `json:"status" v:"in:,active,archived" d:"active" dc:"按状态筛（默认 active）"`
	Page     int    `json:"page"   v:"min:1"  d:"1"`
	PageSize int    `json:"page_size" v:"max:100" d:"20"`
}

// ====== 打卡 ======

// LogHabitReq 打卡请求
// MVP 简化：同一天同习惯只允许一条 log（upsert：count 累加）
type LogHabitReq struct {
	Date            string `json:"date"             v:"required|date" dc:"打卡日期 YYYY-MM-DD（必填）"`
	Count           int    `json:"count"            v:"between:1,99" d:"1" dc:"本次打卡次数（默认 1）"`
	Note            string `json:"note"             v:"length:0,500" dc:"备注"`
	DurationMinutes int    `json:"duration_minutes" v:"between:0,1440" d:"0" dc:"打卡时长（分钟，默认 0）"`
}

// ====== 响应 ======

// HabitResp 习惯响应对象
type HabitResp struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description,omitempty"`
	Icon          string `json:"icon"`
	Color         string `json:"color"`
	Category      string `json:"category"`
	Frequency     string `json:"frequency"`
	TargetCount   int    `json:"target_count"`
	Unit          string `json:"unit,omitempty"`
	TrackDuration bool   `json:"track_duration"`
	// 连续打卡（单位随 frequency：天/周/月）
	CurrentStreak   int    `json:"current_streak"`
	LongestStreak   int    `json:"longest_streak"`
	LastCheckInDate string `json:"last_check_in_date,omitempty"`
	TotalCheckIns   int    `json:"total_check_ins"`
	Status          string `json:"status"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
	// 今日相关（仅 List/GetToday 时填充）
	TodayCount     int    `json:"today_count,omitempty"`
	TodayCompleted bool   `json:"today_completed,omitempty"`
	TodayDate      string `json:"today_date,omitempty"`
}

// ListHabitsResp 习惯列表响应
type ListHabitsResp struct {
	Items []HabitResp `json:"items"`
	Total int64       `json:"total"`
	Page  int         `json:"page"`
}

// TodayHabitsResp 今日习惯响应（含打卡状态）
type TodayHabitsResp struct {
	Date      string      `json:"date"`
	Items     []HabitResp `json:"items"`
	Total     int         `json:"total"`
	DoneCount int         `json:"done_count"`
}

// GetTodayHabitsReq 取今日习惯的查询参数
// 留空时取 server 当前日期
type GetTodayHabitsReq struct {
	Date string `json:"date" v:"date" dc:"指定日期 YYYY-MM-DD（可选，默认今天）"`
}
