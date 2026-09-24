# S1 · 主 Tab `<KeepAlive>` 缓存

> 篇属 `md/spec-20260924-v2/` · 端：**移动端为主，桌面端数据级**
> 基准代码：2026-09-24 实测

---

## 1. 是什么

把 5 个主 Tab 页（Home / Task / Record / Stat / Me）用 `<KeepAlive>` 缓存住组件实例，
使**切换 Tab 不再销毁重建、不再重新拉首屏数据**，从而消除"那 0.几秒空白"。

**一句话**：切 Tab = 从"重新打开一个页面"变成"切到已经开着的页面"。

---

## 2. 为什么（现状实锤）

- `HomeLayout.vue`：`<component :is="Component" :key="viewKey" />`，无 `<KeepAlive>`。
- 每页 `onMounted` 重新 `Promise.all` 打多个接口（首页 5 个）。
- ⇒ 每次切 Tab：卸载 → 重建 → 发请求 → 等响应 → 渲染，这段时间页面是空的。

---

## 3. 关键规则

### 3.1 缓存白名单
`include` 按**路由 name** 精确匹配：

```ts
const KEEP_ALIVE_TABS = ['Home', 'Task', 'Record', 'Stat', 'Me']
```

```html
<router-view v-slot="{ Component, route }">
  <transition name="fade-page">
    <keep-alive :include="KEEP_ALIVE_TABS">
      <component :is="Component" :key="route.name" />
    </keep-alive>
  </transition>
</router-view>
```

> ⚠️ **`<KeepAlive :include>` 匹配的是「组件 name」，不是 vnode key**。
> 5 个页面都是 `pages/*/index.vue`，**不写 name 时推断名都是 `index`**（互相碰撞、
> 且与白名单对不上）→ 缓存完全失效。因此**必须**在每个页面里显式声明：
> ```ts
> defineOptions({ name: 'Home' })  // Task / Record / Stat / Me 同理
> ```
> 这是本批最容易踩的坑，已在代码里落地并注释。

> ⚠️ **key 从 `route.fullPath` 改为 `route.name`**：
> KeepAlive 靠 key 判断"是不是同一个实例"。若 key 用 fullPath，同 Tab 带不同 query
> （如 `/task?filter=all` → `/task?filter=done`）会被当成两个实例、缓存两份、且都命中不了，
> 反而更差。改用 `route.name` 后，**同 Tab 恒定复用同一实例**；Tab 内的 query 变化
> 由页面自身 `watch` 处理（现有逻辑保留）。
> ⚠️ **覆盖层子路由**（`meta.overlay`）依赖原 `viewKey` 逻辑（与宿主共用 key）——
> 改造时需**保留 overlay 分支**，且返回**宿主路由的 name**（不是 path），
> 才能与直接访问宿主页时产出的 key 一致：
> `key = route.meta.overlay ? 宿主.name : route.name`。
> （宿主的覆盖层由 Record 页自己的内层 `<router-view>` 渲染，外层只需保证宿主不重建。）

### 3.2 数据刷新：缓存 ≠ 陈旧
缓存实例后，切回来看到的是上次的 DOM。**必须**在 `onActivated` 做静默刷新：

```
组件生命周期（KeepAlive 下）：
  首次进入   → onMounted → onActivated（首拉，带 loading）
  切走       → onDeactivated
  再次切回   → onActivated（静默刷新，无 loading）
```

统一封装建议（`composables/useKeepAliveRefresh.ts`）：

```ts
/**
 * 首拉带 loading，回归静默刷新。
 * @param load   真正的数据拉取（返回 Promise）
 * @param opts   { silent: 是否静默 } 由本 composable 决定后回调
 */
export function useKeepAliveRefresh(load: (silent: boolean) => Promise<void>) {
  let firstDone = false
  onActivated(async () => {
    if (!firstDone) {
      firstDone = true
      await load(false)      // 首拉：显示 loading / 骨架
    } else {
      await load(true)       // 回归：静默，不闪 loading
    }
  })
  // onMounted 不再拉数据（避免与 onActivated 首帧重复请求）
}
```

⚠️ **易错点**：Vue 中**首次挂载也会触发 `onActivated`**（在 `onMounted` 之后）。
所以**不要把首拉放 `onMounted`**，否则首屏会发两次请求。正确做法：所有拉取逻辑都放
`onActivated`，用 `firstDone` 区分。

### 3.3 静默刷新的约束
- 不弹 loading、不显示骨架（用已有内容占位）。
- **不清空**已有列表（`items.value = []` 这类"清空再填"要避免，否则闪一下变空）。
  做法：拉取结果直接替换（Vue diff 会复用 DOM）；若必须清空，先拉后换。
- 不改滚动位置。
- 失败时**不打断**已有内容（静默失败或轻提示，视页面现有策略）。

### 3.4 生命周期收口（防幽灵状态）
引入 KeepAlive 后，切走时组件**不销毁**，以下需在 `onDeactivated` 处理：

| 状态 | 处理 |
|---|---|
| 打开的弹层（`van-popup`） | `onDeactivated` 时**收起**（否则切回还开着 = 幽灵弹层） |
| 展开的抽屉 / 面板 | 同上，收起或保留（按页面语义定，默认收起） |
| `setInterval` / `requestAnimationFrame` | `onDeactivated` 暂停，`onActivated` 恢复 |
| 未完成的滚动动画 | 停 |

> 5 页当前无长驻定时器，但**落地时仍需 grep 复核**每页是否有 `setInterval` / 全局监听。

### 3.5 滚动位置
- 每页有页内滚动容器（`.home-body` / `.task-list-wrap` / `.tab-body` /
  `.stat-body` / `.page-body`），DOM 不销毁 ⇒ **滚动位置自动保留**。
- `router/index.ts` 的 `scrollBehavior` 只管 window 滚动，对页内容器无效，**无需改动**。
- ⚠️ 落地时自查各页 `watch` 是否在数据变化时误调 `scrollTo(0)`。

---

## 4. 桌面端（React）方案

- React 无 KeepAlive。**不做组件级缓存**。
- 走**数据级缓存**：页面首屏数据依赖 store，store 已具备 `loadedOnce`（如 `task.ts`）。
  落地时确认 5 页数据源均"store 有数据则不重复拉首屏"，缺的补上。
- 桌面端无过渡动画，切页空白感远低于移动端，收益已验证为**可选**。

---

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| 数据陈旧 | `onActivated` 静默刷新（§3.2） |
| 内存（低端机） | 真机压测；超标则 `<KeepAlive :max="3">` + LRU |
| 幽灵弹层/定时器 | §3.4 生命周期收口 |
| query 变化失效 | key 用 `route.name`（§3.1） |
| overlay 子路由串状态 | 保留 overlay 的 hostKey 分支（§3.1） |

---

## 6. 验收（本篇）

- [ ] 5 Tab 互切无空白、无 loading 闪烁
- [ ] 切回数据正确（含"别处改数据"场景）
- [ ] 滚动位置保留
- [ ] 无幽灵弹层
- [ ] query 变化不导致重建
- [ ] `vue-tsc --noEmit` 通过
