# Spec · 2026-09-24 · v2

> **批次名**：主 Tab 切换「跟手化」（干掉切换空白）
> **基准**：`md/spec/`（2026-09-24 代码实测）
> **本轮定位**：这一批是**改动设计**（要落地的新东西），落地验收后结论回写 `md/spec/`，再开 v3。
> **冲突优先级**：代码 > `md/spec/` > 本批 > `md/archive/`。
> **上一批**：`md/spec-20260924-v1/`（R1/R2/R6 已上线 `c448f54`；R3/R4/R5/R7 待办）。

---

## 0. 本批范围一览

| # | 项 | 性质 | 端 | 涉及模块 |
|---|---|---|---|---|
| **S1** | 5 个主 Tab 页面 `<KeepAlive>` 缓存（不重建、不重拉） | 📋 需求 | **双端** | 布局 / 5 Tab |
| **S2** | Tab 切换过渡动画：串行 `out-in` → 重叠/极短淡入 | 🎨 体验 | **双端** | 布局 |
| **S3** | 骨架屏兜底（首帧 & 缓存未命中时不留白） | 🎨 体验 | **双端** | 5 Tab |

> **拆分依据**：用户 2026-09-24 明确——切 Tab「那 0.几秒空白太不爽」，要求
> 「预加载 + 跟手横移」方向。经 agent 可行性分析后**用户拍板：先做方案 1+2**
> （KeepAlive 缓存 + 过渡动画重叠），横移暂不做。S3（骨架屏）是本批内 agent 建议的
> **兜底补强**，随 S1/S2 一起落地，避免"缓存首帧仍留白"。

---

## 1. 问题诊断（代码实锤，2026-09-24）

切主 Tab（首页/任务/记录/统计/我的）时的空白，是**三个原因叠加**，按贡献排序：

### 原因 ①：页面被销毁重建（最大头）
- `life-assisitant-ui-mobile/src/layouts/HomeLayout.vue`：
  `<component :is="Component" :key="viewKey" />`，`viewKey = route.fullPath`。
- 全项目**没有一处 `<KeepAlive>`**（grep 实测 0 命中）。
- 结果：每次切 Tab，页面组件 unmount + mount 从零走一遍。

### 原因 ②：挂载后重新发一堆请求
- 每页 `onMounted` 都在拉数据。首页一次 `Promise.all` 打 5 个接口
  （`refresh()` / `moodStore` / `habitStore` / `financeStore` / `taskStore`），
  其余页同构。
- 请求飞行期间页面渲染 loader/空态 = 用户看到的空白。**这是"不跟手"的主体，
  不是 JS chunk 下载**。

### 原因 ③：过渡动画串行 260ms
- HomeLayout 的 `<transition name="fade-page" mode="out-in">`：
  离开 130ms + 进入 130ms **串行**。旧内容先淡出 → 这段期间新内容还没进来，视觉上是空的。
- App.vue 的 `.fade-layout` 同理（登录页 ↔ 主应用 ↔ 二级页）。

### 已做过的优化（背景，本轮不重复做）
- `src/router/prefetch.ts`：布局挂载后 `requestIdleCallback` 预取 5 个 Tab 的 JS chunk。
  **所以"预加载 chunk"基本已完成**，再堆预加载收益有限——真正要缓存的是**组件实例 + 数据**。

---

## 2. 方案总览（本批做什么 / 不做什么）

### ✅ 做
- **S1**：`<KeepAlive>` 缓存 5 个主 Tab 页 → 切回不重建、不重拉，瞬切。
- **S2**：过渡动画由「串行 out-in 淡出+淡入」改为「重叠 / 极短淡入」，去掉空档。
- **S3**：骨架屏兜底（首帧、缓存未命中、下拉刷新时）。

### ❌ 本批不做（明确记录决策）
- **主 Tab 左右横移（跟手 ViewPager）**：经可行性分析**不做**，理由：
  1. 真横移要求 5 个页面**同时常驻并排渲染**，低端机上内存/首帧成本反而更高；
  2. 项目已存在 `composables/useSwipeTabs.ts`，但它是**模块内二级 tab** 的
     "假横移"（旧出→替换→新进三段式），主 Tab 直接复用会与「页面内左滑删除
     （`van-swipe-cell`）」「横向滚动容器」抢手势；
  3. **设计规范/平台惯例**：主 Tab 不横滑，横滑是二级 tab 的行为。
  > 结论：先做 S1+S2 吃掉空白；横移作为**后续可选增强**（见 §7 未决项）。

---

## 3. 信息架构 / 缓存范围

### 3.1 哪些页面进缓存（移动端）
`HomeLayout` 的 `<router-view>` 下，**only 5 个主 Tab 页**进 `<KeepAlive>`：

| 路由 name | path | 缓存 |
|---|---|---|
| Home | `/home` | ✅ |
| Task | `/task` | ✅ |
| Record | `/record` | ✅ |
| Stat | `/stat` | ✅ |
| Me | `/me` | ✅ |

**不进缓存**的（保持现行为，销毁重建）：
- 二级页（`/me/*`、`/record/*`、`/system/*`、`/task/:id`）：它们挂**顶层路由**，
  本来就在 `HomeLayout` 的 `<router-view>` 之外（或 `meta.hideTab`），不受影响。
- **覆盖层子路由**（`meta.overlay`，如 `/record/finance-categories`）：必须与宿主
  共用同一 key（现逻辑保留），**不单独缓存**，走 overlay 层。

### 桌面端缓存
- 桌面端 `MainLayout.tsx` 用 React Router `<Outlet/>`，**无 transition**；5 个页面都是顶部
  **急加载 import**（非 lazy chunk）→ **没有移动端那种"白一下"**。
- React 侧**没有** `<KeepAlive>` 对应物。本批桌面端**只做已确认最小改动**：
  **首页 `pages/home/index.tsx` 加模块级 SWR 缓存**（再次进页先用缓存渲染、后台静默刷新）。
- ⚠️ **不做**其它 4 页的组件级缓存（`<Activity>`/自研 cache 容器）——桌面无过渡动画，
  空白感远低于移动端，改动风险/收益不划算。其余页数据多在 store（已有缓存语义）。

---

## 4. 关键规则

### 4.1 KeepAlive 缓存规则（移动端 S1）
- `<KeepAlive>` 的 `include` 白名单按**路由 name**：`['Home','Task','Record','Stat','Me']`。
- 之所以用 `include` 而非全量：`/task/:id` 详情页等**不该缓存**，否则返回时状态串。
- `router-view v-slot` 里的 `:key`：缓存命中的页面**key 必须稳定**，否则 KeepAlive
  也会当新实例。5 个主 Tab 的 key 保持 `viewKey`（fullPath），但**同一 Tab 的 fullPath
  不含 query 变化时才会复用**——⚠️ 若某 Tab 带 query（如 `/task?filter=xxx`），
  fullPath 变化会导致 KeepAlive 缓存失效→重建。**本批把主 Tab 的 key 从 `fullPath`
  改为 `route.name`**，保证同 Tab 恒定复用（见 §5 注意点）。

### 4.2 数据刷新策略（S1 核心：缓存≠不更新）
缓存住实例后，**不能**让切回来的数据是"过期快照"。分层策略：

| 场景 | 行为 |
|---|---|
| 首次进入 Tab | `onMounted` 正常拉（不变） |
| 再次切回 Tab | **`onActivated`**：走「静默后台刷新」——**先用缓存渲染**（瞬间有内容），再异步 `fetch` 对比更新（无 loading 闪烁） |
| 用户主动下拉刷新 | 强制 `fetch`（现有逻辑不变） |
| 数据被其它入口改动（如首页记一笔后账变） | 依赖 store 响应式：store 是单例，改动了所有引用处自动更新（**现有架构已满足**，无需额外广播） |

- ⚠️ 移动端 5 页的 `onMounted(async …)` 需**拆**成 `onMounted`（首挂）+ `onActivated`
  （切回静默刷新）。首挂也要在 `onActivated` 首次触发——Vue 中首次挂载**会**触发
  `onActivated`，所以正确写法是：把首拉逻辑放 `onActivated`，用页内 `loadedOnce` 判断
  是首拉（带 loading）还是回归（静默）。
- **静默刷新要求**：不弹 loading、不改滚动位置、不清空已渲染内容（防"闪一下变空"）。

### 4.3 滚动位置（S1）
- 移动端每页有**页内滚动容器**（`.home-body` / `.task-list-wrap` / `.tab-body` /
  `.stat-body` / `.page-body`），`overflow-y:auto`。
- 缓存后，**滚动位置天然保留**（DOM 未销毁）——这是 KeepAlive 的附赠收益。
- ⚠️ 但 `router/index.ts` 的 `scrollBehavior` 目前 `return { top: 0 }`，**对页内滚动容器无效**
  （它只作用于 window/document 滚动）。所以**无需改动**；但要**确认**切回时不被任何
  逻辑强制 `scrollTo(0)`（各页 `watch` 需自查）。
- 二级页返回（`savedPosition`）：保持现状。

### 4.4 过渡动画规则（S2）
- 移动端：把 `.fade-page` 的 `mode="out-in"` **去掉**（或换成过渡更短的重叠方案），
  目标总时长从 260ms → **≤ 120ms**，且"淡出"与"淡入"**重叠**而非串行。
- App.vue 的 `.fade-layout`（登录↔主应用）**保留 out-in**（这是一次性场景，空白无感）。
- 桌面端：本就无过渡，**保持不变**（或加极短 80ms 淡入，可选项）。
- ⚠️ 尊重 `prefers-reduced-motion`（现有 `.tab-pill-indicator` 已有该 media query，
  过渡动画同理加）。

### 4.5 骨架屏规则（S3）
- 移动端：每页「首帧（缓存未命中）+ 下拉刷新后」显示 `van-skeleton`，替代白屏/裸 loader。
- 骨架结构**贴合各页真实布局**（KPI 卡 → 4 块；列表 → 3~5 行），不求像素级一致。
- 桌面端：已有 Semi `Skeleton` 用法（若有则沿用），无则本批**不新增**（桌面空白感低）。

### 4.6 兼容性红线（KeepAlive 引入后必须复检）
KeepAlive 会**改变组件生命周期语义**，以下必须回归验证：
1. **弹层 teleport**：所有 `van-popup` 必须 `teleport="body"`（HomeLayout 已订此铁律，
   缓存后弹层状态会被保留——需确认「切走再切回」时弹层**不该还开着**，即弹层开合
   状态应在 `onDeactivated` 时收起，避免"幽灵弹层"）。
2. **手势**：`useSwipeTabs` 的 `contentRef` 在 KeepAlive 下需确认引用不被替换。
3. **定时器 / 动画**：页面内若有 `setInterval` / 动画帧，`onDeactivated` 时需暂停，
   `onActivated` 恢复（本批 5 页当前无长驻定时器，需 grep 确认）。
4. **`onMounted` 只跑一次**的假设：任何"挂载即绑定的全局监听"要迁到 `onActivated/onDeactivated`。

---

## 5. 接口 / 改动清单

> 均为**前端内部改动**，**无后端接口变更**。

### 移动端（`life-assisitant-ui-mobile`）
| 文件 | 改动 |
|---|---|
| `src/layouts/HomeLayout.vue` | ① `<router-view>` 包 `<KeepAlive :include>`；② key 改 `route.name`（overlay 分支返回宿主 name）；③ 去掉 `.fade-page` 的 `mode="out-in"`；④ 过渡时长 130ms→80ms + reduced-motion |
| `src/pages/home/index.vue` | `defineOptions({name:'Home'})`；`onMounted`→`onActivated`（首拉/静默分段）；`refresh({silent})` |
| `src/pages/task/index.vue` | 同上（name:'Task'）；+`onDeactivated` 清多选；`fetchTasks(_,{silent})` |
| `src/pages/record/index.vue` | 同上（name:'Record'）；首拉幂等，转 `onActivated` |
| `src/pages/stat/index.vue` | 同上（name:'Stat'）；`statsStore.refresh({silent})` |
| `src/pages/me/index.vue` | 同上（name:'Me'）；无首拉数据，仅声明 name |
| `src/stores/task.ts` | `fetchTasks` 加 `silent` |
| `src/stores/stats.ts` | `refresh`/`fetchOverview`/`fetchRangeStats` 加 `silent` |

> **骨架屏（S3）**：实测代码**已有**内联骨架（首页 `.panel-skel`、任务 `.loading-skeleton`、
> 统计 `.chart-skel`、习惯 `.loading-skeleton`），**已满足"不留白"要求**，本批**不重复新增**。

### 桌面端（`life-assisitant-ui-desktop`）
| 文件 | 改动 |
|---|---|
| `src/pages/home/index.tsx` | 模块级 SWR 缓存（`homeCache`）：再进页先显缓存 + `refresh({silent})` 后台刷新 |
| `src/layouts/MainLayout.tsx` | **不动**（无过渡动画，无需改） |
| 其余 4 页 | **不动**（急加载、无过渡，空白感低；数据多在 store） |

---

## 6. 端差异

| 维度 | 移动端 | 桌面端 |
|---|---|---|
| 缓存粒度 | 组件级 `<KeepAlive>`（实例 + DOM + 滚动） | 数据级（store 缓存） |
| 过渡动画 | 有（本批优化） | 无（保持） |
| 骨架屏 | 做（本批） | 不做 / 沿用现有 |
| 横移手势 | 不做（本批） | 不适用 |

---

## 7. 已知问题 / 未决项

- **未决 U1**：主 Tab 横移（跟手 ViewPager）是否后续做？——本批**不做**，留待 S1+S2
  上线后评估真实手感再定。
- **未决 U2**：`KeepAlive` 内存占用——5 页常驻，低端机（iOS 旧机型）需真机压测；
  若超标，改为 `max` 限制 + LRU（如只缓存最近 3 个 Tab）。
- **已知风险**：缓存后「数据陈旧」是主要风险，靠 §4.2 的 `onActivated` 静默刷新兜底；
  需专门验收「切走 → 别处改数据 → 切回」是否正确更新。
- **验收前提**：本项目**无自动化测试**，验收靠真机手测 + 构建产物核对。

---

## 8. 验收标准（落地后逐条核对）

1. 5 个主 Tab 来回切换，**无可见空白**（主观：达到"瞬切"）。
2. 切回某 Tab **不出现 loading 闪烁**（先显缓存内容，再静默刷新）。
3. 「切走→别处改数据→切回」数据**正确更新**。
4. 页面滚动位置在切走切回后**保留**。
5. 弹层无"幽灵"（切走时打开的弹层，切回不应还开着）。
6. `prefers-reduced-motion` 下动画关闭。
7. 双端构建通过（`vue-tsc --noEmit` + `vite build`；桌面端 `tsc` + `build`）。
8. 真机（iOS Safari / Android Chrome）手测通过。

---

## 9. 实施顺序（供落地参考）

1. S1-移动端：`HomeLayout` 上 `<KeepAlive>`（先不加刷新策略，验证"缓存即瞬切"）。
2. S1-数据：5 页 `onMounted`→`onActivated` 拆分 + 静默刷新。
3. S2：过渡动画改重叠/缩短。
4. S3：骨架屏。
5. 桌面端：store 数据缓存补齐。
6. 回归 §4.6 兼容性红线 + §8 验收。
