// RefreshTokenDao 刷新令牌数据访问对象
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

type RefreshTokenDao interface {
	WithContext(ctx context.Context) RefreshTokenDao
	Create(ctx context.Context, rt *model.RefreshToken) error
	FindByHash(ctx context.Context, hash string) (*model.RefreshToken, error)
	RevokeByID(ctx context.Context, id string) error
	// RevokeByIDAndUser 按 id + user_id 撤销（D-03 第十一轮：单设备退出用）。
	// SQL 层就带 user_id 过滤 —— 不能让前端传个 id 就能把别人的会话踢掉。
	// 返回受影响行数：0 表示不存在 / 不属于该用户 / 已撤销。
	RevokeByIDAndUser(ctx context.Context, id, userID string) (int64, error)
	RevokeByUser(ctx context.Context, userID string) error
	RevokeByUserAndDevice(ctx context.Context, userID, deviceID string) error
	DeleteExpired(ctx context.Context) (int64, error)
	CountActiveByUser(ctx context.Context, userID string) (int64, error)
	ListActiveByUser(ctx context.Context, userID string) ([]model.RefreshToken, error)
}

type refreshTokenDao struct {
	db *gorm.DB
}

func NewRefreshTokenDao() RefreshTokenDao { return &refreshTokenDao{db: DB} }

func (d *refreshTokenDao) WithContext(ctx context.Context) RefreshTokenDao {
	return &refreshTokenDao{db: d.db.WithContext(ctx)}
}

func (d *refreshTokenDao) Create(ctx context.Context, rt *model.RefreshToken) error {
	return d.db.WithContext(ctx).Create(rt).Error
}

func (d *refreshTokenDao) FindByHash(ctx context.Context, hash string) (*model.RefreshToken, error) {
	var rt model.RefreshToken
	err := d.db.WithContext(ctx).Where("token_hash = ?", hash).First(&rt).Error
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

func (d *refreshTokenDao) RevokeByID(ctx context.Context, id string) error {
	now := time.Now()
	return d.db.WithContext(ctx).Model(&model.RefreshToken{}).
		Where("id = ?", id).
		Update("revoked_at", now).Error
}

// RevokeByIDAndUser 按 id + user_id 撤销（见接口注释）
func (d *refreshTokenDao) RevokeByIDAndUser(ctx context.Context, id, userID string) (int64, error) {
	res := d.db.WithContext(ctx).Model(&model.RefreshToken{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", id, userID).
		Update("revoked_at", time.Now())
	return res.RowsAffected, res.Error
}

func (d *refreshTokenDao) RevokeByUser(ctx context.Context, userID string) error {
	now := time.Now()
	return d.db.WithContext(ctx).Model(&model.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
}

func (d *refreshTokenDao) RevokeByUserAndDevice(ctx context.Context, userID, deviceID string) error {
	now := time.Now()
	return d.db.WithContext(ctx).Model(&model.RefreshToken{}).
		Where("user_id = ? AND device_id = ? AND revoked_at IS NULL", userID, deviceID).
		Update("revoked_at", now).Error
}

func (d *refreshTokenDao) DeleteExpired(ctx context.Context) (int64, error) {
	res := d.db.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&model.RefreshToken{})
	return res.RowsAffected, res.Error
}

func (d *refreshTokenDao) CountActiveByUser(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := d.db.WithContext(ctx).Model(&model.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, time.Now()).
		Count(&count).Error
	return count, err
}

func (d *refreshTokenDao) ListActiveByUser(ctx context.Context, userID string) ([]model.RefreshToken, error) {
	var list []model.RefreshToken
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, time.Now()).
		Order("created_at DESC").
		Find(&list).Error
	return list, err
}

// 全局 DAO 实例（在 dao.SetDB 中统一初始化）
var RefreshToken RefreshTokenDao
