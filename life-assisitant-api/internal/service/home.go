// Package service 首页聚合服务接口
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IHomeService 首页聚合服务
type IHomeService interface {
	// Fetch 聚合首页所有数据（greeting + KPI + today tasks + today habits + month finance + unread count）
	Fetch(ctx context.Context) (*dto.HomeResp, error)
}
