-- ============================================================================
-- data_261001_perm_fix.sql —— 权限目录漂移修复（2026-10-01）
--
-- 背景（线上真实事故）：
--   GET /z1/api/v1/user-categories?domain=habit 对非 admin 角色恒返
--   403001 PERMISSION_DENIED（"无访问权限 非管理员角色"）。
--   排查结论：**权限目录 permissions 表里根本没有 category 模块的两个点** ——
--   开发库实测 46 条（应为 48），p_category_view / p_category_manage 从未落库，
--   db/data_260922_user_categories.sql 的增量没跑（或跑后被重建覆盖）。
--   ⇒ 路由 RequirePermission("category:view") 对任何非 admin 角色都判定失败。
--
--   顺带查出第二处漂移：user 角色只有 33 条（基线应为 36），缺
--   p_period_view / p_period_write / p_period_manage ⇒ 经期模块对 user 全 403
--   （基线规则见 db/init_data.sql：user = 目录中 module NOT IN(user_mgmt,role_mgmt) 的全集）。
--
-- 本脚本做什么：
--   1. 补权限点 p_category_view / p_category_manage（目录 46 → 48）
--   2. admin：补齐目录中**缺失**的点（admin 语义即全权限）
--   3. 所有非 admin 角色（含自定义角色如 female）：补齐「非管理域」缺失点
--      —— user 补 period×3 + category×2（33 → 38），female 补 category×2（36 → 38）
--
-- ⚠️ 本脚本**只补不删**（INSERT IGNORE），不会动管理员已勾选/取消的项，
--    也不会重置 role_permissions.version（乐观锁版本取 MAX，插 version=1 不影响）。
--
-- ⚠️ 自定义角色要不要自动补？260922 脚本注释写"自定义角色不自动补，由管理员授予"，
--    但实测事故表明：新模块上线后忘补 ⇒ 该角色用户直接 403 且无感知。
--    故本脚本对**所有非 admin 角色**按基线规则补非管理域点（管理域仍不碰）。
--
-- 幂等：可重复执行。
-- 执行：go run scripts/sqlrun/main.go db/data_261001_perm_fix.sql
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. 权限目录补点（与 manifest/sql/0001_init.sql、db/data_260922_user_categories.sql
--    的种子逐字一致；description 变化时用 ON DUPLICATE KEY 同步）
-- ---------------------------------------------------------------------
INSERT INTO `permissions` (`id`, `module`, `action`, `description`) VALUES
  ('p_category_view',   'category', 'view',   '查看习惯/待办分类'),
  ('p_category_manage', 'category', 'manage', '管理习惯/待办分类（增删改）')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- ---------------------------------------------------------------------
-- 2. admin 全量补齐（admin 在中间件里代码旁路全权限，矩阵也应与目录一致，
--    否则权限页显示会缺勾选块）
-- ---------------------------------------------------------------------
INSERT IGNORE INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'admin', p.`id`, 1, 1 FROM `permissions` p;

-- ---------------------------------------------------------------------
-- 3. 非 admin 角色：补齐非管理域缺失点（user_mgmt / role_mgmt 属管理域，不自动授予）
--    逐角色逐点 INSERT IGNORE —— 已存在（含 enabled=0 的显式关闭项）不会被改写。
-- ---------------------------------------------------------------------
INSERT IGNORE INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT r.`code`, p.`id`, 1, 1
FROM `roles` r
JOIN `permissions` p ON p.`module` NOT IN ('user_mgmt', 'role_mgmt')
WHERE r.`code` <> 'admin';

-- ---------------------------------------------------------------------
-- 4. 校验（执行后确认）
--   SELECT COUNT(*) FROM permissions;                       -- 期望 48
--   SELECT COUNT(DISTINCT module) FROM permissions;         -- 期望 15
--   SELECT role_code, COUNT(*) FROM role_permissions GROUP BY role_code;
--     -- 期望 admin 48 / user 38 / female 38
-- ---------------------------------------------------------------------
SELECT (SELECT COUNT(*) FROM `permissions`) AS perm_count,
       (SELECT COUNT(DISTINCT `module`) FROM `permissions`) AS module_count;

SELECT `role_code`, COUNT(*) AS cnt FROM `role_permissions` GROUP BY `role_code`;

SELECT r.`code` AS role_code, p.`id` AS still_missing
FROM `roles` r
JOIN `permissions` p ON p.`module` NOT IN ('user_mgmt', 'role_mgmt')
LEFT JOIN `role_permissions` rp ON rp.`role_code` = r.`code` AND rp.`permission_id` = p.`id`
WHERE r.`code` <> 'admin' AND rp.`permission_id` IS NULL;
