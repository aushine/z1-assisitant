// Package dto 任务模块 DTO（M5 扩展：子任务 / 提醒 / 重复 / 批量操作）
package dto

// ====== 子任务请求 ======

// SubtaskReq 子任务条目（创建/更新共用）
type SubtaskReq struct {
	ID          string `json:"id,omitempty"`
	Title       string `json:"title"        v:"required|length:1,200" dc:"子任务标题"`
	IsCompleted *bool  `json:"is_completed,omitempty"               dc:"是否完成"`
	Order       int    `json:"order"                                 dc:"排序"`
}

// ====== 创建任务 ======

// CreateTaskReq 创建任务请求
// M5 扩展：reminder_at / recurrence_rule / subtasks
type CreateTaskReq struct {
	Title          string       `json:"title"           v:"required|length:1,200"  dc:"任务标题，1-200 字符"`
	Description    string       `json:"description"     v:"length:0,5000"          dc:"详细描述"`
	Priority       string       `json:"priority"        v:"in:,relaxed,normal,important,urgent" dc:"优先级：relaxed/normal/important/urgent，默认 normal"`
	CategoryID     string       `json:"category_id"     v:"length:0,32"            dc:"分类 ID（须属于当前用户 domain=task 且未删；空=未分类）"`
	Icon           string       `json:"icon"            v:"length:0,40"            dc:"图标引用 lucide:<Name> / emoji；空=继承分类图标（20260922 新增）"`
	DueDate        string       `json:"due_date"        v:"date"                   dc:"截止日期 YYYY-MM-DD"`
	DueTime        string       `json:"due_time"        v:"regex:^[0-2][0-9]:[0-5][0-9]$" dc:"截止时间 HH:MM"`
	ReminderAt     string       `json:"reminder_at"     v:"length:0,30"            dc:"提醒时间 ISO datetime，可选"`
	RecurrenceRule string       `json:"recurrence_rule" v:"length:0,255"           dc:"重复规则 RRULE，如 FREQ=DAILY"`
	Subtasks       []SubtaskReq `json:"subtasks"                                   dc:"子任务列表"`
}

// ====== 部分更新 ======

// UpdateTaskReq 更新任务（部分更新，所有字段都可选）
type UpdateTaskReq struct {
	Title          *string      `json:"title"            v:"length:1,200"          dc:"任务标题"`
	Description    *string      `json:"description"      v:"length:0,5000"         dc:"详细描述"`
	Priority       *string      `json:"priority"         v:"in:,relaxed,normal,important,urgent"       dc:"优先级"`
	Status         *string      `json:"status"           v:"in:,todo,in_progress,done,archived" dc:"状态"`
	CategoryID     *string      `json:"category_id"      v:"length:0,32"           dc:"分类 ID（须属于当前用户 domain=task 且未删；空串=清空为未分类）"`
	Icon           *string      `json:"icon"             v:"length:0,40"           dc:"图标引用 lucide:<Name> / emoji；空串=继承分类图标"`
	DueDate        *string      `json:"due_date"         v:"date"                  dc:"截止日期 YYYY-MM-DD；传空字符串表示清空"`
	DueTime        *string      `json:"due_time"         v:"regex:^[0-2][0-9]:[0-5][0-9]$" dc:"截止时间 HH:MM；传空字符串表示清空"`
	ReminderAt     *string      `json:"reminder_at"      v:"length:0,30"           dc:"提醒时间；传空字符串表示清空"`
	RecurrenceRule *string      `json:"recurrence_rule"  v:"length:0,255"          dc:"重复规则；传空字符串表示清空"`
	Subtasks       []SubtaskReq `json:"subtasks"                                   dc:"子任务列表（全量替换）"`
}

// ====== 列表查询 ======

// ListTasksReq 任务列表查询
type ListTasksReq struct {
	Filter   string `json:"filter"     v:"in:,all,today,upcoming,done,overdue" dc:"业务语义筛选"`
	Status   string `json:"status"     v:"in:,todo,in_progress,done,archived" dc:"直接按状态筛"`
	Priority string `json:"priority"   v:"in:,relaxed,normal,important,urgent"                    dc:"按优先级筛"`
	Keyword  string `json:"keyword"    v:"length:0,50"                         dc:"标题模糊搜索"`
	Sort     string `json:"sort"       v:"in:,due_time,priority,created_at"    dc:"排序字段"`
	Page     int    `json:"page"       v:"min:1"  d:"1"`
	PageSize int    `json:"page_size"  v:"max:100" d:"20"`
}

// ====== 子任务响应 ======

// SubtaskResp 子任务响应对象
type SubtaskResp struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	IsCompleted bool   `json:"is_completed"`
	Order       int    `json:"order"`
}

// ====== 响应 ======

// TaskResp 任务响应对象
type TaskResp struct {
	ID             string        `json:"id"`
	Title          string        `json:"title"`
	Description    string        `json:"description,omitempty"`
	Priority       string        `json:"priority"`
	Status         string        `json:"status"`
	CategoryID     string        `json:"category_id,omitempty"`
	CategoryEmoji  string        `json:"category_emoji,omitempty"`
	Icon           string        `json:"icon,omitempty"`
	DueDate        string        `json:"due_date,omitempty"`
	DueTime        string        `json:"due_time,omitempty"`
	ReminderAt     string        `json:"reminder_at,omitempty"`
	RecurrenceRule string        `json:"recurrence_rule,omitempty"`
	ParentTaskID   string        `json:"parent_task_id,omitempty"`
	SubtasksCount  int           `json:"subtasks_count"`
	Subtasks       []SubtaskResp `json:"subtasks,omitempty"`
	CreatedAt      string        `json:"created_at"`
	UpdatedAt      string        `json:"updated_at"`
	CompletedAt    string        `json:"completed_at,omitempty"`
}

// ListTasksResp 任务列表响应
type ListTasksResp struct {
	Items []TaskResp `json:"items"`
	Total int64      `json:"total"`
	Page  int        `json:"page"`
}

// ====== 批量操作 ======

// BatchTaskReq 批量操作请求
type BatchTaskReq struct {
	Action  string   `json:"action"   v:"required|in:complete,delete" dc:"操作类型：complete / delete"`
	TaskIDs []string `json:"task_ids" v:"required|min:1,max:100"      dc:"任务 ID 列表，1-100 个"`
}

// BatchTaskResp 批量操作响应
type BatchTaskResp struct {
	Affected int64 `json:"affected"`
}
