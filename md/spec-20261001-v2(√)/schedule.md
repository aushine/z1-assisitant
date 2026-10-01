# Schedule · spec-20261001-v2

> **✅ 已在分支 T-003-schedule 完成**（代码 cdb3fd0，待主理人核验合并；本收口提交在 main）

> **批次**：spec-20261001-v2
> **状态**：已完成
> **交付物**：个人空间「健康设置」→「性价比人生指南」外链入口（双端）

## 任务清单

- [x] **T1** · 新增 htlb 外链工具函数（双端）
  - 文件：`life-assisitant-ui-mobile/src/utils/external.ts`、`life-assisitant-ui-desktop/src/utils/external.ts`
  - 改动：提供 `htlbUrl()`，返回 `${location.protocol}//${location.host}/htlb/HowToLiveBetter.html`
  - 验收：函数存在，且用运行时 host 而非写死

- [x] **T2** · 移动端替换入口
  - 文件：`life-assisitant-ui-mobile/src/pages/me/index.vue`
  - 改动：`SettingItem` 加 `external?: boolean`；「健康设置」项改为「性价比人生指南」，
    path 用 `htlbUrl()` + `external: true`；移除 `HEALTH_VIEW` 权限判断；
    点击分支：external 则 `window.location.href = url`，否则原 `router.push`
  - 验收：显示「性价比人生指南」，点击跳外链，无权限限制

- [x] **T3** · 桌面端替换入口
  - 文件：`life-assisitant-ui-desktop/src/pages/me/index.tsx`
  - 改动：「健康设置」项改为「性价比人生指南」，`onClick` 改 `window.location.href = htlbUrl()`；
    排查并处理 `setHealthOpen` 浮层是否还有其它入口
  - 验收：显示「性价比人生指南」，点击跳外链

- [x] **T4** · 双端构建自测
  - 文件：`life-assisitant-ui-mobile`、`life-assisitant-ui-desktop`
  - 改动：无（验证）
  - 验收：`vue-tsc` / `tsc` 通过，`vite build` 通过

## 完成判定

- [x] 所有任务项已实现并 commit
- [x] 本批 spec 中「验收标准」逐条自测通过
- [x] 完成后给 batch 目录改名加 `(√)` 并 push（触发主理人验收）
