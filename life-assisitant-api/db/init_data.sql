-- =====================================================================
-- life-assistant 初始化数据（种子数据）—— D-03 权限重构版
--
-- 执行顺序：必须先执行 init.sql（建表），再执行本文件
--   go run scripts/init_db.go db/init.sql
--   go run scripts/init_db.go db/init_data.sql
--   （或 mysql -h <host> -P <port> -u root -p life_assistant < 文件）
--
-- 幂等：本文件可重复执行（角色 upsert；权限目录与矩阵为重建式收敛）
--
-- 内容：
--   1. roles            2 条内置角色（admin 管理员 / user 用户）
--   2. permissions      45 条权限点（14 模块，按真实功能设计，非抽象 CRUD 填充）
--   3. role_permissions admin 40（全量锁定）/ user 30（个人域，权限页可调）
--   4. users            admin 管理员账号（admin / Admin@123）
--   5. accounts         4 个内置默认账户（绑定 admin）
--   6. 同步 roles.user_count 冗余计数
--
-- 260919 新增：经期记录模块 period（view / write / manage）——
--   权限目录 37 → 40 条、模块 11 → 12；user 角色 27 → 30 条。
-- 260919 新增（第二批）：健康模块 health（view/write/manage）+ 纪念日 anniversary（view/write）——
--   权限目录 40 → 45 条、模块 12 → 14；user 角色 30 → 35 条。
--   增量脚本见 db/data_260919.sql；两端权限矩阵页 MODULE_NAMES 也要加 period。
--
-- 注：自定义角色无种子（运行时由 role_mgmt:create 创建）。
--     tasks / habits / habit_logs / transactions / budgets / subtasks
--     / feedbacks / refresh_tokens 属于用户运行时数据，无需种子数据。
--
-- 本文件已并入 260917_role_permission_v2.sql（editor/viewer 存量收敛）与
-- 260917_role_id.sql（is_system 错标修复，见 1c；roles 显式 id 种子）的全部
-- 修复效果，在新库或旧库上执行均可落到同一「D-03 修复后」参考态；
-- 两份迁移文件保留作为历史迁移记录，参考数据与三份文件一致。
-- 260918_user_pwd_avatar.sql（email 可空 / pwd_reset_required 列；avatar 维持
-- varchar(500)——第八轮头像改文件上传+URL 入库，旧版 avatar→TEXT 段已撤销）
-- 为纯结构变更，效果已同步进 init.sql 与 0001_init.sql 建表 DDL；admin 种子
-- 邮箱齐备、非代建用户，pwd_reset_required 走列默认 0，本文件无需数据改动。
-- ⚠️ 结构类修复（加列/改列/加索引）归宿是 init.sql 与 manifest/sql/0001_init.sql
--    的 DDL，本文件只承载数据。
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. roles（内置角色：仅剩 admin + user；editor/viewer 已废弃）
-- ---------------------------------------------------------------------
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `is_system`) VALUES
  (1, 'admin', '管理员', '内置超级角色：拥有全部权限，权限矩阵固定不可修改，角色不可删除', 1),
  (2, 'user',  '用户',   '默认普通用户角色：个人域全部功能，不含用户/角色管理；权限可在权限管理页调整', 1)
ON DUPLICATE KEY UPDATE
  `name`        = VALUES(`name`),
  `description` = VALUES(`description`),
  `is_system`   = VALUES(`is_system`);
  -- id 不参与 UPDATE：已分配的排序号保持稳定（存量库先跑 db/260917_role_id.sql 补列）

-- 1b. 遗留角色收敛（并入迁移 SQL 的效果，幂等）
--     editor/viewer 存量用户一律改挂 user（须先于删角色，FK RESTRICT）
UPDATE `users` SET `role_code` = 'user' WHERE `role_code` IN ('editor', 'viewer');

-- 1c. is_system 数据修复（对应 260917_role_id.sql 第 2 步）：
--     旧后端 GORM default-tag 跳列 bug 曾把新角色错写成内置，非内置一律降 0
UPDATE `roles` SET `is_system` = 0 WHERE `code` NOT IN ('admin', 'user');

-- ---------------------------------------------------------------------
-- 2. permissions（权限点：14 模块 × 实际功能 = 45 条）
--    与后端 RequirePermission("module:action") 路由逐一对应，
--    修改本目录必须同步 internal/controller/router.go。
--    重建式收敛：先清空再插入（旧 7×5 抽象点无法映射，一律作废）。
-- ---------------------------------------------------------------------
DELETE FROM `role_permissions`;
DELETE FROM `permissions`;

-- 2b. 删除遗留角色定义（其矩阵行已由上一步清空、用户已由 1b 改挂，FK 已无引用）
DELETE FROM `roles` WHERE `code` IN ('editor', 'viewer');

INSERT INTO `permissions` (`id`, `module`, `action`, `description`) VALUES
-- home 首页
  ('p_home_view',                'home',         'view',        '查看首页聚合数据'),
  ('p_home_sync',                'home',         'sync',        '手动同步数据'),
-- task 任务
  ('p_task_view',                'task',         'view',        '查看任务'),
  ('p_task_create',              'task',         'create',      '创建任务'),
  ('p_task_update',              'task',         'update',      '编辑任务（含子任务勾选）'),
  ('p_task_complete',            'task',         'complete',    '完成任务（含批量）'),
  ('p_task_delete',              'task',         'delete',      '删除任务（含批量）'),
-- habit 习惯
  ('p_habit_view',               'habit',        'view',        '查看习惯（含今日）'),
  ('p_habit_checkin',            'habit',        'checkin',     '习惯打卡'),
  ('p_habit_create',             'habit',        'create',      '创建习惯'),
  ('p_habit_update',             'habit',        'update',      '编辑习惯'),
  ('p_habit_delete',             'habit',        'delete',      '删除习惯'),
-- mood 心情/精力
  ('p_mood_view',                'mood',         'view',        '查看心情记录'),
  ('p_mood_write',               'mood',         'write',       '记录今日心情/精力'),
-- finance 财务
  ('p_finance_view',             'finance',      'view',        '查看账户/交易/预算'),
  ('p_finance_account',          'finance',      'account',     '管理账户（增删改）'),
  ('p_finance_record',           'finance',      'record',      '记账（收支/转账）'),
  ('p_finance_tx_manage',        'finance',      'tx_manage',   '修改/冲正/删除交易'),
  ('p_finance_budget',           'finance',      'budget',      '管理预算'),
-- period 经期记录（260919 新增；记录模块的第 5 个维度）
  ('p_period_view',              'period',       'view',        '查看经期记录与预测'),
  ('p_period_write',             'period',       'write',       '记录经期日记与修改设置'),
  ('p_period_manage',            'period',       'manage',      '修正周期与重置经期数据'),
-- health 健康（20260919-v1 新增；记录模块第 3 个 tab，经期是其中一个可开关指标）
  ('p_health_view',              'health',       'view',        '查看健康记录与概览'),
  ('p_health_write',             'health',       'write',       '记录健康数据（饮水/体重/体温等）'),
  ('p_health_manage',            'health',       'manage',      '修改健康设置与重置健康数据'),
-- anniversary 纪念日（20260919-v1 新增；入口在「我的 → 重要日子」）
  ('p_anniversary_view',         'anniversary',  'view',        '查看纪念日与倒数日'),
  ('p_anniversary_write',        'anniversary',  'write',       '管理纪念日（增删改）'),
-- stat 统计
  ('p_stat_view',                'stat',         'view',        '查看统计'),
  ('p_stat_export',              'stat',         'export',      '导出统计数据'),
-- timeline 时间线
  ('p_timeline_view',            'timeline',     'view',        '查看生活时间线'),
-- notification 通知
  ('p_notification_view',        'notification', 'view',        '查看通知'),
  ('p_notification_handle',      'notification', 'handle',      '标记通知已读'),
-- me 个人中心
  ('p_me_profile',               'me',           'profile',     '编辑个人资料'),
  ('p_me_password',              'me',           'password',    '修改密码'),
  ('p_me_feedback',              'me',           'feedback',    '提交反馈'),
-- user_mgmt 用户管理
  ('p_user_mgmt_view',           'user_mgmt',    'view',        '查看用户列表/详情'),
  ('p_user_mgmt_create',         'user_mgmt',    'create',      '新建用户'),
  ('p_user_mgmt_update',         'user_mgmt',    'update',      '编辑用户（含启用/禁用）'),
  ('p_user_mgmt_delete',         'user_mgmt',    'delete',      '删除用户'),
  ('p_user_mgmt_assign_role',    'user_mgmt',    'assign_role', '为用户分配角色'),
-- role_mgmt 角色与权限管理
  ('p_role_mgmt_view',           'role_mgmt',    'view',        '查看角色与权限配置'),
  ('p_role_mgmt_create',         'role_mgmt',    'create',      '新建自定义角色'),
  ('p_role_mgmt_update',         'role_mgmt',    'update',      '编辑角色名称/描述'),
  ('p_role_mgmt_delete',         'role_mgmt',    'delete',      '删除自定义角色'),
  ('p_role_mgmt_grant',          'role_mgmt',    'grant',       '配置角色权限（勾选保存）');

-- ---------------------------------------------------------------------
-- 3. role_permissions（角色权限矩阵）
--    admin：全部 45 点（服务端代码旁路 + 矩阵锁定，改不动也删不得）
--    user ：个人域 35 点（目录推导：排除 user_mgmt / role_mgmt；权限页可调）
-- ---------------------------------------------------------------------
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'admin', `id`, 1, 1 FROM `permissions`;

INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'user', `id`, 1, 1 FROM `permissions`
WHERE `module` NOT IN ('user_mgmt', 'role_mgmt');

-- ---------------------------------------------------------------------
-- 4. users（管理员账号）
--    账号：admin    密码：Admin@123
--    bcrypt cost=12（$2a$ 由 Go x/crypto/bcrypt 生成，与项目 utility.VerifyPassword 同库，可正常校验）
--
--    注意：id 必须为 u_cc8f5b30 —— 下面第 5 节的 4 个默认账户
--    通过 fk_account_user 外键绑定到这个 id。
--
--    登录支持「用户名或邮箱」两种方式（dao.User.FindByUsernameOrEmail）
-- ---------------------------------------------------------------------
INSERT INTO `users`
  (`id`, `username`, `password_hash`, `name`, `email`, `role_code`, `department`, `status`, `preferences`)
VALUES
  ('u_cc8f5b30',
   'admin',
   '$2a$12$.s51IL55OEAg.78Y6i11EOxOPOA9.ooixskhMuPP.p.MLdr8mdVMu',
   '系统管理员',
   'admin@life.app',
   'admin',
   '产品部',
   'active',
   JSON_OBJECT('theme', 'light', 'language', 'zh-CN',
               'notifications', JSON_OBJECT('email', true, 'push', true)))
ON DUPLICATE KEY UPDATE
  `password_hash`      = VALUES(`password_hash`),
  `name`               = VALUES(`name`),
  `role_code`          = VALUES(`role_code`),
  `department`         = VALUES(`department`),
  `status`             = 'active',
  `deleted_at`         = NULL,
  `failed_login_count` = 0,
  `locked_until`       = NULL;

-- ---------------------------------------------------------------------
-- 5. accounts（内置默认账户，余额 0）
--    归属 user_id = u_cc8f5b30（见上）
-- ---------------------------------------------------------------------
INSERT INTO `accounts` (`id`, `user_id`, `name`, `type`, `icon`, `color`, `balance`) VALUES
  ('a_saving_default', 'u_cc8f5b30', '储蓄卡',   'saving', '🏦', '#E0F2FF', 0.00),
  ('a_credit_default', 'u_cc8f5b30', '信用卡',   'credit', '💳', '#FFF3E0', 0.00),
  ('a_huabei_default', 'u_cc8f5b30', '花呗',     'huabei', '💙', '#F0E8FF', 0.00),
  ('a_wechat_default', 'u_cc8f5b30', '微信零钱', 'wechat', '💚', '#E8F8F0', 0.00)
ON DUPLICATE KEY UPDATE
  `name`    = VALUES(`name`),
  `type`    = VALUES(`type`),
  `icon`    = VALUES(`icon`),
  `color`   = VALUES(`color`),
  `deleted_at` = NULL;

-- ---------------------------------------------------------------------
-- 6. 同步 roles.user_count 冗余计数（按 users 实际数量重算）
-- ---------------------------------------------------------------------
UPDATE `roles`
SET `user_count` = (
  SELECT COUNT(*) FROM `users`
  WHERE `users`.`role_code` = `roles`.`code`
    AND `users`.`deleted_at` IS NULL
);

-- =====================================================================
-- 校验（可选，执行后确认结果）
--   SELECT code, name, is_system, user_count FROM roles;   -- 期望 admin / user 两行
--   SELECT COUNT(*) FROM permissions;                       -- 期望 40
--   SELECT COUNT(DISTINCT module) FROM permissions;          -- 期望 12
--   SELECT role_code, COUNT(*) FROM role_permissions GROUP BY role_code;
--                                                           -- 期望 admin 40 / user 30
--   SELECT id, username, role_code, status FROM users;
--   SELECT id, name, type, balance FROM accounts;           -- 期望 4 行
-- =====================================================================
