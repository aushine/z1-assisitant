// UserDao 用户表数据访问对象
// 风格参考 GORM Gen：链式 + 类型安全
package dao

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// UserDao 用户 DAO 接口
type UserDao interface {
	WithContext(ctx context.Context) UserDao
	FindByID(ctx context.Context, id string) (*model.User, error)
	FindByUsernameOrEmail(ctx context.Context, account string) (*model.User, error)
	FindByIDUnscoped(ctx context.Context, id string) (*model.User, error)
	Create(ctx context.Context, u *model.User) error
	Update(ctx context.Context, id string, fields map[string]any) error
	UpdateVersion(ctx context.Context, id string, version int, fields map[string]any) (int64, error)
	SoftDelete(ctx context.Context, id string) error
	List(ctx context.Context, opts UserListOptions) ([]model.User, int64, error)
	CountByRole(ctx context.Context, roleCode string) (int64, error)
}

// UserListOptions 用户列表查询参数
type UserListOptions struct {
	Keyword  string
	RoleCode string
	Status   string
	Page     int
	PageSize int
}

type userDao struct {
	db *gorm.DB
}

// NewUserDao 构造函数（由 init 注册）
func NewUserDao() UserDao { return &userDao{db: DB} }

func (d *userDao) WithContext(ctx context.Context) UserDao {
	return &userDao{db: d.db.WithContext(ctx)}
}

func (d *userDao) FindByID(ctx context.Context, id string) (*model.User, error) {
	var u model.User
	err := d.db.WithContext(ctx).Where("id = ?", id).First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *userDao) FindByIDUnscoped(ctx context.Context, id string) (*model.User, error) {
	var u model.User
	err := d.db.WithContext(ctx).Unscoped().Where("id = ?", id).First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *userDao) FindByUsernameOrEmail(ctx context.Context, account string) (*model.User, error) {
	var u model.User
	err := d.db.WithContext(ctx).
		Where("username = ? OR email = ?", account, account).
		First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (d *userDao) Create(ctx context.Context, u *model.User) error {
	db := d.db.WithContext(ctx)
	// D-03 第六轮：email 可空（管理员代建不填）。GORM 对无 default tag 的零值
	// 仍会写列（空串插库 → 第二个无邮箱用户撞 uk_email 1062），
	// 故空串时 Omit 让 DB 落 NULL（MySQL UNIQUE 允许多个 NULL）。
	if u.Email == "" {
		db = db.Omit("email")
	}
	return db.Create(u).Error
}

func (d *userDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("用户不存在或未变更")
	}
	return nil
}

// UpdateVersion CAS 乐观锁更新（version 匹配才更新）
// 返回受影响行数
func (d *userDao) UpdateVersion(ctx context.Context, id string, version int, fields map[string]any) (int64, error) {
	res := d.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ? AND version = ?", id, version).
		Updates(fields)
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

func (d *userDao) SoftDelete(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.User{}).Error
}

func (d *userDao) List(ctx context.Context, opts UserListOptions) ([]model.User, int64, error) {
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.PageSize <= 0 || opts.PageSize > 100 {
		opts.PageSize = 20
	}

	q := d.db.WithContext(ctx).Model(&model.User{})
	if opts.Keyword != "" {
		like := "%" + opts.Keyword + "%"
		q = q.Where("username LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?", like, like, like, like)
	}
	if opts.RoleCode != "" {
		q = q.Where("role_code = ?", opts.RoleCode)
	}
	if opts.Status != "" {
		q = q.Where("status = ?", opts.Status)
	} else {
		q = q.Where("status <> ?", model.UserStatusDeleted) // 默认隐藏软删
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 成员列表属于「主数据」（同 role 列表），按加入时间正序：最早的在前、新增追加到末尾，
	// 而不是像通知/账单那种流水用倒序。id 作次级排序键，保证同秒创建时分页顺序稳定。
	var users []model.User
	err := q.Order("created_at ASC, id ASC").
		Limit(opts.PageSize).
		Offset((opts.Page - 1) * opts.PageSize).
		Find(&users).Error
	if err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (d *userDao) CountByRole(ctx context.Context, roleCode string) (int64, error) {
	var count int64
	err := d.db.WithContext(ctx).Model(&model.User{}).
		Where("role_code = ? AND status = ?", roleCode, model.UserStatusActive).
		Count(&count).Error
	return count, err
}

// 全局 DAO 实例（Service 层直接调用 dao.User.*）
// 注：包级变量初始化时 DB 还是 nil，必须在 main.go InitDB 之后由 setDB 注入
var (
	User         UserDao
	Habit        HabitDao
	HabitLog     HabitLogDao
	Account      AccountDao
	Transaction  TransactionDao
	Budget       BudgetDao
	MoodLog      MoodLogDao
	Notification NotificationDao
	// 经期记录模块（260919 新增）
	PeriodDay     PeriodDayDao
	PeriodCycle   PeriodCycleDao
	PeriodSetting PeriodSettingDao
	// 健康模块 + 纪念日（20260919-v1 新增）
	HealthDay     HealthDayDao
	HealthEvent   HealthEventDao
	HealthSetting HealthSettingDao
	Anniversary   AnniversaryDao
	tSubtask      SubtaskDao
	userDBOnce    bool
)

// SetDB 注入 DB 实例（在 dao.InitDB 末尾调用）
func SetDB(db *gorm.DB) {
	DB = db
	if !userDBOnce {
		User = &userDao{db: db}
		Permission = &permissionDao{db: db}
		Role = &roleDao{db: db}
		RefreshToken = &refreshTokenDao{db: db}
		Task = &taskDao{db: db}
		Habit = &habitDao{db: db}
		HabitLog = &habitLogDao{db: db}
		Account = &accountDao{db: db}
		Transaction = &transactionDao{db: db}
		Budget = &budgetDao{db: db}
		MoodLog = &moodLogDao{db: db}
		Notification = &notificationDao{db: db}
		Subtask = &subtaskDao{db: db}
		PeriodDay = &periodDayDao{db: db}
		PeriodCycle = &periodCycleDao{db: db}
		PeriodSetting = &periodSettingDao{db: db}
		HealthDay = &healthDayDao{db: db}
		HealthEvent = &healthEventDao{db: db}
		HealthSetting = &healthSettingDao{db: db}
		Anniversary = &anniversaryDao{db: db}
		userDBOnce = true
		return
	}
	// 重新绑定（重连场景）
	User = &userDao{db: db}
	Permission = &permissionDao{db: db}
	Role = &roleDao{db: db}
	RefreshToken = &refreshTokenDao{db: db}
	Task = &taskDao{db: db}
	Habit = &habitDao{db: db}
	HabitLog = &habitLogDao{db: db}
	Account = &accountDao{db: db}
	Transaction = &transactionDao{db: db}
	Budget = &budgetDao{db: db}
	MoodLog = &moodLogDao{db: db}
	Notification = &notificationDao{db: db}
	Subtask = &subtaskDao{db: db}
	PeriodDay = &periodDayDao{db: db}
	PeriodCycle = &periodCycleDao{db: db}
	PeriodSetting = &periodSettingDao{db: db}
	HealthDay = &healthDayDao{db: db}
	HealthEvent = &healthEventDao{db: db}
	HealthSetting = &healthSettingDao{db: db}
	Anniversary = &anniversaryDao{db: db}
}

// 旧 NewUserDao 保留供 SetDB 内部使用
var _ = NewUserDao
