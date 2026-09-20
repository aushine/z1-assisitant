// AccountDao 账户表数据访问对象
// 风格参考 task.gen.go：手写 + 链式 + GORM 原生
package dao

import (
	"context"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// AccountDao 账户 DAO 接口
type AccountDao interface {
	WithContext(ctx context.Context) AccountDao
	Create(ctx context.Context, a *model.Account) error
	GetByID(ctx context.Context, id string) (*model.Account, error)
	Update(ctx context.Context, id string, fields map[string]any) error
	UpdateBalance(ctx context.Context, id string, delta float64) error
	Delete(ctx context.Context, id string) error // 软删

	// List 取某用户所有账户（不过滤类型/状态；status 过滤交给 service）
	List(ctx context.Context, userID string) ([]model.Account, error)
	// GetTotalBalance 算某用户总余额
	GetTotalBalance(ctx context.Context, userID string) (float64, error)
}

type accountDao struct {
	db *gorm.DB
}

// NewAccountDao 构造函数
func NewAccountDao() AccountDao { return &accountDao{db: DB} }

func (d *accountDao) WithContext(ctx context.Context) AccountDao {
	return &accountDao{db: d.db.WithContext(ctx)}
}

func (d *accountDao) Create(ctx context.Context, a *model.Account) error {
	return d.db.WithContext(ctx).Create(a).Error
}

func (d *accountDao) GetByID(ctx context.Context, id string) (*model.Account, error) {
	var a model.Account
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

func (d *accountDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.Account{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	return nil
}

// UpdateBalance 原子增减余额（事务内调）
// delta 可正可负
func (d *accountDao) UpdateBalance(ctx context.Context, id string, delta float64) error {
	res := d.db.WithContext(ctx).
		Model(&model.Account{}).
		Where("id = ?", id).
		Update("balance", gorm.Expr("balance + ?", delta))
	if res.Error != nil {
		return res.Error
	}
	return nil
}

func (d *accountDao) Delete(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Account{}).Error
}

// List 取某用户所有账户（含软删过滤、含 archived=逻辑上 service 再处理）
func (d *accountDao) List(ctx context.Context, userID string) ([]model.Account, error) {
	var items []model.Account
	err := d.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

// GetTotalBalance 算总余额
func (d *accountDao) GetTotalBalance(ctx context.Context, userID string) (float64, error) {
	var total float64
	err := d.db.WithContext(ctx).
		Model(&model.Account{}).
		Where("user_id = ?", userID).
		Select("COALESCE(SUM(balance), 0)").
		Scan(&total).Error
	if err != nil {
		return 0, err
	}
	return total, nil
}
