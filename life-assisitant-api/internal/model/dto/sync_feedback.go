package dto

// ====== 反馈 ======

// CreateFeedbackReq 提交反馈请求
type CreateFeedbackReq struct {
	Type    string `json:"type"    v:"required|in:bug,suggestion,other" dc:"反馈类型"`
	Content string `json:"content" v:"required|length:1,2000"           dc:"反馈内容"`
	Contact string `json:"contact" v:"length:0,100"                     dc:"联系方式（可选）"`
}

// FeedbackResp 反馈响应
type FeedbackResp struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Content   string `json:"content"`
	Contact   string `json:"contact,omitempty"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

// ====== 同步 ======

// SyncStatusResp 同步状态响应
type SyncStatusResp struct {
	LastSyncAt string                   `json:"last_sync_at"`
	Status     string                   `json:"status"` // synced / syncing / pending / error
	Pending    int                      `json:"pending"`
	Details    map[string]SyncModuleDetail `json:"details"`
}

// SyncModuleDetail 模块同步详情
type SyncModuleDetail struct {
	LastSync    string `json:"last_sync"`
	Status      string `json:"status"` // synced / pending / error
	PendingCount int   `json:"pending_count"`
}

// SyncTriggerResp 同步触发响应
type SyncTriggerResp struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}
