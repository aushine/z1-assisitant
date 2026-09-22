// 一次性播种脚本：给所有活跃用户写入内置记账分类。
//
// 用法（在项目根目录）：
//
//	go run scripts/fincatseed/main.go
//
// 背景：记账分类是「用户级」的（每人一份，105 条内置），由后端在 GET /finance/categories
// 时**懒创建**播种。本脚本用于「存量活跃用户一次性补齐」，避免依赖每个用户先点进分类页。
//
// 行为：
//   - 取所有未软删的 users.id；
//   - 对每个用户：只要 finance_categories 里存在**任意** is_builtin=1 行（含已删除），
//     就跳过该用户（说明已经播过种，或用户曾全删又触发过重新播种）；
//   - 否则用 utility.BuildSeedCategories(uid) 展开 105 条，INSERT IGNORE 写入。
//
// 只播种，不建表、不回填历史交易。建表/加列见 db/data_260921_finance_categories.sql，
// 历史回填见 db/backfill_260921_finance_categories.sql。
//
// DSN 与 scripts/init_db.go 同源：从 manifest/config/config.yaml 的
// database.default.link 读取（不再硬编码连接串）。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gogf/gf/v2/frame/g"

	"github.com/life-assistant/api/internal/utility"
)

// parseLink 同 scripts/init_db.go：把 config 的 database.default.link 拆成 无库/带库 两个 DSN。
func parseLink(link string) (dsnNoDB, dsnWithDB, dbName string, err error) {
	s := strings.TrimSpace(link)
	at := strings.LastIndex(s, "@")
	if at < 0 {
		return "", "", "", fmt.Errorf("无法解析数据库 link（缺少 @）: %q", link)
	}
	creds, rest := s[:at], s[at+1:]
	open := strings.Index(rest, "(")
	closing := strings.Index(rest, ")")
	if open < 0 || closing < open {
		return "", "", "", fmt.Errorf("无法解析数据库 link（缺少 host:port）: %q", link)
	}
	proto := rest[:open]
	addr := rest[open+1 : closing]

	tail := strings.TrimPrefix(rest[closing+1:], "/")
	params := ""
	if i := strings.Index(tail, "?"); i >= 0 {
		params = tail[i:]
		tail = tail[:i]
	}
	dbName = tail
	if dbName == "" {
		dbName = "life_assistant"
	}
	if params == "" {
		params = "?charset=utf8mb4&parseTime=true&loc=Local"
	}
	if !strings.Contains(params, "multiStatements=true") {
		params += "&multiStatements=true"
	}
	dsnNoDB = fmt.Sprintf("%s@%s(%s)/%s", creds, proto, addr, params)
	dsnWithDB = fmt.Sprintf("%s@%s(%s)/%s%s", creds, proto, addr, dbName, params)
	return dsnNoDB, dsnWithDB, dbName, nil
}

func main() {
	// 0. DSN 同源
	link := g.Cfg().MustGet(context.Background(), "database.default.link").String()
	if link == "" {
		log.Fatalf("❌ 配置 database.default.link 为空（cwd 下找不到 manifest/config/config.yaml？）")
	}
	_, dsnWithDB, _, err := parseLink(link)
	if err != nil {
		log.Fatalf("❌ %v", err)
	}
	hostRe := regexp.MustCompile(`^[^@]+@`)
	fmt.Printf("🔗 目标库: %s (来自 manifest/config/config.yaml)\n", hostRe.ReplaceAllString(dsnWithDB, "***@"))

	db, err := sql.Open("mysql", dsnWithDB)
	if err != nil {
		log.Fatalf("❌ 打开连接失败: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("❌ Ping 失败: %v", err)
	}
	fmt.Println("✅ MySQL 连接成功")

	ctx := context.Background()

	// 1. 取所有活跃用户
	userRows, err := db.QueryContext(ctx, "SELECT `id` FROM `users` WHERE `deleted_at` IS NULL")
	if err != nil {
		log.Fatalf("❌ 查询用户失败: %v", err)
	}
	var userIDs []string
	for userRows.Next() {
		var uid string
		if err := userRows.Scan(&uid); err != nil {
			log.Fatalf("❌ 扫描用户失败: %v", err)
		}
		userIDs = append(userIDs, uid)
	}
	userRows.Close()
	fmt.Printf("👥 活跃用户数: %d\n", len(userIDs))

	// 2. 逐用户判断 + 播种
	var scanned, seeded, skipped, inserted int

	for _, uid := range userIDs {
		scanned++
		var builtinCnt int64
		if err := db.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM `finance_categories` WHERE `user_id` = ? AND `is_builtin` = 1",
			uid,
		).Scan(&builtinCnt); err != nil {
			log.Fatalf("❌ 查询用户 %s 播种状态失败: %v", uid, err)
		}
		if builtinCnt > 0 {
			skipped++
			continue
		}

		seeded++
		n, err := seedUser(ctx, db, uid)
		if err != nil {
			log.Fatalf("❌ 给用户 %s 播种失败: %v", uid, err)
		}
		inserted += n
	}

	fmt.Printf("\n🎉 完成：扫描 %d / 播种 %d / 跳过 %d / 插入 %d 行\n",
		scanned, seeded, skipped, inserted)
}

// seedUser 把某用户的 105 条内置分类 INSERT IGNORE 写入。返回实际写入行数。
func seedUser(ctx context.Context, db *sql.DB, uid string) (int, error) {
	cats := utility.BuildSeedCategories(uid)
	if len(cats) == 0 {
		return 0, nil
	}

	// 列：id, user_id, parent_id, scope, name, full_name, emoji, icon, tint, sort, is_builtin, created_at, updated_at
	const cols = "(`id`, `user_id`, `parent_id`, `scope`, `name`, `full_name`, `emoji`, `icon`, `tint`, `sort`, `is_builtin`, `created_at`, `updated_at`)"
	now := time.Now().Format("2006-01-02 15:04:05")

	var (
		placeholders []string
		args         []any
	)
	for range cats {
		placeholders = append(placeholders, "(?,?,?,?,?,?,?,?,?,?,?,?,?)")
	}
	for _, c := range cats {
		args = append(args,
			c.ID,
			c.UserID,
			c.ParentID,
			c.Scope,
			c.Name,
			deref(c.FullName),
			nullableStr(c.Emoji),
			nullableStr(c.Icon),
			nullableStr(c.Tint),
			c.Sort,
			boolToInt(c.IsBuiltin),
			now,
			now,
		)
	}

	query := fmt.Sprintf(
		"INSERT IGNORE INTO `finance_categories` %s VALUES %s",
		cols, strings.Join(placeholders, ","),
	)
	res, err := db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	aff, _ := res.RowsAffected()
	return int(aff), nil
}

func deref(s *string) any {
	if s == nil {
		return ""
	}
	return *s
}

func nullableStr(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
