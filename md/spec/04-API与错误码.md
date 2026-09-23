# 04 · API 与错误码

## 1. 通用约定

| 项 | 值 |
|---|---|
| 前缀 | **`/z1/api/v1`**（`ServicePrefix=/z1`，`APIPrefix=/z1/api/v1`） |
| 静态资源 | `/z1/uploads` |
| 鉴权 | Bearer JWT（Header `Authorization`） |
| 请求 ID | `X-Request-Id`；另注入 `X-Device-Id`、`X-Client-Platform: mobile` |
| 响应 | 统一 JSON 包装；**HTTP 204** 用于删除类（无 body） |
| 分页 | `page` / `page_size`（默认 20，上限 100） |
| 软删除 | 删除后列表不再返回，30 天内可恢复 |

### 1.1 中间件链

```
RequestId → CORS → Recovery → AccessLog → ErrorHandler → JwtAuth（白名单放行）
```

---

## 2. 鉴权与令牌

| 项 | 值 |
|---|---|
| access token TTL | **4 小时**（`jwt.accessTtl: 14400`） |
| refresh token TTL | **7 天**（`jwt.refreshTtl: 604800`） |
| 算法 | HS256；**access 与 refresh 用两把不同密钥** |
| refresh 存储 | 落库只存 **SHA-256 哈希**（`refresh_tokens.token_hash`） |
| 刷新语义 | **Rotation**：校验 device_id → 撤销旧 refresh → 签发新 access + refresh |
| 登出 | `all_devices=true` 撤销全部；否则只撤销当前 |
| 登录失败 | **5 次锁 10 分钟**（⚠️ 写死在 `service/impl/auth.go`，配置里的 `loginMaxFailures` 未被读取） |

前端：移动端已实现**静默刷新 + 并发队列**（`api/request.ts`，15s 超时兜底）；⚠️ **桌面端只有脚手架，未接线**。

详见 [12-账号与权限](./12-账号与权限.md)。

---

## 3. 端点全表

### 3.1 认证 / 会话

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/auth/login`、`/auth/register`、`/auth/refresh`、`/auth/forgot-password`、`/auth/reset-password` | 公开 |
| GET | `/auth/me`、`/auth/me/permissions`、`/auth/sessions`、`/permissions` | 已登录 |
| POST | `/auth/logout`、`/auth/change-password` | 登录 / `me:password` |
| DELETE | `/auth/sessions/:id` | 已登录 |
| GET | `/app/uploads-base` | 公开 |

### 3.2 首页与时间线

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/home` | `home:view` |
| GET | `/timeline?date=` | `timeline:view` |
| POST | `/sync`、GET `/sync/status` | ⚠️ `/sync` 是**假接口** |

### 3.3 任务 `task`

`GET /tasks`、`GET /tasks/:id`、`POST /tasks`、`PATCH /tasks/:id`、`PATCH /tasks/:id/complete`、`PATCH /tasks/:id/subtasks/:subtaskId`、`DELETE /tasks/:id`、`POST /tasks/batch`

### 3.4 习惯 `habit`

`GET /habits`、`GET /habits/today`、`GET /habits/:id`、`POST /habits`、`PATCH /habits/:id`、`DELETE /habits/:id`、`POST /habits/:id/log`

### 3.5 心情 `mood`

`GET /moods`、`GET /moods/timeline`、`GET /moods/today`（`mood:view`）；`PUT /moods`（`mood:write`）

### 3.6 财务 `finance` ⭐

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/accounts`、`/accounts/total` | 账户列表（带分组小计）、净资产汇总 |
| POST/PATCH/DELETE | `/accounts`、`/accounts/:id` | 账户 CRUD |
| GET | `/transactions`、`/transactions/:id` | 流水列表、详情 |
| POST | `/transactions`、`/transactions/transfer` | 记账、转账 |
| PATCH/DELETE | `/transactions/:id` | 编辑、删除 |
| POST | `/transactions/:id/reverse` | 冲正 |
| GET/POST/PATCH/DELETE | `/budgets`、`/budgets/:id` | 预算 |
| **GET** | **`/finance/summary?period=week\|month\|year`** | 顶部数据块四数（收入/支出/结余/预算） |
| **GET** | **`/finance/calendar?month=YYYY-MM`** | 收支日历 |
| **GET** | **`/finance/debts`** | 债权债务聚合 |
| GET/POST/PATCH/DELETE | `/finance/categories`、`/finance/categories/:id` | 财务分类 CRUD |
| GET/POST/PATCH/DELETE | `/user-categories`、`/user-categories/:id` | 习惯/待办分类 CRUD |

### 3.7 健康 `health`

`GET /health/overview`、`/health/calendar`、`/health/days`、`/health/days/:date`、`/health/settings`、`/health/events`（`health:view`）
`PUT /health/days/:date`、`DELETE /health/days/:date`、`POST /health/events`、`PATCH/DELETE /health/events/:id`（`health:write`）
`PATCH /health/settings`、`POST /health/setup`（`health:manage`）

### 3.8 经期 `period`

`GET /period/overview`、`/period/calendar`、`/period/days`、`/period/days/:date`、`/period/cycles`、`/period/settings`、`/period/report`（`period:view`）
`PUT /period/days/:date`、`DELETE /period/days/:date`、`PATCH /period/settings`、`POST /period/setup`（`period:write`）
`PATCH /period/cycles/:id`、`POST /period/reset`（`period:manage`）

### 3.9 纪念日 / 统计 / 通知 / 我的

| 分组 | 端点 |
|---|---|
| anniversary | `/anniversaries`（CRUD）、`/anniversaries/upcoming` |
| stat | `/stats/overview`、`/stats/tasks`、`/stats/habits`、`/stats/finance`、`/stats/export`（`stat:view` / `stat:export`） |
| notification | `/notifications`（列表、已读）⚠️ **无创建端点** |
| me | `PATCH /users/me`、`POST /users/me/avatar`、`POST /auth/change-password`、`POST /feedback` |
| user_mgmt | `/users` CRUD、`/users/:id/status`、`/users/:id/role` |
| role_mgmt | `/roles`、`/permissions`、`/roles/:code/permissions` |

---

## 4. 关键接口的语义陷阱

| # | 接口 | 陷阱 |
|---|---|---|
| **T1** | `PATCH /accounts/:id` | `record_flow` **只有显式传 `true` 才生成流水**（向后兼容，老前端行为逐分不变） |
| **T2** | `GET /transactions` | 类型筛选**走服务端**（`type` 为空 = 不加条件 = 全量含转账）；客户端过滤会与分页打架 |
| **T3** | 预算 `used` | 按 `period` **滚动现算**，忽略冻结的 `start_date/end_date` |
| **T4** | 剩余预算 | **只统计 `scope=total` 且选定周期**的预算；混入分类预算会重复计算。没有时显示「未设预算 · 去设置」，不做退化猜测 |
| **T5** | `GET /stats/overview` | **不接受 range** ⇒ 总览里的"今日任务/本周完成率/总净资产"是**固定维度** |
| **T6** | `PUT /moods` | 按 `(user_id, date, hour)` upsert；不传 `hour` 取服务器当前小时 |
| **T7** | 健康写入 | 身体指标**唯一写入路径是 `POST /health/events`**；`health_days` 是缓存 |
| **T8** | 日接口整体覆盖 | `saveDay` 必须「取回 → 合并 → 整体提交」；⚠️ **只许提交 period / moods**，身体指标只走 `addEvent` |
| **T9** | 转账 | ⚠️ **转账不可编辑**（只能删除/冲正） |
| **T10** | 编辑账户/用户 | 需带 `version`，冲突返回 `409001` |

---

## 5. 错误码

| 码 | 含义 | 说明 |
|---|---|---|
| `400001` | `ValidationFailed` | 参数校验失败（含账户 `type` 非法、`institution` 超长） |
| `400003` | 业务规则拒绝 | 如分类数量超限（待实施） |
| `401xxx` | 未认证 / token 过期 | 前端按 `REFRESHABLE_CODES` 决定是否静默刷新 |
| `403001` | `PermissionDenied` | 无权限（`RequirePermission` 未命中） |
| `409001` | `VersionConflict` | 乐观锁冲突（更新用户/账户必带 `version`） |
| `500002` | `DATABASE_ERROR` | ⚠️ **余额不足被错误地包成这个码**，`details.cause = ACCOUNT_INSUFFICIENT`（未修） |
| `400304` | `AccountTypeInvalid` | 已定义但**未启用** |

### 5.1 错误处理约定

- 错误**必须外显**：`response.Error(r, c, errs...)` + `details.cause`。
- ⚠️ **禁止 store 层裸 `catch {}`** —— 那是错误态的真正病根。正确模式：store 抛错，页面侧 `error && !loading && list.length === 0` 门控渲染 `<ErrorState>`。
- 前端统一失败提示仍在（全局拦截 `api/request.ts`），成功提示已大幅收敛（见 [02 §8](./02-设计系统.md) 与 [99 §3](./99-附录.md)）。

---

## 6. 权限模型（简述）

- 命名：**`module:action`**（如 `finance:view`），id 形如 `p_finance_view`。
- **48 条 / 15 模块**：`home / task / habit / category / mood / finance / period / health / anniversary / stat / timeline / notification / me / user_mgmt / role_mgmt`。
- 内置角色 **2 个**：`admin`（48 全量，矩阵锁定）、`user`（38 条，排除 user_mgmt / role_mgmt）。⚠️ `editor` / `viewer` 已废弃删除。
- 中间件 `RequirePermission(points...)` 是 **ANY-of**；**admin 代码旁路直通**。
- ⚠️ GoFrame v2 坑：路由级中间件必须走子分组 `group.Group("", func(g){ g.Middleware(...) })`，不能当第三参传。

详见 [12-账号与权限](./12-账号与权限.md)。
