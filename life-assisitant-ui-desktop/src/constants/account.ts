/**
 * 账户类型注册表（前端常量）
 *
 * 依据：md/spec-20260922-v1/01 §3（L2 类型注册表，唯一真源）
 *
 * ⚠️ SYNC 契约（逐字一致，SHA256 校验，同 v1 的 health.ts 做法）：
 *   1. life-assisitant-ui-mobile/src/constants/account.ts   ← 本文件
 *   2. life-assisitant-ui-desktop/src/constants/account.ts
 *   3. life-assisitant-api/internal/utility/account_vocab.go（后端同源，Phase 1）
 *
 * 图标引用三态（D22）：`brand:<slug>` | `lucide:<Name>` | emoji（存量兼容）
 * `brand:` slug = public/brand-logos/ 下文件名（⚠️ 微信是 weixin，不是 wechat）
 */
export type AccountCategory = 'asset' | 'credit' | 'investment'

export type AccountType =
  // ① 资金账户
  | 'cash' | 'saving' | 'alipay' | 'wechat' | 'yuebao' | 'prepaid' | 'ewallet' | 'other_asset'
  // ② 信用账户
  | 'credit' | 'huabei' | 'baitiao' | 'loan' | 'other_credit'
  // ③ 理财账户
  | 'fund' | 'stock' | 'deposit' | 'gold' | 'other_investment'

export interface AccountTypeDef {
  value: AccountType
  label: string
  category: AccountCategory
  /** 默认图标（D22）：`brand:<slug>` | `lucide:<Name>` | emoji（存量兼容） */
  icon: string
  needsInstitution: boolean
  /** 余额输入提示（信用类提示欠款填负数） */
  balanceHint?: string
}

/** 银行 logo 展示开关（版权争议兜底，01 §9.3 Q1；false 时全部降级文字徽标） */
export const SHOW_BANK_LOGOS = true

/**
 * L2 类型注册表（18 项，01 §3.2 表逐行照抄）。
 * ★ = 保留的 4 个旧 value（D3，一字不改，存量数据零迁移）：saving / credit / huabei / wechat
 */
export const ACCOUNT_TYPES: readonly AccountTypeDef[] = [
  // ① 资金账户（asset）
  { value: 'cash', label: '现金钱包', category: 'asset', icon: 'lucide:Banknote', needsInstitution: false },
  { value: 'saving', label: '储蓄卡', category: 'asset', icon: 'lucide:Landmark', needsInstitution: true }, // ★ 选了银行换 brand:<行>
  { value: 'alipay', label: '支付宝', category: 'asset', icon: 'brand:alipay', needsInstitution: false },
  // ★ label 从「微信零钱」改为「微信钱包」，value 不动（存储契约）；slug 是 weixin 不是 wechat
  { value: 'wechat', label: '微信钱包', category: 'asset', icon: 'brand:weixin', needsInstitution: false },
  { value: 'yuebao', label: '余额宝', category: 'asset', icon: 'brand:yuebao', needsInstitution: false },
  { value: 'prepaid', label: '储值卡', category: 'asset', icon: 'lucide:WalletCards', needsInstitution: false },
  { value: 'ewallet', label: '其他电子钱包', category: 'asset', icon: 'lucide:Smartphone', needsInstitution: false },
  { value: 'other_asset', label: '其他', category: 'asset', icon: 'lucide:Wallet', needsInstitution: false },
  // ② 信用账户（credit）—— 余额语义：负数 = 欠款（D14，01 §5.1）
  { value: 'credit', label: '信用卡', category: 'credit', icon: 'lucide:CreditCard', needsInstitution: true, balanceHint: '填已用额度（欠款填负数）' }, // ★ 选了银行换 brand:<行>
  { value: 'huabei', label: '蚂蚁花呗', category: 'credit', icon: 'brand:huabei', needsInstitution: false, balanceHint: '填已用额度（欠款填负数）' },
  { value: 'baitiao', label: '京东白条', category: 'credit', icon: 'brand:baitiao', needsInstitution: false, balanceHint: '填已用额度（欠款填负数）' },
  // Q6 拍板：贷款机构可选 —— needsInstitution=true 但前端按 optional 处理（银行行出现、不强制选）
  { value: 'loan', label: '贷款', category: 'credit', icon: 'lucide:Landmark', needsInstitution: true, balanceHint: '填未还本金' },
  { value: 'other_credit', label: '其他信用', category: 'credit', icon: 'lucide:BadgeDollarSign', needsInstitution: false },
  // ③ 理财账户（investment）
  { value: 'fund', label: '基金', category: 'investment', icon: 'lucide:LineChart', needsInstitution: false },
  { value: 'stock', label: '股票', category: 'investment', icon: 'lucide:CandlestickChart', needsInstitution: false },
  // 机构可选（01 §3.2 表「○ 可选」）：同贷款，前端按 optional 处理
  { value: 'deposit', label: '银行理财', category: 'investment', icon: 'lucide:PiggyBank', needsInstitution: true },
  { value: 'gold', label: '黄金', category: 'investment', icon: 'lucide:Gem', needsInstitution: false },
  { value: 'other_investment', label: '其他投资', category: 'investment', icon: 'lucide:Coins', needsInstitution: false },
]

export interface AccountCategoryDef {
  key: AccountCategory
  label: string
}

/** L1 大类（3 个，固定；01 §2.1。L1 不落库，由 L2 的 category 派生，D2） */
export const ACCOUNT_CATEGORIES: readonly AccountCategoryDef[] = [
  { key: 'asset', label: '资金账户' },
  { key: 'credit', label: '信用账户' },
  { key: 'investment', label: '理财账户' },
]

/** L1 大类派生（D2：映射表封闭穷举，派生 100% 可靠） */
export function accountCategoryOf(type: AccountType): AccountCategory {
  return accountTypeDefOf(type)?.category ?? 'asset'
}

/** 按 value 查类型定义 */
export function accountTypeDefOf(type: AccountType): AccountTypeDef | undefined {
  return ACCOUNT_TYPES.find((t) => t.value === type)
}
