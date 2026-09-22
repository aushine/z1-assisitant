-- db/alter_260922v1_accounts_icon_institution.sql
-- spec-20260922-v1 · 账户体系（md/spec-20260922-v1/01 §7.1）
-- 变更：① accounts.icon varchar(20) → varchar(32)（lucide:CandlestickChart = 22 字符，20 会静默截断，D10）
--       ② 新增 accounts.institution varchar(20)（银行 code，空 = 未指定，D11；⚠️ 不加索引）
-- ⚠️ 必须用 scripts/sqlrun 执行（钉死单连接 + 失败即停）——
--    不能用 scripts/init_db.go：它逐条 db.Exec 走连接池，而 PREPARE/EXECUTE 依赖连接级会话状态，
--    会报 "Unknown prepared statement handler"，且它失败只记日志、继续跑并报「完成」（线上静默事故）。
-- 幂等性：两段都先查 information_schema，已满足目标形态则跳过（重跑零副作用）。

SET NAMES utf8mb4;

SET @db := DATABASE();

-- ① icon 扩到 32（仅当当前长度不是 32 时执行 MODIFY）
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `accounts` MODIFY COLUMN `icon` varchar(32) NOT NULL DEFAULT ''💰'' COMMENT ''图标引用：brand:<slug> | lucide:<Name> | <emoji>''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'accounts' AND COLUMN_NAME = 'icon' AND CHARACTER_MAXIMUM_LENGTH = 32);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ② 加 institution（仅当列不存在时执行 ADD）
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `accounts` ADD COLUMN `institution` varchar(20) NOT NULL DEFAULT '''' COMMENT ''银行 code（CCB/ICBC），空=未指定'' AFTER `icon`',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'accounts' AND COLUMN_NAME = 'institution');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
