# Z1 · Zero to One

> **跨端个人生活管理系统** —— 任务 / 习惯 / 记账 / 健康 / 统计，外加多用户与角色权限。
> 代号 **Z1**，Slogan **Zero to One**：从零到一，构建自己的效率系统。

<p>
  <img alt="mobile" src="https://img.shields.io/badge/mobile-Vue%203%20%2B%20Vant%204-42b883?style=flat-square&logo=vuedotjs&logoColor=white">
  <img alt="desktop" src="https://img.shields.io/badge/desktop-React%2018%20%2B%20Semi%20Design-61dafb?style=flat-square&logo=react&logoColor=white">
  <img alt="backend" src="https://img.shields.io/badge/backend-Go%201.22%20%2B%20GoFrame%20v2-00ADD8?style=flat-square&logo=go&logoColor=white">
  <img alt="database" src="https://img.shields.io/badge/database-MySQL%208-4479A1?style=flat-square&logo=mysql&logoColor=white">
</p>

一套后端，两个前端：**移动端 H5**（加到手机主屏即可当 App 用）与**桌面端 Web**（宽屏仪表盘）。
两端共用同一个 Go 服务与同一套 MySQL 数据，登录后看到的是同一份记录。

---

## 📸 界面预览

### 桌面端 · 1440 × 900

| 登录 | 首页 |
| :---: | :---: |
| ![桌面端 · 登录](./assets/screenshots/desktop-01-login.png) | ![桌面端 · 首页](./assets/screenshots/desktop-02-home.png) |
| **待办** | **记录 · 习惯** |
| ![桌面端 · 待办](./assets/screenshots/desktop-03-todo.png) | ![桌面端 · 记录/习惯](./assets/screenshots/desktop-04-record-habit.png) |
| **记录 · 财务** | **记录 · 健康** |
| ![桌面端 · 记录/财务](./assets/screenshots/desktop-05-record-finance.png) | ![桌面端 · 记录/健康](./assets/screenshots/desktop-06-record-health.png) |
| **统计 · 总览** | **统计 · 趋势** |
| ![桌面端 · 统计总览](./assets/screenshots/desktop-07-stat.png) | ![桌面端 · 统计趋势](./assets/screenshots/desktop-07b-stat-trend.png) |
| **我的** | **系统管理 · 权限矩阵** |
| ![桌面端 · 我的](./assets/screenshots/desktop-08-me.png) | ![桌面端 · 权限矩阵](./assets/screenshots/desktop-10-permission.png) |
| **系统管理 · 用户管理** | |
| ![桌面端 · 用户管理](./assets/screenshots/desktop-09-users.png) | |

### 移动端 · 390 × 844（iPhone 视口）

<p>
  <img src="./assets/screenshots/mobile-01-login.png" width="150" alt="移动端 · 登录">
  <img src="./assets/screenshots/mobile-02-home.png" width="150" alt="移动端 · 首页">
  <img src="./assets/screenshots/mobile-03-task.png" width="150" alt="移动端 · 待办">
  <img src="./assets/screenshots/mobile-03b-task-today.png" width="150" alt="移动端 · 待办/今日">
  <img src="./assets/screenshots/mobile-04-record-habit.png" width="150" alt="移动端 · 记录/习惯">
  <img src="./assets/screenshots/mobile-05-record-finance.png" width="150" alt="移动端 · 记录/财务">
  <img src="./assets/screenshots/mobile-06-record-health.png" width="150" alt="移动端 · 记录/健康">
  <img src="./assets/screenshots/mobile-07-stat-overview.png" width="150" alt="移动端 · 统计/总览">
  <img src="./assets/screenshots/mobile-08-stat-finance.png" width="150" alt="移动端 · 统计/财务">
  <img src="./assets/screenshots/mobile-09-stat-habit.png" width="150" alt="移动端 · 统计/习惯">
  <img src="./assets/screenshots/mobile-10-me.png" width="150" alt="移动端 · 我的">
</p>

> 全部截图（22 张，含各二级 Tab）在 [`assets/screenshots/`](./assets/screenshots/)。

---

## ✨ 功能一览

| 模块 | 能力 |
| :--- | :--- |
| **首页** | 问候 + 今日聚合：任务进度、习惯完成度、当前心情与精力、本月收支 |
| **待办** | 任务 CRUD、子任务、优先级、分类、批量完成 / 删除；今日 / 即将 / 已完成 / 逾期 四个视图 + 搜索排序 |
| **记录 · 习惯** | 习惯管理、一键打卡、连续天数与里程碑、打卡日历（标注农历与节假日） |
| **记录 · 财务** | 收支记账、账户间转账、预算管理、多账户；交易可修改 / 冲正 / 删除 |
| **记录 · 健康** | 身体指标（饮水 / 排便 / 基础体温 / 体重 / 备注）、**按小时**记录心情与精力、今日时间轴、月历、经期记录与预测 |
| **统计** | 总览 / 健康 / 财务 / 习惯 四个领域，各带默认区间（7 / 30 / 90 天或自定义）；趋势图 + 分类占比 + 明细表，支持导出 CSV |
| **我的** | 个人资料与头像、重要日子（纪念日 / 倒数日）、主题（浅色 / 深色 / 跟随系统）、通知设置、隐私与安全、同步状态、帮助与反馈 |
| **系统管理** | 用户管理（增删改 / 启用禁用 / 分配角色）、角色与权限矩阵（**45 个权限点 / 14 个模块**，支持自定义角色） |

---

## 🏗️ 技术栈

| 层 | 技术 |
| :--- | :--- |
| 移动端 H5 | Vue 3.4 · Vant 4 · Pinia · Vue Router 4 · Vite 5 · ECharts · SCSS |
| 桌面端 Web | React 18 · Semi Design 2.49 · Zustand · React Router 6 · Vite 5 · Chart.js |
| 后端 API | Go 1.22 · GoFrame v2.6 · GORM v2.25 · JWT v5 · MySQL 8 |
| 图标 | 两端统一 Lucide（`lucide-vue-next` / `lucide-react`，同版本 `0.300.0`） |
| 部署 | Nginx 单 `location` 分发 API + 静态资源；Docker Compose 编排基础设施 |

> ⚠️ 两个前端的**框架不同**（桌面端 React、移动端 Vue）—— 这是刻意选择：桌面端要 Semi 的表格与
> 表单生态，移动端要 Vant 的手势与原生观感。业务逻辑各自实现，靠 spec 与跨端约定保持一致。

---

## 🚀 快速开始

**前置**：Node.js ≥ 18 · Go ≥ 1.22 · Docker（或一个现成的 MySQL 8）

### 1. 起基础设施

```bash
docker compose -f docker-compose.dev.yml up -d
```

| 服务 | 地址 |
| :--- | :--- |
| MySQL 8 | `127.0.0.1:3306`（root / root123，库 `life_assistant`） |
| Redis 7 | `127.0.0.1:6379`（v1 未启用，配置保留兼容） |
| Adminer | http://localhost:8082 |
| Redis Commander | http://localhost:8081 |

MySQL 首次启动会自动执行 `life-assisitant-api/manifest/sql/0001_init.sql`（建表 + 种子数据 + 演示账号）。

### 2. 起后端

```bash
cd life-assisitant-api
cp manifest/config/config.example.yaml manifest/config/config.yaml   # 首次需要
# 编辑 config.yaml，把 database.default.link 换成本机 MySQL 连接串
go mod download
go run ./cmd/server/
# → http://localhost:8090   业务 API 前缀：/z1/api/v1
```

> 已经有一台 MySQL 时不必用 docker：把 `link` 指过去，然后用
> `go run scripts/init_db.go` 建表 + 灌种子即可（详见下面「数据库变更流程」）。

### 3. 起前端

```bash
# 移动端 → http://localhost:5173/z1-app/
cd life-assisitant-ui-mobile && npm install && npm run dev

# 桌面端 → http://localhost:5174/z1/
cd life-assisitant-ui-desktop && npm install && npm run dev
```

### 4. 登录

| 项 | 值 |
| :--- | :--- |
| 账号 | `admin@life.app`（也支持用户名 `admin`） |
| 密码 | `Admin@123` |
| 角色 | 管理员 —— 可见侧栏「系统管理」下的用户管理与权限管理 |

> 演示账号由种子 SQL 写入（bcrypt cost = 12）。**上线前务必修改。**

---

## 🔌 服务前缀与访问入口（唯一约定）

后端所有路由都挂在 **`/z1`** 前缀下 —— 定义在 `life-assisitant-api/internal/consts/routes.go` 的
`ServicePrefix`，**改前缀只需要改这一行**（路由组、JWT 白名单、限流、静态映射都从它派生）：

| 路径 | 用途 |
| :--- | :--- |
| `/z1/api/v1/*` | 业务 API |
| `/z1/uploads/*` | 用户上传文件（头像等）静态映射 |
| `/z1/*` | 桌面端静态站点（SPA，未命中回落 `index.html`） |
| `/z1-app/*` | 移动端静态站点（同上） |

这样 nginx 只用一个 `location /z1` 就能同时代理 API 与静态资源，也不会和机器上其他服务的 `/api` 撞名。

> ⚠️ 移动端 `vite.config.ts` 的 proxy key 必须写成 **`/z1/`（带尾斜杠）**。写 `/z1` 会把
> `public/z1-logo.png` 一起吞进代理，导致静态图 404。

---

## 🗄️ 数据库变更流程（唯一约定）

> **每次结构或种子数据有变更，必须同时产出两样东西**：① 一个当天日期的**增量脚本**；② 把同一份效果**并入全量种子文件**。
> 目的：**老库只跑增量**即可用；**新环境 / 迁移只跑全量**即可用 —— 不需要额外导库、不需要手工补 SQL。

### 三步走

**1）写增量** —— 在 `life-assisitant-api/db/` 新建 `data_YYMMDD.sql`（当天日期，例：`data_260920_transactions_reversed_by.sql`）。
内容 = 本次变更的**全部增量**：结构变更（建表 / 加列 / 加索引）与数据变更（权限点 / 角色矩阵 / 种子数据）都写在这一个文件里。

要求 **幂等**（`CREATE TABLE IF NOT EXISTS`、`INSERT … ON DUPLICATE KEY UPDATE` / `INSERT IGNORE`），保证在已有数据的库上可以重复执行。

**2）并入全量** —— 同一份效果按变更类型落到下面几处：

| 变更类型 | 落到哪里 |
| :--- | :--- |
| 结构（建表 / 加列 / 加索引） | `db/init.sql` + `manifest/sql/0001_init.sql` |
| 数据（权限点 / 角色矩阵 / 种子账号） | `db/init_data.sql` + `manifest/sql/0001_init.sql` |

> `manifest/sql/0001_init.sql` 是 `docker compose up` 首次启动时**自动执行**的那一份，**结构 + 种子都在里面**，
> 任何变更都必须同步过去，否则新环境会缺东西。

**3）三处一致** —— 同一件事不能只在增量文件里改完就算完：

- **数据类**（权限点 / 角色矩阵 / 种子数据）：`db/init_data.sql` 与 `manifest/sql/0001_init.sql` 必须**逐字一致**
  （含注释里的条数与模块数，如「45 条 / 14 模块」，以及文件末尾的校验块）。
- **结构类**（建表 / 加列 / 加索引）：`db/init.sql` 是 Navicat 导出的 dump，会比另两份多出 `CHARACTER SET` /
  `COLLATE` / `ROW_FORMAT` 等写法，**不要求逐字相同，但字段、类型、默认值、索引、外键、注释必须完全一致**；
  `manifest/sql/0001_init.sql` 则与 `db/data_YYMMDD.sql` 保持一致。

> ⚠️ GORM 模型的 `uniqueIndex` / `index` **必须显式写索引名**，且与手写 DDL 逐字一致。裸写会让 AutoMigrate
> 误删库里已有的单列唯一索引（`Error 1553`，API 起不来），或静默丢掉唯一约束。

### 执行方式

```bash
cd life-assisitant-api
go run scripts/init_db.go db/data_260920_xxx.sql   # 老库：只跑增量
go run scripts/init_db.go db/init.sql              # 新库：建表（Navicat dump）
go run scripts/init_db.go db/init_data.sql         # 新库：种子数据
go run scripts/init_db.go                          # 不传参数 = manifest/sql/0001_init.sql（建表 + 种子）
```

DSN 从 `manifest/config/config.yaml` 的 `database.default.link` 读取（与服务端同源，不再维护第二份连接串）。

### 新增权限点时的同步清单（容易漏）

`permissions` / `role_permissions` 的种子分布在两份文件里，新增权限点时必须**全部**改到：

1. 两份种子的 `permissions` INSERT（`db/init_data.sql` + `manifest/sql/0001_init.sql`）；
2. 授权语句：`admin` 走全量、`user` 走「排除 `user_mgmt` / `role_mgmt`」的推导 —— 新点若属个人域，
   `user` 会自动拿到，**但要核对条数**；
3. 注释与校验块里的**条数与模块数**（当前为 **45 条 / 14 模块**，`user` **35** 条）；
4. **两端权限管理页的模块名与展示顺序**：`life-assisitant-ui-mobile/src/pages/system/permissions.vue` 与
   `life-assisitant-ui-desktop/src/pages/permission/index.tsx` 的 `MODULE_NAMES` —— 这两份**必须逐字一致**，
   顺序即权限矩阵页的分组顺序。

### 新增 GORM 模型时的同步清单

新 model 必须同时登记到 **两处**，否则运行时只会看到 `DATABASE_ERROR 500002`：

1. `internal/dao/db.go` 的 `AutoMigrate` 列表；
2. `manifest/sql/0001_init.sql` 的建表语句。

---

## 📁 仓库结构

```
life-assisitant/                          ← 仓库根
├── README.md                             ← 项目总入口（本文件）
├── docker-compose.dev.yml                ← 本地基础设施：MySQL + Redis + Adminer + Redis Commander
├── assets/screenshots/                   ← 本 README 用到的截图
│
├── life-assisitant-api/                  ← Go 后端（GoFrame v2 + GORM + MySQL）
│   ├── cmd/server/                       ← 主入口
│   ├── internal/
│   │   ├── controller/                   ← 接口层（router.go 在此注册路由）
│   │   ├── service/impl/                 ← 业务逻辑
│   │   ├── dao/                          ← 数据访问（gorm/gen 生成 + 手写查询）
│   │   ├── model/ + model/dto/           ← 实体与请求响应结构
│   │   ├── middleware/ consts/response/  ← 中间件 / 常量（服务前缀）/ 统一响应
│   │   └── utility/                      ← 密码、上传、时间等工具
│   ├── db/                               ← init.sql（建表）+ init_data.sql（种子）+ data_YYMMDD.sql（增量）
│   ├── manifest/
│   │   ├── config/                       ← config.example.yaml 入库；真值 config.yaml 不入库
│   │   └── sql/0001_init.sql             ← docker compose 首次启动自动执行（建表 + 种子）
│   ├── scripts/init_db.go                ← 执行 SQL 文件的小工具
│   └── Dockerfile / build.bat
│
├── life-assisitant-ui-mobile/            ← 移动端 H5（Vue 3 + Vant 4）
│   └── src/{api,pages,components,layouts,stores,composables,constants,styles,router,utils}
│
└── life-assisitant-ui-desktop/           ← 桌面端 Web（React 18 + Semi Design）
    └── src/{api,pages,components,layouts,stores,composables,constants,styles,router,utils}
```

3 个子项目各自独立 npm / go 管理，也各有自己的 README，可以单独跑、单独部署。

---

## 📖 设计文档

完整设计文档（产品 / 设计 / 技术 / 部署，9 个专题目录）保存在本地 **`md/`**，当前**未纳入版本库**
（`.gitignore` 里的 `md/`）。若希望随仓库公开，删掉那一行即可。

按角色建议阅读顺序：

| 你是 | 先看这些 |
| :--- | :--- |
| 产品经理 | `00-总览` / `01-信息架构` / 各功能 spec |
| 设计师 | `02-导航规范` / `03-设计系统` / 各功能 spec |
| 前端工程师 | `08-技术栈` / `40-前端架构` / 各功能 spec |
| 后端工程师 | `08-技术栈` / `30-后端架构` / `31-数据访问层` / `04-API规范` |
| 测试工程师 | 各功能 spec 的「验收标准」章节 |
| 运维 | `50-部署运维` |

---

## 🎯 进度

- ✅ v1.0 设计 + 文档
- ✅ 后端 API：认证 / 任务 / 习惯 / 记账 / 健康 / 心情 / 统计 / 通知 / 时间线 / 用户 / 角色权限（22 张表）
- ✅ 移动端 H5 全部页面
- ✅ 桌面端 Web 全部页面（含系统管理）
- ⬜ 通知触达与周期任务（见下）
- ⬜ 生产环境落地

### ⚠️ 已知限制

- **通知**：表结构、枚举与列表页齐全，但**没有创建入口、也没有定时任务** —— 通知目前不会被投递。
- **任务重复**：`recurrence_rule` 只存不解析，不会自动生成重复实例。
- **时间线**：`/timeline` 只返回今天。
- **同步**：`/sync` 是占位接口，尚未实现真实多端同步。
- **报表**：暂无周报 / 月报与全量备份。

---

## 🤝 团队约定

- 提交前先读对应模块的 spec
- **API 变更**同步更新 `04-API规范.md` 与 `05-数据模型.md`
- **新功能**先写 spec 再开发
- **跨端一致性**：两端同名常量 / 字典（健康指标 `daily` 标记、分类字典、图标版本等）改动必须同步，
  改完做哈希比对
- 3 个子目录各自的 README 是该子项目的入口

---

_最后更新：2026-09-24_

---

> 📌 本仓库由 `xiong-claw` 通过 SSH 维护，改动请走 PR 流程。
