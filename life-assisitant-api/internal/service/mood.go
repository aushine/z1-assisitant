// Package service 心情/精力服务接口
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IMoodService 心情/精力服务
//
// 260919 变更：由「一天一条（UNIQUE(user_id,date)）」改为
// **按小时记录（UNIQUE(user_id,date,hour)）**，可随时改、一天多条。
//
// 读取语义（与两端 types.ts 一致）：
//   - 向前延续（fill-forward）：某行 mood/energy 为 0 时，用同一日期内
//     前面最近一个非 0 值填充后返回；note **不延续**。
//   - 延续只发生在读取阶段，派生值不落库。
//
// 写入语义：三态（缺省 = 不动 / 0 或 "" = 清空 / 全空 → 删行），详见 dto.UpsertMoodReq。
type IMoodService interface {
	// GetTimeline 取某天的时间线（默认今天），含向前延续填充
	GetTimeline(ctx context.Context, req *dto.GetMoodReq) (*dto.MoodTimelineResp, error)
	// GetByDate 取某天最后一条（含向前延续填充），无记录时返回 nil
	GetByDate(ctx context.Context, req *dto.GetMoodReq) (*dto.MoodHourResp, error)
	// Upsert 记录/修改某天某个小时（hour 缺省 = 服务器当前小时）
	Upsert(ctx context.Context, req *dto.UpsertMoodReq) (*dto.UpsertMoodResp, error)
	// List 区间查询（每天内部延续，不跨天延续）
	List(ctx context.Context, req *dto.ListMoodsReq) (*dto.ListMoodsResp, error)
}
