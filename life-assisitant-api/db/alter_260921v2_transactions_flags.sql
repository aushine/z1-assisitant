-- db/alter_260921v2_transactions_flags.sql
-- ⚠️ 必须用 scripts/sqlrun 执行（钉死单连接 + 失败即停）——
--    不能用 scripts/init_db.go：它逐条 db.Exec 走连接池，而 PREPARE/EXECUTE 依赖连接级会话状态，
--    会报 "Unknown prepared statement handler"，且它失败只记日志、继续跑并报「完成」（线上静默事故）。

SET @db := DATABASE();

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE transactions ADD COLUMN exclude_budget tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1=不计入预算''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'exclude_budget');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE transactions ADD COLUMN exclude_stats tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1=不计入收支统计''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'exclude_stats');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE transactions ADD COLUMN source varchar(20) NOT NULL DEFAULT '''' COMMENT ''来源：空=普通记账；balance_adjust=余额调整''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'source');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
