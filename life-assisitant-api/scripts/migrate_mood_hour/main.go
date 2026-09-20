// 260919 迁移：mood_logs 由「一天一条」改为「按小时记录」
//
// 背景：心情/精力从「一天一条（UNIQUE(user_id,date)）」改成「按小时记一条、
// 随时可改（UNIQUE(user_id,date,hour)）」。存量行统一落到 hour = 12
// （model.MoodDiaryHour，也是经期日记的槽位），语义上等于「那天中午记的」。
//
// 为什么是 Go 而不是 .sql：MySQL 不支持 `DROP INDEX IF EXISTS` /
// `ADD COLUMN IF NOT EXISTS`，而 scripts/init_db.go 是按 `;` 拆语句逐条
// db.Exec 的（每次可能取到不同连接，`SET @var` + PREPARE 那套会失效）。
// 所以「先查 information_schema 再决定做不做」放在 Go 里最可靠。
//
// 幂等：每一步先查 information_schema，已完成就跳过。可反复执行。
//
// 用法（**工作目录必须是 life-assisitant-api**，DSN 取自 manifest/config/config.yaml）：
//
//	go run scripts/migrate_mood_hour/main.go
//
// 做六件事：
//  1. 加 hour 列 TINYINT NOT NULL DEFAULT 12（存量行自动变成 12:00）
//  2. 删掉旧唯一键 uk_user_date（若存在；不删的话一天插第二条会被唯一键挡死）
//  3. 去重：同一个 (user_id, date, hour) 只留最新一条
//     —— 见下文「为什么会有重复」，B 步骤不先做，C 步骤的唯一键建不上
//  4. 建新唯一键 uk_user_date_hour (user_id, date, hour)
//  5. 把「mood 0 = 不填」写进列注释
//  6. 校验并打印结果
//
// 新环境不需要跑本脚本：db/init.sql（或 manifest/sql/0001_init.sql）里
// 已经是新结构；AutoMigrate 也会兜底建列与建索引。
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"regexp"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gogf/gf/v2/frame/g"
)

// parseLink 拆出带库 DSN 与库名。
//
// ⚠️ 不要用 `^([^@]+)@\(([^)]+)\)/([^?]*)$` 那个正则（scripts/init_db.go 曾经用的）：
// 它只认 `user:pass@(host)/db`，而 GoFrame 配置里真实格式是
// `user:pass@tcp(host:port)/db?params` —— 中间多一层 `tcp(...)`，正则匹配不上，
// 于是「配置里明明有 link 却报无法解析」。这里按分隔符手工拆，兼容两种写法。
func parseLink(link string) (dsn, dbName string, err error) {
	s := strings.TrimSpace(link)
	at := strings.LastIndex(s, "@")
	if at < 0 {
		return "", "", fmt.Errorf("无法解析数据库 link（缺少 @）: %q", link)
	}
	creds, rest := s[:at], s[at+1:]
	open := strings.Index(rest, "(")
	closing := strings.Index(rest, ")")
	if open < 0 || closing < open {
		return "", "", fmt.Errorf("无法解析数据库 link（缺少 host:port）: %q", link)
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
	dsn = fmt.Sprintf("%s@%s(%s)/%s%s", creds, proto, addr, dbName, params)
	return dsn, dbName, nil
}

// columnExists 列是否存在
func columnExists(db *sql.DB, dbName, table, column string) (bool, error) {
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM information_schema.COLUMNS
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		dbName, table, column).Scan(&n)
	return n > 0, err
}

// indexExists 索引是否存在
func indexExists(db *sql.DB, dbName, table, index string) (bool, error) {
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM information_schema.STATISTICS
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
		dbName, table, index).Scan(&n)
	return n > 0, err
}

// tableExists 表是否存在
func tableExists(db *sql.DB, dbName, table string) (bool, error) {
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM information_schema.TABLES
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
		dbName, table).Scan(&n)
	return n > 0, err
}

func main() {
	log.SetFlags(0)

	// ---- 0. 取 DSN ----
	link := g.Cfg().MustGet(context.Background(), "database.default.link").String()
	if link == "" {
		log.Fatalf("❌ 配置 database.default.link 为空（cwd 下找不到 manifest/config/config.yaml？）")
	}
	dsn, dbName, err := parseLink(link)
	if err != nil {
		log.Fatalf("❌ %v", err)
	}
	hostRe := regexp.MustCompile(`^[^@]+@`)
	fmt.Printf("🔗 目标库: %s (db=%s)\n", hostRe.ReplaceAllString(dsn, "***@"), dbName)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("❌ 打开连接失败: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("❌ Ping 失败: %v", err)
	}
	fmt.Println("✅ MySQL 连接成功")

	const table = "mood_logs"

	ok, err := tableExists(db, dbName, table)
	if err != nil {
		log.Fatalf("❌ 查询表失败: %v", err)
	}
	if !ok {
		fmt.Printf("ℹ️  %s 不存在 —— 新库直接跑 db/init.sql（或 manifest/sql/0001_init.sql）即可，本脚本无事可做。\n", table)
		return
	}

	// ---- 1. 加 hour 列（存量行落到 12） ----
	has, err := columnExists(db, dbName, table, "hour")
	if err != nil {
		log.Fatalf("❌ 查询列失败: %v", err)
	}
	if has {
		fmt.Println("⏭️  列 hour 已存在，跳过")
	} else {
		fmt.Println("➕ 添加列 hour TINYINT NOT NULL DEFAULT 12（存量行 → 12:00）...")
		if _, err := db.Exec(
			"ALTER TABLE `" + table + "` ADD COLUMN `hour` TINYINT NOT NULL DEFAULT 12 " +
				"COMMENT '小时 0-23；12 = 经期日记槽位' AFTER `date`"); err != nil {
			log.Fatalf("❌ 添加 hour 列失败: %v", err)
		}
		fmt.Println("   ✅ 完成")
	}

	// ---- 2. 删旧唯一键 uk_user_date ----
	has, err = indexExists(db, dbName, table, "uk_user_date")
	if err != nil {
		log.Fatalf("❌ 查询索引失败: %v", err)
	}
	if has {
		fmt.Println("➖ 删除旧唯一键 uk_user_date ...")
		if _, err := db.Exec("ALTER TABLE `" + table + "` DROP INDEX `uk_user_date`"); err != nil {
			log.Fatalf("❌ 删除 uk_user_date 失败: %v", err)
		}
		fmt.Println("   ✅ 完成")
	} else {
		fmt.Println("⏭️  旧唯一键 uk_user_date 已不存在，跳过")
	}

	// ---- 3. 去重：同一个 (user_id, date, hour) 只留最新一条 ----
	//
	// 为什么会有重复：本环境的 mood_logs 是 GORM AutoMigrate 建的，而原模型
	// 只在 user_id 上挂了普通 `index`，**从来没有 UNIQUE(user_id,date)**。
	// 于是「一天一条」在库层面从未生效 —— 经期日记的 OnConflict(user_id,date)
	// 因为没有唯一键可撞，每次保存都退化成 INSERT，于是同一个 (user,date)
	// 堆出多条同样的记录。不先去重，唯一键建不上（Error 1062）。
	//
	// 保留策略：同组里 created_at 最新的一条（并列时 id 最大者）。这些重复行
	// 内容完全一致，删旧的等于删掉冗余的重复保存。
	var dupGroups int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM (SELECT 1 FROM ` + "`" + table + "`" + `
		  GROUP BY user_id, ` + "`date`" + `, hour HAVING COUNT(*) > 1) t`).Scan(&dupGroups); err != nil {
		log.Fatalf("❌ 统计重复组失败: %v", err)
	}
	if dupGroups > 0 {
		fmt.Printf("🧹 发现 %d 组重复 (user_id, date, hour)，保留每组最新一条 ...\n", dupGroups)
		res, err := db.Exec(
			"DELETE FROM `" + table + "` WHERE id IN (" +
				"  SELECT id FROM (" +
				"    SELECT id, ROW_NUMBER() OVER (" +
				"      PARTITION BY user_id, `date`, hour" +
				"      ORDER BY COALESCE(created_at, '1970-01-01 00:00:00') DESC, id DESC" +
				"    ) AS rn FROM `" + table + "`" +
				"  ) t WHERE t.rn > 1)")
		if err != nil {
			log.Fatalf("❌ 去重失败: %v", err)
		}
		n, _ := res.RowsAffected()
		fmt.Printf("   ✅ 删除 %d 条冗余行\n", n)
	} else {
		fmt.Println("⏭️  没有重复组，跳过去重")
	}

	// ---- 4. 建新唯一键 uk_user_date_hour ----
	has, err = indexExists(db, dbName, table, "uk_user_date_hour")
	if err != nil {
		log.Fatalf("❌ 查询索引失败: %v", err)
	}
	if has {
		fmt.Println("⏭️  唯一键 uk_user_date_hour 已存在，跳过")
	} else {
		fmt.Println("➕ 创建唯一键 uk_user_date_hour (user_id, date, hour) ...")
		if _, err := db.Exec(
			"ALTER TABLE `" + table + "` ADD UNIQUE KEY `uk_user_date_hour` (`user_id`, `date`, `hour`)"); err != nil {
			log.Fatalf("❌ 创建 uk_user_date_hour 失败: %v", err)
		}
		fmt.Println("   ✅ 完成")
	}

	// ---- 5. 备注列语义（0 = 不填）写进列注释，便于排查 ----
	if _, err := db.Exec("ALTER TABLE `" + table + "` MODIFY COLUMN `mood` TINYINT NOT NULL " +
		"COMMENT '心情 1-5；0 = 该小时不填（读取时按上一条延续）'"); err != nil {
		fmt.Printf("⚠️  更新 mood 列注释失败（不影响功能）: %v\n", err)
	}

	// ---- 6. 校验 ----
	fmt.Println("\n📊 校验：")
	var total, atDiary, badHour int
	_ = db.QueryRow("SELECT COUNT(*) FROM `" + table + "`").Scan(&total)
	_ = db.QueryRow("SELECT COUNT(*) FROM `" + table + "` WHERE `hour` = 12").Scan(&atDiary)
	_ = db.QueryRow("SELECT COUNT(*) FROM `" + table + "` WHERE `hour` < 0 OR `hour` > 23").Scan(&badHour)
	fmt.Printf("   总行数 %d；hour = 12 的行 %d；越界 hour %d\n", total, atDiary, badHour)

	// 用 information_schema 读索引（比 SHOW INDEX 的列数在不同 MySQL 版本间更稳）
	idxRows, err := db.Query(
		`SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.STATISTICS
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		  ORDER BY INDEX_NAME, SEQ_IN_INDEX`, dbName, table)
	if err == nil {
		names := map[string]bool{}
		cols := map[string][]string{}
		for idxRows.Next() {
			var keyName, colName string
			if err := idxRows.Scan(&keyName, &colName); err != nil {
				continue
			}
			names[keyName] = true
			cols[keyName] = append(cols[keyName], colName)
		}
		idxRows.Close()
		for _, k := range []string{"PRIMARY", "uk_user_date_hour"} {
			if names[k] {
				fmt.Printf("   ✅ 索引 %s (%s)\n", k, strings.Join(cols[k], ", "))
			} else {
				fmt.Printf("   ⚠️  索引 %s 缺失\n", k)
			}
		}
		// idx_user_date 只是历史遗留的普通索引；新唯一键的最左前缀就是
		// (user_id, date)，它已经冗余，缺了也不算问题 —— 所以不做告警。
		if names["idx_user_date"] {
			fmt.Printf("   ℹ️  idx_user_date (%s) 仍存在，已被唯一键最左前缀覆盖（冗余但无害）\n",
				strings.Join(cols["idx_user_date"], ", "))
		}
		if names["uk_user_date"] {
			fmt.Println("   ⚠️  旧唯一键 uk_user_date 仍然存在（不该留着，一天多条会被它挡死）")
		}
	}

	fmt.Println("\n🎉 mood_logs 小时制迁移完成。")
}
