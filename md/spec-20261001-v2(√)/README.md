# Spec · 2026-10-01 · v2

> **批次名**：个人空间「健康设置」→「性价比人生指南」入口替换
> **基准**：`md/spec/11-我的.md`（我的模块）
> **本轮定位**：改动设计（要落地的新东西），落地验收后结论回写 `md/spec/`。
> **冲突优先级**：代码 > `md/spec/` > 本批 > `md/archive/`。
> **上一批**：`md/spec-20261001-v1`（同日 v1）。本批为当天第 2 批。
> **需求方**：用户326014，2026-10-01 19:22 提出。

---

## 0. 范围一览

| # | 项 | 性质 | 端 | 涉及模块 |
|---|---|---|---|---|
| **G1** | 个人空间「健康设置」项 → 改为「性价比人生指南」，点击跳转外链 | 📋 需求 | **双端** | 我的 / 个人空间 |

---

## 1. 需求原文（用户 2026-10-01）

> 「我们的 z1 生活助手项目个人空间模块，把健康设置换成性价比人生指南，点击后就是跳转这个网页
> `https://voz21.cn/htlb/HowToLiveBetter.html`。**这个网址不是固定的，就是地址栏的 host:port**。
> 就是跳转到 ip 端口的 htlb 里面。」

**要点**：
1. 「我的空间」分组里的 **「健康设置」** 这一项，**label 改为「性价比人生指南」**。
2. 点击 **不再进入站内页（移动端）/ 浮层（桌面端）**，改为**跳转外部链接**。
3. **链接地址不写死**：用**运行时的 `location.host`（含 host + port）** + 固定路径 `/htlb/HowToLiveBetter.html`。
   - 例：从 `https://voz21.cn/` 访问 → `https://voz21.cn/htlb/HowToLiveBetter.html`
   - 从 `http://192.168.101.75/` 访问 → `http://192.168.101.75/htlb/HowToLiveBetter.html`
   - 从 `http://39.107.229.213/` 访问 → 同理（用当前 host）
4. **协议**：跟随当前页面协议（`location.protocol`），http 站跳 http、https 站跳 https。

---

## 2. 现状（代码实锤，2026-10-01）

### 移动端 `life-assisitant-ui-mobile/src/pages/me/index.vue`

L148-158，「我的空间」分组内的健康设置项：

```ts
// 健康设置 —— 经期设置已并入这里
if (userStore.hasPermission(HEALTH_VIEW)) {
  space.push({
    key: 'health',
    icon: 'HeartPulse',
    tint: getTint('danger'),
    label: '健康设置',
    sublabel: '指标与经期',
    path: '/record/health/settings',   // ← 站内路由
  })
}
```

- `SettingItem` 类型（L104-111）只有 `path` 字段（站内路由），**无法表达外链**。

### 桌面端 `life-assisitant-ui-desktop/src/pages/me/index.tsx`

L125-133：

```tsx
{
  key: 'health',
  icon: <Icon name="HeartPulse" size={20} />,
  label: '健康设置',
  sublabel: '指标与经期',
  onClick: () => setHealthOpen(true),   // ← 开浮层
}
```

- 桌面端是 `onClick` 开 Drawer 浮层；本批改为外链跳转。

---

## 3. 改动方案

### 3.1 链接生成规则（核心）

```
targetUrl = `${location.protocol}//${location.host}/htlb/HowToLiveBetter.html`
```

- **必须运行时计算**（不能构建期写死），因为：
  - 同一份产物要同时服务 `voz21.cn`（域名）、`39.107.229.213`（IP）、`192.168.101.75`（内网）等多种入口。
  - `location.host` 天然含 port（如 `:8443`），满足"host:port"要求。
- 实现建议：抽一个工具函数，双端各一份（或各自内联）：
  ```ts
  // utils/external.ts（建议）
  export function htlbUrl(): string {
    return `${location.protocol}//${location.host}/htlb/HowToLiveBetter.html`
  }
  ```

### 3.2 移动端

1. `SettingItem` 类型加**可选** `external?: boolean`（或 `url?: string`），标识"外链项"。
2. 健康设置项：
   - `label` 改为 `'性价比人生指南'`
   - `sublabel` 改为 `'用最少的钱换回寿命'`（或留空，见 §4 待确认）
   - 加 `path: htlbUrl()`（或 `url`）+ `external: true`
   - **图标**：保留 `HeartPulse` 或换（见 §4 待确认）
3. 点击处理（L259 `go()` 或新分支）：若 `external`，用 `window.location.href = url`（**当前页跳转**，非新标签）；
   否则走原 `router.push(path)`。

### 3.3 桌面端

1. 健康设置项：
   - `label` → `'性价比人生指南'`
   - `onClick` → `() => { window.location.href = htlbUrl() }`
   - 移除/保留 `setHealthOpen`（若该浮层仅此入口用，则可安全移除；否则保留函数）
2. **注意**：桌面端的 `setHealthOpen` 浮层是否还有其它入口？（见 §4 待确认）

### 3.4 权限

- 移动端当前有 `hasPermission(HEALTH_VIEW)` 条件。
- **「性价比人生指南」是公开内容，不应受健康权限限制** → **移除该权限判断**，让所有用户可见。
- 桌面端原本无权限判断，保持不变。

---

## 4. 决策留档（待用户确认）

| # | 问题 | 建议 | 状态 |
|---|---|---|---|
| D1 | sublabel 文案 | 「用最少的钱换回寿命」（或空） | ⏳ 待确认 |
| D2 | 图标是否更换 | 保留 HeartPulse / 换 BookOpen / 换 Scale | ⏳ 待确认 |
| D3 | 跳转方式 | **当前页跳转**（`location.href`），非新标签 | ⏳ 待确认 |
| D4 | 桌面端 `setHealthOpen` 浮层其它入口 | 需排查，若仅此一处则移除 | ⏳ 待确认 |
| D5 | 权限判断移除 | 建议移除（公开内容） | ⏳ 待确认 |

> 若用户未逐条回复，按「建议」列执行（主理人自主定稿）。

---

## 5. 验收标准

- [ ] 移动端「我的空间」有「性价比人生指南」项（原「健康设置」位置）
- [ ] 桌面端「我的空间」有「性价比人生指南」项
- [ ] 点击后跳转到 `{当前协议}//{当前host}/htlb/HowToLiveBetter.html`
- [ ] 用域名访问（voz21.cn）→ 跳 `https://voz21.cn/htlb/HowToLiveBetter.html`
- [ ] 用内网 IP 访问（192.168.101.75）→ 跳该 IP 对应的 htlb 地址
- [ ] 双端 `vue-tsc` / `tsc` 通过，构建通过
- [ ] 原有站内「健康设置」入口的副作用已处理（如权限判断、浮层复用）

---

## 6. 端差异

| 维度 | 移动端 | 桌面端 |
|---|---|---|
| 原交互 | 进站内页 `/record/health/settings` | 开 Drawer 浮层 |
| 新交互 | 跳外链 | 跳外链 |
| 权限 | 原 `HEALTH_VIEW` → 移除 | 原本无 → 不变 |
| 类型 | `SettingItem` 加 `external` 字段 | 无类型改动 |

---

## 7. 已知问题 / 未决项

- **未决 U1**：`htlb` 页面本身是否已有？（已确认：`https://voz21.cn/htlb/` 已上线，2026-10-01 由主理人部署）
- **未决 U2**：外链跳转后，用户无法通过站内返回按钮回来——属正常外链行为，不额外处理。
