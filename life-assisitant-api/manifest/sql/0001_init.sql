-- =====================================================================
-- 生活助手 · 初始数据库结构
-- 版本:0001
-- 适用:MySQL 8.0+
-- 字符集:utf8mb4
--
-- 加载方式(任选其一):
--   1. docker compose up -d 后,容器首次启动会自动执行
--   2. 手动执行:
--        mysql -h 127.0.0.1 -uroot -proot123 life_assistant < manifest/sql/0001_init.sql
--
-- ⚠️ 种子数据不变式(D-03):本文件的 roles / permissions / role_permissions /
--    admin 用户口令种子必须与 db/init_data.sql 逐字一致(历史迁移
--    db/260917_role_permission_v2.sql 为基线)。任何权限目录改动三处同步。
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. roles(角色表)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `role_permissions`;
DROP TABLE IF EXISTS `permissions`;
DROP TABLE IF EXISTS `refresh_tokens`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `roles`;

CREATE TABLE `roles` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增排序号:admin=1,user=2,自定义按创建顺序递增(仅展示排序,业务主键是 code)',
  `code`        VARCHAR(20)  NOT NULL                COMMENT '角色编码:内置 admin/user + 自定义角色(D-03)',
  `name`        VARCHAR(50)  NOT NULL                COMMENT '角色中文名',
  `description` VARCHAR(200) DEFAULT NULL            COMMENT '描述',
  `is_system`   TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '是否系统内置(内置=界面不可删除;自定义角色由后端显式写 0)',
  `user_count`  INT          NOT NULL DEFAULT 0      COMMENT '冗余:该角色下的用户数',
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`code`),
  UNIQUE KEY `uk_roles_id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色表';

-- 预置 2 个内置角色(D-03:editor/viewer 废弃,自定义角色运行时创建)
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `is_system`) VALUES
  (1, 'admin', '管理员', '内置超级角色:拥有全部权限,权限矩阵固定不可修改,角色不可删除', 1),
  (2, 'user',  '用户',   '默认普通用户角色:个人域全部功能,不含用户/角色管理;权限可在权限管理页调整', 1);

-- ---------------------------------------------------------------------
-- 2. permissions(权限表)
-- D-03:11 模块 × 按真实功能设计 = 37 点(旧「模块 × 抽象CRUD」填充式目录废弃)
-- 260919:经期记录模块 period 上线 → 12 模块 = 40 点
-- 260919(第二批):健康模块 health(3)+ 纪念日 anniversary(2)→ 14 模块 = 45 点
-- 260921:记账分类新增 finance:category(1)→ 14 模块 = 46 点
-- 260922:习惯/待办分类新增 category 模块 category:view / category:manage(2)→ 15 模块 = 48 点
-- 与 db/init_data.sql 逐字一致(历史迁移 db/260917_role_permission_v2.sql 的效果已并入)
-- ---------------------------------------------------------------------
CREATE TABLE `permissions` (
  `id`          VARCHAR(32)  NOT NULL                COMMENT 'p_home_view 等',
  `module`      VARCHAR(50)  NOT NULL                COMMENT '功能模块编码',
  `action`      VARCHAR(20)  NOT NULL                COMMENT '操作编码',
  `description` VARCHAR(200) DEFAULT NULL            COMMENT '权限描述',
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_action` (`module`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限点(模块×操作)';

-- 预置 48 条权限点(与后端 middleware.RequirePermission 路由一一对应)
INSERT INTO `permissions` (`id`, `module`, `action`, `description`) VALUES
-- home 首页
  ('p_home_view',                'home',         'view',        '查看首页聚合数据'),
  ('p_home_sync',                'home',         'sync',        '手动同步数据'),
-- task 任务
  ('p_task_view',                'task',         'view',        '查看任务'),
  ('p_task_create',              'task',         'create',      '创建任务'),
  ('p_task_update',              'task',         'update',      '编辑任务(含子任务勾选)'),
  ('p_task_complete',            'task',         'complete',    '完成任务(含批量)'),
  ('p_task_delete',              'task',         'delete',      '删除任务(含批量)'),
-- habit 习惯
  ('p_habit_view',               'habit',        'view',        '查看习惯(含今日)'),
  ('p_habit_checkin',            'habit',        'checkin',     '习惯打卡'),
  ('p_habit_create',             'habit',        'create',      '创建习惯'),
  ('p_habit_update',             'habit',        'update',      '编辑习惯'),
  ('p_habit_delete',             'habit',        'delete',      '删除习惯'),
-- category 习惯/待办分类(20260922 新增;user_categories 两域共用实体,不挂 habit/task 名下)
  ('p_category_view',            'category',     'view',        '查看习惯/待办分类'),
  ('p_category_manage',          'category',     'manage',      '管理习惯/待办分类(增删改)'),
-- mood 心情/精力
  ('p_mood_view',                'mood',         'view',        '查看心情记录'),
  ('p_mood_write',               'mood',         'write',       '记录今日心情/精力'),
-- finance 财务
  ('p_finance_view',             'finance',      'view',        '查看账户/交易/预算'),
  ('p_finance_account',          'finance',      'account',     '管理账户(增删改)'),
  ('p_finance_record',           'finance',      'record',      '记账(收支/转账)'),
  ('p_finance_tx_manage',        'finance',      'tx_manage',   '修改/冲正/删除交易'),
  ('p_finance_budget',           'finance',      'budget',      '管理预算'),
  ('p_finance_category',         'finance',      'category',    '管理收支分类'),
-- period 经期记录(260919 新增;记录模块的第 5 个维度)
  ('p_period_view',              'period',       'view',        '查看经期记录与预测'),
  ('p_period_write',             'period',       'write',       '记录经期日记与修改设置'),
  ('p_period_manage',            'period',       'manage',      '修正周期与重置经期数据'),
-- health 健康(20260919-v1 新增;记录模块第 3 个 tab,经期是其中一个可开关指标)
  ('p_health_view',              'health',       'view',        '查看健康记录与概览'),
  ('p_health_write',             'health',       'write',       '记录健康数据(饮水/体重/体温等)'),
  ('p_health_manage',            'health',       'manage',      '修改健康设置与重置健康数据'),
-- anniversary 纪念日(20260919-v1 新增;入口在「我的 → 重要日子」)
  ('p_anniversary_view',         'anniversary',  'view',        '查看纪念日与倒数日'),
  ('p_anniversary_write',        'anniversary',  'write',       '管理纪念日(增删改)'),
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
  ('p_user_mgmt_update',         'user_mgmt',    'update',      '编辑用户(含启用/禁用)'),
  ('p_user_mgmt_delete',         'user_mgmt',    'delete',      '删除用户'),
  ('p_user_mgmt_assign_role',    'user_mgmt',    'assign_role', '为用户分配角色'),
-- role_mgmt 角色与权限管理
  ('p_role_mgmt_view',           'role_mgmt',    'view',        '查看角色与权限配置'),
  ('p_role_mgmt_create',         'role_mgmt',    'create',      '新建自定义角色'),
  ('p_role_mgmt_update',         'role_mgmt',    'update',      '编辑角色名称/描述'),
  ('p_role_mgmt_delete',         'role_mgmt',    'delete',      '删除自定义角色'),
  ('p_role_mgmt_grant',          'role_mgmt',    'grant',       '配置角色权限(勾选保存)');

-- ---------------------------------------------------------------------
-- 3. role_permissions(角色-权限关联表,带乐观锁)
-- ---------------------------------------------------------------------
CREATE TABLE `role_permissions` (
  `role_code`     VARCHAR(20)  NOT NULL,
  `permission_id` VARCHAR(32)  NOT NULL,
  `enabled`       TINYINT(1)   NOT NULL DEFAULT 1,
  `updated_at`    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `version`       INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
  PRIMARY KEY (`role_code`, `permission_id`),
  KEY `idx_role` (`role_code`),
  CONSTRAINT `fk_rp_role`       FOREIGN KEY (`role_code`)     REFERENCES `roles`(`code`),
  CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-权限关联';

-- 预置权限矩阵(D-03,目录推导 -- 与 db/init_data.sql 逐字一致)
-- admin = 全部 48 点(服务端代码旁路 + 矩阵锁定不可改)
-- user  = 个人域 38 点(排除 user_mgmt / role_mgmt;权限页可调。
--         260922 新增 category 模块 2 点对 user 角色自动派生授予 -- 否则用户进分类页 403)
-- version=1:与迁移后线上数据一致(首次「保存权限」会 +1 → 2)

INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'admin', `id`, 1, 1 FROM `permissions`;

INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'user', `id`, 1, 1 FROM `permissions`
WHERE `module` NOT IN ('user_mgmt', 'role_mgmt');

-- ---------------------------------------------------------------------
-- 4. users(用户表,带软删除)
-- ---------------------------------------------------------------------
CREATE TABLE `users` (
  `id`                VARCHAR(32)   NOT NULL                COMMENT 'u_001 格式',
  `username`          VARCHAR(32)   NOT NULL                COMMENT '登录账号',
  `password_hash`     VARCHAR(255)  NOT NULL                COMMENT 'bcrypt(cost=12)',
  `name`              VARCHAR(50)   NOT NULL                COMMENT '真实姓名',
  `email`             VARCHAR(100)  DEFAULT NULL            COMMENT '邮箱(管理员代建用户可空;NULL 不参与唯一冲突)',
  `phone`             VARCHAR(20)   DEFAULT NULL,
  `avatar`            VARCHAR(500)  DEFAULT NULL            COMMENT '头像 URL:/uploads/avatars/<file> 或 http(s) 外链;NULL=显示姓名首字',
  `role_code`         VARCHAR(20)   NOT NULL                COMMENT '角色编码:内置 admin/user + 自定义(D-03)',
  `department`        VARCHAR(50)   DEFAULT NULL,
  `status`            VARCHAR(20)   NOT NULL DEFAULT 'active' COMMENT 'active/disabled/deleted',
  `pwd_reset_required` TINYINT(1)   NOT NULL DEFAULT 0       COMMENT '需修改初始密码:管理员代建=1,本人改密成功=0(D-03 第六轮)',
  `preferences`       JSON          DEFAULT NULL            COMMENT '用户偏好(主题/通知/语言)',
  `failed_login_count`INT           NOT NULL DEFAULT 0      COMMENT '连续登录失败次数(5 次锁定)',
  `locked_until`      TIMESTAMP     NULL DEFAULT NULL       COMMENT '锁定截止时间',
  `last_login_at`     TIMESTAMP     NULL DEFAULT NULL,
  `last_login_ip`     VARCHAR(50)   DEFAULT NULL,
  `last_login_device` VARCHAR(20)   DEFAULT NULL,
  `created_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `version`           INT           NOT NULL DEFAULT 0      COMMENT '乐观锁',
  `deleted_at`        TIMESTAMP     NULL DEFAULT NULL       COMMENT '软删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_email`    (`email`),
  KEY `idx_role`          (`role_code`),
  KEY `idx_status`        (`status`),
  KEY `idx_created`       (`created_at`),
  KEY `idx_deleted`       (`deleted_at`),
  CONSTRAINT `fk_user_role` FOREIGN KEY (`role_code`) REFERENCES `roles`(`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 默认管理员账号(与 db/init_data.sql 逐字一致 -- 即当前线上库状态)
-- 邮箱:admin@life.app
-- 密码:Admin@123
-- bcrypt cost=12($2a$ Go x/crypto/bcrypt 生成,与 utility.VerifyPassword 同库校验)
INSERT INTO `users`
  (`id`, `username`, `password_hash`, `name`, `email`, `role_code`, `department`, `status`, `preferences`)
VALUES
  ('u_cc8f5b30', 'admin', '$2a$12$.s51IL55OEAg.78Y6i11EOxOPOA9.ooixskhMuPP.p.MLdr8mdVMu',
   '系统管理员', 'admin@life.app', 'admin', '产品部', 'active',
   JSON_OBJECT('theme', 'light', 'language', 'zh-CN', 'notifications', JSON_OBJECT('email', true, 'push', true)));

-- 重算 roles.user_count 冗余计数(admin=1,user=0)
UPDATE `roles` r SET r.`user_count` = (
  SELECT COUNT(*) FROM `users` u
  WHERE u.`role_code` = r.`code` AND u.`deleted_at` IS NULL
);

-- ---------------------------------------------------------------------
-- 5. refresh_tokens(刷新令牌表)
-- ---------------------------------------------------------------------
CREATE TABLE `refresh_tokens` (
  `id`           VARCHAR(64)   NOT NULL                COMMENT 'UUID',
  `user_id`      VARCHAR(32)   NOT NULL,
  `token_hash`   VARCHAR(255)  NOT NULL                COMMENT 'refresh_token 哈希值(不存明文)',
  `device_id`    VARCHAR(100)  NOT NULL                COMMENT '设备指纹',
  `device_info`  JSON          DEFAULT NULL            COMMENT '设备信息(OS/UA/型号)',
  `ip`           VARCHAR(50)   DEFAULT NULL,
  `expires_at`   TIMESTAMP     NOT NULL,
  `revoked_at`   TIMESTAMP     NULL DEFAULT NULL       COMMENT '主动撤销时间',
  `created_at`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token` (`token_hash`),
  KEY `idx_user`         (`user_id`),
  KEY `idx_device`       (`user_id`, `device_id`),
  KEY `idx_expires`      (`expires_at`),
  CONSTRAINT `fk_rt_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Refresh Token 表';

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- 6. tasks(任务表)
-- MVP 字段:标题/描述/优先级/状态/分类/截止时间 + 软删除
-- 不做:提醒/reminder_at、重复/recurrence_rule、子任务、附件
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `tasks`;

CREATE TABLE `tasks` (
  `id`          VARCHAR(32)  NOT NULL                  COMMENT 't_xxxx 格式(utility.NewID("t") 生成)',
  `user_id`     VARCHAR(32)  NOT NULL                  COMMENT '所属用户',
  `title`       VARCHAR(200) NOT NULL                  COMMENT '任务标题,1-200 字符',
  `description` TEXT         DEFAULT NULL              COMMENT '详细描述',
  `priority`    VARCHAR(2)   NOT NULL DEFAULT 'P2'     COMMENT 'P0/P1/P2/P3',
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'todo'   COMMENT 'todo/in_progress/done/archived',
  `category_id` VARCHAR(32)  DEFAULT NULL              COMMENT '分类 ID(user_categories.domain=task 的 id,内置 c_work...;NULL=未分类)',
  `icon`        VARCHAR(40)  NOT NULL DEFAULT ''       COMMENT '图标引用 lucide:<Name> / emoji;空=继承分类图标(20260922 新增)',
  `due_date`    DATE         DEFAULT NULL              COMMENT '截止日期',
  `due_time`    VARCHAR(5)   DEFAULT NULL              COMMENT '截止时间 HH:MM',
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP   NULL DEFAULT NULL         COMMENT '完成时间(status=done 时设置)',
  `deleted_at`  TIMESTAMP    NULL DEFAULT NULL         COMMENT '软删除标记',
  PRIMARY KEY (`id`),
  KEY `idx_user_status`   (`user_id`, `status`),
  KEY `idx_user_due`      (`user_id`, `due_date`),
  KEY `idx_user_priority` (`user_id`, `priority`),
  KEY `idx_deleted`       (`deleted_at`),
  CONSTRAINT `fk_task_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务表';

-- ---------------------------------------------------------------------
-- 7. habits(习惯表)
-- MVP 字段:标题/描述/icon/color/frequency/target_count/unit/status
-- 不做:reminder_time、custom_days、weekly_target、is_archived(用 status 替代)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `habit_logs`;
DROP TABLE IF EXISTS `habits`;

CREATE TABLE `habits` (
  `id`           VARCHAR(32)   NOT NULL                       COMMENT 'h_xxxx 格式(utility.NewID("h"))',
  `user_id`      VARCHAR(32)   NOT NULL                       COMMENT '所属用户',
  `title`        VARCHAR(200)  NOT NULL                       COMMENT '习惯名,1-200 字符',
  `description`  VARCHAR(500)  DEFAULT NULL                   COMMENT '详细描述',
  `icon`         VARCHAR(40)   NOT NULL DEFAULT ''             COMMENT '图标引用 lucide:<Name> / emoji;空=继承分类图标(20260922:20→40 防静默截断;默认 📌→空)',
  `color`        VARCHAR(20)   NOT NULL DEFAULT '#014DB2'      COMMENT '图标底色 hex',
  `frequency`    VARCHAR(20)   NOT NULL DEFAULT 'daily'       COMMENT 'daily/weekly/monthly',
  `category`     VARCHAR(20)   NOT NULL DEFAULT 'life'        COMMENT '分类(user_categories.domain=habit 的 id,内置 sport/diet/life/study)',
  `target_count` INT           NOT NULL DEFAULT 1             COMMENT '每周期目标次数(默认 1)',
  `unit`         VARCHAR(20)   DEFAULT NULL                   COMMENT '单位(分钟/次/杯...)',
  `status`       VARCHAR(16)   NOT NULL DEFAULT 'active'      COMMENT 'active/archived',
  `track_duration` TINYINT(1)  NOT NULL DEFAULT 0             COMMENT '是否记录打卡时长',
  `current_streak` INT        NOT NULL DEFAULT 0             COMMENT '当前连续(单位由 frequency 决定)',
  `longest_streak` INT        NOT NULL DEFAULT 0             COMMENT '历史最长连续',
  `last_check_in_date` DATE   NULL DEFAULT NULL              COMMENT '最后打卡日',
  `total_check_ins` INT        NOT NULL DEFAULT 0             COMMENT '累计打卡次数',
  `created_at`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   TIMESTAMP     NULL DEFAULT NULL              COMMENT '软删除标记',
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_deleted`     (`deleted_at`),
  CONSTRAINT `fk_habit_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='习惯表';

-- ---------------------------------------------------------------------
-- 8. habit_logs(习惯打卡日志)
-- 唯一索引 (habit_id, log_date):同一天同习惯只能打一条(upsert,count 累加)
-- ---------------------------------------------------------------------
CREATE TABLE `habit_logs` (
  `id`        VARCHAR(32)  NOT NULL                  COMMENT 'hl_xxxx 格式(utility.NewID("hl"))',
  `habit_id`  VARCHAR(32)  NOT NULL                  COMMENT '关联 habits.id',
  `user_id`   VARCHAR(32)  NOT NULL                  COMMENT '所属用户(冗余便于按用户日期查询)',
  `log_date`  DATE         NOT NULL                  COMMENT '打卡日期 YYYY-MM-DD',
  `count`     INT          NOT NULL DEFAULT 1        COMMENT '本次打卡次数(多次打卡累加)',
  `note`      VARCHAR(500) DEFAULT NULL              COMMENT '备注',
  `duration_minutes` INT  NOT NULL DEFAULT 0         COMMENT '打卡时长(分钟)',
  `created_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_habit_date` (`habit_id`, `log_date`),
  KEY `idx_user_date`        (`user_id`, `log_date`),
  CONSTRAINT `fk_habitlog_habit` FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='习惯打卡日志';

-- ---------------------------------------------------------------------
-- 9. accounts(账户表)
-- MVP 字段:name/type/icon/color/balance
-- 不做:is_default/credit_limit/billing_date/due_date/is_archived
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `accounts`;

CREATE TABLE `accounts` (
  `id`         VARCHAR(32)    NOT NULL                      COMMENT 'a_xxxx 格式(utility.NewID("a"))',
  `user_id`    VARCHAR(32)    NOT NULL                      COMMENT '所属用户',
  `name`       VARCHAR(50)    NOT NULL                      COMMENT '账户名',
  `type`       VARCHAR(20)    NOT NULL                      COMMENT 'saving/credit/huabei/wechat',
  `icon`       VARCHAR(32)    NOT NULL DEFAULT '💰'          COMMENT '图标引用:brand:<slug> | lucide:<Name> | <emoji>',
  `institution` VARCHAR(20)   NOT NULL DEFAULT ''            COMMENT '银行 code(CCB/ICBC),空=未指定',
  `color`      VARCHAR(20)    NOT NULL DEFAULT '#E0F2FF'     COMMENT '图标底色 hex',
  `balance`    DECIMAL(18, 2) NOT NULL DEFAULT 0            COMMENT '当前余额(shopspring/decimal 精确计算)',
  `created_at` TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP      NULL DEFAULT NULL             COMMENT '软删除标记',
  PRIMARY KEY (`id`),
  KEY `idx_user_type`  (`user_id`, `type`),
  KEY `idx_deleted`    (`deleted_at`),
  CONSTRAINT `fk_account_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账户表';

-- 内置 4 个默认账户(绑定到 admin 用户,余额 0)
INSERT INTO `accounts` (`id`, `user_id`, `name`, `type`, `icon`, `color`, `balance`) VALUES
  ('a_saving_default',  'u_cc8f5b30', '储蓄卡',   'saving', '🏦', '#E0F2FF', 0.00),
  ('a_credit_default',  'u_cc8f5b30', '信用卡',   'credit', '💳', '#FFF3E0', 0.00),
  ('a_huabei_default',  'u_cc8f5b30', '花呗',     'huabei', '💙', '#F0E8FF', 0.00),
  ('a_wechat_default',  'u_cc8f5b30', '微信零钱', 'wechat', '💚', '#E8F8F0', 0.00);

-- ---------------------------------------------------------------------
-- 10. transactions(交易表)
-- MVP 字段:type/amount/category_emoji/category_name/category_id/account_id/to_account_id/note/happened_at
-- type: expense/income/transfer
-- 260921:新增 category_id(权威,指向 finance_categories.id);category_name 退化为**写入快照**,
--         category_emoji 保留仅供历史数据渲染(不再写新值),本次**不删任何旧列**(两步走)。
-- 不做:attachments / location / version
-- ---------------------------------------------------------------------
CREATE TABLE `transactions` (
  `id`             VARCHAR(32)    NOT NULL                       COMMENT 'tx_xxxx 格式(utility.NewID("tx"))',
  `user_id`        VARCHAR(32)    NOT NULL                       COMMENT '所属用户',
  `type`           VARCHAR(20)    NOT NULL                       COMMENT 'expense/income/transfer',
  `amount`         DECIMAL(18, 2) NOT NULL                       COMMENT '金额(始终为正)',
  `category_emoji` VARCHAR(20)    DEFAULT NULL                   COMMENT '分类 emoji(文本)',
  `category_name`  VARCHAR(50)    DEFAULT NULL                   COMMENT '分类名(快照,文本)',
  `category_id`    VARCHAR(32)    DEFAULT NULL                   COMMENT '分类 id(权威,指向 finance_categories.id);NULL = 历史数据未映射',
  `account_id`     VARCHAR(32)    NOT NULL                       COMMENT '出/入账账户 ID',
  `to_account_id`  VARCHAR(32)    DEFAULT NULL                   COMMENT '转入账户 ID(仅 transfer)',
  `note`           VARCHAR(500)   DEFAULT NULL                   COMMENT '备注',
  `exclude_budget` TINYINT(1)     NOT NULL DEFAULT 0              COMMENT '1=不计入预算',
  `exclude_stats`  TINYINT(1)     NOT NULL DEFAULT 0              COMMENT '1=不计入收支统计',
  `source`         VARCHAR(20)    NOT NULL DEFAULT ''             COMMENT '来源:空=普通记账;balance_adjust=余额调整',
  `contact`        VARCHAR(50)    NOT NULL DEFAULT ''             COMMENT '对方(借入借出必填;待报销=报销对象;退款=商家)',
  `settle_of`      VARCHAR(32)    NOT NULL DEFAULT ''             COMMENT '关联的原交易 id(空=原笔;非空=核销/退还笔)',
  `happened_at`    TIMESTAMP      NOT NULL                       COMMENT '发生时间',
  `created_at`     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     TIMESTAMP      NULL DEFAULT NULL              COMMENT '软删除标记',
  PRIMARY KEY (`id`),
  KEY `idx_user_type`    (`user_id`, `type`),
  KEY `idx_user_happened`(`user_id`, `happened_at`),
  KEY `idx_tx_category`  (`category_id`),
  KEY `idx_account`      (`account_id`),
  KEY `idx_to_account`   (`to_account_id`),
  KEY `idx_deleted`      (`deleted_at`),
  CONSTRAINT `fk_tx_user`        FOREIGN KEY (`user_id`)        REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tx_account`     FOREIGN KEY (`account_id`)     REFERENCES `accounts`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_tx_to_account`  FOREIGN KEY (`to_account_id`)  REFERENCES `accounts`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交易表';

-- ---------------------------------------------------------------------
-- 11. budgets(预算表)
-- MVP 字段:name/period/amount/start_date/end_date/alert_threshold/is_alerted
-- used 字段由后端实时计算(基于 transactions 的支出合计),不存表
-- 预算表(含分类预算 scope 字段)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `budgets`;

CREATE TABLE `budgets` (
  `id`              VARCHAR(32)    NOT NULL                       COMMENT 'b_xxxx 格式(utility.NewID("b"))',
  `user_id`         VARCHAR(32)    NOT NULL                       COMMENT '所属用户',
  `name`            VARCHAR(50)    NOT NULL                       COMMENT '预算名称,如"7月总预算"',
  `period`          VARCHAR(20)    NOT NULL DEFAULT 'monthly'     COMMENT 'monthly/weekly/yearly',
  `amount`          DECIMAL(18, 2) NOT NULL                       COMMENT '预算总额',
  `scope`           VARCHAR(20)    NOT NULL DEFAULT 'total'       COMMENT 'total/category',
  `category_emoji`  VARCHAR(20)    NULL                           COMMENT '分类预算-表情(scope=category 时)',
  `category_name`   VARCHAR(50)    NULL                           COMMENT '分类预算-分类名(快照,scope=category 时)',
  `category_id`     VARCHAR(32)    NULL                           COMMENT '分类 id(权威,指向 finance_categories.id);scope=total 时为空',
  `start_date`      DATE           NOT NULL                       COMMENT '预算起始日期',
  `end_date`        DATE           NOT NULL                       COMMENT '预算结束日期',
  `alert_threshold` DECIMAL(3, 2)  NOT NULL DEFAULT 0.80          COMMENT '预警阈值(0.80 = 80%)',
  `is_alerted`      TINYINT(1)     NOT NULL DEFAULT 0             COMMENT '是否已触发预警',
  `created_at`      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      TIMESTAMP      NULL DEFAULT NULL              COMMENT '软删除标记',
  PRIMARY KEY (`id`),
  KEY `idx_user_period`  (`user_id`, `start_date`, `end_date`),
  KEY `idx_budget_category` (`category_id`),
  KEY `idx_budgets_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_budget_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预算表';

-- ---------------------------------------------------------------------
-- 11b. finance_categories(收支分类,20260921 新增)
--      一级 + 二级同表,parent_id 自关联;空串 = 一级(不用 NULL,见 02 §1.2)。
--      ⚠️ 主键为**复合主键 (id, user_id)**:分类是「每人一份」,内置项用固定 id
--         (fc_b_food),若只写 PRIMARY KEY (id),第 2 个用户播种会全部撞主键被静默丢弃。
--      ⚠️ 唯一索引 uk_fin_cat_user_scope_parent_name 末列是 deleted_seq(不是 is_deleted):
--         软删写自身 id,避免「同名分类反复删除」撞 uk 1062。索引名须与 model tag 逐字一致。
--      ⚠️ 内置种子**不进 SQL**(每用户一份),由后端懒创建(utility.BuildSeedCategories)。
-- ---------------------------------------------------------------------
CREATE TABLE `finance_categories` (
  `id`         VARCHAR(32)  NOT NULL                  COMMENT '主键之一;内置项用固定 id(fc_b_food),用户新建用 uuid 去横线',
  `user_id`    VARCHAR(32)  NOT NULL                  COMMENT '归属用户(分类是用户级的);主键之一',
  `parent_id`  VARCHAR(32)  NOT NULL DEFAULT ''       COMMENT '父分类 id;⚠️ 空串 = 一级分类',
  `scope`      VARCHAR(10)  NOT NULL DEFAULT 'expense' COMMENT 'expense 支出 / income 收入',
  `name`       VARCHAR(30)  NOT NULL                  COMMENT '显示名(不含父级前缀),如「三餐」',
  `full_name`  VARCHAR(80)  DEFAULT NULL              COMMENT '完整名,如「餐饮-三餐」;用于快照与搜索',
  `emoji`      VARCHAR(20)  DEFAULT NULL              COMMENT '可选 emoji(兼容旧渲染 / 导出)',
  `icon`       VARCHAR(40)  DEFAULT NULL              COMMENT 'Lucide 图标名(PascalCase),如 Utensils',
  `tint`       VARCHAR(20)  DEFAULT NULL              COMMENT '语义色名,取自 utils/tint 的 TintName',
  `sort`       INT          NOT NULL DEFAULT 0        COMMENT '排序,越小越前;内置项 10/20/30...,用户新建从 900 起',
  `is_builtin` TINYINT(1)   NOT NULL DEFAULT 0        COMMENT '是否内置种子(供「恢复默认」与「是否已播种」判断)',
  `is_deleted` TINYINT(1)   NOT NULL DEFAULT 0        COMMENT '软删除标记(audit 用;唯一索引末列已改为 deleted_seq)',
  `deleted_seq` VARCHAR(32) NOT NULL DEFAULT ''       COMMENT '软删序号:活跃行恒为 '''';删除时写自身 id(全库唯一),作 uk 末列避免同名反复删撞 1062',
  `created_at` DATETIME     DEFAULT NULL,
  `updated_at` DATETIME     DEFAULT NULL,
  `deleted_at` DATETIME     DEFAULT NULL              COMMENT '软删除时间(审计用)',
  PRIMARY KEY (`id`, `user_id`),
  UNIQUE KEY `uk_fin_cat_user_scope_parent_name` (`user_id`, `scope`, `parent_id`, `name`, `deleted_seq`),
  KEY `idx_fin_cat_user_scope` (`user_id`, `scope`),
  KEY `idx_fin_cat_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收支分类(两级,用户级)';

-- ---------------------------------------------------------------------
-- 11c. user_categories(习惯/待办分类,20260922 新增)
--      习惯(domain=habit)与待办(domain=task)两域共用一张表,用户级(每人一份)。
--      ⚠️ **复合主键 (id, user_id)**:内置 id 保留旧值(sport / c_work...,06 §3.2 零迁移),
--         跨用户重复,单主键必撞;任何按 id 的查询必须同时带 user_id。
--      ⚠️ 唯一索引 uk_user_cat 末列是 deleted_seq(**不是 deleted_at**):活跃行 deleted_at 为
--         NULL,NULL 不参与唯一比较会让约束静默失效;deleted_seq 删除时写随机值,
--         避免「同名分类删了再建再删」撞 1062。索引名须与 model tag 逐字一致(项目铁律)。
--      ⚠️ 内置种子**不进 SQL**(每用户一份),由后端懒创建(utility.BuildUserCategories,
--         判断口径 = 该用户该 domain 是否存在 is_builtin=1 的行,**含已删行**)。
--      ⚠️ 零数据回填:habits.category / tasks.category_id 存量值直接命中内置 id。
-- ---------------------------------------------------------------------
CREATE TABLE `user_categories` (
  `id`          VARCHAR(32)  NOT NULL                  COMMENT '主键之一;内置项保留旧值(sport/c_work...),用户新建用 uc_<domain>_<10位随机>',
  `user_id`     VARCHAR(32)  NOT NULL                  COMMENT '归属用户(分类是用户级的);主键之一',
  `domain`      VARCHAR(16)  NOT NULL                  COMMENT 'habit | task',
  `parent_id`   VARCHAR(32)  NOT NULL DEFAULT ''       COMMENT '父分类 id（R3 两级分类）；空串 = 一级", 二级指向同域一级的 id',
  `name`        VARCHAR(30)  NOT NULL                  COMMENT '显示名，去空白后 1-10 字',
  `full_name`   VARCHAR(80)  NOT NULL DEFAULT ''       COMMENT '完整名（运动-跑步）；二级为空时读时用「父名-子名」拼接兜底',
  `emoji`       VARCHAR(20)  NOT NULL DEFAULT ''       COMMENT '可选 emoji（兼容旧渲染 / 导出）',
  `icon`        VARCHAR(40)  NOT NULL DEFAULT ''       COMMENT 'lucide:Pin',
  `tint`        VARCHAR(20)  NOT NULL DEFAULT 'neutral' COMMENT '语义色名（primary/success/accent/danger/warning/neutral）',
  `sort`        INT          NOT NULL DEFAULT 0        COMMENT '排序，越小越前；内置项 10/20/30…，用户新建从 900 起',
  `is_builtin`  TINYINT      NOT NULL DEFAULT 0        COMMENT '是否内置种子（含已删行，供「是否已播种」判断）',
  `is_deleted`  TINYINT      NOT NULL DEFAULT 0        COMMENT '软删除标记',
  `deleted_seq` VARCHAR(32)  NOT NULL DEFAULT ''       COMMENT '软删序号：活跃行恒为 '''';删除时写随机值，作 uk 末列避免同名反复删撞 1062',
  `created_at`  DATETIME     NULL,
  `updated_at`  DATETIME     NULL,
  `deleted_at`  DATETIME     NULL,
  PRIMARY KEY (`id`, `user_id`),
  UNIQUE KEY `uk_user_cat` (`user_id`, `domain`, `parent_id`, `name`, `deleted_seq`),
  KEY `idx_user_cat_domain` (`user_id`, `domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 12. mood_logs(心情/精力日志)
-- 260919:由「一天一条」改为按小时记录 -- UNIQUE(user_id,date,hour)
--   hour 0-23;12 是经期日记的槽位(model.MoodDiaryHour)
--   mood 1-5(0 = 该小时不填,读取时按同日上一条向前延续)
--   energy 1-3 可空(NULL 等价于 0 = 不填);note ≤50 字,不延续
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `mood_logs`;

CREATE TABLE `mood_logs` (
  `id`         VARCHAR(32)  NOT NULL                  COMMENT 'ml_xxxx 格式(utility.NewID("ml"))',
  `user_id`    VARCHAR(32)  NOT NULL                  COMMENT '所属用户',
  `date`       DATE         NOT NULL                  COMMENT '记录日期 YYYY-MM-DD',
  `hour`       TINYINT      NOT NULL DEFAULT 12       COMMENT '小时 0-23;12 = 经期日记槽位',
  `mood`       TINYINT      NOT NULL                  COMMENT '心情 1-5;0 = 该小时不填(读取时按上一条延续)',
  `energy`     TINYINT      DEFAULT NULL              COMMENT '精力 1-3,可空(NULL 等价于 0 = 不填)',
  `note`       VARCHAR(200) DEFAULT NULL              COMMENT '备注,≤50 字,不延续',
  `created_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date_hour` (`user_id`, `date`, `hour`),
  KEY `idx_user_date` (`user_id`, `date`),
  CONSTRAINT `fk_moodlog_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='心情/精力日志';

-- ---------------------------------------------------------------------
-- 13. notifications(站内通知)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `notifications`;

CREATE TABLE `notifications` (
  `id`         VARCHAR(32)   NOT NULL                  COMMENT 'n_xxxx 格式(utility.NewID("n"))',
  `user_id`    VARCHAR(32)   NOT NULL                  COMMENT '接收用户',
  `type`       VARCHAR(30)   NOT NULL                  COMMENT '通知类型:task_reminder/habit_reminder/budget_alert/weekly_report/system',
  `title`      VARCHAR(200)  NOT NULL                  COMMENT '标题',
  `body`       VARCHAR(1000) DEFAULT NULL              COMMENT '内容',
  `is_read`    TINYINT(1)    NOT NULL DEFAULT 0        COMMENT '是否已读',
  `read_at`    TIMESTAMP     NULL DEFAULT NULL         COMMENT '已读时间',
  `created_at` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_read`    (`user_id`, `is_read`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内通知';

-- ---------------------------------------------------------------------
-- 14. period_days / period_cycles / period_settings(经期记录,260919 新增)
--     period_days  = 逐日打卡,唯一事实源(UNIQUE(user_id, date))
--     period_cycles= 由 period_days 幂等派生,支持人工修正
--     period_settings = 每用户一行,首次访问懒创建
--     心情/精力/备注不新建表,复用 mood_logs(见 db/init.sql 第 12 节)
--     ⚠️ 没有 hide_tab 列:隐私遮罩是前端 localStorage 的设备级状态
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `period_days`;

CREATE TABLE `period_days` (
  `id`          varchar(32)  NOT NULL                COMMENT 'pd_xxxx 格式(utility.NewID("pd"))',
  `user_id`     varchar(32)  NOT NULL                COMMENT '所属用户(users.id)',
  `date`        date         NOT NULL                COMMENT '记录日期(本地日期,非 UTC)',
  `flow`        tinyint      NOT NULL DEFAULT 0      COMMENT '0未记录 1点滴 2量少 3中等 4量多',
  `symptoms`    json         NULL DEFAULT NULL       COMMENT '症状 key 数组',
  `pain_level`  tinyint      NOT NULL DEFAULT 0      COMMENT '痛经等级 0未记录 1..5',
  `discharge`   tinyint      NOT NULL DEFAULT 0      COMMENT '0未记录 1干燥 2粘稠 3乳白 4水样 5蛋清拉丝',
  `bbt`         decimal(4,2) NULL DEFAULT NULL       COMMENT '基础体温 °C,34.00~42.00',
  `weight`      decimal(5,2) NULL DEFAULT NULL       COMMENT '体重 kg,20.00~300.00',
  `sleep_hours` decimal(3,1) NULL DEFAULT NULL       COMMENT '睡眠时长 h,0.0~24.0',
  `intercourse` tinyint      NOT NULL DEFAULT 0      COMMENT '0未记录 1有(未避孕) 2有(避孕)',
  `created_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_period_days_user_date` (`user_id` ASC, `date` ASC) USING BTREE,
  INDEX `idx_period_days_user_date` (`user_id` ASC, `date` DESC) USING BTREE,
  CONSTRAINT `fk_period_day_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='经期逐日记录';

DROP TABLE IF EXISTS `period_cycles`;

CREATE TABLE `period_cycles` (
  `id`               varchar(32)  NOT NULL                COMMENT 'pc_xxxx 格式(utility.NewID("pc"))',
  `user_id`          varchar(32)  NOT NULL                COMMENT '所属用户(users.id)',
  `start_date`       date         NOT NULL                COMMENT '本次经期第一天',
  `end_date`         date         NULL DEFAULT NULL       COMMENT '本次经期最后一天,进行中为 NULL',
  `period_length`    smallint     NOT NULL DEFAULT 0      COMMENT '出血天数(不含点滴出血)',
  `cycle_length`     smallint     NULL DEFAULT NULL       COMMENT '本次 start - 上次 start;首个周期为 NULL',
  `ovulation_date`   date         NULL DEFAULT NULL       COMMENT '排卵日(用户手动标记或体温法确认)',
  `ovulation_source` tinyint      NOT NULL DEFAULT 0      COMMENT '0无 1算法推算 2体温法确认 3用户手动',
  `is_manual`        tinyint(1)   NOT NULL DEFAULT 0      COMMENT '用户是否手动修正过 start/end',
  `note`             varchar(255) NOT NULL DEFAULT ''     COMMENT '周期备注',
  `created_at`       timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_period_cycles_user_start` (`user_id` ASC, `start_date` ASC) USING BTREE,
  INDEX `idx_period_cycles_user_start` (`user_id` ASC, `start_date` DESC) USING BTREE,
  CONSTRAINT `fk_period_cycle_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='经期周期(由 period_days 派生)';

DROP TABLE IF EXISTS `period_settings`;

CREATE TABLE `period_settings` (
  `id`                     varchar(32) NOT NULL             COMMENT 'ps_xxxx 格式(utility.NewID("ps"))',
  `user_id`                varchar(32) NOT NULL             COMMENT '所属用户(users.id)',
  `avg_cycle_length`       smallint    NOT NULL DEFAULT 28  COMMENT '默认周期长度,数据不足时兜底',
  `avg_period_length`      smallint    NOT NULL DEFAULT 5   COMMENT '默认经期长度',
  `luteal_length`          smallint    NOT NULL DEFAULT 14  COMMENT '黄体期长度,体温法可校准',
  `goal`                   tinyint     NOT NULL DEFAULT 1   COMMENT '1仅记录 2备孕 3避孕参考 4围绝经期',
  `show_fertile_window`    tinyint(1)  NOT NULL DEFAULT 1   COMMENT '是否显示易孕期/排卵日',
  `irregular_alert`        tinyint(1)  NOT NULL DEFAULT 1   COMMENT '是否开启异常提醒',
  `last_period_start`      date        NULL DEFAULT NULL    COMMENT '引导时填写,仅作无数据时的兜底',
  `disclaimer_accepted_at` datetime    NULL DEFAULT NULL    COMMENT '免责声明确认时间,NULL=未确认',
  `created_at`             timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_period_settings_user` (`user_id` ASC) USING BTREE,
  CONSTRAINT `fk_period_setting_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='经期设置';

-- ---------------------------------------------------------------------
-- 健康模块 + 纪念日(md/spec-20260919-v1,20260919 新增)
-- 增量脚本:db/data_260919_health.sql
-- ⚠️ id / user_id 一律 varchar(32)(本项目约定);spec 04 §2 的 bigint 草案是错的。
-- ---------------------------------------------------------------------

DROP TABLE IF EXISTS `health_days`;

CREATE TABLE `health_days` (
  `id`          varchar(32)  NOT NULL            COMMENT 'hd_xxxx(utility.NewID("hd"))',
  `user_id`     varchar(32)  NOT NULL            COMMENT '所属用户(users.id)',
  `date`        date         NOT NULL            COMMENT '用户本地日期,不做时区换算',
  `water_ml`    int          NOT NULL DEFAULT 0  COMMENT '当日累计饮水 ml(0-10000)',
  `weight_kg`   decimal(5,2) NULL DEFAULT NULL   COMMENT '体重 kg,20.00~300.00',
  `bbt`         decimal(4,2) NULL DEFAULT NULL   COMMENT '基础体温 °C,34.00~42.00',
  `sleep_hours` decimal(3,1) NULL DEFAULT NULL   COMMENT '睡眠时长 h,0.0~24.0',
  `bowel_count` tinyint      NOT NULL DEFAULT 0  COMMENT '排便次数 0~9',
  `bowel_type`  tinyint      NOT NULL DEFAULT 0  COMMENT '0未记录 1正常 2偏软 3偏硬 4腹泻',
  `created_at`  datetime     NULL DEFAULT NULL,
  `updated_at`  datetime     NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  -- ⚠️ 索引名必须与 Go model 的 uniqueIndex tag 逐字一致,否则 AutoMigrate 会误删
  UNIQUE INDEX `uk_health_days_user_date` (`user_id` ASC, `date` ASC) USING BTREE,
  CONSTRAINT `fk_health_day_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='身体指标逐日记录';

DROP TABLE IF EXISTS `health_events`;

-- 身体指标**时间轴事件**(2026-09-19 新增)
--
-- ⚠️ 体温 / 饮水 / 排便 不是一天一个定值(上午喝的和下午喝的是两次事件),
--    所以改成**多次记录**;与 mood_logs 的心情不同,这些**不延续**。
-- ⚠️ 本表是这五项指标的**唯一真源**;health_days 退化为日汇总缓存。
CREATE TABLE `health_events` (
  `id`          varchar(32)   NOT NULL            COMMENT 'he_xxxx(utility.NewID("he"))',
  `user_id`     varchar(32)   NOT NULL            COMMENT '所属用户(users.id)',
  `date`        date          NOT NULL            COMMENT '归属日期(冗余,按天查能走索引)',
  `time_of_day` char(5)       NOT NULL            COMMENT '一天内的时刻 HH:mm,如 09:20',
  `metric_key`  varchar(32)   NOT NULL            COMMENT 'water / bbt / weight / sleep / bowel',
  `value_num`   decimal(10,2) NULL DEFAULT NULL   COMMENT '数值型取值(water 毫升 / bbt 度 / weight 公斤 / sleep 小时)',
  `value_int`   int           NULL DEFAULT NULL   COMMENT '离散取值(bowel 排便形态 1-4)',
  `note`        varchar(200)  NOT NULL DEFAULT '' COMMENT '这一次记录的备注(不延续,只属于本条)',
  `created_at`  datetime      NULL DEFAULT NULL,
  `updated_at`  datetime      NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  -- ⚠️ 索引名必须与 model/health_event.go 的 index tag 逐字一致
  INDEX `idx_health_events_user_date` (`user_id` ASC, `date` ASC) USING BTREE,
  INDEX `idx_health_events_user_metric` (`user_id` ASC, `metric_key` ASC, `date` ASC) USING BTREE,
  CONSTRAINT `fk_health_event_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='健康时间轴事件(身体指标多次记录)';

DROP TABLE IF EXISTS `health_settings`;

CREATE TABLE `health_settings` (
  `id`              varchar(32)  NOT NULL             COMMENT 'hs_xxxx(utility.NewID("hs"))',
  `user_id`         varchar(32)  NOT NULL             COMMENT '所属用户(users.id)',
  `metrics_enabled` json         NULL                 COMMENT '启用指标 key 数组,指标开关的唯一真源',
  `water_goal_ml`   int          NOT NULL DEFAULT 1500 COMMENT '饮水目标 500~4000',
  `water_step_ml`   int          NOT NULL DEFAULT 200  COMMENT '「一杯」的容量 ml,50~1000;快捷加水步进',
  `weight_goal_kg`  decimal(5,2) NULL DEFAULT NULL    COMMENT '可选,仅趋势参考,不做达标判定',
  `setup_done_at`   datetime     NULL DEFAULT NULL    COMMENT '首次引导完成时间;跳过不写,避免死循环',
  `created_at`      datetime     NULL DEFAULT NULL,
  `updated_at`      datetime     NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_health_settings_user` (`user_id` ASC) USING BTREE,
  CONSTRAINT `fk_health_setting_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='健康模块用户配置';

DROP TABLE IF EXISTS `anniversaries`;

CREATE TABLE `anniversaries` (
  `id`            varchar(32)  NOT NULL               COMMENT 'an_xxxx(utility.NewID("an"))',
  `user_id`       varchar(32)  NOT NULL               COMMENT '所属用户(users.id)',
  `title`         varchar(50)  NOT NULL               COMMENT '标题',
  `target_date`   date         NOT NULL               COMMENT '基准日期(首次发生的那天)',
  `repeat_rule`   tinyint      NOT NULL DEFAULT 2     COMMENT '1不重复 2每年 3每月 4每周',
  `calendar_type` tinyint      NOT NULL DEFAULT 1     COMMENT '1公历 2农历',
  `remind_days`   json         NULL                   COMMENT '提前几天提醒,如 [7,3,1,0]',
  `category`      varchar(20)  NOT NULL DEFAULT 'other' COMMENT 'birthday/anniversary/countdown/other',
  `icon`          varchar(20)  NOT NULL DEFAULT 'calendar-heart' COMMENT '图标名',
  `color`         varchar(20)  NOT NULL DEFAULT 'primary' COMMENT '语义色名',
  `is_pinned`     tinyint      NOT NULL DEFAULT 0     COMMENT '是否置顶',
  `note`          varchar(200) NOT NULL DEFAULT ''    COMMENT '备注',
  `created_at`    datetime     NULL DEFAULT NULL,
  `updated_at`    datetime     NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  -- ⚠️ next_date / days_left 不落库,每次实时推导(04 §4)
  INDEX `idx_anniversaries_user_date` (`user_id` ASC, `target_date` ASC) USING BTREE,
  CONSTRAINT `fk_anniversary_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='纪念日/倒数日';

-- ---------------------------------------------------------------------
-- 完成
-- ---------------------------------------------------------------------
SELECT '✅ schema 0001_init.sql loaded' AS status;
