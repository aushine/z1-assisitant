// AccountDao 账户表数据访问对象
// 风格参考 task.gen.go：手写 + 链式 + GORM 原生
package dao

import (
	"context"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/utility"
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
	// GetBalanceSummary 按 type 分组求和 → Go 侧按 L1 大类归并（spec-20260922-v1 P2）
	GetBalanceSummary(ctx context.Context, userID string) (*AccountBalanceSummary, error)
}

// AccountBalanceSummary 净资产分组汇总（01 §5.2）
//
// ⚠️ 恒等式：NetWorth ≡ Assets + Investments + Debts ≡ SUM(全部 balance)
type AccountBalanceSummary struct {
	Assets       float64 // 资金组小计（负值原样）
	Investments  float64 // 理财组小计
	Debts        float64 // 信用组小计（⚠️ 保留负数原值，不做取绝对值加工）
	NetWorth     float64 // = SUM(全部 balance)
	AccountCount int     // 账户数（不是类型数）
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

// GetBalanceSummary 按 type 分组求和，Go 侧按注册表 category 归并出三组小计。
//
// SQL：SELECT type, COUNT(*) AS cnt, COALESCE(SUM(balance), 0) AS sum
//
//	FROM accounts WHERE user_id = ? AND deleted_at IS NULL GROUP BY type
//
// （软删由 gorm.DeletedAt 自动过滤）
//
// ⚠️ debts 保留负数原值（D14：信用类直接存负数）；未知类型兜底计入 assets，
//
//	保证 NetWorth ≡ Assets+Investments+Debts ≡ SUM(全部) 恒等式恒成立
//	（type 白名单校验上线后实际不会出现未知类型）。
func (d *accountDao) GetBalanceSummary(ctx context.Context, userID string) (*AccountBalanceSummary, error) {
	var rows []struct {
		Type string
		Cnt  int
		Sum  float64
	}
	err := d.db.WithContext(ctx).
		Model(&model.Account{}).
		Where("user_id = ?", userID).
		Select("type, COUNT(*) AS cnt, COALESCE(SUM(balance), 0) AS sum").
		Group("type").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	s := &AccountBalanceSummary{}
	for _, r := range rows {
		s.AccountCount += r.Cnt
		switch utility.AccountCategoryOf(r.Type) {
		case utility.AccountCategoryCredit:
			s.Debts += r.Sum
		case utility.AccountCategoryInvestment:
			s.Investments += r.Sum
		default: // asset + 未知类型兜底
			s.Assets += r.Sum
		}
		s.NetWorth += r.Sum
	}
	return s, nil
}
