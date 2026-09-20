// Period 经期模块数据访问对象
// 风格参考 mood_log.gen.go：手写 + 链式 + GORM 原生
//
// 三张表的关系：period_days（唯一事实源）→ period_cycles（幂等派生）→ period_settings（偏好）
// 心情/精力/备注**不在本模块**，复用 mood_logs（见 MoodLogDao）
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/model"
)

// ============================================================================
// PeriodDayDao 经期逐日记录（period_days）
// ============================================================================

// PeriodDayDao 逐日打卡 DAO 接口
type PeriodDayDao interface {
	WithContext(ctx context.Context) PeriodDayDao

	Create(ctx context.Context, p *model.PeriodDay) error
	// Upsert 按 (user_id, date) 唯一键插入或整体覆盖
	// ⚠️ 整体覆盖语义：未给的字段会被写成本列的默认值（0 / NULL），
	//    这样「取消勾选症状」才能生效（与 PUT /moods 的语义一致）
	Upsert(ctx context.Context, p *model.PeriodDay) error

	GetByUserDate(ctx context.Context, userID string, date time.Time) (*model.PeriodDay, error)
	// ListByRange 区间查询 [start, end]（闭区间，两端都含）
	ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.PeriodDay, error)
	// ListAllByUser 该用户全部记录（按 date 升序）—— RebuildCycles 的输入
	ListAllByUser(ctx context.Context, userID string) ([]model.PeriodDay, error)

	DeleteByUserDate(ctx context.Context, userID string, date time.Time) error
	// DeleteAllByUser 整模块重置用
	DeleteAllByUser(ctx context.Context, userID string) (int64, error)
}

type periodDayDao struct {
	db *gorm.DB
}

// NewPeriodDayDao 构造函数
func NewPeriodDayDao() PeriodDayDao { return &periodDayDao{db: DB} }

func (d *periodDayDao) WithContext(ctx context.Context) PeriodDayDao {
	return &periodDayDao{db: d.db.WithContext(ctx)}
}

// periodDayUpdatable 冲突时需要覆盖的列（不含 id / user_id / date / created_at）
var periodDayUpdatable = []string{
	"flow", "symptoms", "pain_level", "discharge",
	"bbt", "weight", "sleep_hours", "intercourse", "updated_at",
}

func (d *periodDayDao) Create(ctx context.Context, p *model.PeriodDay) error {
	return d.db.WithContext(ctx).Create(p).Error
}

func (d *periodDayDao) Upsert(ctx context.Context, p *model.PeriodDay) error {
	return d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "date"}},
		DoUpdates: clause.AssignmentColumns(periodDayUpdatable),
	}).Create(p).Error
}

func (d *periodDayDao) GetByUserDate(ctx context.Context, userID string, date time.Time) (*model.PeriodDay, error) {
	var p model.PeriodDay
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date.Format("2006-01-02")).
		First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (d *periodDayDao) ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.PeriodDay, error) {
	var items []model.PeriodDay
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date >= ? AND date <= ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Order("date ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *periodDayDao) ListAllByUser(ctx context.Context, userID string) ([]model.PeriodDay, error) {
	var items []model.PeriodDay
	err := d.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("date ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *periodDayDao) DeleteByUserDate(ctx context.Context, userID string, date time.Time) error {
	return d.db.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date.Format("2006-01-02")).
		Delete(&model.PeriodDay{}).Error
}

func (d *periodDayDao) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	res := d.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.PeriodDay{})
	return res.RowsAffected, res.Error
}

// ============================================================================
// PeriodCycleDao 经期周期（period_cycles）
// ============================================================================

// PeriodCycleDao 周期 DAO 接口
type PeriodCycleDao interface {
	WithContext(ctx context.Context) PeriodCycleDao

	Create(ctx context.Context, c *model.PeriodCycle) error
	// Upsert 按 (user_id, start_date) 唯一键插入或覆盖
	Upsert(ctx context.Context, c *model.PeriodCycle) error
	UpdateFields(ctx context.Context, id string, fields map[string]any) error

	GetByID(ctx context.Context, id string) (*model.PeriodCycle, error)
	GetByUserStart(ctx context.Context, userID string, start time.Time) (*model.PeriodCycle, error)
	// ListByUser 取最近 limit 个周期（start_date 倒序，limit <= 0 表示不限）
	ListByUser(ctx context.Context, userID string, limit int) ([]model.PeriodCycle, error)
	// ListAllByUser 该用户全部周期（start_date 升序）—— 预测与重建的输入
	ListAllByUser(ctx context.Context, userID string) ([]model.PeriodCycle, error)

	DeleteByUserStart(ctx context.Context, userID string, start time.Time) error
	// DeleteAllByUser 整模块重置用
	DeleteAllByUser(ctx context.Context, userID string) (int64, error)
}

type periodCycleDao struct {
	db *gorm.DB
}

// NewPeriodCycleDao 构造函数
func NewPeriodCycleDao() PeriodCycleDao { return &periodCycleDao{db: DB} }

func (d *periodCycleDao) WithContext(ctx context.Context) PeriodCycleDao {
	return &periodCycleDao{db: d.db.WithContext(ctx)}
}

// periodCycleUpdatable 冲突时需要覆盖的列
// ⚠️ 不含 is_manual：人工修正标记一旦置 1，派生流程不应把它抹掉
var periodCycleUpdatable = []string{
	"end_date", "period_length", "cycle_length",
	"ovulation_date", "ovulation_source", "updated_at",
}

func (d *periodCycleDao) Create(ctx context.Context, c *model.PeriodCycle) error {
	return d.db.WithContext(ctx).Create(c).Error
}

func (d *periodCycleDao) Upsert(ctx context.Context, c *model.PeriodCycle) error {
	return d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "start_date"}},
		DoUpdates: clause.AssignmentColumns(periodCycleUpdatable),
	}).Create(c).Error
}

func (d *periodCycleDao) UpdateFields(ctx context.Context, id string, fields map[string]any) error {
	return d.db.WithContext(ctx).Model(&model.PeriodCycle{}).Where("id = ?", id).Updates(fields).Error
}

func (d *periodCycleDao) GetByID(ctx context.Context, id string) (*model.PeriodCycle, error) {
	var c model.PeriodCycle
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *periodCycleDao) GetByUserStart(ctx context.Context, userID string, start time.Time) (*model.PeriodCycle, error) {
	var c model.PeriodCycle
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND start_date = ?", userID, start.Format("2006-01-02")).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *periodCycleDao) ListByUser(ctx context.Context, userID string, limit int) ([]model.PeriodCycle, error) {
	q := d.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("start_date DESC")
	if limit > 0 {
		q = q.Limit(limit)
	}
	var items []model.PeriodCycle
	if err := q.Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (d *periodCycleDao) ListAllByUser(ctx context.Context, userID string) ([]model.PeriodCycle, error) {
	var items []model.PeriodCycle
	err := d.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("start_date ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *periodCycleDao) DeleteByUserStart(ctx context.Context, userID string, start time.Time) error {
	return d.db.WithContext(ctx).
		Where("user_id = ? AND start_date = ?", userID, start.Format("2006-01-02")).
		Delete(&model.PeriodCycle{}).Error
}

func (d *periodCycleDao) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	res := d.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.PeriodCycle{})
	return res.RowsAffected, res.Error
}

// ============================================================================
// PeriodSettingDao 经期设置（period_settings，每用户一行）
// ============================================================================

// PeriodSettingDao 设置 DAO 接口
type PeriodSettingDao interface {
	WithContext(ctx context.Context) PeriodSettingDao

	Create(ctx context.Context, s *model.PeriodSetting) error
	UpdateFields(ctx context.Context, id string, fields map[string]any) error
	GetByUser(ctx context.Context, userID string) (*model.PeriodSetting, error)
}

type periodSettingDao struct {
	db *gorm.DB
}

// NewPeriodSettingDao 构造函数
func NewPeriodSettingDao() PeriodSettingDao { return &periodSettingDao{db: DB} }

func (d *periodSettingDao) WithContext(ctx context.Context) PeriodSettingDao {
	return &periodSettingDao{db: d.db.WithContext(ctx)}
}

func (d *periodSettingDao) Create(ctx context.Context, s *model.PeriodSetting) error {
	return d.db.WithContext(ctx).Create(s).Error
}

func (d *periodSettingDao) UpdateFields(ctx context.Context, id string, fields map[string]any) error {
	return d.db.WithContext(ctx).Model(&model.PeriodSetting{}).Where("id = ?", id).Updates(fields).Error
}

func (d *periodSettingDao) GetByUser(ctx context.Context, userID string) (*model.PeriodSetting, error) {
	var s model.PeriodSetting
	if err := d.db.WithContext(ctx).Where("user_id = ?", userID).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}
