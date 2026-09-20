// HabitLogDao 习惯打卡日志 DAO
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// HabitLogDao 习惯日志 DAO 接口
type HabitLogDao interface {
	WithContext(ctx context.Context) HabitLogDao
	Create(ctx context.Context, log *model.HabitLog) error
	Update(ctx context.Context, id string, fields map[string]any) error
	Delete(ctx context.Context, id string) error

	// GetByDate 取某习惯某天的打卡记录（用于 upsert 检查）
	GetByDate(ctx context.Context, habitID string, date time.Time) (*model.HabitLog, error)
	// ListByDate 取某用户在某天所有习惯的打卡
	ListByDate(ctx context.Context, userID string, date time.Time) ([]model.HabitLog, error)
	// ListByHabitAndRange 取某习惯某段时间的打卡
	ListByHabitAndRange(ctx context.Context, habitID string, start, end time.Time) ([]model.HabitLog, error)
	// ListByHabit 取某习惯全部打卡（streak 重算用）
	ListByHabit(ctx context.Context, habitID string) ([]model.HabitLog, error)

	// ====== 统计模块新增 ======
	// ListByUserAndRange 取某用户某段时间所有习惯打卡
	ListByUserAndRange(ctx context.Context, userID string, start, end time.Time) ([]model.HabitLog, error)
	// CountByUserAndRange 统计某用户某段时间的打卡总次数
	CountByUserAndRange(ctx context.Context, userID string, start, end time.Time) (int64, error)
}

type habitLogDao struct {
	db *gorm.DB
}

// NewHabitLogDao 构造函数
func NewHabitLogDao() HabitLogDao { return &habitLogDao{db: DB} }

func (d *habitLogDao) WithContext(ctx context.Context) HabitLogDao {
	return &habitLogDao{db: d.db.WithContext(ctx)}
}

func (d *habitLogDao) Create(ctx context.Context, log *model.HabitLog) error {
	return d.db.WithContext(ctx).Create(log).Error
}

func (d *habitLogDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.HabitLog{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	return nil
}

func (d *habitLogDao) Delete(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.HabitLog{}).Error
}

func (d *habitLogDao) GetByDate(ctx context.Context, habitID string, date time.Time) (*model.HabitLog, error) {
	var log model.HabitLog
	dateStr := date.Format("2006-01-02")
	err := d.db.WithContext(ctx).
		Where("habit_id = ? AND log_date = ?", habitID, dateStr).
		First(&log).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

func (d *habitLogDao) ListByDate(ctx context.Context, userID string, date time.Time) ([]model.HabitLog, error) {
	var logs []model.HabitLog
	dateStr := date.Format("2006-01-02")
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND log_date = ?", userID, dateStr).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}
	return logs, nil
}

func (d *habitLogDao) ListByHabitAndRange(ctx context.Context, habitID string, start, end time.Time) ([]model.HabitLog, error) {
	var logs []model.HabitLog
	err := d.db.WithContext(ctx).
		Where("habit_id = ? AND log_date BETWEEN ? AND ?",
			habitID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Order("log_date ASC").
		Find(&logs).Error
	if err != nil {
		return nil, err
	}
	return logs, nil
}

// ListByHabit 取某习惯全部打卡（streak 重算用）
func (d *habitLogDao) ListByHabit(ctx context.Context, habitID string) ([]model.HabitLog, error) {
	var logs []model.HabitLog
	err := d.db.WithContext(ctx).
		Where("habit_id = ?", habitID).
		Order("log_date ASC").
		Find(&logs).Error
	if err != nil {
		return nil, err
	}
	return logs, nil
}

// ListByUserAndRange 取某用户某段时间所有习惯打卡
func (d *habitLogDao) ListByUserAndRange(ctx context.Context, userID string, start, end time.Time) ([]model.HabitLog, error) {
	var logs []model.HabitLog
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND log_date BETWEEN ? AND ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Order("log_date ASC, habit_id ASC").
		Find(&logs).Error
	if err != nil {
		return nil, err
	}
	return logs, nil
}

// CountByUserAndRange 统计某用户某段时间的打卡总次数
func (d *habitLogDao) CountByUserAndRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).
		Model(&model.HabitLog{}).
		Where("user_id = ? AND log_date BETWEEN ? AND ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Count(&n).Error
	return n, err
}
