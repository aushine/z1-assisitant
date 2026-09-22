// Package dto 记账分类 DTO（见 06 §1）
package dto

// FinanceCategoryResp 分类响应（**树形**：一级内嵌 children 二级）
//
// 字段说明（06 §1.1）：
//   - emoji / icon / tint 用指针：二级留空 = null = 继承父级（03 §5）
//   - children 恒为非 nil 数组（空时为 []，不是 null）
type FinanceCategoryResp struct {
	ID        string                `json:"id"`
	ParentID  string                `json:"parent_id"`
	Scope     string                `json:"scope"`
	Name      string                `json:"name"`
	FullName  string                `json:"full_name"`
	Emoji     *string               `json:"emoji"`
	Icon      *string               `json:"icon"`
	Tint      *string               `json:"tint"`
	Sort      int                   `json:"sort"`
	IsBuiltin bool                  `json:"is_builtin"`
	Children  []FinanceCategoryResp `json:"children"`
}

// ListFinanceCategoriesResp 分类树响应
type ListFinanceCategoriesResp struct {
	Items []FinanceCategoryResp `json:"items"`
	// Seeded 本次请求是否触发了懒创建播种（前端可据此做一次性提示）
	Seeded bool `json:"seeded"`
}

// FinanceCategoryItemResp 单个分类响应包装（POST / PATCH 返回 { "item": {...} }）
type FinanceCategoryItemResp struct {
	Item FinanceCategoryResp `json:"item"`
}

// CreateFinanceCategoryReq 新建分类
//
// parent_id 空串 = 一级分类；scope 必填 expense/income。
// 图标白名单**不在后端校验**（06 §1.2），只校验长度。
type CreateFinanceCategoryReq struct {
	ParentID string `json:"parent_id" dc:"父分类 id；空串 = 一级分类"`
	Scope    string `json:"scope"     dc:"expense 支出 / income 收入"`
	Name     string `json:"name"      dc:"分类名，去空白后 1-10 字"`
	Icon     string `json:"icon"      dc:"可选，Lucide 图标名（≤40 字符）"`
	Tint     string `json:"tint"      dc:"可选，语义色名（≤20 字符）"`
	Emoji    string `json:"emoji"     dc:"可选，emoji（≤20 字符）"`
}

// UpdateFinanceCategoryReq 更新分类（仅 name / icon / tint / emoji）
//
// ⚠️ 不可改 parent_id、scope（会让已引用该分类的历史交易语义漂移，06 §1.3）——
// 因此本结构体里**刻意不含**这两个字段，传了会被忽略。
type UpdateFinanceCategoryReq struct {
	Name  *string `json:"name"  dc:"分类名，去空白后 1-10 字"`
	Icon  *string `json:"icon"  dc:"Lucide 图标名（≤40 字符）；空串 = 清空（二级将继承父级）"`
	Tint  *string `json:"tint"  dc:"语义色名（≤20 字符）；空串 = 清空（二级将继承父级）"`
	Emoji *string `json:"emoji" dc:"emoji（≤20 字符）；空串 = 清空"`
}
