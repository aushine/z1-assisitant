// MoodLogDao 心情/精力日志表数据访问对象
// 风格参考 task.gen.go：手写 + 链式 + GORM 原生
//
// 260919 变更：心情/精力改为**按小时记录**（UNIQUE(user_id, date, hour)）。
// 因此「取某天」的语义拆成三种，不要再用模糊的 GetByUserDate：
//   - ListByDate            某天全部小时行（hour 升序）—— 时间线用
//   - GetByUserDateHour     精确到小时（经期日记固定取 model.MoodDiaryHour）
//   - ListDiaryByRange      区间内只取日记槽位（hour = 12）—— 经期模块用
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// MoodLogDao 心情日志 DAO 接口
type MoodLogDao interface {
	WithContext(ctx context.Context) MoodLogDao
	Create(ctx context.Context, m *model.MoodLog) error
	Update(ctx context.Context, id string, fields map[string]any) error
	// DeleteByID 按主键删除（清空某小时后要删掉空行时用）
	DeleteByID(ctx context.Context, id string) error

	// GetByUserDateHour 精确取某天的某一个小时（经期日记用 model.MoodDiaryHour）
	GetByUserDateHour(ctx context.Context, userID string, date time.Time, hour int) (*model.MoodLog, error)
	// ListByDate 取某天全部小时行，按 hour 升序（时间线的唯一数据源）
	ListByDate(ctx context.Context, userID string, date time.Time) ([]model.MoodLog, error)
	// ListByRange 取某用户某段时间的全部小时行，按 date、hour 升序
	ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.MoodLog, error)
	// ListDiaryByRange 区间内只取「经期日记槽位」（hour = model.MoodDiaryHour）的行
	ListDiaryByRange(ctx context.Context, userID string, start, end time.Time) ([]model.MoodLog, error)
	// DeleteByUserDateHour 删除某天的某一个小时
	// （经期模块「整页全空」时只清自己那个槽位，**不能**连带删掉当天的小时记录）
	DeleteByUserDateHour(ctx context.Context, userID string, date time.Time, hour int) error
}

type moodLogDao struct {
	db *gorm.DB
}

// NewMoodLogDao 构造函数
func NewMoodLogDao() MoodLogDao { return &moodLogDao{db: DB} }

func (d *moodLogDao) WithContext(ctx context.Context) MoodLogDao {
	return &moodLogDao{db: d.db.WithContext(ctx)}
}

func (d *moodLogDao) Create(ctx context.Context, m *model.MoodLog) error {
	return d.db.WithContext(ctx).Create(m).Error
}

func (d *moodLogDao) Update(ctx context.Context, id string, fields map[string]any) error {
	return d.db.WithContext(ctx).Model(&model.MoodLog{}).Where("id = ?", id).Updates(fields).Error
}

func (d *moodLogDao) DeleteByID(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.MoodLog{}).Error
}

func (d *moodLogDao) GetByUserDateHour(
	ctx context.Context, userID string, date time.Time, hour int,
) (*model.MoodLog, error) {
	var m model.MoodLog
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date = ? AND hour = ?", userID, date.Format("2006-01-02"), hour).
		First(&m).Error
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (d *moodLogDao) ListByDate(ctx context.Context, userID string, date time.Time) ([]model.MoodLog, error) {
	var items []model.MoodLog
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date.Format("2006-01-02")).
		Order("hour ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *moodLogDao) ListByRange(
	ctx context.Context, userID string, start, end time.Time,
) ([]model.MoodLog, error) {
	var items []model.MoodLog
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date >= ? AND date < ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Order("date ASC, hour ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *moodLogDao) ListDiaryByRange(
	ctx context.Context, userID string, start, end time.Time,
) ([]model.MoodLog, error) {
	var items []model.MoodLog
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date >= ? AND date < ? AND hour = ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02"), model.MoodDiaryHour).
		Order("date ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *moodLogDao) DeleteByUserDateHour(
	ctx context.Context, userID string, date time.Time, hour int,
) error {
	return d.db.WithContext(ctx).
		Where("user_id = ? AND date = ? AND hour = ?", userID, date.Format("2006-01-02"), hour).
		Delete(&model.MoodLog{}).Error
}
