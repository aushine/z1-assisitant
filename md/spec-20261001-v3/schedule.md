# Schedule · spec-20261001-v3

> **批次**：spec-20261001-v3
> **状态**：开发中
> **交付物**：「性价比人生指南」改为 iframe 内嵌页（双端，带返回按钮）

## 任务清单

- [ ] **T1** · 移动端新增内嵌页
  - 文件：`life-assisitant-ui-mobile/src/pages/me/htlb.vue`
  - 改动：`van-nav-bar`（‹ 返回 + 标题「性价比人生指南」）+ 全屏 `<iframe :src="htlbUrl()">`；
    返回 `router.back()`；iframe 铺满导航栏以下区域，无双重滚动条
  - 验收：内嵌加载指南页，可滚动，返回回「我的」

- [ ] **T2** · 移动端路由 + 入口改造
  - 文件：`life-assisitant-ui-mobile/src/router/index.ts`、`life-assisitant-ui-mobile/src/pages/me/index.vue`
  - 改动：新增路由 `/me/htlb`（name `MeHtlb`，`meta.hideTab:true`）；
    `htlb` 项去掉 `external:true`，`path` 改 `'/me/htlb'`；`go()` 走 `router.push`
  - 验收：点击进内嵌页而非跳外链；底部 Tab 隐藏

- [ ] **T3** · 桌面端新增内嵌页 + 入口改造
  - 文件：`life-assisitant-ui-desktop/src/pages/me/htlb.tsx`、路由表、`life-assisitant-ui-desktop/src/pages/me/index.tsx`
  - 改动：新增 `MeHtlbPage`（`.sub-page` + `.sub-page-header` + iframe 铺满）；
    路由 `/me/htlb`；`htlb` 项 `onClick` 改 `navigate('/me/htlb')`
  - 验收：点击进内嵌页，返回栏可用

- [ ] **T4** · 双端构建自测
  - 文件：`life-assisitant-ui-mobile`、`life-assisitant-ui-desktop`
  - 改动：无（验证）
  - 验收：`vue-tsc` / `tsc` 通过，`vite build` 通过

## 完成判定

- [ ] 所有任务项已实现并 commit
- [ ] 本批 spec 中「验收标准」逐条自测通过
- [ ] 完成后：① 在 schedule 头部加「完成声明：已在分支 `<分支名>` 完成」；② 目录改名加 `(√)`；③ push 到 main
