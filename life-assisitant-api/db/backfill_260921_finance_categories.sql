-- ============================================================================
-- backfill_260921_finance_categories.sql —— 历史数据回填（记账分类体系）
--
-- ⚠️ 这是**手动物理执行**文件，由老大/DBA 跑，脚本本身不建表、不加列。
--    建表 + 加列 + 权限请先跑：db/data_260921_finance_categories.sql
--
-- ---- 执行前置条件与顺序（02 §5.3）-----------------------------------------
--   ① 建表加列：db/data_260921_finance_categories.sql 已跑（finance_categories
--                表 + transactions/budgets 的 category_id 列与索引已就位）。
--   ② 播种：每个活跃用户都「至少请求过一次 GET /finance/categories」
--            （后端懒创建播种 105 条/人），或已跑一次性脚本 scripts/fincatseed。
--   ③ 回填：跑本文件（把历史交易的 category_name 映射到 finance_categories.id）。
--   ④ 校验：本文件末尾的校验语句，期望 0 行未映射。
--
-- ⚠️ 若 ② 还没完成就来跑本文件：所有 UPDATE 都会 0 行匹配 —— 这是**预期**，
--    不是报错（JOIN 不到任何 finance_categories 行）。看下方「前置检查」输出即可判断。
--
-- 执行：
--   mysql -h 127.0.0.1 -uroot -proot123 life_assistant < db/backfill_260921_finance_categories.sql
-- 或：
--   go run scripts/init_db.go db/backfill_260921_finance_categories.sql
-- ============================================================================

-- ---------------------------------------------------------------------
-- 0. 前置检查：一眼看出该不该继续
-- ---------------------------------------------------------------------
SELECT '=== 前置检查：finance_categories 内置行 / 已播种用户数 ===' AS step;
SELECT
  COUNT(*)                       AS builtin_rows,
  COUNT(DISTINCT `user_id`)      AS seeded_users
FROM `finance_categories`
WHERE `is_builtin` = 1;

SELECT '=== 活跃用户总数（users，未软删） ===' AS step;
SELECT COUNT(*) AS active_users FROM `users` WHERE `deleted_at` IS NULL;

SELECT '⚠️ 若 seeded_users = 0，说明还没播种，下面回填会 0 行匹配（属预期），请先完成播种再跑本文件。' AS hint;

-- ---------------------------------------------------------------------
-- 1. 交易回填（③）：按「用户 + 收支方向 + 一级分类名」匹配内置分类
--    只填未映射(NULL) 且 有旧分类名 的 expense/income 交易。
-- ---------------------------------------------------------------------
UPDATE `transactions` t
  JOIN `finance_categories` c
    ON  c.`user_id`   = t.`user_id`
    AND c.`scope`     = IF(t.`type` = 'income', 'income', 'expense')
    AND c.`parent_id` = ''
    AND c.`name`      = t.`category_name`
    AND c.`is_deleted` = 0
    AND c.`is_builtin` = 1
SET t.`category_id` = c.`id`
WHERE t.`category_id` IS NULL
  AND t.`category_name` IS NOT NULL
  AND t.`type` IN ('expense', 'income');

-- ---------------------------------------------------------------------
-- 2. 预算回填（③）：按「用户 + 支出 + 一级分类名」匹配内置分类
--    仅 scope=category 且未映射的预算。
-- ---------------------------------------------------------------------
UPDATE `budgets` b
  JOIN `finance_categories` c
    ON  c.`user_id`   = b.`user_id`
    AND c.`scope`     = 'expense'
    AND c.`parent_id` = ''
    AND c.`name`      = b.`category_name`
    AND c.`is_builtin` = 1
    AND c.`is_deleted` = 0
SET b.`category_id` = c.`id`
WHERE b.`scope` = 'category'
  AND b.`category_id` IS NULL;

-- ---------------------------------------------------------------------
-- 3. 校验（④）：期望 0 —— 仍未映射(但有过旧分类名)的 expense/income 交易数
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS unmatched_tx
FROM `transactions`
WHERE `category_id` IS NULL
  AND `category_name` IS NOT NULL
  AND `type` IN ('expense', 'income');

-- 校验：scope=category 但仍未映射的预算数（期望 0）
SELECT COUNT(*) AS unmatched_budget
FROM `budgets`
WHERE `scope` = 'category'
  AND `category_id` IS NULL;

SELECT '✅ 回填结束：上面两个校验若都为 0，说明历史数据已全量映射；非 0 则需排查旧分类名差异。' AS done;
