/**
 * Emoji → Lucide 图标映射（02 §6.2）。
 *
 * 后端仍存 emoji 字符串，渲染层在此映射为 Lucide 图标 + 语义色。
 * 这是分类图标的唯一字典（02 §8.4 的合并目标）。
 *
 * 语义色从 ~20 组 bg/fg 收敛为 6 组 tint（02 §5.2），
 * 同时修正了多处语义错误的映射（如 💧 喝水从 Flag → Droplet、🔥 连续天数从 Activity → Flame）。
 *
 * `bg` / `fg` 为兼容字段（旧调用方直接读它们），由 tint 派生为 CSS 变量字符串，
 * 新代码应优先使用 `tint`。
 */
import {
  TINT_VARS,
  Briefcase,
  BookOpen,
  Home,
  Dumbbell,
  Users,
  Pin,
  ListChecks,
  Flame,
  Banknote,
  Landmark,
  Zap,
  BarChart3,
  User,
  CreditCard,
  Utensils,
  Route,
  ShoppingBag,
  Video,
  HeartPulse,
  Package,
  RefreshCw,
  TrendingUp,
  Droplet,
  Footprints,
  Sparkles,
  Apple,
  Moon,
  Coffee,
  Target,
  PenLine,
  Bike,
  Palette,
  Music,
  Brush,
  Sprout,
  Wallet,
  MessageCircle,
  Sun,
  Lock,
  Compass,
  Crown,
  Pencil,
  Eye,
  Key,
  Smartphone,
  PlusCircle,
  Gem,
  Trophy,
  HelpCircle,
} from '@/components/icon'
import type { LucideIcon, TintName } from '@/components/icon'

export interface IconMapping {
  icon: LucideIcon
  tint: TintName
  /** 兼容字段：tint 派生的背景色（CSS 变量字符串） */
  bg: string
  /** 兼容字段：tint 派生的前景色（CSS 变量字符串） */
  fg: string
}

function mapping(icon: LucideIcon, tint: TintName): IconMapping {
  const tv = TINT_VARS[tint]
  return { icon, tint, bg: tv.bg, fg: tv.fg }
}

export const EMOJI_ICON_MAP: Record<string, IconMapping> = {
  // ---- 任务分类（6）----
  '💼': mapping(Briefcase, 'primary'), // 工作
  '📚': mapping(BookOpen, 'accent'), // 学习
  '🏠': mapping(Home, 'success'), // 家庭
  '💪': mapping(Dumbbell, 'success'), // 运动（原 Heart 与运动无关）
  '👥': mapping(Users, 'accent'), // 社交
  '📌': mapping(Pin, 'neutral'), // 其他

  // ---- KPI / 区块（8）----
  '📋': mapping(ListChecks, 'primary'), // 待办
  '🔥': mapping(Flame, 'warning'), // 连续天数（原 Activity）
  '💰': mapping(Banknote, 'danger'), // 支出
  '🏦': mapping(Landmark, 'success'), // 储蓄 / 储蓄卡（原 CreditCard）
  '⚡': mapping(Zap, 'warning'), // 快捷
  '📊': mapping(BarChart3, 'primary'), // 统计
  '👤': mapping(User, 'accent'), // 用户
  '💳': mapping(CreditCard, 'warning'), // 信用卡

  // ---- 支出分类（7）----
  '🍱': mapping(Utensils, 'warning'), // 餐饮（原 Star 与餐饮无关）
  '🚇': mapping(Route, 'primary'), // 交通
  '🛍️': mapping(ShoppingBag, 'danger'), // 购物
  '🎬': mapping(Video, 'accent'), // 娱乐（原 Music）
  '💊': mapping(HeartPulse, 'danger'), // 医疗（原 Shield 与医疗无关）
  '📦': mapping(Package, 'neutral'), // 其他
  '🔄': mapping(RefreshCw, 'accent'), // 订阅

  // ---- 收入分类（2）----
  '📈': mapping(TrendingUp, 'success'), // 投资（原 PieChart）
  '💵': mapping(Banknote, 'neutral'), // 现金

  // ---- 习惯图标（13）----
  '💧': mapping(Droplet, 'primary'), // 喝水（原 Flag，全表最错的一处）
  '🏃': mapping(Footprints, 'success'), // 跑步
  '🧘': mapping(Sparkles, 'accent'), // 冥想
  '🍎': mapping(Apple, 'danger'), // 饮食（原 Heart）
  '💤': mapping(Moon, 'accent'), // 睡眠（原 Alarm 闹钟语义相反）
  '☕': mapping(Coffee, 'warning'), // 咖啡（原 Beaker 烧杯）
  '🎯': mapping(Target, 'danger'), // 目标（原 Flag）
  '✍️': mapping(PenLine, 'primary'), // 写作（原 Edit2）
  '🚴': mapping(Bike, 'success'), // 骑行（原 Route）
  '🎨': mapping(Palette, 'accent'), // 创作（原 ColorPalette）
  '🎵': mapping(Music, 'warning'), // 音乐
  '🧹': mapping(Brush, 'primary'), // 家务（原 Flag）
  '🌱': mapping(Sprout, 'success'), // 成长（原 Article）

  // ---- 账户预设（4）----
  '💙': mapping(Wallet, 'accent'), // 花呗（原 CreditCard）
  '💚': mapping(MessageCircle, 'success'), // 微信零钱（原 Share）

  // ---- 其他 / 通用（13）----
  '👋': mapping(Sun, 'warning'), // 问候
  '🔒': mapping(Lock, 'neutral'), // 锁定
  '🧭': mapping(Compass, 'primary'), // 探索（原 MapPin）
  '👑': mapping(Crown, 'warning'), // 管理员（原 Shield 与 Header 撞车）
  '✏️': mapping(Pencil, 'success'), // 编辑
  '👁': mapping(Eye, 'accent'), // 可见
  '🔑': mapping(Key, 'warning'), // 密钥
  '📱': mapping(Smartphone, 'primary'), // 通知（原 Bell 与 Header 撞车）
  '➕': mapping(PlusCircle, 'primary'), // 新建
  '💎': mapping(Gem, 'accent'), // 会员 / 等级（修复静默降级）
  '🏆': mapping(Trophy, 'warning'), // 成就
  '⚡️': mapping(Zap, 'warning'), // 精力
  '❓': mapping(HelpCircle, 'neutral'), // 未知（兜底）
}

/** 兜底映射：未知 emoji → HelpCircle + 中性色 */
const FALLBACK_MAPPING: IconMapping = mapping(HelpCircle, 'neutral')

/** 已告警过的 emoji，避免控制台刷屏（02 §6.2：开发期 warn 一次） */
const warnedMissing = new Set<string>()

/**
 * 获取 emoji 对应的图标映射。
 * 未命中时降级为 HelpCircle + 中性色，并在开发期 console.warn 一次。
 */
export function getIconMapping(emoji: string): IconMapping {
  const hit = EMOJI_ICON_MAP[emoji]
  if (hit) return hit
  if (import.meta.env.DEV && !warnedMissing.has(emoji)) {
    warnedMissing.add(emoji)
    console.warn(`[icon-map] 未映射的 emoji "${emoji}" 已降级为 HelpCircle（中性色）`)
  }
  return FALLBACK_MAPPING
}
