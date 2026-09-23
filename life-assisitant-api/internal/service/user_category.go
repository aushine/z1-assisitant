// Package service 习惯/待办分类服务接口（user_categories，见 06 §3.3）
//
// 4 个接口：
//
//	GET    /user-categories?domain=habit|task  拉取分类列表（⚠️ 同时承担「懒创建播种」）
//	POST   /user-categories                    新建分类
//	PATCH  /user-categories/:id                改名/改图标（不可改 domain）
//	DELETE /user-categories/:id                软删（三件套一起写）
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IUserCategoryService 习惯/待办分类服务
type IUserCategoryService interface {
	// List 拉取某 domain 的分类列表；若该用户该 domain 从未播种过
	// （不存在任何 is_builtin=1 的行，**含已删除**）则先播种内置 4 / 6 条（06 §3.1 铁律 3）。
	List(ctx context.Context, domain string) (*dto.ListUserCategoriesResp, error)

	// Create 新建分类（domain 白名单；name ≤10 字且同域未删行不可重名）
	Create(ctx context.Context, req *dto.CreateUserCategoryReq) (*dto.UserCategoryResp, error)

	// Update 更新分类（仅 name / icon / emoji / tint；不可改 domain）
	Update(ctx context.Context, id string, req *dto.UpdateUserCategoryReq) (*dto.UserCategoryResp, error)

	// Delete 软删除分类（is_deleted=1 + deleted_at=now + deleted_seq=随机值）
	Delete(ctx context.Context, id string) error
}
