<!--
  schedule.md 模板 —— 复制到 md/spec-yyyyMMdd-vX/schedule.md

  契约（勿随意改格式，状态机靠它解析）：
   - 任务项：- [ ] **Tn** · 标题 / - [x] **Tn** · 标题
   - 「开发完成」判定：全文所有 - [ ] 都变成 - [x]
   - 任务项里的文件路径用反引号包起来（`path/to/file`），供核验脚本比对
-->

# Schedule · spec-yyyyMMdd-vX

> **批次**：spec-yyyyMMdd-vX
> **状态**：开发中
> **交付物**：一句话说明本批要交付什么

## 任务清单

- [ ] **T1** · 任务标题
  - 文件：`life-assisitant-ui-mobile/src/pages/xxx/index.vue`
  - 改动：简述要做的事
  - 验收：怎么算完成

- [ ] **T2** · 任务标题
  - 文件：`path/to/file`
  - 改动：...
  - 验收：...

## 完成判定

- [ ] 所有任务项已实现并 commit
- [ ] 本批 spec 中「验收标准」逐条自测通过
