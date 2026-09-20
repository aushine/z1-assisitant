// Package service 生活时间线服务接口
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// ITimelineService 生活时间线服务
// 跨模块聚合：任务完成 / 习惯打卡 / 记账 / 心情
type ITimelineService interface {
	// Fetch 聚合某天时间线，按时间倒序，分页
	Fetch(ctx context.Context, req *dto.TimelineReq) (*dto.TimelineResp, error)
}
