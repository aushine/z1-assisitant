package utility

import (
	"strings"
	"testing"
)

// 断言：一级 12 支出 + 8 收入、id 唯一、二级 parent 可解析、
// 一级 name/emoji/icon 非空、二级只填 name + icon（icon 非空，emoji/tint 仍继承父级）
// （见 03 §5 / §9.4 / 07「260921 后续改动清单」第 7 项）。
func TestFinanceCategorySeeds(t *testing.T) {
	seeds := FinanceCategorySeeds()

	if len(seeds) != 105 {
		t.Fatalf("种子总数应为 105（20 一级 + 85 二级），实际 %d", len(seeds))
	}

	primaries := make(map[string]FinanceCategorySeed) // id → 一级
	secondary := make([]FinanceCategorySeed, 0, 85)

	seenID := make(map[string]bool, len(seeds))
	for _, s := range seeds {
		if s.ID == "" {
			t.Fatal("种子 id 不能为空")
		}
		if seenID[s.ID] {
			t.Fatalf("种子 id 重复：%s", s.ID)
		}
		seenID[s.ID] = true

		if s.Scope != FinanceScopeExpense && s.Scope != FinanceScopeIncome {
			t.Fatalf("种子 %s 的 scope 非法：%q", s.ID, s.Scope)
		}
		if s.Name == "" {
			t.Fatalf("种子 %s 的 name 为空", s.ID)
		}

		if s.ParentID == RootCategoryParent {
			if s.FullName != s.Name {
				t.Fatalf("一级 %s 的 full_name 应等于 name，实际 %q", s.ID, s.FullName)
			}
			if s.Emoji == "" || s.Icon == "" {
				t.Fatalf("一级 %s 的 emoji/icon 不能为空（emoji=%q icon=%q）", s.ID, s.Emoji, s.Icon)
			}
			if s.Sort <= 0 {
				t.Fatalf("一级 %s 的 sort 应为正数，实际 %d", s.ID, s.Sort)
			}
			primaries[s.ID] = s
			continue
		}

		// 二级：填 name + icon（+ 父 id / 从父级继承的 scope / 拼好的 full_name）
		if !strings.HasPrefix(s.ID, s.ParentID+"_") {
			t.Fatalf("二级 %s 的 id 应以父 id %s + \"_\" 开头", s.ID, s.ParentID)
		}
		// 260921 二轮：内置二级必须逐个配好 icon，防回归（03 §5 / 07 第 7 项）
		if s.Icon == "" {
			t.Fatalf("二级 %s 的 icon 不能为空（内置二级须逐个配图标，见 03 §5）", s.ID)
		}
		// emoji / tint 仍留空，渲染时继承父级（03 §5：老大只要求图标独立）
		if s.Emoji != "" || s.Tint != "" {
			t.Fatalf("二级 %s 不应带 emoji/tint（应继承父级；icon 已带，见 03 §5）", s.ID)
		}
		secondary = append(secondary, s)
	}

	// 一级数量：12 支出 + 8 收入
	expensePrimaries, incomePrimaries := 0, 0
	for _, p := range primaries {
		switch p.Scope {
		case FinanceScopeExpense:
			expensePrimaries++
		case FinanceScopeIncome:
			incomePrimaries++
		}
	}
	if expensePrimaries != 12 || incomePrimaries != 8 {
		t.Fatalf("一级数量应为 12 支出 + 8 收入，实际 %d 支出 + %d 收入", expensePrimaries, incomePrimaries)
	}
	if len(secondary) != 85 {
		t.Fatalf("二级数量应为 85，实际 %d", len(secondary))
	}

	// 二级的 parent_id 都能在一级里解析，scope 与 full_name 一致
	for _, s := range secondary {
		parent, ok := primaries[s.ParentID]
		if !ok {
			t.Fatalf("二级 %s 的 parent_id %s 在种子一级里找不到", s.ID, s.ParentID)
		}
		if s.Scope != parent.Scope {
			t.Fatalf("二级 %s 的 scope(%s) 与父级 %s(%s) 不一致", s.ID, s.Scope, parent.ID, parent.Scope)
		}
		if want := parent.Name + "-" + s.Name; s.FullName != want {
			t.Fatalf("二级 %s 的 full_name 应为 %q，实际 %q", s.ID, want, s.FullName)
		}
	}

	// (scope, parent_id, name) 必须唯一 —— 与唯一索引
	// uk_fin_cat_user_scope_parent_name 口径一致，否则同一用户播种时会撞唯一键
	key := make(map[string]string, len(seeds))
	for _, s := range seeds {
		k := s.Scope + "\x00" + s.ParentID + "\x00" + s.Name
		if prev, ok := key[k]; ok {
			t.Fatalf("(scope, parent, name) 重复：%s 与 %s 同为 %s/%s/%s", prev, s.ID, s.Scope, s.ParentID, s.Name)
		}
		key[k] = s.ID
	}

	// 现有 12 个分类的名字必须原样保留（03 §1 硬约束①）
	legacy := []string{"餐饮", "交通", "购物", "娱乐", "居住", "医疗", "学习", "其他",
		"工资", "兼职", "投资"}
	for _, name := range legacy {
		found := false
		for _, p := range primaries {
			if p.Name == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("现有分类名 %q 在种子里缺失（改名会破坏历史数据映射）", name)
		}
	}
}

// 断言 id 前缀规则：二级 id = 父 id + "_NN"
func TestFinanceCategorySeedIDs(t *testing.T) {
	for _, s := range FinanceCategorySeeds() {
		if s.ParentID == RootCategoryParent {
			if !strings.HasPrefix(s.ID, "fc_b_") {
				t.Fatalf("内置一级 id 应以 fc_b_ 开头，实际 %s", s.ID)
			}
			continue
		}
		if !strings.HasPrefix(s.ID, "fc_b_") {
			t.Fatalf("内置二级 id 应以 fc_b_ 开头，实际 %s", s.ID)
		}
	}
}

// SeedVersion 必须为正（02 §4.3 预留增量补种的判断位）
func TestFinanceCategorySeedVersion(t *testing.T) {
	if FinanceCategorySeedVersion <= 0 {
		t.Fatalf("FinanceCategorySeedVersion 应为正数，实际 %d", FinanceCategorySeedVersion)
	}
}
