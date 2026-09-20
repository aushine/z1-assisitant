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

	// SumExpenseByCategory 计算某用户在指定时间范围内按分类的支出合计（用于分类预算 used 字段）
	SumExpenseByCategory(ctx context.Context, userID string, categoryName string, start, end time.Time) (float64, error)
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
		Where("user_id = ? AND type = ? AND happened_at >= ? AND happened_at < ?", userID, model.TransactionTypeExpense, start, end).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	if err != nil {
		return 0, err
	}
	return total, nil
}

// SumExpenseByCategory 计算某用户在指定时间范围内按分类的支出合计
func (d *budgetDao) SumExpenseByCategory(ctx context.Context, userID string, categoryName string, start, end time.Time) (float64, error) {
	var total float64
	err := d.db.WithContext(ctx).
		Model(&model.Transaction{}).
		Where("user_id = ? AND type = ? AND category_name = ? AND happened_at >= ? AND happened_at < ?", userID, model.TransactionTypeExpense, categoryName, start, end).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	if err != nil {
		return 0, err
	}
	return total, nil
}
