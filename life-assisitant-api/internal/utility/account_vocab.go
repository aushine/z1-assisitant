// Package utility 账户 L2 类型注册表（md/spec-20260922-v1/01 §3.2）
//
// ⚠️ 本文件是后端侧**唯一真源**，必须与下列两份前端注册表**语义逐字一致**
// （value / label / category 三字段逐字对照；★ 4 个旧值 saving/credit/huabei/wechat 一字不改，D3）：
//
//	life-assisitant-ui-mobile/src/constants/account.ts
//	life-assisitant-ui-desktop/src/constants/account.ts
//
// 用途：
//   - CreateAccount / UpdateAccount 的 type 白名单校验（D21，非法 → 400001）
//   - GetBalanceSummary 按 L1 大类归并净资产（01 §5.2）
//   - 余额不足拦截按 category 放行 credit 类（01 §8.3.1，D24）
//
// ⚠️ L1 大类不落库，由 L2 派生（D2）——不新增 category 列。
package utility

// 账户 L1 大类（由 L2 类型派生）
const (
	AccountCategoryAsset      = "asset"      // 资金账户：正数 = 余额（负数 = 透支）
	AccountCategoryCredit     = "credit"     // 信用账户：负数 = 欠款（D14 直接存负）
	AccountCategoryInvestment = "investment" // 理财账户：正数 = 市值
)

// AccountTypeDef 账户 L2 类型定义（与前端 AccountTypeDef 接口对应）
type AccountTypeDef struct {
	// Value 存储契约（落库 accounts.type）
	Value string
	// Label 中文名（UI 展示；wechat 由「微信零钱」改为「微信钱包」，value 不动）
	Label string
	// Category 所属 L1 大类：asset / credit / investment
	Category string
	// NeedsInstitution 是否关联机构（银行）行：
	// true = 储蓄卡/信用卡（必选）与贷款/银行理财（可选，Q6 / 01 §3.2 ○ 可选）；
	// 是否「可选」由前端按类型区分，后端不消费本字段（institution 不校验白名单，D20）
	NeedsInstitution bool
}

// AccountTypes 类型注册表（18 项，顺序 = 01 §3.2 表序）
var AccountTypes = []AccountTypeDef{
	// ① 资金账户 asset
	{Value: "cash", Label: "现金钱包", Category: AccountCategoryAsset},
	{Value: "saving", Label: "储蓄卡", Category: AccountCategoryAsset, NeedsInstitution: true}, // ★ 旧值
	{Value: "alipay", Label: "支付宝", Category: AccountCategoryAsset},
	{Value: "wechat", Label: "微信钱包", Category: AccountCategoryAsset}, // ★ 旧值（label 改词，value 不动）
	{Value: "yuebao", Label: "余额宝", Category: AccountCategoryAsset},
	{Value: "prepaid", Label: "储值卡", Category: AccountCategoryAsset},
	{Value: "ewallet", Label: "其他电子钱包", Category: AccountCategoryAsset},
	{Value: "other_asset", Label: "其他", Category: AccountCategoryAsset},
	// ② 信用账户 credit
	{Value: "credit", Label: "信用卡", Category: AccountCategoryCredit, NeedsInstitution: true}, // ★ 旧值
	{Value: "huabei", Label: "蚂蚁花呗", Category: AccountCategoryCredit},                        // ★ 旧值
	{Value: "baitiao", Label: "京东白条", Category: AccountCategoryCredit},
	{Value: "loan", Label: "贷款", Category: AccountCategoryCredit, NeedsInstitution: true}, // 机构可选（Q6）
	{Value: "other_credit", Label: "其他信用", Category: AccountCategoryCredit},
	// ③ 理财账户 investment
	{Value: "fund", Label: "基金", Category: AccountCategoryInvestment},
	{Value: "stock", Label: "股票", Category: AccountCategoryInvestment},
	{Value: "deposit", Label: "银行理财", Category: AccountCategoryInvestment}, // 机构可选（01 §3.2 ○）
	{Value: "gold", Label: "黄金", Category: AccountCategoryInvestment},
	{Value: "other_investment", Label: "其他投资", Category: AccountCategoryInvestment},
}

// accountTypeIndex 按 value 建索引（包初始化时构建，避免每次线性扫描）
var accountTypeIndex = func() map[string]AccountTypeDef {
	m := make(map[string]AccountTypeDef, len(AccountTypes))
	for _, v := range AccountTypes {
		m[v.Value] = v
	}
	return m
}()

// IsValidAccountType type 是否在 18 类型白名单内（D21）
func IsValidAccountType(t string) bool {
	_, ok := accountTypeIndex[t]
	return ok
}

// AccountCategoryOf 返回类型的 L1 大类；未知类型返回 ""
// （调用方需先用 IsValidAccountType 拦截，未知类型不应落库）
func AccountCategoryOf(t string) string {
	return accountTypeIndex[t].Category
}
