# Spec · 2026-09-24 · v3

> **批次名**：主 Tab 切换方向感知转场（方案 D · 快照/位移转场）
> **基准**：`md/spec/`（2026-09-24 代码实测）+ `md/spec-20260924-v2/`（KeepAlive 已上线）
> **本轮定位**：**需求**（用户 2026-09-24 明确选「方案 D」）。落地验收后结论回写 `md/spec/`。
> **冲突优先级**：代码 > `md/spec/` > 本批 > `md/archive/`。
> **上一批**：`md/spec-20260924-v2/`（KeepAlive 缓存 + 过渡缩短，已上线 `5a5b63c`）。

---

## 0. 本批做什么

| # | 项 | 端 |
|---|---|---|
| **D** | 主 Tab 切换改为**方向感知的横滑转场**（点左 → 新页从左进、旧页向右出；点右反之） | **移动端**（桌面端见 §6） |

> **为什么选 D**：v2 已让切换「不再重建、不重拉」（瞬切），但过渡仍是**淡入淡出**——没有空间连续性，用户仍觉「生硬」。方案 D 用「新旧两页在转场期间短暂并存 + 同时横向平移」制造**推挤感**，方向与用户点击一致，接近原生 App；相比「真跟手横移」（方案 C）成本低得多（无需相邻页常驻，仅转场 ~200ms 两页并存）。

**不做**：
- **方案 C（真 1:1 跟手横移）** —— 本批不做（需相邻页常驻、内存与手势冲突回归成本高；D 已能给到方向感）。
- 手指**拖拽切主 Tab** —— 本批不做（D 是「点击触发 + 方向动画」，不接管手指横滑；横滑仍归模块内二级 tab 的 `useSwipeTabs`）。

---

## 1. 现状（代码实锤）

- `layouts/HomeLayout.vue`：`<main class="content">` 内 `<router-view>` → `<transition name="fade-page">` → `<keep-alive :include="KEEP_ALIVE_TABS">` → `<component :is="Component" :key="viewKey">`。
- `fade-page` 仅 `opacity` 过渡（v2 已去 `out-in`、时长压到 `--duration-instant` 80ms）→ **纯淡入淡出，无位移**。
- 底部胶囊指示块按 `activeIndex` 做 `translateX`（已有位移）。
- `useSwipeTabs`（模块内二级 tab）：1:1 跟手横移，仅当 `tabs.value` 非空时生效（首页/我的/二级页不生效）。
- 5 个主 Tab 页由 `<KeepAlive>` 缓存；key = `route.name`（overlay 子路由取宿主 name）。

---

## 2. 方案 D 设计（方向感知横滑转场）

### 2.1 核心

把 `fade-page` 从「纯 opacity」升级为「**按方向平移 + 交叉淡入**」：

```
点右边 Tab（activeIndex 增大）：
  旧页：translateX(0 → -18%)  + opacity 1 → 0
  新页：translateX(+18% → 0)  + opacity 0 → 1
点左边 Tab（activeIndex 减小）：
  旧页：translateX(0 → +18%)  + opacity 1 → 0
  新页：translateX(-18% → 0)  + opacity 0 → 1
```

- 幅度 **18%**（不是 100%）：太满会像"翻页"且露出背面；18% 的推挤感最像原生 segmented 切换，也让两页并存的视觉不至于太乱。
- 时长 **200ms**，`--ease-default`（与胶囊指示块动效同族，避免"内容先动、胶囊后动"的割裂）。
- leaving / entering **同时进行**（不加 `mode`），即两页短暂并存 → 这就是"快照/位移转场"的观感；旧页实际是 KeepAlive 里的**静止 DOM**（非真销毁），所以"快照"是免费的。

### 2.2 方向判定

- 在 `router.push` 前/或看 `activeIndex` 变化判定方向：新 index > 旧 index = 向右（内容左移）；否则向左。
- 实现：用一个 `transitionDirection: 'forward' | 'backward'` 响应式变量，在 `onTabClick` / route 变化时更新；`<transition>` 的 JS 钩子（`@before-enter` 等）按方向设置 CSS 变量 `--slide-from` / `--slide-to`。
- ⚠️ 非主 Tab 的跳转（二级页 `/task/:id`、`hideTab` 场景）不做横滑（它们不在 `KEEP_ALIVE_TABS`，key 也非 tab name）→ 保持淡入淡出，避免方向错乱。

### 2.3 与「模块内二级 tab 横滑」的关系

- 两者**互不冲突**：二级 tab 的横滑是 `useSwipeTabs` 直接操纵 `.content` 的 `translateX`（跟手），主 Tab 的 D 是**页面级** `<transition>` 的进出动画（`<component>` 自身平移）。
- ⚠️ 需确认 `useSwipeTabs` 在切主 Tab 时把 `contentStyle` 复位为 `{}`（静止不写 transform，见其文件头设计要点 5），否则内容区残留位移会与页面级过渡叠加。**本批回归验证这一条。**

### 2.4 无障碍 / 降级

- `prefers-reduced-motion: reduce` → 关闭位移，退化为极短（或 0）淡入。
- 保留 `.fade-page` 类名做**兜底**（万一 JS 钩子未触发，仍有淡入不白屏）。

---

## 3. 信息架构 / 涉及文件

| 文件 | 改动 |
|---|---|
| `layouts/HomeLayout.vue` | ① `<transition>` 加 JS 钩子（设置方向 CSS 变量）；② 新增 `transitionDirection` 状态；③ `onTabClick`/watch(route) 更新方向；④ `fade-page` 过渡 CSS 改为「translateX + opacity」；⑤ `prefers-reduced-motion` 降级 |
| （可选）`composables/useTabTransition.ts` | 抽方向判定 + 钩子，保持 HomeLayout 精简 |

**无后端改动。**

---

## 4. 关键规则

| # | 规则 | 说明 |
|---|---|---|
| D-1 | 方向 = `activeIndex` 增减 | 新 index > 旧 = 右移；相等（同页/非 tab 跳转）= 无方向，退回 fade |
| D-2 | 幅度 18%、时长 200ms、ease-default | 与胶囊指示块同族 |
| D-3 | 两页并存（无 `out-in`） | "快照感"来源；旧页是 KeepAlive 静止 DOM，非真销毁 |
| D-4 | 非主 Tab 跳转只 fade | 二级页 / overlay / hideTab 场景不做横滑 |
| D-5 | 静止不写 transform | 回归确认 `useSwipeTabs` 切主 Tab 时 `contentStyle` 已复位 |
| D-6 | `prefers-reduced-motion` 关位移 | 退化为极短淡入 |
| D-7 | 保留淡入兜底 | JS 钩子异常时不白屏 |

---

## 5. 验收标准

1. 点**右侧** Tab：新页从**右**滑入、旧页向左让位（方向正确）。
2. 点**左侧** Tab：方向相反。
3. 切换**无空白**、无"啪一下换画面"的割裂感；胶囊指示块与内容动效**同步**。
4. 二级页（任务详情等）跳转**不**误触发横滑。
5. 「减少动态效果」开启时**无位移**。
6. 移动端 `vue-tsc --noEmit` + `vite build` 通过。
7. 真机（iOS Safari / Android Chrome）手测通过。

---

## 6. 端差异

| 维度 | 移动端 | 桌面端 |
|---|---|---|
| D 转场 | 本批实现 | **不做** —— 桌面端用 SideMenu 导航（非底部 Tab），无横向 Tab 语义；且无过渡动画（切页不白屏）。如需可另议。 |

---

## 7. 已知问题 / 未决项

- **未决 U1**：要不要再叠加**手指横滑切主 Tab**（方案 C 的真跟手）？—— 本批不做，D 上线后按手感再议。
- **风险**：两页并存期间，若两页都有 `position: fixed` 子元素（FAB、弹层），可能短暂叠影 —— 回归验证；FAB 在各页内、切 Tab 时随页平移应可接受。
- **风险**：`will-change: transform` 只在转场期间加（避免常驻合成层副作用，参考 `useSwipeTabs` 设计要点 5）。

---

## 8. 实施顺序

1. HomeLayout 加方向状态 + `<transition>` JS 钩子（设置 `--slide-from/to`）。
2. `fade-page` 过渡 CSS 改「translateX + opacity」。
3. 方向判定逻辑（`onTabClick` + `watch(route)`）。
4. `prefers-reduced-motion` 降级 + 兜底。
5. 回归 D-5（contentStyle 复位）。
6. 类型检查 + 构建 + 部署 + 真机验收。
