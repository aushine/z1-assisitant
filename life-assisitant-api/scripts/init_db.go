// 数据库初始化脚本：建库 + 跑 DDL + 跑种子数据 + 跑迁移 SQL
// 用法（在项目根目录）：
//
//	go run scripts/init_db.go                       # 默认 manifest/sql/0001_init.sql
//	go run scripts/init_db.go db/init.sql           # 建表（Navicat dump）
//	go run scripts/init_db.go db/init_data.sql      # 种子数据
//	go run scripts/init_db.go db/260917_role_permission_v2.sql  # D-03 权限重构迁移
//
// 2026-09-17（D-03）：DSN 不再硬编码（原 127.0.0.1:3987 早已过期），
// 改从 manifest/config/config.yaml 的 database.default.link 读取，与服务端同源。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	_ "github.com/go-sql-driver/mysql"
)

// parseLink 把 config 的 database.default.link 拆成 无库/带库 两个 DSN。
//
// ⚠️ 2026-09-19 修正：原来的正则 `^([^@]+)@\(([^)]+)\)/([^?]*)(\?.*)?$` 只认
// `user:pass@(host)/db`，而 GoFrame 配置里真实格式是
// `user:pass@tcp(host:port)/db?params` —— 中间多一层 `tcp(...)` 就匹配不上，
// 表现为「config 里明明有 link 却报无法解析」。改成按分隔符手工拆，兼容两种写法。
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
	proto := rest[:open] // 通常 "tcp"，也可能是 "" 或 "unix"
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
	sqlFile := "manifest/sql/0001_init.sql"
	if len(os.Args) > 1 {
		sqlFile = os.Args[1]
	}

	// 0. 从 config 读 DSN（与运行中的服务端同源，不再维护第二份连接串）
	link := g.Cfg().MustGet(context.Background(), "database.default.link").String()
	if link == "" {
		log.Fatalf("❌ 配置 database.default.link 为空（cwd 下找不到 manifest/config/config.yaml？）")
	}
	dsnNoDB, dsnWithDB, dbName, err := parseLink(link)
	if err != nil {
		log.Fatalf("❌ %v", err)
	}
	// 打印时遮蔽密码
	hostRe := regexp.MustCompile(`^[^@]+@`)
	fmt.Printf("🔗 目标库: %s (来自 manifest/config/config.yaml)\n", hostRe.ReplaceAllString(dsnWithDB, "***@"))

	// 1. 读 SQL
	sqlBytes, err := os.ReadFile(sqlFile)
	if err != nil {
		log.Fatalf("❌ 读取 %s 失败: %v", sqlFile, err)
	}
	sqlContent := string(sqlBytes)
	fmt.Printf("📄 读取 SQL: %s (%.1f KB)\n", sqlFile, float64(len(sqlBytes))/1024)

	// 2. 连接（无库）
	fmt.Println("🔌 连接到 MySQL ...")
	db, err := sql.Open("mysql", dsnNoDB)
	if err != nil {
		log.Fatalf("❌ 打开连接失败: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("❌ Ping 失败: %v", err)
	}
	fmt.Println("✅ MySQL 连接成功")

	// 3. 建库
	fmt.Printf("📦 创建数据库 %s ...\n", dbName)
	if _, err := db.Exec(fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", dbName)); err != nil {
		log.Fatalf("❌ 建库失败: %v", err)
	}
	fmt.Println("✅ 数据库就绪")

	// 4. 切到目标库
	if _, err := db.Exec(fmt.Sprintf("USE `%s`", dbName)); err != nil {
		log.Fatalf("❌ USE 失败: %v", err)
	}

	// 5. 关闭无库连接，重新打开带库连接（保证 multiStatements 生效）
	db.Close()
	db, err = sql.Open("mysql", dsnWithDB)
	if err != nil {
		log.Fatalf("❌ 重连失败: %v", err)
	}
	defer db.Close()

	// 6. 拆分多条 SQL，逐条执行
	// SQL 里有 ; 结尾的语句，但要避免字符串里的 ; 被错分
	stmts := splitSQL(sqlContent)
	fmt.Printf("📋 解析到 %d 条 SQL 语句\n", len(stmts))

	// 分离 DDL 和 DML：SHOW/CREATE 一起执行，INSERT 单独执行（避免外键依赖问题）
	successCount := 0
	for i, stmt := range stmts {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		// 跳过注释行
		if strings.HasPrefix(stmt, "--") && !strings.Contains(stmt, " ") {
			continue
		}
		preview := stmt
		if len(preview) > 60 {
			preview = preview[:60] + "..."
		}
		fmt.Printf("  [%d/%d] %s\n", i+1, len(stmts), preview)
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("⚠️  执行失败: %v\n  SQL: %s", err, stmt)
			// 不退出，继续执行
		} else {
			successCount++
		}
	}
	fmt.Printf("\n✅ 完成: %d/%d 成功\n", successCount, len(stmts))

	// 7. 验证：列出所有表
	fmt.Println("\n📊 当前库表：")
	rows, err := db.Query("SHOW TABLES")
	if err != nil {
		log.Fatalf("❌ SHOW TABLES 失败: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		fmt.Printf("  - %s\n", name)
	}

	fmt.Println("\n🎉 数据库初始化完成！")
}

// splitSQL 拆分 SQL 语句（按 ; 分隔，但要避开字符串里的 ;）
func splitSQL(sql string) []string {
	var (
		stmts       []string
		buf         strings.Builder
		inString    bool
		stringChar  byte
		inLineCom   bool
		inBlockCom  bool
	)
	for i := 0; i < len(sql); i++ {
		c := sql[i]
		// 跳过块注释
		if inBlockCom {
			if c == '*' && i+1 < len(sql) && sql[i+1] == '/' {
				inBlockCom = false
				i++
			}
			continue
		}
		// 跳行注释
		if inLineCom {
			if c == '\n' {
				inLineCom = false
				buf.WriteByte(c)
			}
			continue
		}
		// 进入块注释
		if c == '/' && i+1 < len(sql) && sql[i+1] == '*' {
			inBlockCom = true
			i++
			continue
		}
		// 进入行注释
		if c == '-' && i+1 < len(sql) && sql[i+1] == '-' {
			inLineCom = true
			i++
			continue
		}
		// 字符串
		if inString {
			buf.WriteByte(c)
			if c == '\\' && i+1 < len(sql) {
				buf.WriteByte(sql[i+1])
				i++
				continue
			}
			if c == stringChar {
				inString = false
			}
			continue
		}
		// 进入字符串
		if c == '\'' || c == '"' || c == '`' {
			inString = true
			stringChar = c
			buf.WriteByte(c)
			continue
		}
		// 分号
		if c == ';' {
			stmt := strings.TrimSpace(buf.String())
			if stmt != "" {
				stmts = append(stmts, stmt)
			}
			buf.Reset()
			continue
		}
		buf.WriteByte(c)
	}
	// 收尾
	if rest := strings.TrimSpace(buf.String()); rest != "" {
		stmts = append(stmts, rest)
	}
	return stmts
}
