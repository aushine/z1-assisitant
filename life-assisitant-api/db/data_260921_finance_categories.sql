-- ============================================================================
-- data_260921_finance_categories.sql —— 记账分类体系（md/spec-20260921-v1）
--
-- 幂等：可重复执行。
-- 执行：go run scripts/init_db.go db/data_260921_finance_categories.sql
--       （DSN 取自 manifest/config/config.yaml，与运行服务同源）
--
-- 内容：
--   1. 新表 finance_categories（两级分类，用户级）
--   2. transactions 加列 category_id + 索引 idx_tx_category
--   3. budgets      加列 category_id + 索引 idx_budget_category
--   4. 权限点 finance:category（权限目录 45 → 46 条；模块数仍 14；user 角色 35 → 36 条）
--
-- ⚠️ **内置分类种子不进本文件**（每个用户一份，SQL 里写死 user_id 不可行）——
--    由后端 Go 常量（internal/utility/finance_category_seed.go）+ 懒创建播种。
--
-- ⚠️ 本文件**不含**历史数据回填（transactions.category_id / budgets.category_id）：
--    回填有严格顺序依赖（② 播种 → ③ 回填），见文件末尾第 6 节的说明与建议语句。
--
-- ⚠️ 主键 / user_id 一律 varchar(32)（本项目约定，utility.NewID）。
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. finance_categories —— 收支分类（一级 + 二级同表，用户级）
--
--    ⚠️ 相对 02 §1 的 DDL，**主键改为复合主键 (id, user_id)**：
--       02 §4.1 / README D4 / 03 §7 要求「每个用户一份」内置种子（105 条 × 用户数），
--       而 03 §6 要求内置项用**固定 id**（fc_b_food / fc_b_food_01，全用户相同）。
--       若按 02 §1 只写 `PRIMARY KEY (id)`，第 2 个用户播种时全部内置行都会撞主键，
--       被 INSERT IGNORE 静默丢弃 → 该用户分类列表为空（且接口返回 seeded=true）。
--       改为复合主键后：固定 id 保留（06 接口示例、02 §5.1 回填映射都成立），
--       同时保证每人一份。代价：id 单独不再全局唯一，任何按 id 的查询都必须带 user_id。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `finance_categories` (
  `id`         VARCHAR(32)  NOT NULL                  COMMENT '主键之一；内置项用固定 id（fc_b_food），用户新建用 uuid 去横线',
  `user_id`    VARCHAR(32)  NOT NULL                  COMMENT '归属用户（分类是用户级的）；主键之一',
  `parent_id`  VARCHAR(32)  NOT NULL DEFAULT ''       COMMENT '父分类 id；⚠️ 空串 = 一级分类（不用 NULL，见 02 §1.2）',
  `scope`      VARCHAR(10)  NOT NULL DEFAULT 'expense' COMMENT 'expense 支出 / income 收入',
  `name`       VARCHAR(30)  NOT NULL                  COMMENT '显示名（不含父级前缀），如「三餐」',
  `full_name`  VARCHAR(80)  DEFAULT NULL              COMMENT '完整名，如「餐饮-三餐」；用于快照与搜索',
  `emoji`      VARCHAR(20)  DEFAULT NULL              COMMENT '可选 emoji（兼容旧渲染 / 导出）',
  `icon`       VARCHAR(40)  DEFAULT NULL              COMMENT 'Lucide 图标名（PascalCase），如 Utensils',
  `tint`       VARCHAR(20)  DEFAULT NULL              COMMENT '语义色名，取自 utils/tint 的 TintName',
  `sort`       INT          NOT NULL DEFAULT 0        COMMENT '排序，越小越前；内置项 10/20/30…，用户新建从 900 起',
  `is_builtin` TINYINT(1)   NOT NULL DEFAULT 0        COMMENT '是否内置种子（供「恢复默认」与「是否已播种」判断）',
  `is_deleted` TINYINT(1)   NOT NULL DEFAULT 0        COMMENT '软删除标记（audit 用；唯一索引末列已改为 deleted_seq，见下）',
  `deleted_seq` VARCHAR(32) NOT NULL DEFAULT ''       COMMENT '软删序号：活跃行恒为 ''''；删除时写自身 id（全库唯一），作 uk 末列避免同名反复删撞 1062',
  `created_at` DATETIME     DEFAULT NULL,
  `updated_at` DATETIME     DEFAULT NULL,
  `deleted_at` DATETIME     DEFAULT NULL              COMMENT '软删除时间（审计用）',
  -- ⚠️ 索引名必须与 model/finance_category.go 的 tag **逐字一致**，
  --    否则 GORM AutoMigrate 会认为索引不匹配去删建（period_settings 已踩过一次）。
  PRIMARY KEY (`id`, `user_id`),
  UNIQUE KEY `uk_fin_cat_user_scope_parent_name` (`user_id`, `scope`, `parent_id`, `name`, `deleted_seq`),
  KEY `idx_fin_cat_user_scope` (`user_id`, `scope`),
  KEY `idx_fin_cat_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收支分类（两级，用户级）';

-- ---------------------------------------------------------------------
-- 1b. ★G 幂等补偿：表可能已存在（被 AutoMigrate 抢建过，也可能还停在于 is_deleted 版本）
--     必须能处理「表已存在但 uk 列不匹配 / 缺 deleted_seq 列」两种情况。
--     路径 A：表不存在 → 上面的 CREATE TABLE IF NOT EXISTS 已建好（含 deleted_seq + 新 uk）。
--     路径 B：表已存在 → 走下面的动态补偿（加列 + 必要时 DROP/ADD uk），索引名保持相同。
-- ---------------------------------------------------------------------

-- 1b-1. 缺 deleted_seq 列则补（information_schema 判列存在）
SET @_add_col_ds = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'finance_categories'
      AND `COLUMN_NAME`  = 'deleted_seq') = 0,
  'ALTER TABLE `finance_categories` ADD COLUMN `deleted_seq` VARCHAR(32) NOT NULL DEFAULT '''' COMMENT ''软删序号：活跃行恒为空串，删除时写自身 id（全库唯一），作 uk 末列避免同名反复删撞 1062'' AFTER `is_deleted`',
  'SELECT 1'
);
PREPARE _stmt_ds FROM @_add_col_ds;
EXECUTE _stmt_ds;
DEALLOCATE PREPARE _stmt_ds;

-- 1b-2. uk 末列含 deleted_seq 才正确；否则 DROP + ADD（同一段动态 SQL，索引名保持不变）
--   先判：uk 是否已存在（@_uk_exists） 且 是否已含 deleted_seq（@_uk_has_ds）
SET @_uk_exists = (
  SELECT COUNT(*) FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME`   = 'finance_categories'
    AND `INDEX_NAME`   = 'uk_fin_cat_user_scope_parent_name'
);
SET @_uk_has_ds = (
  SELECT COUNT(*) FROM `information_schema`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME`   = 'finance_categories'
    AND `INDEX_NAME`   = 'uk_fin_cat_user_scope_parent_name'
    AND `COLUMN_NAME`  = 'deleted_seq'
);
-- 仅当索引存在且末列还不是 deleted_seq 时才 DROP（避免在「根本没这个索引」时报 1091）
SET @_drop_uk = IF(@_uk_exists > 0 AND @_uk_has_ds = 0,
  'ALTER TABLE `finance_categories` DROP INDEX `uk_fin_cat_user_scope_parent_name`',
  'SELECT 1'
);
PREPARE _stmt_drop_uk FROM @_drop_uk;
EXECUTE _stmt_drop_uk;
DEALLOCATE PREPARE _stmt_drop_uk;
-- 仅当 uk 还「不含 deleted_seq」时（无论上面是否 DROP）才 ADD（含新建场景）
SET @_add_uk = IF(@_uk_has_ds = 0,
  'ALTER TABLE `finance_categories` ADD UNIQUE KEY `uk_fin_cat_user_scope_parent_name` (`user_id`, `scope`, `parent_id`, `name`, `deleted_seq`)',
  'SELECT 1'
);
PREPARE _stmt_add_uk FROM @_add_uk;
EXECUTE _stmt_add_uk;
DEALLOCATE PREPARE _stmt_add_uk;

-- ---------------------------------------------------------------------
-- 2. transactions 加列 category_id + 索引
--
--    ⚠️ MySQL 没有 ADD COLUMN / ADD INDEX IF NOT EXISTS，
--       用 information_schema 判列/判索引 + 动态 SQL 做幂等。
-- ---------------------------------------------------------------------
SET @_add_col_tx_category = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'transactions'
      AND `COLUMN_NAME`  = 'category_id') = 0,
  'ALTER TABLE `transactions` ADD COLUMN `category_id` VARCHAR(32) DEFAULT NULL COMMENT ''分类 id（权威）；NULL = 历史数据未映射'' AFTER `category_name`',
  'SELECT 1'
);
PREPARE _stmt_tx_category FROM @_add_col_tx_category;
EXECUTE _stmt_tx_category;
DEALLOCATE PREPARE _stmt_tx_category;

SET @_add_idx_tx_category = IF(
  (SELECT COUNT(*) FROM `information_schema`.`STATISTICS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'transactions'
      AND `INDEX_NAME`   = 'idx_tx_category') = 0,
  'ALTER TABLE `transactions` ADD KEY `idx_tx_category` (`category_id`)',
  'SELECT 1'
);
PREPARE _stmt_tx_category_idx FROM @_add_idx_tx_category;
EXECUTE _stmt_tx_category_idx;
DEALLOCATE PREPARE _stmt_tx_category_idx;

-- ---------------------------------------------------------------------
-- 3. budgets 加列 category_id + 索引
-- ---------------------------------------------------------------------
SET @_add_col_budget_category = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'budgets'
      AND `COLUMN_NAME`  = 'category_id') = 0,
  'ALTER TABLE `budgets` ADD COLUMN `category_id` VARCHAR(32) DEFAULT NULL COMMENT ''分类 id（权威）；scope=total 时为空'' AFTER `category_name`',
  'SELECT 1'
);
PREPARE _stmt_budget_category FROM @_add_col_budget_category;
EXECUTE _stmt_budget_category;
DEALLOCATE PREPARE _stmt_budget_category;

SET @_add_idx_budget_category = IF(
  (SELECT COUNT(*) FROM `information_schema`.`STATISTICS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'budgets'
      AND `INDEX_NAME`   = 'idx_budget_category') = 0,
  'ALTER TABLE `budgets` ADD KEY `idx_budget_category` (`category_id`)',
  'SELECT 1'
);
PREPARE _stmt_budget_category_idx FROM @_add_idx_budget_category;
EXECUTE _stmt_budget_category_idx;
DEALLOCATE PREPARE _stmt_budget_category_idx;

-- ---------------------------------------------------------------------
-- 4. 权限点 finance:category（管理收支分类）
--    权限目录 45 → 46 条；模块数仍 14；user 角色 35 → 36 条。
--    ⚠️ 与 db/init_data.sql / manifest/sql/0001_init.sql 的种子逐字一致。
-- ---------------------------------------------------------------------
DELETE FROM `role_permissions` WHERE `permission_id` = 'p_finance_category';
DELETE FROM `permissions`      WHERE `id`            = 'p_finance_category';

INSERT INTO `permissions` (`id`, `module`, `action`, `description`) VALUES
  ('p_finance_category', 'finance', 'category', '管理收支分类');

-- admin：全量
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'admin', `id`, 1, 1 FROM `permissions` WHERE `id` = 'p_finance_category';

-- user：分类属个人域，自动拿到
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'user', `id`, 1, 1 FROM `permissions` WHERE `id` = 'p_finance_category';

-- ---------------------------------------------------------------------
-- 5. 校验（可选）
--   SELECT COUNT(*) FROM permissions;                        -- 期望 46
--   SELECT COUNT(DISTINCT module) FROM permissions;          -- 期望 14
--   SELECT role_code, COUNT(*) FROM role_permissions GROUP BY role_code;  -- 期望 admin 46 / user 36
--   SHOW CREATE TABLE finance_categories;                    -- 主键应为 (id, user_id)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 6. ⚠️ 历史数据回填（**本文件刻意不含可执行语句，不要在这里直接跑**）
--
--    顺序不能错（02 §5.3）：① 建表加列（本文件上半） → ② 播种 → ③ 回填 → ④ 校验。
--    内置种子靠**后端懒创建**写入（每人一份），所以在回填之前必须让每个活跃用户
--    至少请求过一次 GET /finance/categories（或跑一次性"给所有用户播种"脚本）。
--    否则 JOIN finance_categories 匹配不到任何一行，回填全部落空（R10）。
--
--    回填 + 校验的可执行语句已单独拆到 db/backfill_260921_finance_categories.sql
--    （含执行前置检查与「期望 0」的校验），由老大手动跑。此处不再内联。
-- ---------------------------------------------------------------------
