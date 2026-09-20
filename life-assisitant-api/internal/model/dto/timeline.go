// Package dto 生活时间线模块 DTO
package dto

// TimelineReq 时间线查询参数
type TimelineReq struct {
	Date     string `json:"date"      v:"date" d:"" dc:"日期 YYYY-MM-DD（默认今天）"`
	Page     int    `json:"page"      v:"min:1" d:"1"`
	PageSize int    `json:"page_size" v:"max:100" d:"20"`
}

// TimelineEvent 时间线事件（统一结构）
// 见 04 §4.3：{ id, type, title, detail, amount?, time, icon_hint }
type TimelineEvent struct {
	ID       string   `json:"id"`
	Type     string   `json:"type"`               // task / habit / expense / income / mood / milestone
	Title    string   `json:"title"`
	Detail   string   `json:"detail,omitempty"`
	Amount   *float64 `json:"amount,omitempty"`   // 金额（支出为负、收入为正）
	Time     string   `json:"time"`               // HH:MM（当天内）
	IconHint string   `json:"icon_hint,omitempty"` // 图标提示（emoji / 任务优先级 / 心情档位）
}

// TimelineResp 时间线响应
type TimelineResp struct {
	Date  string          `json:"date"`
	Items []TimelineEvent `json:"items"`
	Total int             `json:"total"`
}
