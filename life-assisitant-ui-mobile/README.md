# Z1 · Zero to One · 移动端 H5

> 「Zero to One —— 从零到一，构建自己的效率系统。」
>
> 移动端 SPA，覆盖任务 / 习惯 / 记账 / 统计 / 我的 5 大模块。

## 📦 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Vue | 3.4+ |
| 构建 | Vite | 5.x |
| UI 库 | Vant | 4.8+ |
| 状态 | Pinia | 2.1+ |
| 路由 | Vue Router | 4.x |
| HTTP | Axios | 1.6+ |
| 语言 | TypeScript | 5.x |
| 样式 | Sass + postcss-px-to-viewport | latest |
| 图标 | emoji 为主（不引入图标库） | — |

> ⚠️ 原 `package.json` 里的 `@vant/icons@^0.13.0` 已移除：该包版本号从
> `0.0.2` 直接跳到 `1.0.0`（无 0.13.x），**会让 `npm install` 直接 ETARGET 失败**；
> 且全工程零引用（图标策略是 emoji，见 `md/移动端移植方案.md` §3.4），
> Vant 4 的图标字体已由 `vant/lib/index.css` 自带。

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 3. 类型检查
npm run type-check

# 4. 生产构建
npm run build

# 5. 预览构建产物
npm run preview
```

> 设计稿基准 375px，开发时浏览器模拟设备宽度即可（移动端 H5）。

## 🗂 目录结构

```
src/
├── api/                  # API 封装（14 个模块，均完整实现）
│   ├── request.ts        # Axios 实例 + 拦截器（JWT 注入 / 401 静默刷新 + 并发队列）
│   ├── auth.ts / user.ts / role.ts / permission.ts
│   ├── task.ts / habit.ts / finance.ts / stats.ts
│   ├── home.ts / notification.ts / sync.ts / feedback.ts
│   └── types.ts          # 业务类型（SYNC-FROM-DESKTOP 锚点，与桌面端同步）
│
├── components/           # 公共组件
│   ├── TaskEditSheet.vue / TransactionEditSheet.vue
│   ├── HabitEditSheet.vue / AccountEditSheet.vue
│   └── TabPagePlaceholder.vue   # Tab 占位页模板（当前零引用，待接入或删除）
│
├── composables/          # 组合式函数
│   └── useLongPress.ts   # 长按手势（横向滚动区不能用左滑）
│
├── layouts/
│   └── HomeLayout.vue    # 移动端主布局（状态栏 + 内容 + 底部 Pill TabBar）
│
├── pages/                # 页面
│   ├── login/            # 登录页（按 spec/20-登录认证.md 实现）
│   ├── home/             # 首页 Tab
│   ├── task/             # 任务 Tab（B4 左滑删除 + B5 上拉加载）
│   ├── record/           # 记录 Tab
│   ├── stat/             # 统计 Tab
│   ├── me/               # 我的 Tab（含退出登录）
│   └── error/            # 403 / 404
│
├── router/
│   └── index.ts          # 路由表 + 守卫（auth / guest / requiresAdmin）
│
├── stores/               # Pinia
│   ├── user.ts           # 用户 + token + 记住密码（持久化到 localStorage）
│   ├── theme.ts          # light / dark / system（main.ts 中实例化，见 B3）
│   ├── task.ts / habit.ts / finance.ts / stats.ts
│   ├── notification.ts / sync.ts
│   └── app.ts            # 死代码，待清理
│
├── styles/
│   ├── tokens.scss       # CSS 变量（含 tint 6 组语义色 + 奖牌色 + 暗色覆写）
│   ├── reset.scss        # 全局重置
│   └── global.scss       # 工具类
│
├── types/
│   └── index.ts          # 通用类型（与 api/types.ts 分工：这里只放无业务依赖的基础类型）
│
├── utils/
│   ├── date.ts           # dayjs 收口：todayDate() / 格式化 / 相对时间
│   ├── tint.ts           # 语义色 6 组（SYNC-FROM-DESKTOP）
│   ├── task-dict.ts      # 优先级 / 状态字典（SYNC-FROM-DESKTOP）
│   ├── storage.ts        # localStorage 封装
│   └── validate.ts       # 表单校验
│
├── App.vue
├── main.ts
└── env.d.ts
```

## 🎨 设计系统

颜色、间距、圆角、阴影严格遵循 `../md/spec/03-设计系统.md`。

| Token | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#014DB2` | 品牌主色 |
| `--color-success` | `#10B981` | 成功/已完成 |
| `--color-warning` | `#F59E0B` | 警告 |
| `--color-danger`  | `#EF4444` | 错误/危险 |
| `--color-accent`  | `#8B5CF6` | 强调/紫 |

> 业务代码**禁止硬编码颜色/间距/圆角**，必须用 `var(--xxx)` 引用 token。

## 🧭 路由

| 路径 | 名称 | 鉴权 | 说明 |
|---|---|---|---|
| `/login` | Login | ❌ | 登录页 |
| `/` | (HomeLayout) | ✅ | 容器，自动 redirect 到 `/home` |
| `/home` | Home | ✅ | 首页 Tab |
| `/task` | Task | ✅ | 任务 Tab |
| `/record` | Record | ✅ | 记录 Tab |
| `/stat` | Stat | ✅ | 统计 Tab |
| `/me` | Me | ✅ | 我的 Tab |
| `/403` | Forbidden | ❌ | 无权限 |
| `/:pathMatch(.*)*` | NotFound | ❌ | 404 |

### 路由守卫

- `authGuard` — 未登录访问受保护路由 → 跳 `/login?redirect=xxx`
- `guestGuard` — 已登录访问 `/login` → 跳 `/home`

## 🔌 后端 API

后端基础路径通过环境变量 `VITE_API_BASE` 配置（默认 `/api/v1`，dev 走 vite proxy）。

- **生产**：`https://api.life.app/api/v1`
- **开发**：`/api/v1` → vite proxy → `http://localhost:8090`

> ⚠️ 后端端口是 **8090**（`life-assisitant-api/manifest/config/config.yaml`），
> 与 `vite.config.ts` 的 `server.proxy` 一致。此前 README 与本文件写作 8080 是错的。

具体协议遵循 `../md/spec/04-API规范.md`：
- JWT（access_token 15min + refresh_token 7d）
- 统一响应 `{ code, message, data }`
- 业务错误码 6 位（见 `06-错误码.md`）

## 📐 移动端适配

- 设计稿基准：375 × 812（iPhone 13/14）
- 使用 `postcss-px-to-viewport` 自动将 `px` 转 `vw`
- 适配 iOS 安全区（`env(safe-area-inset-*)`）
- 触摸目标 ≥ 44pt（无障碍）

## 🎯 验收清单（MVP）

- [x] 登录页 375px 宽，Hero 渐变 + 浮卡 + 眼睛切换 + 记住密码
- [x] 5 Tab 完整可切换（首页 / 任务 / 记录 / 统计 / 我的）
- [x] Pill TabBar（62px 高 + 36px 圆角 + 激活态实心蓝）
- [x] 路由守卫（未登录跳登录 / 已登录跳首页）
- [x] Axios 拦截器（JWT 注入 + 401 静默刷新 + 错误 toast）
- [x] Pinia user store 持久化（access/refresh token + user + 记住密码）
- [x] TypeScript 严格模式
- [x] 403 / 404 错误页
- [x] 设计 Token 完整（颜色/字体/间距/圆角/阴影）

## 📝 后续迭代

参见 `../md/spec/07-版本路线图.md`：
- v1.0 — 当前 MVP
- v1.1 — 协作升级（自定义角色 / 团队）
- v1.2 — 智能化（AI 建议 / 周报）
- v2.0 — 平台化（开放 API）

## 📚 相关文档

- [产品总览](../md/spec/00-总览.md)
- [导航规范](../md/spec/02-导航规范.md) ← Tab Bar 设计
- [设计系统](../md/spec/03-设计系统.md) ← 设计 Token
- [API 规范](../md/spec/04-API规范.md)
- [错误码](../md/spec/06-错误码.md)
- [登录认证](../md/spec/20-登录认证.md) ← 登录页实现
- [前端架构](../md/spec/40-前端架构.md)
