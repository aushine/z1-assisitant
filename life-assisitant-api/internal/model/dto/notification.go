// Package dto 通知模块 DTO
package dto

// UnreadCountResp 未读通知数响应
type UnreadCountResp struct {
	Count int `json:"count"`
}

// MarkReadResp 标记已读响应
type MarkReadResp struct {
	Affected int `json:"affected"` // 标记已读的通知数
}

// NotificationItem 通知列表项
type NotificationItem struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Body      string `json:"body,omitempty"`
	IsRead    bool   `json:"is_read"`
	ReadAt    string `json:"read_at,omitempty"`
	CreatedAt string `json:"created_at"`
}

// ListNotificationsReq 通知列表查询参数
type ListNotificationsReq struct {
	Page     int `json:"page"      v:"min:1"  d:"1"`
	PageSize int `json:"page_size" v:"max:100" d:"20"`
}

// ListNotificationsResp 通知列表响应
type ListNotificationsResp struct {
	Items []NotificationItem `json:"items"`
	Total int64              `json:"total"`
}
