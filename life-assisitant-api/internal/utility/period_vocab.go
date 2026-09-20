// Package utility 经期词库（症状 31 项 / 5 组）
//
// ⚠️ 同步契约：词库的「唯一真源」是前端常量文件
//
//	life-assisitant-ui-mobile/src/constants/period.ts
//	life-assisitant-ui-desktop/src/constants/period.ts（两份逐字一致，key 与中文照抄 02 §4）
//
// 后端保存这一份**只用于两件事**：
//  1. 写入时校验 symptoms[]（未知 key 静默丢弃并记 warn，避免前端版本不同步导致整单失败）；
//  2. 预测 / 报告响应里回填中文 label（前端不必为此再查一次词库）。
//
// 因此：**改 key 或中文必须三处同改**（02 §4.1 表格 → 两端 constants → 本文件）。
package utility

// PeriodSymptomGroup 症状分组（保持 02 §4.1 的声明顺序，前端渲染顺序一致）
type PeriodSymptomGroup struct {
	Key   string // PAIN / DIGEST / SKIN / CIRCULATION / OTHER
	Label string // 疼痛 / 消化 / 皮肤毛发 / 循环体温 / 其他
	Items []PeriodSymptom
}

// PeriodSymptom 单个症状
type PeriodSymptom struct {
	Key   string
	Label string
}

// periodSymptomGroups 31 项症状词库
var periodSymptomGroups = []PeriodSymptomGroup{
	{Key: "PAIN", Label: "疼痛", Items: []PeriodSymptom{
		{Key: "headache", Label: "头痛"},
		{Key: "migraine", Label: "偏头痛"},
		{Key: "cramps", Label: "痛经/腹痛"},
		{Key: "backache", Label: "腰酸背痛"},
		{Key: "breast_tender", Label: "乳房胀痛"},
		{Key: "joint_pain", Label: "关节痛"},
		{Key: "muscle_ache", Label: "肌肉酸痛"},
	}},
	{Key: "DIGEST", Label: "消化", Items: []PeriodSymptom{
		{Key: "bloating", Label: "腹胀"},
		{Key: "constipation", Label: "便秘"},
		{Key: "diarrhea", Label: "腹泻"},
		{Key: "nausea", Label: "恶心"},
		{Key: "appetite_up", Label: "食欲增加"},
		{Key: "appetite_down", Label: "食欲不振"},
		{Key: "cravings", Label: "渴望甜食"},
		{Key: "indigestion", Label: "消化不良"},
	}},
	{Key: "SKIN", Label: "皮肤毛发", Items: []PeriodSymptom{
		{Key: "acne", Label: "痤疮"},
		{Key: "hair_loss", Label: "掉发"},
		{Key: "oily_skin", Label: "皮肤油腻"},
		{Key: "dry_skin", Label: "皮肤干燥"},
	}},
	{Key: "CIRCULATION", Label: "循环体温", Items: []PeriodSymptom{
		{Key: "hot_flash", Label: "潮热"},
		{Key: "night_sweat", Label: "盗汗"},
		{Key: "cold_limbs", Label: "手脚冰凉"},
		{Key: "dizziness", Label: "头晕"},
		{Key: "palpitations", Label: "心悸"},
	}},
	{Key: "OTHER", Label: "其他", Items: []PeriodSymptom{
		{Key: "incontinence", Label: "膀胱失禁"},
		{Key: "frequent_urination", Label: "尿频"},
		{Key: "edema", Label: "水肿"},
		{Key: "insomnia", Label: "失眠"},
		{Key: "fatigue", Label: "疲劳"},
		{Key: "drowsiness", Label: "嗜睡"},
		{Key: "low_focus", Label: "注意力不集中"},
	}},
}

// periodSymptomLabels key → 中文（由 periodSymptomGroups 派生，避免两份数据不同步）
var periodSymptomLabels = func() map[string]string {
	m := make(map[string]string, 31)
	for _, g := range periodSymptomGroups {
		for _, it := range g.Items {
			m[it.Key] = it.Label
		}
	}
	return m
}()

// PeriodSymptomGroups 返回症状分组（顺序即渲染顺序）
func PeriodSymptomGroups() []PeriodSymptomGroup { return periodSymptomGroups }

// PeriodSymptomLabel key → 中文；未知名返回 key 本身（不返回空，避免前端显示空白）
func PeriodSymptomLabel(key string) string {
	if v, ok := periodSymptomLabels[key]; ok {
		return v
	}
	return key
}

// PeriodSymptomValid 是否是词库内的合法 key
func PeriodSymptomValid(key string) bool {
	_, ok := periodSymptomLabels[key]
	return ok
}

// PeriodSymptomCount 词库规模（供测试断言 31）
func PeriodSymptomCount() int { return len(periodSymptomLabels) }

// periodDefaultRecentSymptoms 02 §4.4：近期症状不足 6 个时的补足顺序
var periodDefaultRecentSymptoms = []string{
	"cramps", "bloating", "breast_tender", "fatigue", "headache", "appetite_down",
}

// PeriodDefaultRecentSymptoms 默认「近期症状」补足顺序（返回副本，调用方可改）
func PeriodDefaultRecentSymptoms() []string {
	out := make([]string, len(periodDefaultRecentSymptoms))
	copy(out, periodDefaultRecentSymptoms)
	return out
}

// Discharge 文案（02 §4.2）。前端持有渲染用的完整文案，这里只给短名，
// 供报告页 / 导出等后端侧文案使用。
var periodDischargeLabels = map[int]string{
	1: "干燥",
	2: "粘稠",
	3: "乳白",
	4: "水样",
	5: "蛋清拉丝",
}

// PeriodDischargeLabel 分泌物档位 → 中文；0 或未知名返回「未记录」
func PeriodDischargeLabel(v int) string {
	if s, ok := periodDischargeLabels[v]; ok {
		return s
	}
	return "未记录"
}
