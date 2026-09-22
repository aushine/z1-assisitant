// Package service 记账分类服务接口
//
// 4 个接口（06 §1）：
//
//	GET    /finance/categories       拉取分类树（⚠️ 同时承担「懒创建播种」）
//	POST   /finance/categories       新建分类（一级或二级）
//	PATCH  /finance/categories/:id   改名/改图标（⚠️ 改一级名要级联二级 full_name）
//	DELETE /finance/categories/:id   软删除（⚠️ 删一级要级联软删二级）
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IFinanceCategoryService 记账分类服务
type IFinanceCategoryService interface {
	// List 拉取分类树；若该用户从未播种过（不存在任何 is_builtin=1 的行，含已删除）
	// 则先播种 105 条内置分类（见 02 §4.2）。scope 为空 = 返回全部。
	List(ctx context.Context, scope string) (*dto.ListFinanceCategoriesResp, error)

	// Create 新建分类；parent_id 空串 = 一级
	Create(ctx context.Context, req *dto.CreateFinanceCategoryReq) (*dto.FinanceCategoryResp, error)

	// Update 更新分类（仅 name / icon / tint / emoji；不可改 parent_id / scope）
	Update(ctx context.Context, id string, req *dto.UpdateFinanceCategoryReq) (*dto.FinanceCategoryResp, error)

	// Delete 软删除分类（写 is_deleted=1 + deleted_at；删一级时同事务级联软删其二级）
	Delete(ctx context.Context, id string) error
}
