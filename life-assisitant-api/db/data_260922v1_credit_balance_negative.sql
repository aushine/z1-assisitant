-- db/data_260922v1_credit_balance_negative.sql
-- spec-20260922-v1 · D23 信用类余额符号迁移（真实数据修正）
--
-- 背景：历史实现把信用类账户的「已用额度」存成**正数**，而净资产公式是
--       net_worth = Σ balance（D25 恒等）⇒ 信用卡欠 1942 被当成 +1942 资产，
--       净资产虚高 2×欠款。本次把信用类（category = credit）的**正数余额翻负**。
--
-- 范围（严格白名单）：type ∈ {credit, huabei, baitiao, loan, other_credit}
--   AND balance > 0 AND deleted_at IS NULL
-- ⚠️ 不碰：saving = −3240（Q4 拍板：真实透支，保持）；已软删行；非信用类。
--
-- 幂等性：条件含 `balance > 0` —— 翻负后不再匹配，**重跑零副作用**（不会翻回）。
-- ⚠️ 必须用 scripts/sqlrun 执行（钉死单连接 + 失败即停）。

SET NAMES utf8mb4;

UPDATE `accounts`
SET `balance` = -`balance`
WHERE `deleted_at` IS NULL
  AND `type` IN ('credit', 'huabei', 'baitiao', 'loan', 'other_credit')
  AND `balance` > 0;
