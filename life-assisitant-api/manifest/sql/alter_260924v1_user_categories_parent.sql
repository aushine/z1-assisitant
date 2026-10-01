-- =====================================================================
-- 迁移：user_categories 升级为两级分类（spec-20260924-v1/03 R3）
--   1) 新增列 parent_id（空串=一级）、full_name
--   2) 唯一索引 uk_user_cat 加 parent_id 列（user_id, domain, parent_id, name, deleted_seq）
--   3) 补种内置二级分类（对已播种的用户，按 domain 补齐；幂等，可重跑）
--
-- ⚠️ 执行方式（在 Pi 上，cwd = life-assisitant-api）：
--     go run scripts/sqlrun/main.go manifest/sql/alter_260924v1_user_categories_parent.sql
--   跑前先 SELECT 白名单、跑后复查行数（见 sqlrun 头注释）。
-- ⚠️ 幂等：可重跑，重跑影响行数应为 0（本文件用 information_schema 判存在 + INSERT IGNORE）。
-- ⚠️ 顺序铁律：**先迁库 → 再部署新代码**（老代码读不到 parent_id 无妨，新代码读不到列会报错）。
-- =====================================================================

-- ---------- 1. 加列（information_schema 判存在，幂等） ----------
SET @add_parent := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_categories' AND COLUMN_NAME = 'parent_id') = 0,
    'ALTER TABLE `user_categories` ADD COLUMN `parent_id` VARCHAR(32) NOT NULL DEFAULT '''' COMMENT ''父分类 id（R3 两级分类）；空串 = 一级，二级指向同域一级的 id'' AFTER `domain`',
    'SELECT 1'
  )
);
PREPARE s FROM @add_parent; EXECUTE s; DEALLOCATE PREPARE s;

SET @add_fullname := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_categories' AND COLUMN_NAME = 'full_name') = 0,
    'ALTER TABLE `user_categories` ADD COLUMN `full_name` VARCHAR(80) NOT NULL DEFAULT '''' COMMENT ''完整名（运动-跑步）；二级为空时读时拼接兜底'' AFTER `name`',
    'SELECT 1'
  )
);
PREPARE s FROM @add_fullname; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------- 2. 换唯一索引 uk_user_cat：加 parent_id ----------
-- ⚠️ 必须显式写索引名，且与 model tag 逐字一致，否则 AutoMigrate 误删 → Error 1553。
-- 判断「旧索引是否缺 parent_id」：若存在同名索引但不含 parent_id 列则先 DROP 再建。
SET @need_rebuild := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_categories'
         AND INDEX_NAME = 'uk_user_cat' AND COLUMN_NAME = 'parent_id') = 0,
    1, 0
  )
);
SET @drop_uk := IF(@need_rebuild = 1,
  'ALTER TABLE `user_categories` DROP INDEX `uk_user_cat`', 'SELECT 1');
PREPARE s FROM @drop_uk; EXECUTE s; DEALLOCATE PREPARE s;

SET @create_uk := IF(@need_rebuild = 1,
  'ALTER TABLE `user_categories` ADD UNIQUE KEY `uk_user_cat` (`user_id`,`domain`,`parent_id`,`name`,`deleted_seq`)', 'SELECT 1');
PREPARE s FROM @create_uk; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------- 3. 回填已有一级行的 full_name = name（幂等） ----------
UPDATE `user_categories` SET `full_name` = `name`
  WHERE `parent_id` = '' AND `full_name` = '' AND `is_deleted` = 0;

-- ---------- 4. 补种内置二级（对已播种用户；INSERT IGNORE 幂等） ----------
-- ⚠️ 种子清单必须与 internal/utility/user_category_seed.go 的内置二级逐字一致
--    （id / domain / parent_id / name / full_name / icon / tint / sort）。
--    此处按「每个用户 + 每个 domain 已存在内置一级」为前提补插二级；
--    INSERT IGNORE 依赖 (id,user_id) 主键去重，重跑不重复插入。
INSERT IGNORE INTO `user_categories`
  (`id`,`user_id`,`domain`,`parent_id`,`name`,`full_name`,`emoji`,`icon`,`tint`,`sort`,`is_builtin`,`is_deleted`,`deleted_seq`,`created_at`,`updated_at`)
SELECT t.seed_id, u.id, t.domain, t.parent_id, t.name, CONCAT(p.name, '-', t.name),
       '', t.icon, t.tint, t.sort, 1, 0, '', NOW(), NOW()
FROM (
  -- ===== 习惯域二级 =====
  SELECT 'sport_01' AS seed_id,'habit' AS domain,'sport' AS parent_id,'跑步' AS name,'lucide:Footprints' AS icon,'success' AS tint,10 AS sort
  UNION ALL SELECT 'sport_02','habit','sport','骑行','lucide:Bike','success',20
  UNION ALL SELECT 'sport_03','habit','sport','羽毛球','lucide:Activity','success',30
  UNION ALL SELECT 'sport_04','habit','sport','健身','lucide:Dumbbell','success',40
  UNION ALL SELECT 'sport_05','habit','sport','游泳','lucide:Waves','success',50
  UNION ALL SELECT 'diet_01','habit','diet','早餐','lucide:Coffee','danger',10
  UNION ALL SELECT 'diet_02','habit','diet','午餐','lucide:Utensils','danger',20
  UNION ALL SELECT 'diet_03','habit','diet','晚餐','lucide:Salad','danger',30
  UNION ALL SELECT 'diet_04','habit','diet','控糖','lucide:CupSoda','danger',40
  UNION ALL SELECT 'diet_05','habit','diet','喝水','lucide:Droplets','danger',50
  UNION ALL SELECT 'life_01','habit','life','早起','lucide:Sunrise','success',10
  UNION ALL SELECT 'life_02','habit','life','早睡','lucide:Moon','success',20
  UNION ALL SELECT 'life_03','habit','life','整理','lucide:Sparkles','success',30
  UNION ALL SELECT 'life_04','habit','life','记账','lucide:Wallet','success',40
  UNION ALL SELECT 'study_01','habit','study','阅读','lucide:BookOpen','accent',10
  UNION ALL SELECT 'study_02','habit','study','背单词','lucide:BookMarked','accent',20
  UNION ALL SELECT 'study_03','habit','study','课程','lucide:Presentation','accent',30
  UNION ALL SELECT 'study_04','habit','study','复盘','lucide:ClipboardCheck','accent',40
  -- ===== 待办域二级 =====
  UNION ALL SELECT 'c_work_01','task','c_work','周报','lucide:FileText','primary',10
  UNION ALL SELECT 'c_work_02','task','c_work','会议','lucide:Users','primary',20
  UNION ALL SELECT 'c_work_03','task','c_work','汇报','lucide:Presentation','primary',30
  UNION ALL SELECT 'c_work_04','task','c_work','对接','lucide:Send','primary',40
  UNION ALL SELECT 'c_study_01','task','c_study','课程','lucide:Presentation','accent',10
  UNION ALL SELECT 'c_study_02','task','c_study','阅读','lucide:BookOpen','accent',20
  UNION ALL SELECT 'c_study_03','task','c_study','练习','lucide:PenLine','accent',30
  UNION ALL SELECT 'c_life_01','task','c_life','采购','lucide:ShoppingCart','success',10
  UNION ALL SELECT 'c_life_02','task','c_life','家务','lucide:Sparkles','success',20
  UNION ALL SELECT 'c_life_03','task','c_life','缴费','lucide:Receipt','success',30
  UNION ALL SELECT 'c_health_01','task','c_health','就医','lucide:Stethoscope','success',10
  UNION ALL SELECT 'c_health_02','task','c_health','运动','lucide:Dumbbell','success',20
  UNION ALL SELECT 'c_health_03','task','c_health','体检','lucide:HeartPulse','success',30
  UNION ALL SELECT 'c_social_01','task','c_social','聚会','lucide:Users','accent',10
  UNION ALL SELECT 'c_social_02','task','c_social','联络','lucide:PhoneCall','accent',20
  UNION ALL SELECT 'c_social_03','task','c_social','送礼','lucide:Gift','accent',30
) t
JOIN `users` u ON u.id <> '' AND u.deleted_at IS NULL
JOIN `user_categories` p
  ON p.user_id = u.id AND p.domain = t.domain AND p.id = t.parent_id
     AND p.parent_id = '' AND p.is_builtin = 1 AND p.is_deleted = 0;

-- ---------- 校验（打印结果集，人工核对） ----------
SELECT domain, parent_id, COUNT(*) AS cnt
FROM `user_categories`
WHERE is_deleted = 0 AND parent_id <> ''
GROUP BY domain, parent_id
ORDER BY domain, parent_id;
