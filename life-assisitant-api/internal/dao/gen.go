// Package dao - GORM Gen 配置
//
// gen 命令的"占位"配置。生产环境按需执行：
//
//	go run internal/dao/gen.go
//
// 本 MVP 不强制执行 gen，而是采用"手写 DAO 接口 + GORM 链式 API"的方案，
// 以便控制代码体积、避免大量生成代码。
//
// 如果未来表数量增加或需要 Gen 的高级特性（type-safe 字段选择等），
// 可以 uncomment 下方函数并执行。
package dao

import (
	"gorm.io/gen"
	"gorm.io/gorm"
)

// NewGenerator 创建一个 GORM Gen 生成器
// 调用方式（未来按需启用）：
//
//	if err := dao.InitDB(dsn, false); err != nil { panic(err) }
//	dao.GenerateAll(dao.DB, "internal/dao", "internal/model/entity")
func NewGenerator(db *gorm.DB, outPath, modelPkg string) *gen.Generator {
	return gen.NewGenerator(gen.Config{
		OutPath:           outPath,
		OutFile:           "gen.go",
		ModelPkgPath:      modelPkg,
		WithUnitTest:      false,
		FieldNullable:     true,
		FieldCoverable:    true,
		FieldSignable:     true,
		FieldWithIndexTag: true,
		FieldWithTypeTag:  true,
	})
}

// ApplyBasicModels 在 Gen 实例上注册要生成代码的表
func ApplyBasicModels(g *gen.Generator) {
	g.ApplyBasic(
		g.GenerateModel("users"),
		g.GenerateModel("roles"),
		g.GenerateModel("permissions"),
		g.GenerateModel("role_permissions"),
		g.GenerateModel("refresh_tokens"),
	)
}

// GenerateAll 一键生成（默认实现）
func GenerateAll(db *gorm.DB, outPath, modelPkg string) error {
	g := NewGenerator(db, outPath, modelPkg)
	g.UseDB(db)
	ApplyBasicModels(g)
	g.Execute()
	return nil
}
