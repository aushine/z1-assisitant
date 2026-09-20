-- ============================================================================
-- data_260920_transactions_reversed_by.sql —— transactions 补 `reversed_by`
--
-- 幂等：可重复执行。
-- 执行：go run scripts/init_db.go db/data_260920_transactions_reversed_by.sql
--       （DSN 取自 manifest/config/config.yaml，与运行服务同源）
--
-- 背景：`internal/model/transaction.go` 早已声明 `ReversedBy`（冲正流程用，
--       见 `service/impl/finance.go` 的 finance.go:838/879/884），但建表语句
--       从未同步这一列，线上库也没有 —— 导致**任何** `POST /transactions`
--       都报 `Error 1054 Unknown column 'reversed_by' in 'field list'`
--       （外层表现为 DATABASE_ERROR 500002），记账功能 100% 不可用。
--
-- 修复：只做**加列 + 加索引**，纯增量、不动存量数据，可随时
--       `ALTER TABLE transactions DROP COLUMN reversed_by, DROP INDEX idx_reversed_by;` 回滚。
-- ============================================================================

-- MySQL 没有 `ADD COLUMN IF NOT EXISTS`，用 information_schema 判列 + 动态 SQL 实现幂等
SET @_add_reversed_by = IF(
  (SELECT COUNT(*) FROM `information_schema`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME` = 'transactions'
      AND `COLUMN_NAME` = 'reversed_by') = 0,
  'ALTER TABLE `transactions` ADD COLUMN `reversed_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT ''冲正后指向的反向交易 id（空 = 未被冲正）'' AFTER `note`',
  'SELECT 1'
);
PREPARE _stmt_reversed_by FROM @_add_reversed_by;
EXECUTE _stmt_reversed_by;
DEALLOCATE PREPARE _stmt_reversed_by;

-- 索引：与 model 标签 `index:idx_reversed_by` 逐字一致（本项目约定：显式写索引名，避免 GORM 误删/重名）
SET @_idx_reversed_by = IF(
  (SELECT COUNT(*) FROM `information_schema`.`STATISTICS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME` = 'transactions'
      AND `INDEX_NAME` = 'idx_reversed_by') = 0,
  'ALTER TABLE `transactions` ADD INDEX `idx_reversed_by`(`reversed_by` ASC) USING BTREE',
  'SELECT 1'
);
PREPARE _stmt_idx_reversed_by FROM @_idx_reversed_by;
EXECUTE _stmt_idx_reversed_by;
DEALLOCATE PREPARE _stmt_idx_reversed_by;

-- 自检：期望输出 1 行（列已存在）
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`, `COLUMN_COMMENT`
FROM `information_schema`.`COLUMNS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = 'transactions'
  AND `COLUMN_NAME` = 'reversed_by';
