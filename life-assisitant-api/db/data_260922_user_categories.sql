-- ============================================================================
-- data_260922_user_categories.sql —— 习惯/待办分类体系（md/spec-20260922-v2，06 §3/§4/§5）
--
-- 幂等：可重复执行。
-- 执行：go run scripts/init_db.go db/data_260922_user_categories.sql
--       （DSN 取自 manifest/config/config.yaml，与运行服务同源）
--
-- 内容：
--   1. 新表 user_categories（习惯/待办两域共用，用户级，复合主键 (id, user_id)）
--   2. habits.icon 列变更：VARCHAR(20) DEFAULT '📌' → VARCHAR(40) DEFAULT ''
--   3. tasks    加列 icon VARCHAR(40) NOT NULL DEFAULT ''（AFTER category_id）
--   4. 权限点 category:view / category:manage（权限目录 46 → 48 条；模块 14 → 15；
--      admin 46 → 48 / user 36 → 38 条）
--
-- ⚠️ **零数据回填 / 零迁移**（06 §3.2 / §7）：内置分类 id 保留旧值
--    （habit：sport/diet/life/study；task：c_work/c_study/c_life/c_health/c_social/c_other），
--    habits.category 与 tasks.category_id 的存量值天然命中；
--    老行 habits.icon 的非空值（如 '📌' / emoji）原样保留，不受列变更影响。
--
-- ⚠️ **内置分类种子不进本文件**（每个用户一份，SQL 里写死 user_id 不可行）——
--    由后端 Go 常量（internal/utility/user_category_seed.go）+ 懒创建播种
--    （判断口径 = 该用户该 domain 是否存在 is_builtin=1 的行，**含已删行**）。
--
-- ⚠️ 发布顺序（06 §7）：① 本脚本 → ② 后端 → ③ 抽验 → ④ 双端。
--    先跑本脚本对老版本无影响（新表新列无人读）；老前端也不会被 habits.icon
--    20→40 的放宽破坏。
--
-- ⚠️ 主键 / user_id 一律 varchar(32)（本项目约定，utility.NewID）。
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. user_categories —— 习惯/待办分类（两域共用一张表，用户级）
--
--    ⚠️ **复合主键 (id, user_id)**：内置 id 保留旧值（sport / c_work…），跨用户重复，
--       单主键必撞 ⇒ 任何按 id 的查询必须同时带 user_id。
--    ⚠️ 唯一索引 uk_user_cat 末列是 deleted_seq（**不是 deleted_at**）：
--       活跃行 deleted_at 为 NULL，NULL 不参与唯一比较 ⇒ 约束静默失效（同一用户两条「运动」）；
--       deleted_seq 删除时写随机值，避免「同名分类删了再建再删」撞 1062。
--    ⚠️ 索引名必须与 model/user_category.go 的 gorm tag **逐字一致**（项目铁律，
--       否则 AutoMigrate 误删重建 → Error 1553 或静默丢唯一约束）。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_categories` (
  `id`          VARCHAR(32)  NOT NULL                  COMMENT '主键之一；内置项保留旧值（sport/c_work…），用户新建用 uc_<domain>_<10位随机>',
  `user_id`     VARCHAR(32)  NOT NULL                  COMMENT '归属用户（分类是用户级的）；主键之一',
  `domain`      VARCHAR(16)  NOT NULL                  COMMENT 'habit | task',
  `name`        VARCHAR(30)  NOT NULL                  COMMENT '显示名，去空白后 1-10 字',
  `emoji`       VARCHAR(20)  NOT NULL DEFAULT ''       COMMENT '可选 emoji（兼容旧渲染 / 导出）',
  `icon`        VARCHAR(40)  NOT NULL DEFAULT ''       COMMENT 'lucide:Pin',
  `tint`        VARCHAR(20)  NOT NULL DEFAULT 'neutral' COMMENT '语义色名（primary/success/accent/danger/warning/neutral）',
  `sort`        INT          NOT NULL DEFAULT 0        COMMENT '排序，越小越前；内置项 10/20/30…，用户新建从 900 起',
  `is_builtin`  TINYINT      NOT NULL DEFAULT 0        COMMENT '是否内置种子（含已删行，供「是否已播种」判断）',
  `is_deleted`  TINYINT      NOT NULL DEFAULT 0        COMMENT '软删除标记',
  `deleted_seq` VARCHAR(32)  NOT NULL DEFAULT ''       COMMENT '软删序号：活跃行恒为 ''''；删除时写随机值，作 uk 末列避免同名反复删撞 1062',
  `created_at`  DATETIME     NULL,
  `updated_at`  DATETIME     NULL,
  `deleted_at`  DATETIME     NULL,
  PRIMARY KEY (`id`, `user_id`),
  UNIQUE KEY `uk_user_cat` (`user_id`, `domain`, `name`, `deleted_seq`),
  KEY `idx_user_cat_domain` (`user_id`, `domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 2. habits.icon 列变更：VARCHAR(20) DEFAULT '📌' → VARCHAR(40) DEFAULT ''
--
--    ⚠️ 20 会**静默截断** 'lucide:' + 长名（最长 29 字符）⇒ 图标消失，必须放宽到 40
--       （与 finance_categories.icon 同规格）。默认值改空串 = 新语义「继承分类图标」。
--    ⚠️ MODIFY COLUMN 只改列定义与默认值，**不动任何存量数据**（零回填铁律）。
--    幂等：已是 varchar(40) + DEFAULT '' 时跳过。
-- ---------------------------------------------------------------------
SET @_mod_habit_icon = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'habits'
      AND `COLUMN_NAME`  = 'icon'
      AND `COLUMN_TYPE`  = 'varchar(40)'
      AND `COLUMN_DEFAULT` = '') = 0,
  'ALTER TABLE `habits` MODIFY COLUMN `icon` VARCHAR(40) NOT NULL DEFAULT '''' COMMENT ''图标引用 lucide:<Name> / emoji；空=继承分类图标（20260922：20→40 防静默截断；默认 📌→空）''',
  'SELECT 1'
);
PREPARE _stmt_habit_icon FROM @_mod_habit_icon;
EXECUTE _stmt_habit_icon;
DEALLOCATE PREPARE _stmt_habit_icon;

-- ---------------------------------------------------------------------
-- 3. tasks 加列 icon（空 = 继承分类图标；与 habits.icon 同规格）
--    幂等：MySQL 无 ADD COLUMN IF NOT EXISTS，用 information_schema + 动态 SQL。
-- ---------------------------------------------------------------------
SET @_add_col_task_icon = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME`   = 'tasks'
      AND `COLUMN_NAME`  = 'icon') = 0,
  'ALTER TABLE `tasks` ADD COLUMN `icon` VARCHAR(40) NOT NULL DEFAULT '''' COMMENT ''图标引用 lucide:<Name> / emoji；空=继承分类图标（20260922 新增）'' AFTER `category_id`',
  'SELECT 1'
);
PREPARE _stmt_task_icon FROM @_add_col_task_icon;
EXECUTE _stmt_task_icon;
DEALLOCATE PREPARE _stmt_task_icon;

-- ---------------------------------------------------------------------
-- 4. 权限点 category:view / category:manage（习惯/待办分类，两域共用实体）
--    权限目录 46 → 48 条；模块 14 → 15；admin 46 → 48 / user 36 → 38 条。
--    ⚠️ 与 db/init_data.sql / manifest/sql/0001_init.sql 的种子逐字一致。
--    ⚠️ 不复用 habit:* / task:*（分类是两域共用实体，挂任一域都语义错位，06 §5）。
--    ⚠️ 基线两文件按目录派生授权（category 不在 user 排除清单，自动拿到），
--       本增量脚本对**存量库**显式给 admin 与 user 各补一条 —— 否则用户进分类页 403。
-- ---------------------------------------------------------------------
DELETE FROM `role_permissions` WHERE `permission_id` IN ('p_category_view', 'p_category_manage');
DELETE FROM `permissions`      WHERE `id`            IN ('p_category_view', 'p_category_manage');

INSERT INTO `permissions` (`id`, `module`, `action`, `description`) VALUES
  ('p_category_view',   'category', 'view',   '查看习惯/待办分类'),
  ('p_category_manage', 'category', 'manage', '管理习惯/待办分类（增删改）');

-- admin：全量
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'admin', `id`, 1, 1 FROM `permissions` WHERE `id` IN ('p_category_view', 'p_category_manage');

-- user：分类属个人域，自动拿到
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'user', `id`, 1, 1 FROM `permissions` WHERE `id` IN ('p_category_view', 'p_category_manage');

-- ---------------------------------------------------------------------
-- 5. 校验（可选，执行后确认结果）
--   SELECT COUNT(*) FROM permissions;                        -- 期望 48
--   SELECT COUNT(DISTINCT module) FROM permissions;          -- 期望 15
--   SELECT role_code, COUNT(*) FROM role_permissions GROUP BY role_code;
--     -- 本脚本保证 **admin 与 user 各 +2**（否则用户进分类页 403）。
--     -- 基线重建态为 admin 48 / user 38；⚠️ **存量库矩阵可在权限页被改，存在漂移**
--     --   （实测开发库：admin 46 / user 33，另有自定义角色 female 30），
--     --   故增量后以「各比执行前 +2」为准（如 user 33 → 35），不是绝对值 38；
--     --   自定义角色（如 female）**不自动补**，由管理员在权限矩阵页自行授予。
--   SHOW CREATE TABLE user_categories;  -- 主键应为 (id, user_id)，
--                                       -- uk_user_cat(user_id,domain,name,deleted_seq) / idx_user_cat_domain(user_id,domain)
--   SHOW COLUMNS FROM habits LIKE 'icon';   -- Type varchar(40)，Default NULL（''显示为空）
--   SHOW COLUMNS FROM tasks  LIKE 'icon';   -- Type varchar(40)，Default ''
--
--   -- 存量数据零改动自检（本脚本不回填，行数必须不变）：
--   -- SELECT COUNT(*) FROM habits WHERE icon <> '';  -- 与执行前一致
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 6. ⚠️ 刻意**没有**的语句（对照 260921 的回填章节）：
--    本批 **无历史数据回填** —— 内置分类 id 保留旧值（06 §3.2），
--    habits.category / tasks.category_id 存量值直接命中；
--    内置 user_categories 行由后端**懒创建**播种（GET /user-categories 或
--    习惯/待办写入路径自动补齐），SQL 里不写一行种子数据。
-- ---------------------------------------------------------------------
