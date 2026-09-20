package model

import (
	"time"

	"gorm.io/gorm"
)

// User 用户表实体
// 软删除：gorm.DeletedAt
// 乐观锁：version
// JSON 字段：preferences
type User struct {
	ID           string `gorm:"column:id;primaryKey;type:varchar(32)"        json:"id"`
	Username     string `gorm:"column:username;type:varchar(32);uniqueIndex:uk_username;not null" json:"username"`
	PasswordHash string `gorm:"column:password_hash;type:varchar(255);not null" json:"-"`
	Name         string `gorm:"column:name;type:varchar(50);not null"        json:"name"`
	// Email 可空（D-03 第六轮）：管理员代建用户不再填邮箱。
	// 空串零值在 GORM Create 时跳列 → 落 NULL（NULL 不撞 uk_email，多个无邮箱用户可共存）
	Email string  `gorm:"column:email;type:varchar(100);uniqueIndex:uk_email"   json:"email"`
	Phone *string `gorm:"column:phone;type:varchar(20)"                json:"phone,omitempty"`
	// Avatar 只存 URL：/uploads/avatars/<file>（POST /users/me/avatar 落盘产物）或 http(s) 外链；
	// 第八轮改文件上传后短 URL 绰绰有余，varchar(500) 足够（base64 入库方案已废弃——曾撞 1406）
	Avatar     *string `gorm:"column:avatar;type:varchar(500)"              json:"avatar,omitempty"`
	RoleCode   string  `gorm:"column:role_code;type:varchar(20);not null;index" json:"role_code"`
	Department *string `gorm:"column:department;type:varchar(50)"           json:"department,omitempty"`
	Status     string  `gorm:"column:status;type:varchar(20);default:active;index" json:"status"`
	// PwdResetRequired 初始密码待改标记：管理员代建=1，本人改密成功=0（登录响应带回，前端提示改密）。
	// ⚠️ 不写 default tag——「零值+default tag 跳列」是 D-03 第五轮 is_system 错标事故的根因。
	PwdResetRequired bool           `gorm:"column:pwd_reset_required"                     json:"pwd_reset_required"`
	Preferences      JSON           `gorm:"column:preferences;type:json"                 json:"preferences,omitempty"`
	FailedLoginCount int            `gorm:"column:failed_login_count;default:0"          json:"-"`
	LockedUntil      *time.Time     `gorm:"column:locked_until"                          json:"locked_until,omitempty"`
	LastLoginAt      *time.Time     `gorm:"column:last_login_at"                         json:"last_login_at,omitempty"`
	LastLoginIP      *string        `gorm:"column:last_login_ip;type:varchar(50)"        json:"last_login_ip,omitempty"`
	LastLoginDevice  *string        `gorm:"column:last_login_device;type:varchar(20)"    json:"last_login_device,omitempty"`
	CreatedAt        time.Time      `gorm:"column:created_at;autoCreateTime"             json:"created_at"`
	UpdatedAt        time.Time      `gorm:"column:updated_at;autoUpdateTime"             json:"updated_at"`
	Version          int            `gorm:"column:version;default:0"                     json:"version"`
	DeletedAt        gorm.DeletedAt `gorm:"column:deleted_at;index"                      json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (u *User) TableName() string { return "users" }
