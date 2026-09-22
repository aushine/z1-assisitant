-- db/alter_260921v4_tx_contact_settle.sql
-- ⚠️ 必须用 scripts/sqlrun（钉死单连接 + 失败即停）。
--    不能用 scripts/init_db.go：PREPARE/EXECUTE 依赖连接级会话状态，
--    它会报 "Unknown prepared statement handler"，且失败只记日志、继续跑并报「完成」。

SET @db := DATABASE();

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE transactions ADD COLUMN contact varchar(50) NOT NULL DEFAULT '''' COMMENT ''对方（借入借出必填；待报销=报销对象；退款=商家）''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'contact');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE transactions ADD COLUMN settle_of varchar(32) NOT NULL DEFAULT '''' COMMENT ''关联的原交易 id（空=原笔；非空=核销/退还笔）''',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'settle_of');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
