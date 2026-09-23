// Package dto 习惯/待办分类 DTO（user_categories，见 06 §3.3）
package dto

// UserCategoryResp 分类响应（扁平列表，两域共用一张表，用 domain 区分）
type UserCategoryResp struct {
	ID        string `json:"id"`
	Domain    string `json:"domain"`
	Name      string `json:"name"`
	Emoji     string `json:"emoji"`
	Icon      string `json:"icon"`
	Tint      string `json:"tint"`
	Sort      int    `json:"sort"`
	IsBuiltin bool   `json:"is_builtin"`
}

// ListUserCategoriesResp 分类列表响应
type ListUserCategoriesResp struct {
	Items []UserCategoryResp `json:"items"`
	// Seeded 本次请求是否触发了懒创建播种（前端可据此做一次性提示）
	Seeded bool `json:"seeded"`
}

// UserCategoryItemResp 单个分类响应包装（POST / PATCH 返回 { "item": {...} }）
type UserCategoryItemResp struct {
	Item UserCategoryResp `json:"item"`
}

// CreateUserCategoryReq 新建分类
//
// domain 必填 habit|task（白名单校验）；name 去空白后 1-10 字；
// 图标白名单**不在后端校验**（与记账分类同口径），只校验长度。
type CreateUserCategoryReq struct {
	Domain string `json:"domain" dc:"habit 习惯 / task 待办"`
	Name   string `json:"name"   dc:"分类名，去空白后 1-10 字"`
	Icon   string `json:"icon"   dc:"可选，图标引用 lucide:<Name>（≤40 字符）"`
	Emoji  string `json:"emoji"  dc:"可选，emoji（≤20 字符）"`
	Tint   string `json:"tint"   dc:"可选，语义色名（≤20 字符，默认 neutral）"`
}

// UpdateUserCategoryReq 更新分类（仅 name / icon / emoji / tint）
//
// ⚠️ 不可改 domain（改域等于换实体，历史 habit/task 引用会语义漂移）——
// 本结构体里刻意不含该字段，传了会被忽略。
type UpdateUserCategoryReq struct {
	Name  *string `json:"name"  dc:"分类名，去空白后 1-10 字"`
	Icon  *string `json:"icon"  dc:"图标引用 lucide:<Name>（≤40 字符）；空串 = 清空"`
	Emoji *string `json:"emoji" dc:"emoji（≤20 字符）；空串 = 清空"`
	Tint  *string `json:"tint"  dc:"语义色名（≤20 字符）；空串 = 恢复 neutral"`
}
