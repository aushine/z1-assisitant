# Spec · 2026-10-01 · v3

> **批次名**：「性价比人生指南」改为 iframe 内嵌页（替代外链跳转）
> **基准**：`md/spec/11-我的.md` + v2 已上线的外链实现
> **本轮定位**：改动设计（对 v2 的体验改进），落地验收后结论回写 `md/spec/`。
> **冲突优先级**：代码 > `md/spec/` > 本批 > `md/archive/`。
> **上一批**：`md/spec-20261001-v2(√)`（外链入口，已上线 `cdb3fd0`）。本批为当天第 3 批。
> **需求方**：用户326014，2026-10-01 20:16 提出；**线框已定稿**（20:17）。

---

## 0. 范围一览

| # | 项 | 性质 | 端 | 涉及模块 |
|---|---|---|---|---|
| **H1** | 「性价比人生指南」由**外链跳转**改为 **iframe 内嵌页**，带返回按钮 | 📋 需求（体验改进） | **双端** | 我的 |

---

## 1. 需求原文（用户 2026-10-01 20:16）

> 「高性价比人生指南跳转到另一个网页上和我们的使用有点割裂，特别是我用 Safari 打开的话，
> 界面就会变成和网页一样，那和我希望的近似 app 体验有偏差，弄个 iframe 内嵌到我们的 app 里面吧，
> 要有一个返回按钮。」

**要点**：
1. **不跳出 app**（原来是 `window.location.href` 跳走，Safari 里变成"网页样"）→ 改为 **iframe 内嵌**。
2. **要有返回按钮**（回到「我的」）。
3. 地址仍**运行时生成**：`{当前协议}//{当前host}/htlb/HowToLiveBetter.html`（复用 v2 的 `htlbUrl()`）。

---

## 2. 现状（v2 已上线，代码实锤）

- `utils/external.ts`（双端）已有 `htlbUrl()` ✅ **本批复用它，不改**。
- 移动端 `me/index.vue`：项 `key:'htlb'`，`external:true`，`go()` 里 `window.location.href = item.path`（**跳走**）。
- 桌面端 `me/index.tsx`：项 `onClick` → `window.location.href = htlbUrl()`（**跳走**）。

**本批要改的**：把上述"跳走"改为"**进站内内嵌页**"。

---

## 3. 线框（已定稿，2026-10-01 20:17）

### 移动端
```
┌─────────────────────────────────────┐
│  ●●●●●●●●●  9:41        ▮▮▮ ⚡     │
├─────────────────────────────────────┤
│  ‹          性价比人生指南       ⋯  │  ← 导航栏（二级页）
├─────────────────────────────────────┤
│   ┌───────────────────────────┐     │
│   │  ❰iframe❱                 │     │
│   │  /htlb/HowToLiveBetter    │     │  ← 指南正文，可独立滚动
│   │      .html                │     │     不跳出 app
│   └───────────────────────────┘     │
├─────────────────────────────────────┤  ← 底部 Tab 隐藏（hideTab）
└─────────────────────────────────────┘
```

### 桌面端
```
┌──────────────────────────────────────────────────┐
│  ‹ 返回    性价比人生指南                    ⋯    │  ← .sub-page-header
├──────────────────────────────────────────────────┤
│    ┌────────────────────────────────────────┐    │
│    │  ❰iframe❱ /htlb/HowToLiveBetter.html   │    │  ← 占满内容区
│    └────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

> 可视化线框：`wireframe-iframe.html`（本目录）。

---

## 4. 改动方案

### 4.1 移动端

1. **新增页面** `src/pages/me/htlb.vue`：
   - 结构：`van-nav-bar`（左 `‹ 返回`，标题「性价比人生指南」）+ 全屏 `<iframe :src="htlbUrl()">`。
   - iframe 样式：`width:100%; height:100%; border:0;`，容器铺满导航栏以下区域。
   - 返回：`router.back()`（回「我的」）。
2. **新增路由**（`router/index.ts`，与 `/record/health/settings` 同级）：
   ```ts
   { path: '/me/htlb', name: 'MeHtlb',
     component: () => import('@/pages/me/htlb.vue'),
     meta: { title: '性价比人生指南', hideTab: true } }
   ```
3. **改 `me/index.vue`**：
   - `htlb` 项：**去掉 `external:true`**，`path` 改为 `'/me/htlb'`（站内路由）。
   - `go()`：恢复纯 `router.push(item.path)`（不再需要 external 分支，或保留分支无害）。

### 4.2 桌面端

1. **新增页面** `src/pages/me/htlb.tsx`：
   - 结构：`.sub-page` + `.sub-page-header`（`‹ 返回` + 标题）+ iframe 铺满内容区。
   - 返回：`navigate('/me')`。
2. **新增路由**（`MainLayout` / 路由表，与 `me/about` 同级）：
   - `path: '/me/htlb'` → `MeHtlbPage`。
3. **改 `me/index.tsx`**：
   - `htlb` 项：`onClick` 改为 `navigate('/me/htlb')`（原 `window.location.href`）。

### 4.3 兼容性 / 安全

- **X-Frame-Options / CSP**：htlb 页 (`/htlb/HowToLiveBetter.html`) 由 Pi nginx 提供，需确认**未被设为 DENY/SAMEORIGIN 限制非同源**。
  - 同源时不受限（同 host 同 port，属同源）→ **本场景同源，理论无碍**；实施前实测确认。
- **iframe 高度**：用 `height:100%` 或 `flex:1`，避免出现双滚动条。

---

## 5. 验收标准

- [ ] 移动端「我的 → 性价比人生指南」点击后**进内嵌页**（不跳出 app），顶部有返回按钮
- [ ] 移动端内嵌页隐藏底部 Tab；点返回回到「我的」
- [ ] 桌面端同上（进内嵌页 + 返回栏）
- [ ] iframe 内容正确加载（域名/IP/端口自适应，复用 `htlbUrl()`）
- [ ] 无双重滚动条；iframe 铺满内容区
- [ ] 桌面端 `setHealthOpen` 等旧逻辑无残留副作用
- [ ] 双端 `vue-tsc` / `tsc` 通过，构建通过

---

## 6. 端差异

| 维度 | 移动端 | 桌面端 |
|---|---|---|
| 页面 | `pages/me/htlb.vue` | `pages/me/htlb.tsx` |
| 导航栏 | `van-nav-bar`（‹ + 标题） | `.sub-page-header`（‹ 返回 + 标题） |
| 隐藏 Tab | `hideTab: true` | 不适用 |
| 返回 | `router.back()` | `navigate('/me')` |

---

## 7. 已知问题 / 未决项

- **未决 U1**：`htlb` 页面 `X-Frame-Options` 实测（同源应无碍）。
- **未决 U2**：iframe 内页面的字体/主题是否与 app 协调（内嵌页是独立 HTML，自带样式，不强求统一）。
