// 健康模块数据访问对象（health_days / health_settings）
// 风格参考 period.gen.go：手写 + 链式 + GORM 原生
//
// 两张表的关系：
//   - health_days    逐日事实（饮水/体重/体温/睡眠/排便），一天一行
//   - health_settings 每用户一行配置（启用指标 / 目标值 / 引导完成时间）
//
// ⚠️ 心情/精力/备注**不在本模块**，仍走 mood_logs（按小时，见 MoodLogDao）。
// 健康浮层只是「一天一张表单」，落库时选一个目标小时：记今天 = now_hour，补记历史 = 12。
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/model"
)

// ============================================================================
// HealthDayDao 身体指标逐日记录（health_days）
// ============================================================================

// HealthDayDao 身体指标 DAO 接口
type HealthDayDao interface {
	WithContext(ctx context.Context) HealthDayDao

	Create(ctx context.Context, h *model.HealthDay) error
	// Upsert 按 (user_id, date) 唯一键插入或整体覆盖
	// ⚠️ 整体覆盖语义：未给的字段写成本列默认值（0 / NULL），这样「取消勾选」才能生效。
	//    因此**快捷条必须先取回当天完整记录、合并后再提交**，否则会抹掉当天其它指标。
	Upsert(ctx context.Context, h *model.HealthDay) error

	// GetByUserDate 单日记录；不存在返回 (nil, nil)（不是 error，调用方要区分「没记录」与「出错」）
	GetByUserDate(ctx context.Context, userID string, date time.Time) (*model.HealthDay, error)
	// ListByRange 区间查询 [start, end]（闭区间，两端都含），跨度上限 366 天由 service 层校验
	ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.HealthDay, error)
	// ListLatest 取该用户最近 n 天有值的记录（「沿用上次值」chip 用），按 date 降序
	ListLatest(ctx context.Context, userID string, days int) ([]model.HealthDay, error)

	DeleteByUserDate(ctx context.Context, userID string, date time.Time) error
	DeleteAllByUser(ctx context.Context, userID string) (int64, error)
}

type healthDayDao struct {
	db *gorm.DB
}

// NewHealthDayDao 构造函数
func NewHealthDayDao() HealthDayDao { return &healthDayDao{db: DB} }

func (d *healthDayDao) WithContext(ctx context.Context) HealthDayDao {
	return &healthDayDao{db: d.db.WithContext(ctx)}
}

// healthDayUpdatable 冲突时需要覆盖的列（不含 id / user_id / date / created_at）
var healthDayUpdatable = []string{
	"water_ml", "weight_kg", "bbt", "sleep_hours", "bowel_count", "bowel_type", "updated_at",
}

func (d *healthDayDao) Create(ctx context.Context, h *model.HealthDay) error {
	return d.db.WithContext(ctx).Create(h).Error
}

func (d *healthDayDao) Upsert(ctx context.Context, h *model.HealthDay) error {
	return d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "date"}},
		DoUpdates: clause.AssignmentColumns(healthDayUpdatable),
	}).Create(h).Error
}

func (d *healthDayDao) GetByUserDate(ctx context.Context, userID string, date time.Time) (*model.HealthDay, error) {
	var h model.HealthDay
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date.Format("2006-01-02")).
		First(&h).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (d *healthDayDao) ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.HealthDay, error) {
	var items []model.HealthDay
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

func (d *healthDayDao) ListLatest(ctx context.Context, userID string, days int) ([]model.HealthDay, error) {
	var items []model.HealthDay
	from := time.Now().AddDate(0, 0, -days)
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date >= ?", userID, from.Format("2006-01-02")).
		Order("date DESC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *healthDayDao) DeleteByUserDate(ctx context.Context, userID string, date time.Time) error {
	return d.db.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date.Format("2006-01-02")).
		Delete(&model.HealthDay{}).Error
}

func (d *healthDayDao) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	res := d.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.HealthDay{})
	return res.RowsAffected, res.Error
}

// ============================================================================
// HealthSettingDao 健康模块用户配置（health_settings）
// ============================================================================

// HealthSettingDao 健康配置 DAO 接口
type HealthSettingDao interface {
	WithContext(ctx context.Context) HealthSettingDao

	// GetByUserID 取配置；不存在返回 (nil, nil)（service 层负责懒创建）
	GetByUserID(ctx context.Context, userID string) (*model.HealthSetting, error)
	// Upsert 按 user_id 唯一键插入或整体覆盖（引导提交 / 设置修改都走这个）
	Upsert(ctx context.Context, s *model.HealthSetting) error

	DeleteByUser(ctx context.Context, userID string) error
}

type healthSettingDao struct {
	db *gorm.DB
}

// NewHealthSettingDao 构造函数
func NewHealthSettingDao() HealthSettingDao { return &healthSettingDao{db: DB} }

func (d *healthSettingDao) WithContext(ctx context.Context) HealthSettingDao {
	return &healthSettingDao{db: d.db.WithContext(ctx)}
}

// healthSettingUpdatable 冲突时需要覆盖的列（不含 id / user_id / created_at）
var healthSettingUpdatable = []string{
	"metrics_enabled", "water_goal_ml", "water_step_ml", "weight_goal_kg", "setup_done_at", "updated_at",
}

func (d *healthSettingDao) GetByUserID(ctx context.Context, userID string) (*model.HealthSetting, error) {
	var s model.HealthSetting
	err := d.db.WithContext(ctx).Where("user_id = ?", userID).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (d *healthSettingDao) Upsert(ctx context.Context, s *model.HealthSetting) error {
	return d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns(healthSettingUpdatable),
	}).Create(s).Error
}

func (d *healthSettingDao) DeleteByUser(ctx context.Context, userID string) error {
	return d.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.HealthSetting{}).Error
}

// ============================================================================
// HealthEventDao 身体指标时间轴事件（health_events）
// ============================================================================

// HealthEventDao 时间轴事件 DAO 接口
//
// ⚠️ 本表是身体指标的**唯一真源**（一天可多次，不延续）。
// 所有写操作都必须由 service 层包在事务里，并在同一事务内重算 health_days 日汇总，
// 否则两边会漂（见 service/impl/health.go 的 recomputeDaySummary）。
type HealthEventDao interface {
	WithContext(ctx context.Context) HealthEventDao

	Create(ctx context.Context, e *model.HealthEvent) error
	// GetByID 单条；不存在返回 (nil, nil)
	GetByID(ctx context.Context, id, userID string) (*model.HealthEvent, error)
	// Update 整体覆盖（只改 value / note / time_of_day，不改 date 与 metric_key）
	Update(ctx context.Context, e *model.HealthEvent) error

	// ListByDate 某一天的全部事件，按 time_of_day 升序
	ListByDate(ctx context.Context, userID string, date time.Time) ([]model.HealthEvent, error)
	// ListByRange 区间查询 [start, end]（闭区间），按 date + time_of_day 升序
	ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.HealthEvent, error)
	// ListByMetricRange 某指标在区间的全部事件（统计曲线用），按 date + time_of_day 升序
	ListByMetricRange(ctx context.Context, userID, metricKey string, start, end time.Time) ([]model.HealthEvent, error)
	// ListLatestByMetric 某指标最近 n 条（「沿用上次值」chip 用），按 date + time_of_day 降序
	ListLatestByMetric(ctx context.Context, userID, metricKey string, limit int) ([]model.HealthEvent, error)
	// MetricKeysInRange 区间内出现过的指标 key 去重集合（日历分类小点用）
	// 返回 map[date字符串][]metricKey，只含**有记录**的日期
	MetricKeysInRange(ctx context.Context, userID string, start, end time.Time) (map[string][]string, error)

	Delete(ctx context.Context, id, userID string) error
	DeleteAllByUser(ctx context.Context, userID string) (int64, error)
}

type healthEventDao struct {
	db *gorm.DB
}

// NewHealthEventDao 构造函数
func NewHealthEventDao() HealthEventDao { return &healthEventDao{db: DB} }

func (d *healthEventDao) WithContext(ctx context.Context) HealthEventDao {
	return &healthEventDao{db: d.db.WithContext(ctx)}
}

// healthEventUpdatable 覆盖时需要更新的列（不含 id / user_id / date / metric_key / created_at）
//
// ⚠️ date 与 metric_key **刻意不在**更新列里：改一次记录不该把它挪到别的天或变成别的指标，
// 那种操作应走「删除 + 新建」，语义更直白也更容易审计。
var healthEventUpdatable = []string{"time_of_day", "value_num", "value_int", "note", "updated_at"}

func (d *healthEventDao) Create(ctx context.Context, e *model.HealthEvent) error {
	return d.db.WithContext(ctx).Create(e).Error
}

func (d *healthEventDao) GetByID(ctx context.Context, id, userID string) (*model.HealthEvent, error) {
	var e model.HealthEvent
	err := d.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&e).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (d *healthEventDao) Update(ctx context.Context, e *model.HealthEvent) error {
	return d.db.WithContext(ctx).Model(e).
		Select(healthEventUpdatable).
		Where("id = ? AND user_id = ?", e.ID, e.UserID).
		Updates(e).Error
}

func (d *healthEventDao) ListByDate(ctx context.Context, userID string, date time.Time) ([]model.HealthEvent, error) {
	var items []model.HealthEvent
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date = ?", userID, date.Format("2006-01-02")).
		Order("time_of_day ASC, id ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *healthEventDao) ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.HealthEvent, error) {
	var items []model.HealthEvent
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND date >= ? AND date <= ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Order("date ASC, time_of_day ASC, id ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *healthEventDao) ListByMetricRange(ctx context.Context, userID, metricKey string, start, end time.Time) ([]model.HealthEvent, error) {
	var items []model.HealthEvent
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND metric_key = ? AND date >= ? AND date <= ?",
			userID, metricKey, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Order("date ASC, time_of_day ASC, id ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *healthEventDao) ListLatestByMetric(ctx context.Context, userID, metricKey string, limit int) ([]model.HealthEvent, error) {
	if limit <= 0 {
		limit = 1
	}
	var items []model.HealthEvent
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND metric_key = ?", userID, metricKey).
		Order("date DESC, time_of_day DESC").
		Limit(limit).
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *healthEventDao) MetricKeysInRange(ctx context.Context, userID string, start, end time.Time) (map[string][]string, error) {
	type row struct {
		Date      string
		MetricKey string
		MinID     string
	}
	var rows []row
	// ⚠️ 用 MIN(id) 做排序锚点只是为了让同一天内的 key 顺序稳定（便于前端渲染一致），
	// 真正要去重靠的是 DISTINCT。
	err := d.db.WithContext(ctx).
		Model(&model.HealthEvent{}).
		Select("date, metric_key, MIN(id) AS min_id").
		Where("user_id = ? AND date >= ? AND date <= ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Group("date, metric_key").
		Order("date ASC, min_id ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string][]string, len(rows))
	for _, r := range rows {
		d := r.Date
		if len(d) > 10 {
			d = d[:10] // date 列可能被驱动带成 "2006-01-02T00:00:00Z"，统一截成 10 位
		}
		out[d] = append(out[d], r.MetricKey)
	}
	return out, nil
}

func (d *healthEventDao) Delete(ctx context.Context, id, userID string) error {
	return d.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&model.HealthEvent{}).Error
}

func (d *healthEventDao) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	res := d.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.HealthEvent{})
	return res.RowsAffected, res.Error
}
