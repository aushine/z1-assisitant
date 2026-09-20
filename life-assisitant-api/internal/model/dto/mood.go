// Package dto 心情/精力模块 DTO
//
// 260919 变更：由「一天一条」改为「按小时记录」。
//
// 三态语义（PUT /moods，与两端 types.ts 逐字一致）：
//   - 字段**缺省 = 不动**既有值（不是清空）
//   - mood:0 / energy:0 / note:"" = **显式清空**该字段
//   - 三个字段最终全空 → 后端删掉该行，返回 { item: null }
//
// 读取时的向前延续（fill-forward）：某行 mood/energy 为 0 时，
// 取**同一日期内前面最近一个非 0 值**填充后返回；note **不延续**。
// 延续只发生在读取阶段（派生数据不落库，同「预测不落表」的取舍）。
package dto

// MoodHourResp 小时级心情/精力记录（响应）
type MoodHourResp struct {
	ID string `json:"id"`
	// Date YYYY-MM-DD
	Date string `json:"date"`
	// Hour 0-23；12 = 经期日记槽位
	Hour int `json:"hour"`
	// Mood 1-5；0 = 该小时确无心情（已做向前延续，仍无才是 0）
	Mood int `json:"mood"`
	// Energy 1-3；0 = 不填
	Energy int `json:"energy"`
	// Note ≤50 字，不延续
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// MoodTimelineResp 某天的心情时间线
type MoodTimelineResp struct {
	Date string `json:"date"`
	// NowHour 服务器当前小时 0-23
	NowHour int `json:"now_hour"`
	// Items 按 hour 升序；只含实际存在的行
	Items []MoodHourResp `json:"items"`
}

// UpsertMoodReq 记录/修改某天某个小时
//
// 全部字段用指针以区分「没传」与「传了 0」——这是三态语义的前提。
type UpsertMoodReq struct {
	// Date YYYY-MM-DD
	Date string `json:"date" v:"required|date" dc:"记录日期 YYYY-MM-DD"`
	// Hour 0-23；缺省 = 服务器当前小时
	Hour *int `json:"hour" dc:"小时 0-23（缺省 = 服务器当前小时）"`
	// Mood 1-5；0 = 该小时不填心情；缺省 = 不动既有值
	Mood *int `json:"mood" dc:"心情 1-5；0 = 不填；缺省 = 不动"`
	// Energy 1-3；0 = 不填；缺省 = 不动既有值
	Energy *int `json:"energy" dc:"精力 1-3；0 = 不填；缺省 = 不动"`
	// Note ≤50；"" = 清空；缺省 = 不动既有备注
	Note *string `json:"note" dc:"备注 ≤50 字；\"\" = 清空；缺省 = 不动"`
}

// UpsertMoodResp 写入响应；Item 为 nil 表示该格已被清空（后端删掉了空行）
type UpsertMoodResp struct {
	Item *MoodHourResp `json:"item"`
}

// GetMoodReq 查询某天心情（时间线 / 当天最后一条共用）
type GetMoodReq struct {
	Date string `json:"date" v:"date" dc:"日期 YYYY-MM-DD（默认今天）"`
}

// ListMoodsReq 心情记录区间查询
type ListMoodsReq struct {
	StartDate string `json:"start_date" v:"date" dc:"起始日期 YYYY-MM-DD"`
	EndDate   string `json:"end_date"   v:"date" dc:"结束日期 YYYY-MM-DD（含当天）"`
}

// ListMoodsResp 心情记录列表响应
type ListMoodsResp struct {
	Items []MoodHourResp `json:"items"`
}
