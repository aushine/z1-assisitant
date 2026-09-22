// BudgetDao 预算表数据访问对象
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// BudgetDao 预算 DAO 接口
type BudgetDao interface {
	WithContext(ctx context.Context) BudgetDao
	Create(ctx context.Context, b *model.Budget) error
	GetByID(ctx context.Context, id string) (*model.Budget, error)
	Update(ctx context.Context, id string, fields map[string]any) error
	Delete(ctx context.Context, id string) error

	// List 取某用户所有预算（按 start_date DESC），支持 scope 筛选
	List(ctx context.Context, userID string, scope string) ([]model.Budget, error)

	// SumExpense 计算某用户在指定时间范围内的支出合计（用于预算 used 字段）
	SumExpense(ctx context.Context, userID string, start, end time.Time) (float64, error)

	// SumExpenseByCategory 计算某用户在指定时间范围内某分类（**含其子分类**）的支出合计
	// （用于分类预算 used 字段）。categoryID 为空时退化为按 categoryName 文本匹配（未迁移的历史预算）。
	SumExpenseByCategory(ctx context.Context, userID, categoryID, categoryName string, start, end time.Time) (float64, error)
}

type budgetDao struct {
	db *gorm.DB
}

// NewBudgetDao 构造函数
func NewBudgetDao() BudgetDao { return &budgetDao{db: DB} }

func (d *budgetDao) WithContext(ctx context.Context) BudgetDao {
	return &budgetDao{db: d.db.WithContext(ctx)}
}

func (d *budgetDao) Create(ctx context.Context, b *model.Budget) error {
	return d.db.WithContext(ctx).Create(b).Error
}

func (d *budgetDao) GetByID(ctx context.Context, id string) (*model.Budget, error) {
	var b model.Budget
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func (d *budgetDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.Budget{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	return nil
}

func (d *budgetDao) Delete(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Budget{}).Error
}

// List 取某用户所有预算（含软删过滤），支持 scope 筛选
func (d *budgetDao) List(ctx context.Context, userID string, scope string) ([]model.Budget, error) {
	var items []model.Budget
	q := d.db.WithContext(ctx).
		Where("user_id = ?", userID)
	if scope != "" {
		q = q.Where("scope = ?", scope)
	}
	err := q.Order("start_date DESC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

// SumExpense 计算某用户在指定时间范围内的支出合计
func (d *budgetDao) SumExpense(ctx context.Context, userID string, start, end time.Time) (float64, error) {
	var total float64
	err := d.db.WithContext(ctx).
		Model(&model.Transaction{}).
		Where("user_id = ? AND type = ? AND happened_at >= ? AND happened_at < ? AND exclude_budget = 0", userID, model.TransactionTypeExpense, start, end).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	if err != nil {
		return 0, err
	}
	return total, nil
}

// SumExpenseByCategory 计算某用户在指定时间范围内某分类（含子分类）的支出合计
//
// ⚠️ 260921 改造（02 §6.2 / §6.3）：
//
//	改前：`WHERE ... AND category_name = ?` —— 分类一改名，预算已用**立刻归零**；
//	改后：**按 id 匹配，且必须包含子分类**。
//
// 为什么必须包含子分类（§6.3）：用户给「餐饮」设 1500，但每笔都记「餐饮-三餐」；
// 若只匹配 `category_id = 餐饮的id`，已用额度永远是 0 —— 用户会以为预算坏了。
//
// 三段条件：
//  1. `category_id = ?`            直接命中该一级分类
//  2. `category_id IN (子查询)`    子分类向上归集（⚠️ 子查询额外带 user_id：
//     内置 id 跨用户重复，不加会把别人的分类 id 也捞进来）
//  3. `category_id IS NULL AND category_name = ?`  过渡期兜底（未回填的历史交易）
//
// categoryID 为空（历史预算只有 name）时退化为纯 name 匹配。
// 本次**不做二级预算**（只允许一级），但 SQL 结构已支持二级（02 §6.4）。
func (d *budgetDao) SumExpenseByCategory(ctx context.Context, userID, categoryID, categoryName string, start, end time.Time) (float64, error) {
	var total float64
	q := d.db.WithContext(ctx).
		Model(&model.Transaction{}).
		Where("user_id = ? AND type = ? AND happened_at >= ? AND happened_at < ? AND exclude_budget = 0",
			userID, model.TransactionTypeExpense, start, end)
	if categoryID != "" {
		q = q.Where(
			"(category_id = ? "+
				"OR category_id IN (SELECT id FROM finance_categories WHERE user_id = ? AND parent_id = ? AND is_deleted = 0) "+
				"OR (category_id IS NULL AND category_name = ?))",
			categoryID, userID, categoryID, categoryName)
	} else {
		q = q.Where("category_name = ?", categoryName)
	}
	err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error
	if err != nil {
		return 0, err
	}
	return total, nil
}
