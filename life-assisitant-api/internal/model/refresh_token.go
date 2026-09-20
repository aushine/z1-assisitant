package model

import "time"

// RefreshToken 刷新令牌实体
type RefreshToken struct {
	ID         string     `gorm:"column:id;primaryKey;type:varchar(64)"   json:"id"`
	UserID     string     `gorm:"column:user_id;type:varchar(32);not null;index" json:"user_id"`
	TokenHash  string     `gorm:"column:token_hash;type:varchar(255);not null;uniqueIndex:uk_token" json:"-"`
	DeviceID   string     `gorm:"column:device_id;type:varchar(100);not null" json:"device_id"`
	DeviceInfo JSON       `gorm:"column:device_info;type:json"              json:"device_info,omitempty"`
	IP         *string    `gorm:"column:ip;type:varchar(50)"                json:"ip,omitempty"`
	ExpiresAt  time.Time  `gorm:"column:expires_at;not null"               json:"expires_at"`
	RevokedAt  *time.Time `gorm:"column:revoked_at"                        json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `gorm:"column:created_at;autoCreateTime"         json:"created_at"`
}

func (rt *RefreshToken) TableName() string { return "refresh_tokens" }
