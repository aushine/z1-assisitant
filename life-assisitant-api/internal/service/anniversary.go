// Package service 纪念日 / 倒数日业务接口
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IAnniversaryService 纪念日 / 倒数日业务逻辑接口
type IAnniversaryService interface {
	// List GET /anniversaries（scope = upcoming/month/all）
	List(ctx context.Context, req *dto.ListAnniversariesReq) (*dto.ListAnniversariesResp, error)
	// Upcoming GET /anniversaries/upcoming（首页最近 N 条）
	Upcoming(ctx context.Context, req *dto.UpcomingAnniversariesReq) (*dto.UpcomingAnniversariesResp, error)
	// Create POST /anniversaries
	Create(ctx context.Context, req *dto.CreateAnniversaryReq) (*dto.CreateAnniversaryResp, error)
	// Patch PATCH /anniversaries/:id（只改传了的字段）
	Patch(ctx context.Context, req *dto.PatchAnniversaryReq) (*dto.PatchAnniversaryResp, error)
	// Delete DELETE /anniversaries/:id（204 无响应体）
	Delete(ctx context.Context, id string) error
}
