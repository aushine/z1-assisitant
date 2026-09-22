// 可靠的 SQL 执行器（迁移/运维用）
//
// 用法（cwd 必须是 life-assisitant-api）：
//
//	go run scripts/sqlrun/main.go db/data_260921_finance_categories.sql
//
// 与 scripts/init_db.go 的区别（为什么需要另写一个）：
//  1. ⚠️ **单连接**：增量脚本普遍用 `SET @x = ...; PREPARE s FROM @x; EXECUTE s; DEALLOCATE PREPARE s;`
//     这种「动态 SQL 做幂等」的写法，@变量 与 PREPARE 都是**连接级会话状态**。
//     init_db.go 逐条 db.Exec 走连接池，语句可能落到不同连接 ⇒ EXECUTE 报
//     "Unknown prepared statement handler"，而它**失败只打日志、继续跑并报「完成」**，
//     线上迁移会出现"以为改了其实没改"的静默事故。
//     本工具把 MaxOpenConns/MaxIdleConns 钉成 1，并在同一连接上顺序执行。
//  2. ⚠️ **失败即停**：任一条语句报错就立刻退出（exit 1），不掩盖问题。
//  3. ✅ **能看结果**：SELECT / SHOW / DESC / EXPLAIN 会把结果集打印成 TSV
//     （init_db.go 用 db.Exec 跑 SELECT，什么都看不到，没法做迁移后的校验）。
//
// DSN 与运行中的服务同源：manifest/config/config.yaml 的 database.default.link。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gogf/gf/v2/frame/g"
)

// parseLink 把 config 的 database.default.link 拆成 无库/带库 两个 DSN。
// 兼容 `user:pass@tcp(host:port)/db?params` 与 `user:pass@(host)/db` 两种写法。
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
	if len(os.Args) < 2 {
		log.Fatalf("用法: go run scripts/sqlrun/main.go <sql文件> [--pause-on-error]")
	}
	sqlFile := os.Args[1]

	link := g.Cfg().MustGet(context.Background(), "database.default.link").String()
	if link == "" {
		log.Fatalf("❌ 配置 database.default.link 为空（cwd 下找不到 manifest/config/config.yaml？）")
	}
	_, dsnWithDB, _, err := parseLink(link)
	if err != nil {
		log.Fatalf("❌ %v", err)
	}
	hostRe := regexp.MustCompile(`^[^@]+@`)
	fmt.Printf("🔗 目标库: %s\n", hostRe.ReplaceAllString(dsnWithDB, "***@"))

	raw, err := os.ReadFile(sqlFile)
	if err != nil {
		log.Fatalf("❌ 读取 %s 失败: %v", sqlFile, err)
	}
	fmt.Printf("📄 %s (%.1f KB)\n", sqlFile, float64(len(raw))/1024)

	db, err := sql.Open("mysql", dsnWithDB)
	if err != nil {
		log.Fatalf("❌ 打开连接失败: %v", err)
	}
	defer db.Close()
	// ⚠️ 关键：钉成单连接，保证 SET @x / PREPARE 的会话状态不丢。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		log.Fatalf("❌ Ping 失败: %v", err)
	}
	fmt.Println("✅ 已连接（单连接模式）")

	stmts := splitSQL(string(raw))
	fmt.Printf("📋 解析到 %d 条语句\n\n", len(stmts))

	ctx := context.Background()
	failed := 0
	for i, stmt := range stmts {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		head := strings.ToUpper(stmt)
		isQuery := strings.HasPrefix(head, "SELECT") || strings.HasPrefix(head, "SHOW") ||
			strings.HasPrefix(head, "DESC") || strings.HasPrefix(head, "EXPLAIN")
		preview := strings.Join(strings.Fields(stmt), " ")
		if len(preview) > 90 {
			preview = preview[:90] + " …"
		}

		if isQuery {
			rows, err := db.QueryContext(ctx, stmt)
			if err != nil {
				failed++
				fmt.Printf("[%d/%d] ❌ 查询失败: %v\n        SQL: %s\n", i+1, len(stmts), err, preview)
				continue
			}
			cols, _ := rows.Columns()
			fmt.Printf("[%d/%d] 🔍 %s\n", i+1, len(stmts), preview)
			fmt.Printf("        %s\n", strings.Join(cols, "\t"))
			n := 0
			for rows.Next() {
				vals := make([]any, len(cols))
				ptrs := make([]any, len(cols))
				for j := range vals {
					ptrs[j] = &vals[j]
				}
				if err := rows.Scan(ptrs...); err != nil {
					failed++
					fmt.Printf("        ❌ 读取行失败: %v\n", err)
					break
				}
				cells := make([]string, len(cols))
				for j, v := range vals {
					cells[j] = fmtCell(v)
				}
				fmt.Printf("        %s\n", strings.Join(cells, "\t"))
				n++
			}
			rows.Close()
			fmt.Printf("        → %d 行\n\n", n)
			continue
		}

		res, err := db.ExecContext(ctx, stmt)
		if err != nil {
			failed++
			fmt.Printf("[%d/%d] ❌ 执行失败: %v\n        SQL: %s\n\n", i+1, len(stmts), err, preview)
			continue
		}
		aff, _ := res.RowsAffected()
		fmt.Printf("[%d/%d] ✅ %s  (影响 %d 行)\n", i+1, len(stmts), preview, aff)
	}

	fmt.Printf("\n==================== 结果 ====================\n")
	if failed > 0 {
		fmt.Printf("❌ 失败 %d 条 / 共 %d 条 —— 请处理后重跑（本文件应幂等）\n", failed, len(stmts))
		os.Exit(1)
	}
	fmt.Printf("🎉 全部 %d 条执行成功\n", len(stmts))
}

func fmtCell(v any) string {
	switch t := v.(type) {
	case nil:
		return "NULL"
	case []byte:
		return string(t)
	default:
		return fmt.Sprintf("%v", t)
	}
}

// splitSQL 按 ; 拆分语句，跳过行注释 / 块注释，并避开字符串与反引号里的 ;。
func splitSQL(sql string) []string {
	var (
		stmts      []string
		buf        strings.Builder
		inString   bool
		stringChar byte
		inLineCom  bool
		inBlockCom bool
	)
	for i := 0; i < len(sql); i++ {
		c := sql[i]
		if inBlockCom {
			if c == '*' && i+1 < len(sql) && sql[i+1] == '/' {
				inBlockCom = false
				i++
			}
			continue
		}
		if inLineCom {
			if c == '\n' {
				inLineCom = false
				buf.WriteByte(c)
			}
			continue
		}
		if c == '/' && i+1 < len(sql) && sql[i+1] == '*' {
			inBlockCom = true
			i++
			continue
		}
		if c == '-' && i+1 < len(sql) && sql[i+1] == '-' {
			inLineCom = true
			i++
			continue
		}
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
		if c == '\'' || c == '"' || c == '`' {
			inString = true
			stringChar = c
			buf.WriteByte(c)
			continue
		}
		if c == ';' {
			if stmt := strings.TrimSpace(buf.String()); stmt != "" {
				stmts = append(stmts, stmt)
			}
			buf.Reset()
			continue
		}
		buf.WriteByte(c)
	}
	if rest := strings.TrimSpace(buf.String()); rest != "" {
		stmts = append(stmts, rest)
	}
	return stmts
}
