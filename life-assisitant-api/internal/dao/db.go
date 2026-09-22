// Package dao 提供 GORM 数据访问层
//
// 设计要点：
//  1. db 全局单例，由 main.go 启动时初始化
//  2. 业务表对应的 DAO 接口手写实现（GORM Gen 风格 API）
//  3. Service 层通过 dao.User / dao.Role 等全局变量访问
//  4. WithContext(ctx) 是统一入口，支持 trace / soft delete / 调试日志
package dao

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/life-assistant/api/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// DB 全局 GORM 实例
var DB *gorm.DB

// InitDB 初始化数据库连接
// dsn 示例：mysql:root:root123@tcp(127.0.0.1:3306)/life_assistant?charset=utf8mb4&parseTime=true&loc=Local
func InitDB(dsn string, debug bool) error {
	// 配置 GORM Logger，输出 SQL 到控制台
	logLevel := logger.Warn
	if debug {
		logLevel = logger.Info
	}
	gormLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second, // 慢 SQL 阈值
			LogLevel:                  logLevel,    // 日志级别
			IgnoreRecordNotFoundError: true,        // 忽略记录未找到错误
			Colorful:                  true,        // 彩色打印
		},
	)
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger:                                   gormLogger,
		DisableForeignKeyConstraintWhenMigrating: false,
		PrepareStmt:                              true,
	})
	if err != nil {
		return fmt.Errorf("连接 MySQL 失败: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("获取底层 *sql.DB 失败: %w", err)
	}
	sqlDB.SetMaxOpenConns(50)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(time.Hour)
	DB = db

	// 自动迁移：确保新表/新字段存在
	// 2026-09-17 勘误：清单曾遗漏 Habit/HabitLog，导致 habits 缺 current_streak 等
	// P2-2 新列、建习惯报 1054 Unknown column 且被静默吞掉。新增模型必须同步登记到这里。
	if err := db.AutoMigrate(
		&model.Feedback{},
		&model.Subtask{},
		&model.Task{},
		&model.Budget{},
		&model.MoodLog{},
		&model.Notification{},
		&model.Habit{},
		&model.HabitLog{},
		// 经期记录模块（260919 新增）—— 漏登记只报 DATABASE_ERROR 500002
		&model.PeriodDay{},
		&model.PeriodCycle{},
		&model.PeriodSetting{},
		// 健康模块 + 纪念日（20260919-v1 新增）
		// ⚠️ 索引名已在 model 里显式写好（uk_health_days_user_date / uk_health_settings_user），
		//    与手写 DDL 逐字一致，避免 GORM 误删唯一索引（Error 1553 / 静默丢约束）
		&model.HealthDay{},
		&model.HealthEvent{},
		&model.HealthSetting{},
		&model.Anniversary{},
		// 记账分类（20260921 新增）—— 漏登记不报错，接口只返 DATABASE_ERROR 500002
		// ⚠️ 索引名已在 model 里显式写好（uk_fin_cat_user_scope_parent_name /
		//    idx_fin_cat_user_scope / idx_fin_cat_parent），与手写 DDL 逐字一致；
		//    主键为复合主键 (id, user_id)（详见 model/finance_category.go 的说明）
		&model.FinanceCategory{},
	); err != nil {
		return fmt.Errorf("AutoMigrate 失败: %w", err)
	}

	// 注入到所有 DAO 全局变量
	SetDB(db)
	return nil
}

// CloseDB 关闭数据库连接
func CloseDB() error {
	if DB == nil {
		return nil
	}
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// WithContext 链式查询的统一入口
func WithContext(ctx context.Context) *gorm.DB {
	return DB.WithContext(ctx)
}
