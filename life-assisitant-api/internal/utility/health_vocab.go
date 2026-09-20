// Package utility 健康模块指标注册表（md/spec-20260919-v1/02 §2）
//
// ⚠️ 本文件是**唯一真源**，必须与下列两份文件**逐字一致**：
//
//	life-assisitant-ui-mobile/src/constants/health.ts
//	life-assisitant-ui-desktop/src/constants/health.ts
//
// 沿用经期模块已建立的约定：症状 / 分泌物的词库由 period_vocab.go 提供，
// 健康模块直接引用，**不复制一份**。
//
// 验证手段（两端与后端三份文件）：
//
//	Get-FileHash life-assisitant-ui-mobile/src/constants/health.ts
//	Get-FileHash life-assisitant-ui-desktop/src/constants/health.ts
//
// 两份 SHA256 必须相等；本文件的 Key / Name / Group / Order / DefaultOn / DependsOn
// 逐字段对照。
package utility

// HealthMetric 一项健康指标的定义
type HealthMetric struct {
	// Key 指标唯一标识（落库在 health_settings.metrics_enabled 里）
	Key string
	// Name 中文名（UI 展示）
	Name string
	// Group 维度：cycle 周期 / subjective 主观 / objective 客观 / privacy 隐私
	// 决定卡片左侧 3px 色条的取色（03 §2 的「维度色」）
	Group string
	// Order 卡片展示顺序（03 §2 固定顺序）。
	// ⚠️ 顺序考虑的是**填写动线**：今天发生的事实 → 身体感受 → 测量值 → 其他。
	//    不要按字母或用户配置顺序排。
	Order int
	// DefaultOn 是否默认启用（首次进入的默认值）
	DefaultOn bool
	// DependsOn 依赖的指标 key；为空表示无依赖。
	// ⚠️ 依赖未启用时本项**自动隐藏**，但**数据保留**（永不删数据）
	DependsOn string
	// Daily 「预期每天都有」的指标（02 §14.5）。
	// true = 饮水 / 体重 / 体温 / 睡眠 / 心情；false = 排便 / 症状 / 性生活 / 分泌物 / 备注 / 经期（周期性）。
	// ⚠️ 由它同时驱动「今日完成度分母」与 §14.2 的分型；本字段必须与两端前端
	//     constants/health.ts 逐字一致（见各指标行的取值）。
	Daily bool
}

// 维度分组
const (
	MetricGroupCycle      = "cycle"      // 周期
	MetricGroupSubjective = "subjective" // 主观
	MetricGroupObjective  = "objective"  // 客观
	MetricGroupPrivacy    = "privacy"    // 隐私
)

// HealthMetrics 指标注册表（11 项，按 Order 升序）
//
// ⚠️ 指标是**有限且已知**的集合（不会天天加），所以数据库用宽表（health_days）
// 而不是 EAV —— 见 04 §2 的决策。加指标要走 DDL，这是刻意的。
var HealthMetrics = []HealthMetric{
	{Key: "period", Name: "经期", Group: MetricGroupCycle, Order: 1, DefaultOn: true, Daily: false},
	{Key: "symptoms", Name: "症状", Group: MetricGroupSubjective, Order: 2, DefaultOn: true, Daily: false},
	{Key: "mood", Name: "心情", Group: MetricGroupSubjective, Order: 3, DefaultOn: true, Daily: true},
	{Key: "energy_sleep", Name: "精力 · 睡眠", Group: MetricGroupSubjective, Order: 4, DefaultOn: true, Daily: true},
	{Key: "bbt", Name: "基础体温", Group: MetricGroupObjective, Order: 5, DefaultOn: true, Daily: true},
	{Key: "weight", Name: "体重", Group: MetricGroupObjective, Order: 6, DefaultOn: true, Daily: true},
	{Key: "water", Name: "饮水", Group: MetricGroupObjective, Order: 7, DefaultOn: true, Daily: true},
	{Key: "bowel", Name: "排便", Group: MetricGroupObjective, Order: 8, DefaultOn: true, Daily: false},
	{Key: "discharge", Name: "分泌物", Group: MetricGroupCycle, Order: 9, DefaultOn: true, DependsOn: "period", Daily: false},
	// 性生活**默认关**：它是最私密的一项，不替用户做默认开启的决定
	{Key: "sex", Name: "性生活", Group: MetricGroupPrivacy, Order: 10, DefaultOn: false, Daily: false},
	{Key: "note", Name: "备注", Group: MetricGroupSubjective, Order: 11, DefaultOn: true, Daily: false},
}

// metricIndex 按 key 建索引（包初始化时构建，避免每次线性扫描）
var metricIndex = func() map[string]HealthMetric {
	m := make(map[string]HealthMetric, len(HealthMetrics))
	for _, v := range HealthMetrics {
		m[v.Key] = v
	}
	return m
}()

// DefaultEnabledMetrics 默认启用的指标 key 集合（02 §2 的「默认」列）
func DefaultEnabledMetrics() []string {
	out := make([]string, 0, len(HealthMetrics))
	for _, m := range HealthMetrics {
		if m.DefaultOn {
			out = append(out, m.Key)
		}
	}
	return out
}

// IsKnownMetric 是否为注册表中的已知指标
func IsKnownMetric(key string) bool {
	_, ok := metricIndex[key]
	return ok
}

// GetHealthMetric 取指标定义；未知 key 返回零值与 false
func GetHealthMetric(key string) (HealthMetric, bool) {
	m, ok := metricIndex[key]
	return m, ok
}

// NormalizeMetrics 规范化用户提交的指标列表：
//  1. 丢弃未知 key（前端版本不一致时不至于整单失败，调用方应记 warn 日志）
//  2. 丢弃依赖未满足的项（如只传 discharge 而未启用 period）
//  3. 按注册表 Order 排序，保证浮层卡片顺序稳定
//
// ⚠️ 空数组是合法结果（全部关闭）→ UI 走「去配置」引导态，**不是空白**。
func NormalizeMetrics(keys []string) []string {
	enabled := make(map[string]bool, len(keys))
	for _, k := range keys {
		if IsKnownMetric(k) {
			enabled[k] = true
		}
	}

	out := make([]string, 0, len(HealthMetrics))
	for _, m := range HealthMetrics {
		if !enabled[m.Key] {
			continue
		}
		// 依赖未启用 → 该项不生效
		if m.DependsOn != "" && !enabled[m.DependsOn] {
			continue
		}
		out = append(out, m.Key)
	}
	return out
}

// MetricsOrDefault nil（从未配置）→ 返回默认集合；非 nil（含空数组）→ 规范化后返回
//
// 区分「null」与「[]」很重要：null = 从未配置走默认值；[] = 用户主动全关。
func MetricsOrDefault(keys []string) []string {
	if keys == nil {
		return DefaultEnabledMetrics()
	}
	return NormalizeMetrics(keys)
}
