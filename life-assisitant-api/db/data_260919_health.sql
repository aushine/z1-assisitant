-- ============================================================================
-- data_260919_health.sql —— 健康模块 + 纪念日（md/spec-20260919-v1）
--
-- 幂等：可重复执行。
-- 执行：go run scripts/init_db.go db/data_260919_health.sql
--       （DSN 取自 manifest/config/config.yaml，与运行服务同源）
--
-- 内容：
--   1. 三张新表：health_days / health_settings / anniversaries
--   2. 5 个权限点：health:view|write|manage、anniversary:view|write（+ admin/user 授权）
--   3. period_days → health_days 的数据迁移（**本次不删旧列**，见第 4 节）
--
-- ⚠️ 主键 / user_id 一律 varchar(32)（本项目约定，utility.NewID），
--    spec 04 §2 的 bigint + int unsigned 草案是错的（与 users.id 类型不一致，无法关联）。
-- ============================================================================

-- ---------------------------------------------------------------------
-- 1. health_days —— 身体指标逐日记录（饮水 / 体重 / 体温 / 睡眠 / 排便）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `health_days` (
  `id`          VARCHAR(32)   NOT NULL                COMMENT '主键 hd_xxx（utility.NewID）',
  `user_id`     VARCHAR(32)   NOT NULL                COMMENT '用户 ID',
  `date`        DATE          NOT NULL                COMMENT '用户本地日期，不做时区换算',
  `water_ml`    INT           NOT NULL DEFAULT 0      COMMENT '当日累计饮水 ml（0-10000）',
  `weight_kg`   DECIMAL(5,2)  DEFAULT NULL            COMMENT '体重 kg，20.00~300.00',
  `bbt`         DECIMAL(4,2)  DEFAULT NULL            COMMENT '基础体温 ℃，34.00~42.00',
  `sleep_hours` DECIMAL(3,1)  DEFAULT NULL            COMMENT '睡眠时长 h，0.0~24.0',
  `bowel_count` TINYINT       NOT NULL DEFAULT 0      COMMENT '排便次数 0~9',
  `bowel_type`  TINYINT       NOT NULL DEFAULT 0      COMMENT '0未记录 1正常 2偏软 3偏硬 4腹泻',
  `created_at`  DATETIME      DEFAULT NULL,
  `updated_at`  DATETIME      DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_health_days_user_date` (`user_id`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='身体指标逐日记录';

-- ---------------------------------------------------------------------
-- 2. health_settings —— 健康模块用户配置（每用户一行，懒创建）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `health_settings` (
  `id`              VARCHAR(32)  NOT NULL             COMMENT '主键 hs_xxx',
  `user_id`         VARCHAR(32)  NOT NULL             COMMENT '用户 ID',
  `metrics_enabled` JSON         DEFAULT NULL         COMMENT '启用指标 key 数组，指标开关的唯一真源',
  `water_goal_ml`   INT          NOT NULL DEFAULT 1500 COMMENT '饮水目标 500~4000',
  `water_step_ml`   INT          NOT NULL DEFAULT 200  COMMENT '「一杯」的容量 ml，50~1000；快捷加水步进',
  `weight_goal_kg`  DECIMAL(5,2) DEFAULT NULL         COMMENT '可选，仅趋势参考，不做达标判定',
  `setup_done_at`   DATETIME     DEFAULT NULL         COMMENT '首次引导完成时间；跳过不写，避免死循环',
  `created_at`      DATETIME     DEFAULT NULL,
  `updated_at`      DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_health_settings_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='健康模块用户配置';

-- ⚠️ 上面是 CREATE TABLE IF NOT EXISTS：库里已有这张表时新列**不会**自动补上。
--    这里用 information_schema 判列 + 动态 SQL 做一次幂等 ALTER（MySQL 没有 ADD COLUMN IF NOT EXISTS）。
SET @_add_water_step = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME` = 'health_settings'
      AND `COLUMN_NAME` = 'water_step_ml') = 0,
  'ALTER TABLE `health_settings` ADD COLUMN `water_step_ml` INT NOT NULL DEFAULT 200 COMMENT ''一杯的容量 ml，快捷加水步进'' AFTER `water_goal_ml`',
  'SELECT 1'
);
PREPARE _stmt_water_step FROM @_add_water_step;
EXECUTE _stmt_water_step;
DEALLOCATE PREPARE _stmt_water_step;

-- 存量行兜底：加列前就已存在的行可能落了 0（0 会让快捷档变成 [+0]，点了没反应）
UPDATE `health_settings` SET `water_step_ml` = 200 WHERE `water_step_ml` <= 0;

-- ---------------------------------------------------------------------
-- 3. health_events —— 身体指标**时间轴事件**（2026-09-19 新增）
--
--    ⚠️ 老大 260919 复核 spec 时指出：体温 / 饮水 / 排便 这些**不是一天一个定值**
--       —— 上午喝的水和下午喝的水是两次独立事件，上午腹泻下午正常也是两次。
--       所以它们改成按时间轴**多次记录**，一天可以有 N 条。
--
--    ⚠️ 与 mood_logs 的区别（别搞混）：
--       mood_logs（心情/精力）  按小时，**向前延续**（没记的小时沿用上一条）
--       health_events（身体指标）按时刻，**不延续**（没记就是没记）
--
--    ⚠️ 与 health_days 的关系：本表是**唯一真源**；health_days 退化为日汇总缓存，
--       由后端在写本表时**同一事务内**重算（impl/health_event.go#recomputeDaySummaryTx）。
--       ⚠️ 不要再往 health_days 直接写这五项。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `health_events` (
  `id`          VARCHAR(32)   NOT NULL              COMMENT '主键 he_xxx',
  `user_id`     VARCHAR(32)   NOT NULL              COMMENT '用户 ID',
  `date`        DATE          NOT NULL              COMMENT '归属日期（冗余，按天查能直接走索引）',
  `time_of_day` CHAR(5)       NOT NULL              COMMENT '一天内的时刻 HH:mm，如 09:20',
  `metric_key`  VARCHAR(32)   NOT NULL              COMMENT 'water / bbt / weight / sleep / bowel',
  `value_num`   DECIMAL(10,2) DEFAULT NULL          COMMENT '数值型取值（water 毫升 / bbt 度 / weight 公斤 / sleep 小时）',
  `value_int`   INT           DEFAULT NULL          COMMENT '离散取值（bowel 排便形态 1-4）',
  `note`        VARCHAR(200)  NOT NULL DEFAULT ''   COMMENT '这一次记录的备注（不延续，只属于本条）',
  `created_at`  DATETIME      DEFAULT NULL,
  `updated_at`  DATETIME      DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- ⚠️ 索引名必须与 model/health_event.go 的 tag **逐字一致**，
  --    否则 GORM AutoMigrate 会认为索引不匹配去删建（period_settings 已踩过一次）。
  KEY `idx_health_events_user_date`   (`user_id`, `date`),
  KEY `idx_health_events_user_metric` (`user_id`, `metric_key`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='健康时间轴事件（身体指标多次记录）';

-- ---------------------------------------------------------------------
-- 4. anniversaries —— 纪念日 / 倒数日
--    ⚠️ 不存「下次日期」：next_date / days_left 每次实时推导（04 §4）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `anniversaries` (
  `id`            VARCHAR(32)  NOT NULL               COMMENT '主键 an_xxx',
  `user_id`       VARCHAR(32)  NOT NULL               COMMENT '用户 ID',
  `title`         VARCHAR(50)  NOT NULL               COMMENT '标题',
  `target_date`   DATE         NOT NULL               COMMENT '基准日期（首次发生的那天）',
  `repeat_rule`   TINYINT      NOT NULL DEFAULT 2     COMMENT '1不重复 2每年 3每月 4每周',
  `calendar_type` TINYINT      NOT NULL DEFAULT 1     COMMENT '1公历 2农历',
  `remind_days`   JSON         DEFAULT NULL           COMMENT '提前几天提醒，如 [7,3,1,0]',
  `category`      VARCHAR(20)  NOT NULL DEFAULT 'other' COMMENT 'birthday/anniversary/countdown/other',
  `icon`          VARCHAR(20)  NOT NULL DEFAULT 'calendar-heart',
  `color`         VARCHAR(20)  NOT NULL DEFAULT 'primary',
  `is_pinned`     TINYINT      NOT NULL DEFAULT 0,
  `note`          VARCHAR(200) NOT NULL DEFAULT ''    COMMENT '备注',
  `created_at`    DATETIME     DEFAULT NULL,
  `updated_at`    DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_anniversaries_user_date` (`user_id`, `target_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='纪念日/倒数日';

-- ---------------------------------------------------------------------
-- 5. 权限点（5 条）+ 角色授权
--    权限目录 40 → 45 条、模块 12 → 14；user 角色 30 → 35 条。
-- ---------------------------------------------------------------------
DELETE FROM `role_permissions`
WHERE `permission_id` IN ('p_health_view','p_health_write','p_health_manage',
                          'p_anniversary_view','p_anniversary_write');
DELETE FROM `permissions`
WHERE `id` IN ('p_health_view','p_health_write','p_health_manage',
               'p_anniversary_view','p_anniversary_write');

INSERT INTO `permissions` (`id`, `module`, `action`, `description`) VALUES
-- health 健康（20260919-v1 新增；记录模块第 3 个 tab，经期是其中一个可开关指标）
  ('p_health_view',              'health',       'view',        '查看健康记录与概览'),
  ('p_health_write',             'health',       'write',       '记录健康数据（饮水/体重/体温等）'),
  ('p_health_manage',            'health',       'manage',      '修改健康设置与重置健康数据'),
-- anniversary 纪念日（20260919-v1 新增；入口在「我的 → 重要日子」）
  ('p_anniversary_view',         'anniversary',  'view',        '查看纪念日与倒数日'),
  ('p_anniversary_write',        'anniversary',  'write',       '管理纪念日（增删改）');

-- admin：全量（含新点）
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'admin', `id`, 1, 1 FROM `permissions`
WHERE `module` IN ('health', 'anniversary');

-- user：个人域（排除 user_mgmt / role_mgmt，本就不在这两个新模块里）
INSERT INTO `role_permissions` (`role_code`, `permission_id`, `enabled`, `version`)
SELECT 'user', `id`, 1, 1 FROM `permissions`
WHERE `module` IN ('health', 'anniversary');

-- ---------------------------------------------------------------------
-- 6. ⚠️ 数据迁移：period_days(weight / bbt / sleep_hours) → health_days
--
--    两步走（04 §5.1）：本次只迁数据，period_days 的三列**保留不动**（双写过渡）。
--    第二步确认稳定后单独发布：
--      ALTER TABLE period_days DROP COLUMN weight, DROP COLUMN bbt, DROP COLUMN sleep_hours;
--    ⚠️ 不要在同一次发布里既迁数据又删列 —— 一旦迁移有遗漏就再也没有源数据可重来。
--
--    ⚠️ 拆成「先建行（INSERT IGNORE）→ 再回填（UPDATE JOIN）」两条，
--      而不是一条 `INSERT ... SELECT ... ON DUPLICATE KEY UPDATE`：
--      `bbt` / `sleep_hours` 在 **两张表里都存在**（period_days 源表 + health_days 目标表），
--      ON DUPLICATE KEY UPDATE 子句里的裸列名会让 MySQL 分不清是哪张表 →
--      **Error 1052: Column 'bbt' in field list is ambiguous**（2026-09-19 实测踩到）。
--      拆开后每个列名都带表别名，5.7 / 8.0 都能跑，也避开了 8.0.20 起废弃的 VALUES()。
--
--    COALESCE(源, 目标) 保证：源值为 NULL 时**不覆盖**已迁好的值
--    （health_days 里可能有用户后来录的更新数据）。
-- ---------------------------------------------------------------------

-- 5.1 迁移前体检（先跑一次，确认没有越界值会把 decimal 撑爆）：
--   SELECT COUNT(*) AS rows_total,
--          SUM(weight IS NOT NULL) AS has_weight,
--          SUM(bbt IS NOT NULL) AS has_bbt,
--          SUM(sleep_hours IS NOT NULL) AS has_sleep,
--          MIN(weight), MAX(weight),        -- 期望 20~300
--          MIN(bbt),    MAX(bbt),           -- 期望 34~42
--          MIN(sleep_hours), MAX(sleep_hours) -- 期望 0~24
--     FROM period_days;
--   若有越界值（历史录入没校验），**先清洗再迁移**。

-- 5.2 建行：只补 health_days 里还缺的 (user_id, date)。
--     INSERT IGNORE 撞上 uk_health_days_user_date 就静默跳过 —— 正是「只补不覆盖」。
INSERT IGNORE INTO `health_days`
  (`id`, `user_id`, `date`, `water_ml`, `weight_kg`, `bbt`, `sleep_hours`,
   `bowel_count`, `bowel_type`, `created_at`, `updated_at`)
SELECT
  CONCAT('hd_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 16)),
  `pd`.`user_id`, `pd`.`date`, 0, `pd`.`weight`, `pd`.`bbt`, `pd`.`sleep_hours`,
  0, 0, NOW(), NOW()
FROM `period_days` AS `pd`
WHERE `pd`.`weight` IS NOT NULL
   OR `pd`.`bbt` IS NOT NULL
   OR `pd`.`sleep_hours` IS NOT NULL;

-- 5.3 回填：三列各自 COALESCE(源, 目标)，源为 NULL 就不动目标。
--     ⚠️ 所有列都带表别名（hd / pd），不要再写裸列名。
UPDATE `health_days` AS `hd`
JOIN `period_days` AS `pd`
  ON `pd`.`user_id` = `hd`.`user_id`
 AND `pd`.`date`    = `hd`.`date`
SET
  `hd`.`weight_kg`   = COALESCE(`pd`.`weight`,      `hd`.`weight_kg`),
  `hd`.`bbt`         = COALESCE(`pd`.`bbt`,         `hd`.`bbt`),
  `hd`.`sleep_hours` = COALESCE(`pd`.`sleep_hours`, `hd`.`sleep_hours`),
  `hd`.`updated_at`  = NOW()
WHERE `pd`.`weight` IS NOT NULL
   OR `pd`.`bbt` IS NOT NULL
   OR `pd`.`sleep_hours` IS NOT NULL;

-- 5.4 迁移后自检（期望三行计数一致）：
--   SELECT
--     (SELECT COUNT(*) FROM `period_days`
--       WHERE `weight` IS NOT NULL OR `bbt` IS NOT NULL OR `sleep_hours` IS NOT NULL) AS src_rows,
--     (SELECT COUNT(*) FROM `health_days`
--       WHERE `weight_kg` IS NOT NULL OR `bbt` IS NOT NULL OR `sleep_hours` IS NOT NULL) AS dst_rows;

-- ---------------------------------------------------------------------
-- 7. ⚠️ 数据迁移：health_days（一天一行）→ health_events（时间轴多次）
--
--    历史数据只有「当天总量 / 当天一个值」，**没有时刻信息**。
--    迁移时刻按下述「语义上最合理」的默认值落，且 **note 里标注来源**，
--    免得用户看到「12:00 喝水 1500ml」以为自己真在那个点记过：
--
--      water  → 12:00（历史只有当日总量，放中午不代表实际）
--      weight → 08:00（称重多在晨起）
--      bbt    → 07:00（基础体温本就是晨起测的）
--      sleep  → 08:00（睡醒后补记）
--      bowel  → 按次数从 08:00 起铺开（最多 9 次）
--
--    ⚠️ 幂等：只在该 (user_id, date, metric_key) **还没有** event 时才插，重跑不会翻倍。
--    ⚠️ 迁移完 health_days 保持原样不动 —— 它现在是日汇总缓存，
--       下一次写 events 时会由 recomputeDaySummaryTx 重算并覆盖，结果应当一致。
-- ---------------------------------------------------------------------

-- 7.1 water：当日总量 → 一条
INSERT INTO `health_events`
  (`id`, `user_id`, `date`, `time_of_day`, `metric_key`, `value_num`, `value_int`, `note`, `created_at`, `updated_at`)
SELECT
  CONCAT('he_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 16)),
  `hd`.`user_id`, `hd`.`date`, '12:00', 'water', `hd`.`water_ml`, NULL,
  '由历史「当日总量」迁移', NOW(), NOW()
FROM `health_days` AS `hd`
WHERE `hd`.`water_ml` > 0
  AND NOT EXISTS (
    SELECT 1 FROM `health_events` AS `he`
    WHERE `he`.`user_id` = `hd`.`user_id`
      AND `he`.`date` = `hd`.`date`
      AND `he`.`metric_key` = 'water'
  );

-- 7.2 weight：晨起称重
INSERT INTO `health_events`
  (`id`, `user_id`, `date`, `time_of_day`, `metric_key`, `value_num`, `value_int`, `note`, `created_at`, `updated_at`)
SELECT
  CONCAT('he_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 16)),
  `hd`.`user_id`, `hd`.`date`, '08:00', 'weight', `hd`.`weight_kg`, NULL,
  '由历史「当日体重」迁移', NOW(), NOW()
FROM `health_days` AS `hd`
WHERE `hd`.`weight_kg` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `health_events` AS `he`
    WHERE `he`.`user_id` = `hd`.`user_id`
      AND `he`.`date` = `hd`.`date`
      AND `he`.`metric_key` = 'weight'
  );

-- 7.3 bbt：基础体温（晨起）
INSERT INTO `health_events`
  (`id`, `user_id`, `date`, `time_of_day`, `metric_key`, `value_num`, `value_int`, `note`, `created_at`, `updated_at`)
SELECT
  CONCAT('he_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 16)),
  `hd`.`user_id`, `hd`.`date`, '07:00', 'bbt', `hd`.`bbt`, NULL,
  '由历史「当日基础体温」迁移', NOW(), NOW()
FROM `health_days` AS `hd`
WHERE `hd`.`bbt` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `health_events` AS `he`
    WHERE `he`.`user_id` = `hd`.`user_id`
      AND `he`.`date` = `hd`.`date`
      AND `he`.`metric_key` = 'bbt'
  );

-- 7.4 sleep：睡醒后补记
INSERT INTO `health_events`
  (`id`, `user_id`, `date`, `time_of_day`, `metric_key`, `value_num`, `value_int`, `note`, `created_at`, `updated_at`)
SELECT
  CONCAT('he_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 16)),
  `hd`.`user_id`, `hd`.`date`, '08:00', 'sleep', `hd`.`sleep_hours`, NULL,
  '由历史「当日睡眠时长」迁移', NOW(), NOW()
FROM `health_days` AS `hd`
WHERE `hd`.`sleep_hours` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `health_events` AS `he`
    WHERE `he`.`user_id` = `hd`.`user_id`
      AND `he`.`date` = `hd`.`date`
      AND `he`.`metric_key` = 'sleep'
  );

-- 7.5 bowel：次数铺开成 N 条
--     ⚠️ 历史只有「次数 + 一个形态」，无法还原每次各自的形态。
--        形态统一取当天的 bowel_type；若当天没记形态（=0）则 value_int 置 NULL
--        （**次数仍然记**，「拉了但没记形态」也是一次，不能丢）。
INSERT INTO `health_events`
  (`id`, `user_id`, `date`, `time_of_day`, `metric_key`, `value_num`, `value_int`, `note`, `created_at`, `updated_at`)
SELECT
  CONCAT('he_', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 16)),
  `hd`.`user_id`, `hd`.`date`,
  ELT(`s`.`n`, '08:00', '10:00', '13:00', '15:00', '17:00', '19:00', '21:00', '22:00', '23:00'),
  'bowel', NULL,
  CASE WHEN `hd`.`bowel_type` > 0 THEN `hd`.`bowel_type` ELSE NULL END,
  '由历史「当日排便次数」迁移', NOW(), NOW()
FROM `health_days` AS `hd`
JOIN (
  SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
  UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
) AS `s` ON `s`.`n` <= `hd`.`bowel_count`
WHERE `hd`.`bowel_count` > 0
  AND NOT EXISTS (
    SELECT 1 FROM `health_events` AS `he`
    WHERE `he`.`user_id` = `hd`.`user_id`
      AND `he`.`date` = `hd`.`date`
      AND `he`.`metric_key` = 'bowel'
  );

-- 7.6 迁移后自检（期望：events 条数 ≥ health_days 有值行数；water 总量一致）
-- SELECT
--   (SELECT COUNT(*) FROM `health_events')                                    AS events_rows,
--   (SELECT COUNT(*) FROM `health_days` WHERE `water_ml` > 0)                 AS hd_water_days,
--   (SELECT COUNT(*) FROM `health_events` WHERE `metric_key` = 'water')       AS ev_water_rows,
--   (SELECT COALESCE(SUM(`water_ml`), 0) FROM `health_days`)                  AS hd_water_sum,
--   (SELECT COALESCE(SUM(`value_num`), 0) FROM `health_events`
--     WHERE `metric_key` = 'water')                                           AS ev_water_sum;
