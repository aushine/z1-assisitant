# schedules/ 批次清单（每批需求一个文件）

一批需求（可能含多个 spec）对应一个 schedule 文件：`S-<编号>-<slug>.md`。

```markdown
# Schedule S-001 · <批次名>

批次说明：<这批需求要达成什么>

- [ ] T-004: 标题 (specs/T-004-xxx.md)
- [ ] T-005: 标题 (specs/T-005-xxx.md)
```

规则：
1. **spec 关联批次**：spec 文件头部写一行 `schedule: S-001-<slug>`（intake 解析后写进 board 卡）。
2. **worker 完成一个任务** → 立即在 schedule 里把该项 `- [ ]` 勾成 `- [x]`，随任务分支一起 commit（漏勾不算交付完成）。
3. **全部勾选** + 关联任务 PR 全部 merge → runner 播报「🏁 批次完成」并在文件尾打通报标记（防重复）。
4. 批次未完成但有 blocked 项 → 不影响其他项继续；blocked 由主理人（阿派）答复后 `unblock` 恢复。
