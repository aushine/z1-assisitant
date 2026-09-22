-- ============================================================================
-- data_260921b_finance_category_icons.sql —— 给 85 个内置二级分类补图标
--   （md/spec-20260921-v1；对应 03 §5.1 / §5.2、02 §4.4、07「260921 后续改动清单」第 8 项）
--
-- ⚠️ 这是**手动物理执行**文件，由老大/DBA 跑，脚本本身不建表、不加列。
--
-- ---- 用途 ---------------------------------------------------------------
--   一轮播种时内置二级的 `icon` 是 **NULL**（渲染时继承父级）；
--   二轮要求「内置的 85 个二级全部配上独立图标」。
--   ⇒ 本文件给**已经播种过**的存量用户，把 85 个二级的 `icon` 补上。
--   ⚠️ 新用户由后端懒创建重新播种，Go 常量里已带 icon（utility/finance_category_seed.go），
--      天然就带图标 —— 本文件只补存量，不改建表脚本（init.sql 无需变更）。
--
-- ---- 执行顺序（务必按序，否则匹配不到行）--------------------------------
--   ① 建表加列：db/data_260921_finance_categories.sql
--                （finance_categories 表 + transactions/budgets 的 category_id 列与索引）
--   ② 播种   ：每个活跃用户「至少请求过一次 GET /finance/categories」，
--              或已跑一次性脚本 scripts/fincatseed（105 条/人）
--   ③ 本文件 ：补 85 个二级的 icon          ← 就是这里
--   ④ 回填   ：db/backfill_260921_finance_categories.sql
--              （把历史交易的 category_name 映射到 finance_categories.id）
--
--   执行：
--     mysql -h 127.0.0.1 -uroot -proot123 life_assistant < db/data_260921b_finance_category_icons.sql
--   或：
--     go run scripts/init_db.go db/data_260921b_finance_category_icons.sql
--
-- ---- 幂等 / 安全 ---------------------------------------------------------
--   ✅ **可重复执行**：每条 UPDATE 都带 `icon IS NULL` 守卫，
--      已补过的行（icon 非 NULL）第二次不会再改动。
--   ✅ **不覆盖用户自己改过的图标**：用户改过 ⇒ icon 为非 NULL ⇒ 被卫兵挡住。
--   ⚠️ 若在 ② 播种之前跑：全部 0 行匹配 —— 这是**预期，不是报错**
--      （表里还没有内置二级行）。请先完成 ② 再跑本文件。
--
--   ⚠️ 已知边界（02 §4.4）：`icon IS NULL` 无法区分「从未设置」与「用户故意清空以继承父级」；
--      但用户清空后看到的仍是父级图标，补上独立图标符合本次产品意图，可接受。
--
-- ⚠️ 图标名全部取自两端 ICON_GROUPS（constants/icon-groups.ts，14 组 225 条），
--    与 Go 种子常量（utility/finance_category_seed.go）逐条一致 ⇒ 必定可渲染。
-- ============================================================================


-- ---------------------------------------------------------------------
-- 1. 支出二级（61 个）
-- ---------------------------------------------------------------------

-- 餐饮 fc_b_food
UPDATE `finance_categories` SET `icon` = 'Utensils',        `updated_at` = NOW() WHERE `id` = 'fc_b_food_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Cookie',          `updated_at` = NOW() WHERE `id` = 'fc_b_food_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'CupSoda',         `updated_at` = NOW() WHERE `id` = 'fc_b_food_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Package',         `updated_at` = NOW() WHERE `id` = 'fc_b_food_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'UtensilsCrossed', `updated_at` = NOW() WHERE `id` = 'fc_b_food_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Wine',            `updated_at` = NOW() WHERE `id` = 'fc_b_food_06' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 交通 fc_b_transit
UPDATE `finance_categories` SET `icon` = 'Bus',             `updated_at` = NOW() WHERE `id` = 'fc_b_transit_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'CarFront',        `updated_at` = NOW() WHERE `id` = 'fc_b_transit_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Fuel',            `updated_at` = NOW() WHERE `id` = 'fc_b_transit_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'ParkingCircle',   `updated_at` = NOW() WHERE `id` = 'fc_b_transit_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'TrainFront',      `updated_at` = NOW() WHERE `id` = 'fc_b_transit_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Plane',           `updated_at` = NOW() WHERE `id` = 'fc_b_transit_06' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Bike',            `updated_at` = NOW() WHERE `id` = 'fc_b_transit_07' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 购物 fc_b_shopping
UPDATE `finance_categories` SET `icon` = 'ShoppingBasket',  `updated_at` = NOW() WHERE `id` = 'fc_b_shopping_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Shirt',           `updated_at` = NOW() WHERE `id` = 'fc_b_shopping_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Monitor',         `updated_at` = NOW() WHERE `id` = 'fc_b_shopping_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Brush',           `updated_at` = NOW() WHERE `id` = 'fc_b_shopping_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Sofa',            `updated_at` = NOW() WHERE `id` = 'fc_b_shopping_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Truck',           `updated_at` = NOW() WHERE `id` = 'fc_b_shopping_06' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 居住 fc_b_home
UPDATE `finance_categories` SET `icon` = 'Key',             `updated_at` = NOW() WHERE `id` = 'fc_b_home_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Landmark',        `updated_at` = NOW() WHERE `id` = 'fc_b_home_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Droplet',         `updated_at` = NOW() WHERE `id` = 'fc_b_home_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Flame',           `updated_at` = NOW() WHERE `id` = 'fc_b_home_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Home',            `updated_at` = NOW() WHERE `id` = 'fc_b_home_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Phone',           `updated_at` = NOW() WHERE `id` = 'fc_b_home_06' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'PlugZap',         `updated_at` = NOW() WHERE `id` = 'fc_b_home_07' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Brush',           `updated_at` = NOW() WHERE `id` = 'fc_b_home_08' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 娱乐 fc_b_fun
UPDATE `finance_categories` SET `icon` = 'Film',            `updated_at` = NOW() WHERE `id` = 'fc_b_fun_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Gamepad2',        `updated_at` = NOW() WHERE `id` = 'fc_b_fun_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Palmtree',        `updated_at` = NOW() WHERE `id` = 'fc_b_fun_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Dumbbell',        `updated_at` = NOW() WHERE `id` = 'fc_b_fun_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Crown',           `updated_at` = NOW() WHERE `id` = 'fc_b_fun_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Mic',             `updated_at` = NOW() WHERE `id` = 'fc_b_fun_06' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 医疗 fc_b_medical
UPDATE `finance_categories` SET `icon` = 'Stethoscope',     `updated_at` = NOW() WHERE `id` = 'fc_b_medical_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Pill',            `updated_at` = NOW() WHERE `id` = 'fc_b_medical_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Activity',        `updated_at` = NOW() WHERE `id` = 'fc_b_medical_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Cross',           `updated_at` = NOW() WHERE `id` = 'fc_b_medical_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'BedDouble',       `updated_at` = NOW() WHERE `id` = 'fc_b_medical_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'FileText',        `updated_at` = NOW() WHERE `id` = 'fc_b_medical_06' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 学习 fc_b_study
UPDATE `finance_categories` SET `icon` = 'BookOpen',        `updated_at` = NOW() WHERE `id` = 'fc_b_study_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Book',            `updated_at` = NOW() WHERE `id` = 'fc_b_study_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Pencil',          `updated_at` = NOW() WHERE `id` = 'fc_b_study_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'GraduationCap',   `updated_at` = NOW() WHERE `id` = 'fc_b_study_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 人情 fc_b_social
UPDATE `finance_categories` SET `icon` = 'Gift',            `updated_at` = NOW() WHERE `id` = 'fc_b_social_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'HeartHandshake',  `updated_at` = NOW() WHERE `id` = 'fc_b_social_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'UtensilsCrossed', `updated_at` = NOW() WHERE `id` = 'fc_b_social_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Heart',           `updated_at` = NOW() WHERE `id` = 'fc_b_social_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 育儿 fc_b_baby
UPDATE `finance_categories` SET `icon` = 'Milk',            `updated_at` = NOW() WHERE `id` = 'fc_b_baby_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'ToyBrick',        `updated_at` = NOW() WHERE `id` = 'fc_b_baby_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Shirt',           `updated_at` = NOW() WHERE `id` = 'fc_b_baby_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'GraduationCap',   `updated_at` = NOW() WHERE `id` = 'fc_b_baby_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Stethoscope',     `updated_at` = NOW() WHERE `id` = 'fc_b_baby_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 宠物 fc_b_pet
UPDATE `finance_categories` SET `icon` = 'Beef',            `updated_at` = NOW() WHERE `id` = 'fc_b_pet_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Cookie',          `updated_at` = NOW() WHERE `id` = 'fc_b_pet_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Stethoscope',     `updated_at` = NOW() WHERE `id` = 'fc_b_pet_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Package',         `updated_at` = NOW() WHERE `id` = 'fc_b_pet_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Home',            `updated_at` = NOW() WHERE `id` = 'fc_b_pet_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 金融 fc_b_finance
UPDATE `finance_categories` SET `icon` = 'Receipt',         `updated_at` = NOW() WHERE `id` = 'fc_b_finance_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Percent',         `updated_at` = NOW() WHERE `id` = 'fc_b_finance_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Landmark',        `updated_at` = NOW() WHERE `id` = 'fc_b_finance_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'TrafficCone',     `updated_at` = NOW() WHERE `id` = 'fc_b_finance_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;


-- ---------------------------------------------------------------------
-- 2. 收入二级（24 个）
-- ---------------------------------------------------------------------

-- 工资 fc_b_salary
UPDATE `finance_categories` SET `icon` = 'Banknote',        `updated_at` = NOW() WHERE `id` = 'fc_b_salary_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Clock',           `updated_at` = NOW() WHERE `id` = 'fc_b_salary_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Trophy',          `updated_at` = NOW() WHERE `id` = 'fc_b_salary_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Target',          `updated_at` = NOW() WHERE `id` = 'fc_b_salary_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 兼职 fc_b_part
UPDATE `finance_categories` SET `icon` = 'Briefcase',       `updated_at` = NOW() WHERE `id` = 'fc_b_part_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Laptop',          `updated_at` = NOW() WHERE `id` = 'fc_b_part_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'PenLine',         `updated_at` = NOW() WHERE `id` = 'fc_b_part_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Video',           `updated_at` = NOW() WHERE `id` = 'fc_b_part_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 投资 fc_b_invest
UPDATE `finance_categories` SET `icon` = 'TrendingUp',      `updated_at` = NOW() WHERE `id` = 'fc_b_invest_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'PieChart',        `updated_at` = NOW() WHERE `id` = 'fc_b_invest_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Percent',         `updated_at` = NOW() WHERE `id` = 'fc_b_invest_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Coins',           `updated_at` = NOW() WHERE `id` = 'fc_b_invest_04' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Key',             `updated_at` = NOW() WHERE `id` = 'fc_b_invest_05' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 报销 fc_b_reimburse
UPDATE `finance_categories` SET `icon` = 'Plane',           `updated_at` = NOW() WHERE `id` = 'fc_b_reimburse_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Briefcase',       `updated_at` = NOW() WHERE `id` = 'fc_b_reimburse_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Stethoscope',     `updated_at` = NOW() WHERE `id` = 'fc_b_reimburse_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 人情 fc_b_social_in
UPDATE `finance_categories` SET `icon` = 'Gift',            `updated_at` = NOW() WHERE `id` = 'fc_b_social_in_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'HeartHandshake',  `updated_at` = NOW() WHERE `id` = 'fc_b_social_in_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'PartyPopper',     `updated_at` = NOW() WHERE `id` = 'fc_b_social_in_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 退款 fc_b_refund
UPDATE `finance_categories` SET `icon` = 'RotateCcw',       `updated_at` = NOW() WHERE `id` = 'fc_b_refund_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Receipt',         `updated_at` = NOW() WHERE `id` = 'fc_b_refund_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;

-- 补贴 fc_b_subsidy
UPDATE `finance_categories` SET `icon` = 'Landmark',        `updated_at` = NOW() WHERE `id` = 'fc_b_subsidy_01' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Banknote',        `updated_at` = NOW() WHERE `id` = 'fc_b_subsidy_02' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;
UPDATE `finance_categories` SET `icon` = 'Baby',            `updated_at` = NOW() WHERE `id` = 'fc_b_subsidy_03' AND `is_builtin` = 1 AND `is_deleted` = 0 AND `icon` IS NULL;


-- ---------------------------------------------------------------------
-- 3. 校验（期望 0）
--    仍未补上 icon 的内置二级数 —— 全部补完应为 0。
--    （若在 ② 播种之前跑，本查询仍返回 0，但那是「表里还没有内置二级行」，
--      请按前置检查确认已播种。）
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS builtin_secondary_without_icon
FROM `finance_categories`
WHERE `is_builtin` = 1
  AND `is_deleted` = 0
  AND `parent_id` <> ''
  AND `icon` IS NULL;
-- 期望 0

SELECT '✅ 补图标结束：上面校验为 0 说明 85 个内置二级都已有 icon；非 0 请先确认已完成播种（②）。' AS done;
