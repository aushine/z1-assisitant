// 纪念日 / 倒数日 DTO
//
// 对应接口（路由由 router.go 挂载）：
//
//	GET    /anniversaries             → ListAnniversariesReq / ListAnniversariesResp
//	GET    /anniversaries/upcoming    → UpcomingAnniversariesReq / UpcomingAnniversariesResp
//	POST   /anniversaries             → CreateAnniversaryReq / CreateAnniversaryResp
//	PATCH  /anniversaries/:id         → PatchAnniversaryReq / PatchAnniversaryResp
//	DELETE /anniversaries/:id         → 无响应体（204）
//
// next_date / days_left 是**推导字段**，后端每次实时计算（不落库，见 model/anniversary.go 头注释）。
package dto

// AnniversaryItem 单条纪念日 / 倒数日（含推导字段）
//
// target_date / next_date 为 YYYY-MM-DD 字符串；days_left 为距下次发生还有几天
// （0 = 今天，负数 = 已过）；is_pinned 用 bool 便于前端渲染；remind_days 为提前提醒天数集合。
type AnniversaryItem struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	TargetDate   string `json:"target_date"`   // 基准日（首次发生那天）YYYY-MM-DD
	NextDate     string `json:"next_date"`     // 推导出的下次发生日 YYYY-MM-DD
	DaysLeft     int    `json:"days_left"`     // 距 next_date 还有几天（可为负）
	RepeatRule   int    `json:"repeat_rule"`   // 1 不重复 / 2 每年 / 3 每月 / 4 每周
	CalendarType int    `json:"calendar_type"` // 1 公历 / 2 农历
	RemindDays   []int  `json:"remind_days"`   // 子集 {0,1,3,7}，空=不提醒
	Category     string `json:"category"`
	Icon         string `json:"icon"`
	Color        string `json:"color"`
	IsPinned     bool   `json:"is_pinned"`
	Note         string `json:"note"`
}

// AnniversaryBrief 首页卡片用的精简版
type AnniversaryBrief struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	NextDate string `json:"next_date"`
	DaysLeft int    `json:"days_left"`
	Category string `json:"category"`
	Icon     string `json:"icon"`
	Color    string `json:"color"`
	IsPinned bool   `json:"is_pinned"`
}

// ListAnniversariesReq GET /anniversaries
// Scope 取值 upcoming / month / all（缺省 all；未知值按 all 处理）
// Limit 上限（>0 时截断，0 或负 = 不限制）
type ListAnniversariesReq struct {
	Scope string `json:"scope" dc:"upcoming 仅 30 天内 / month 仅本月 / all 全部"`
	Limit int    `json:"limit" dc:"返回条数上限，0 = 不限制"`
}

// ListAnniversariesResp GET /anniversaries 响应
type ListAnniversariesResp struct {
	Items []AnniversaryItem `json:"items"`
	Total int               `json:"total"`
}

// UpcomingAnniversariesReq GET /anniversaries/upcoming
// Limit 缺省 3，上限 10
type UpcomingAnniversariesReq struct {
	Limit int `json:"limit" d:"3" dc:"取最近 N 条，默认 3，上限 10"`
}

// UpcomingAnniversariesResp GET /anniversaries/upcoming 响应
type UpcomingAnniversariesResp struct {
	Items []AnniversaryBrief `json:"items"`
	Total int                `json:"total"`
}

// CreateAnniversaryReq POST /anniversaries
// 创建一条纪念日 / 倒数日；字段语义见 model.Anniversary 注释。
type CreateAnniversaryReq struct {
	Title        string `json:"title"        v:"required|length:1,50" dc:"标题 ≤50 字"`
	TargetDate   string `json:"target_date"  v:"required|date"         dc:"基准日 YYYY-MM-DD（首次发生那天）"`
	RepeatRule   int    `json:"repeat_rule"  v:"in:1,2,3,4"            dc:"1 不重复 / 2 每年(默认) / 3 每月 / 4 每周"`
	CalendarType int    `json:"calendar_type" v:"in:1,2"              dc:"1 公历(默认) / 2 农历"`
	RemindDays   []int  `json:"remind_days"                           dc:"提前提醒天数，子集 {0,1,3,7}，未知值静默丢弃"`
	Category     string `json:"category"                             dc:"birthday/anniversary/countdown/other"`
	Icon         string `json:"icon"                                 dc:"图标 key，空=calendar-heart"`
	Color        string `json:"color"                                dc:"配色 key，空=primary"`
	IsPinned     bool   `json:"is_pinned"                            dc:"是否置顶"`
	Note         string `json:"note"         v:"length:0,200"        dc:"备注 ≤200 字"`
}

// CreateAnniversaryResp POST /anniversaries 响应
type CreateAnniversaryResp struct {
	Item AnniversaryItem `json:"item"`
}

// PatchAnniversaryReq PATCH /anniversaries/:id
// 只传要改的字段；remind_days 整体覆盖（传了就替换整列）。
// 所有字段均是指针/可空，用于区分「没给」与「给了空值/零值」。
type PatchAnniversaryReq struct {
	ID           string  `json:"id"           dc:"路径参数，由 controller 回填"`
	Title        *string `json:"title"        v:"length:1,50"       dc:"标题 ≤50 字"`
	TargetDate   *string `json:"target_date"  v:"date"              dc:"基准日 YYYY-MM-DD"`
	RepeatRule   *int    `json:"repeat_rule"  v:"in:1,2,3,4"        dc:"重复规则"`
	CalendarType *int    `json:"calendar_type" v:"in:1,2"          dc:"历法"`
	RemindDays   *[]int  `json:"remind_days"                       dc:"整体覆盖的提前提醒天数"`
	Category     *string `json:"category"                          dc:"分类"`
	Icon         *string `json:"icon"                             dc:"图标 key"`
	Color        *string `json:"color"                            dc:"配色 key"`
	IsPinned     *bool   `json:"is_pinned"                        dc:"是否置顶"`
	Note         *string `json:"note"         v:"length:0,200"     dc:"备注 ≤200 字"`
}

// PatchAnniversaryResp PATCH /anniversaries/:id 响应
type PatchAnniversaryResp struct {
	Item AnniversaryItem `json:"item"`
}
