// 一次性幂等重算脚本：health_days.weight_kg 从「取最后一次」改为「取最早一次」后的历史回填
//
// 背景（老大拍板 260920）：weight 日汇总口径与 bbt 统一为晨起口径，
// recomputeDaySummaryTx 已改为取最早一次（见 internal/service/impl/health_event.go）。
// 口径变更只影响 health_days.weight_kg（月份汇总 weight_avg 是读时从 health_days 算的，
// 无需单独回填）；本脚本按 health_events 明细把存量行重算一遍。
//
// 幂等性：以「最早一次体重事件的值（四舍五入 2 位）与 weight_kg 是否一致」为判据，
// 一致的行不更新 —— 重复执行第二轮必然报告 0 行受影响。
//
// 用法（cwd = life-assisitant-api）：
//
//	go run ./scripts/weightrecompute
package main

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/gogf/gf/v2/frame/g"
)

func main() {
	link := g.Cfg().MustGet(nil, "database.default.link").String()
	if link == "" {
		log.Fatal("配置 database.default.link 为空（cwd 下找不到 manifest/config/config.yaml？）")
	}
	// 与 scripts/init_db.go 同源的 DSN：weight 值都是 DECIMAL，parseTime 只为扫 date 列
	db, err := sql.Open("mysql", link+"&multiStatements=true")
	if err != nil {
		log.Fatalf("打开连接失败: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("连接失败: %v", err)
	}

	// 1) 最早一次体重事件（按 user_id, date, time_of_day ASC, id ASC 取第一条）
	rows, err := db.Query(`
		SELECT user_id, DATE_FORMAT(date, '%Y-%m-%d') AS d, value_num
		FROM health_events
		WHERE metric_key = 'weight' AND value_num IS NOT NULL
		ORDER BY user_id, date, time_of_day, id`)
	if err != nil {
		log.Fatalf("查询体重事件失败: %v", err)
	}
	type key struct{ user, date string }
	first := map[key]float64{}
	for rows.Next() {
		var u, d string
		var v float64
		if err := rows.Scan(&u, &d, &v); err != nil {
			log.Fatalf("扫描事件失败: %v", err)
		}
		k := key{u, d}
		if _, ok := first[k]; !ok { // 已按序排列 → 首条即最早
			first[k] = math.Round(v*100) / 100
		}
	}
	rows.Close()
	fmt.Printf("有体重事件的 (user, date) 组合数: %d\n", len(first))
	if len(first) == 0 {
		fmt.Println("无需重算。")
		return
	}

	// 2) 逐行比对 health_days.weight_kg，只更新不一致的行（幂等判据）
	var updated, missing, matched int
	for k, want := range first {
		var cur sql.NullFloat64
		err := db.QueryRow(`SELECT weight_kg FROM health_days WHERE user_id = ? AND date = ?`, k.user, k.date).
			Scan(&cur)
		switch {
		case err == sql.ErrNoRows:
			// 该天有体重事件但没有 health_days 行（不该发生，正常写入路径会建行）
			missing++
			fmt.Printf("⚠️ 缺行: user=%s date=%s want=%.2f（仅报告，不代建，避免误造半空行）\n", k.user, k.date, want)
			continue
		case err != nil:
			log.Fatalf("查询 health_days 失败: %v", err)
		}
		if cur.Valid && math.Round(cur.Float64*100) == math.Round(want*100) {
			matched++
			continue // 已是正确值 → 幂等跳过
		}
		res, err := db.Exec(`UPDATE health_days SET weight_kg = ?, updated_at = ? WHERE user_id = ? AND date = ?`,
			want, time.Now().Format("2006-01-02 15:04:05"), k.user, k.date)
		if err != nil {
			log.Fatalf("更新失败 (user=%s date=%s): %v", k.user, k.date, err)
		}
		n, _ := res.RowsAffected()
		updated += int(n)
	}

	// 3) 存量体检：health_days 里 weight_kg 非空但没有任何体重事件的老行（260919 迁移前数据）
	var legacy int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM health_days hd
		WHERE hd.weight_kg IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM health_events he
			WHERE he.user_id = hd.user_id AND he.date = hd.date AND he.metric_key = 'weight')`).
		Scan(&legacy); err != nil {
		log.Fatalf("统计遗留行失败: %v", err)
	}

	fmt.Println("──── 重算报告 ────")
	fmt.Printf("体重事件组合总数: %d\n", len(first))
	fmt.Printf("已是正确值（跳过）: %d\n", matched)
	fmt.Printf("实际更新行数:      %d\n", updated)
	fmt.Printf("缺 health_days 行: %d（仅报告）\n", missing)
	fmt.Printf("无事件遗留老行:    %d（260919 前数据，weight_kg 保留不动）\n", legacy)
}
