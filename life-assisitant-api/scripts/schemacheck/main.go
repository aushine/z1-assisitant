// 结构对账工具：把线上库每张表的列名导出成 TSV，供本地与 model 标签比对。
//
// 用法（cwd = life-assisitant-api）：
//
//	go run scripts/schemacheck/main.go <输出文件>
//
// DSN 从 manifest/config/config.yaml 的 database.default.link 读取（与服务端同源）。
// 只读 information_schema，不改任何数据。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gogf/gf/v2/frame/g"
)

func parseLink(link string) (dsnWithDB, dbName string, err error) {
	s := strings.TrimSpace(link)
	at := strings.LastIndex(s, "@")
	if at < 0 {
		return "", "", fmt.Errorf("无法解析 link（缺少 @）: %q", link)
	}
	creds, rest := s[:at], s[at+1:]
	open := strings.Index(rest, "(")
	closing := strings.Index(rest, ")")
	if open < 0 || closing < open {
		return "", "", fmt.Errorf("无法解析 link（缺少 host:port）: %q", link)
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
	return fmt.Sprintf("%s@%s(%s)/%s%s", creds, proto, addr, dbName, params), dbName, nil
}

func main() {
	out := "schemacheck.tsv"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	link := g.Cfg().MustGet(context.Background(), "database.default.link").String()
	if link == "" {
		log.Fatalf("❌ 配置 database.default.link 为空")
	}
	dsn, dbName, err := parseLink(link)
	if err != nil {
		log.Fatalf("❌ %v", err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("❌ 打开连接失败: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("❌ Ping 失败: %v", err)
	}
	fmt.Printf("✅ 已连接 %s\n", dbName)

	rows, err := db.Query(`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
		FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, dbName)
	if err != nil {
		log.Fatalf("❌ 查询 information_schema 失败: %v", err)
	}
	defer rows.Close()

	type row struct{ table, col, typ, nullable string }
	var all []row
	tables := map[string]bool{}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.table, &r.col, &r.typ, &r.nullable); err != nil {
			log.Fatalf("❌ Scan 失败: %v", err)
		}
		all = append(all, r)
		tables[r.table] = true
	}
	sort.Slice(all, func(i, j int) bool { return all[i].table+all[i].col < all[j].table+all[j].col })

	var sb strings.Builder
	sb.WriteString("TABLE\tCOLUMN\tTYPE\tNULLABLE\n")
	for _, r := range all {
		sb.WriteString(fmt.Sprintf("%s\t%s\t%s\t%s\n", r.table, r.col, r.typ, r.nullable))
	}
	if err := os.WriteFile(out, []byte(sb.String()), 0o644); err != nil {
		log.Fatalf("❌ 写文件失败: %v", err)
	}
	fmt.Printf("✅ 导出 %d 张表 / %d 列 -> %s\n", len(tables), len(all), out)
}
