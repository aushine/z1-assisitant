/**
 * 图标分组（04 §3）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/constants/icon-groups.ts
 * 最后同步：2026-09-21
 *
 * ⚠️ 两端逐字一致：本文件的键与值序列化后算出的 SHA256 必须完全相同
 *    （校验脚本：`scripts/check-icon-groups.mjs`，可被 npm script / CI 调用）。
 * ⚠️ 只允许引用 `ICONS` 注册表里的名字（见 `../components/icon/names.ts`）；
 *    分组是用户可选集合的**白名单**，只引用注册表 ⇒ 用户入库的图标名必定可渲染。
 * ⚠️ 图标名与 lucide 版本强耦合（本项目锁 0.300.0），不得照抄官网最新文档里的名字。
 */
import type { IconName } from '../components/icon/names'

export const ICON_GROUPS: Record<string, IconName[]> = {
  // 1
  '食品饮品': [
    'Utensils', 'UtensilsCrossed', 'Soup', 'Salad', 'Sandwich', 'Pizza', 'Beef', 'Fish',
    'EggFried', 'IceCream', 'Cake', 'Cookie', 'Coffee', 'CupSoda', 'Wine', 'Beer',
  ],
  // 2
  '交通出行': [
    'Car', 'CarFront', 'Bus', 'TrainFront', 'Plane', 'Bike', 'Fuel', 'ParkingCircle',
    'MapPin', 'Route', 'Navigation', 'Compass', 'Ship', 'Truck', 'TrafficCone', 'Rocket',
  ],
  // 3
  '购物消费': [
    'ShoppingBag', 'ShoppingCart', 'ShoppingBasket', 'Tag', 'Tags', 'Gift', 'Store', 'CreditCard',
    'Wallet', 'Banknote', 'PiggyBank', 'Percent', 'BadgePercent', 'Receipt', 'Package', 'Shirt',
  ],
  // 4
  '居住家居': [
    'Home', 'Sofa', 'Armchair', 'BedDouble', 'Lamp', 'LampDesk', 'Lightbulb', 'Plug',
    'PlugZap', 'Refrigerator', 'Microwave', 'Tv', 'Droplet', 'Flame', 'Key', 'Brush',
  ],
  // 5
  '娱乐休闲': [
    'Video', 'Film', 'Camera', 'Music', 'Headphones', 'Mic', 'Gamepad2', 'Dices',
    'PartyPopper', 'Ticket', 'Popcorn', 'Speaker', 'Guitar', 'Palette', 'Sparkles', 'Crown',
  ],
  // 6
  '医疗健康': [
    'HeartPulse', 'Heart', 'Stethoscope', 'Pill', 'Tablets', 'Syringe', 'Thermometer', 'Cross',
    'Activity', 'Dna', 'Microscope', 'FlaskConical', 'Brain', 'Eye', 'Bone', 'Scale',
  ],
  // 7
  '学习教育': [
    'BookOpen', 'Book', 'BookMarked', 'BookText', 'Library', 'GraduationCap', 'PenLine', 'Pen',
    'Pencil', 'Ruler', 'Scissors', 'Paperclip', 'Highlighter', 'FileText', 'Calculator', 'Puzzle',
  ],
  // 8
  '人际人情': [
    'User', 'Users', 'UserPlus', 'UserCheck', 'UserCog', 'Crown', 'Heart', 'HeartHandshake',
    'Gift', 'PartyPopper', 'MessageCircle', 'MessageSquare', 'Send', 'Mail', 'Phone', 'Smile',
  ],
  // 9
  '母婴育儿': [
    'Baby', 'Milk', 'Blocks', 'ToyBrick', 'Puzzle', 'Smile', 'Footprints', 'Shirt',
    'Bath', 'Bed', 'Cookie', 'Cake', 'Popcorn', 'Apple', 'Egg', 'Star',
  ],
  // 10
  '宠物动物': [
    'PawPrint', 'Dog', 'Cat', 'Bird', 'Fish', 'Rabbit', 'Turtle', 'Squirrel',
    'Snail', 'Bug', 'Rat', 'Bone', 'Egg', 'Feather', 'Beef', 'Heart',
  ],
  // 11
  '金融钱币': [
    'Banknote', 'Coins', 'Landmark', 'PiggyBank', 'Wallet', 'CreditCard', 'BadgeDollarSign', 'DollarSign',
    'CircleDollarSign', 'TrendingUp', 'TrendingDown', 'BarChart3', 'PieChart', 'LineChart', 'Calculator', 'Percent',
    'RotateCcw',
  ],
  // 12
  '办公工作': [
    'Briefcase', 'Laptop', 'Monitor', 'Keyboard', 'Mouse', 'Printer', 'FolderOpen', 'Folder',
    'FileText', 'Calendar', 'CalendarCheck', 'CalendarDays', 'Clock', 'Timer', 'ListTodo', 'ListChecks',
  ],
  // 13
  '运动健身': [
    'Dumbbell', 'Footprints', 'Bike', 'PersonStanding', 'Activity', 'Target', 'Timer', 'Trophy',
    'Medal', 'Award', 'Flame', 'Zap', 'Waves', 'Mountain', 'Snowflake', 'Wind',
  ],
  // 14
  '旅行度假': [
    'Luggage', 'Globe', 'Map', 'MapPin', 'Plane', 'PlaneTakeoff', 'Tent', 'Palmtree',
    'TreePine', 'Mountain', 'Sun', 'Sunrise', 'Sunset', 'Cloud', 'Umbrella', 'Compass',
  ],
}
