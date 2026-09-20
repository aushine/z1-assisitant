# Z1 · Zero to One

> 跨端个人效率管理工具：任务 / 习惯 / 记账 / 统计 + 多账户与权限管理。  
> **代号 Z1**，Slogan：**Zero to One** —— 从零到一，构建自己的效率系统。  
> 移动端 H5（Vue 3 + Vant）+ 桌面端 Web（Vue 3 + Semi Design）+ Go 后端（GoFrame + GORM + MySQL）。

---

## 📚 仓库结构（monorepo）

本仓库是一个 **monorepo**，所有代码和文档都在 `D:\codedemo\life-assisitant` 下：

```
life-assisitant/                          ← 本仓库根目录
├── md/spec/                              ← 24 篇完整 spec 文档
├── docker-compose.dev.yml                ← 本地基础设施编排
├── README.md                             ← 你正在看的文件
│
├── life-assisitant-api/                  ← Go 后端（GoFrame v2 + GORM + MySQL）
├── life-assisitant-ui-mobile/            ← 移动端 H5（Vue 3 + Vant 4）
└── life-assisitant-ui-desktop/           ← 桌面端 Web（Vue 3 + Semi Design）
```

> 3 个子项目独立 npm/go 管理，各自有自己的 README，可以单独跑、单独部署。

---

## 🚀 本地开发

### 1. 启动基础设施

```bash
docker compose -f docker-compose.dev.yml up -d
```

这会启动：
- **MySQL 8** → `127.0.0.1:3306` (root/root123, db=life_assistant)
- **Redis 7** → `127.0.0.1:6379`
- **Redis Commander**（管理界面） → http://localhost:8081
- **Adminer**（MySQL 管理界面） → http://localhost:8082

MySQL 首次启动会自动执行 `life-assisitant-api/manifest/sql/0001_init.sql`（建表 + 种子数据 + 默认 admin 账号）。

### 2. 启动后端

```bash
cd life-assisitant-api
go mod download
go run cmd/server/main.go
# → http://localhost:8080
# 默认账号：admin@life.app / Admin@123456
```

### 3. 启动前端

```bash
# 移动端（H5）
cd life-assisitant-ui-mobile
npm install
npm run dev
# → http://localhost:5173

# 桌面端（Web）
cd life-assisitant-ui-desktop
npm install
npm run dev
# → http://localhost:5174
```

---

## 🗄️ 数据库变更流程（唯一约定）

> **每次结构或种子数据有变更，必须同时产出两样东西**：① 一个当天日期的**增量脚本**；② 把同一份效果**并入全量种子文件**。
> 目的：**老库只跑增量**即可用；**新环境 / 迁移只跑全量**即可用 —— 不需要额外导库、不需要手工补 SQL。

### 三步走

**1）写增量** —— 在 `life-assisitant-api/db/` 新建 `data_YYMMDD.sql`（当天日期，例：`data_260919.sql`）。
内容 = 本次变更的**全部增量**：结构变更（建表 / 加列 / 加索引）与数据变更（权限点 / 角色矩阵 / 种子数据）都写在这一个文件里。

要求 **幂等**（`CREATE TABLE IF NOT EXISTS`、`INSERT … ON DUPLICATE KEY UPDATE` / `INSERT IGNORE`），保证在已有数据的库上可以重复执行。

**2）并入全量** —— 同一份效果按变更类型落到下面几处：

| 变更类型 | 落到哪里 |
|---|---|
| 结构（建表 / 加列 / 加索引） | `db/init.sql` + `manifest/sql/0001_init.sql` |
| 数据（权限点 / 角色矩阵 / 种子账号） | `db/init_data.sql` + `manifest/sql/0001_init.sql` |

> `manifest/sql/0001_init.sql` 是 `docker compose up` 首次启动时**自动执行**的那一份，**结构 + 种子都在里面**，任何变更都必须同步过去，否则新环境会缺东西。

**3）三处一致** —— 同一件事不能只在增量文件里改完就算完：

- **数据类**（权限点 / 角色矩阵 / 种子数据）：`db/init_data.sql` 与 `manifest/sql/0001_init.sql` 必须**逐字一致**（含注释里的条数与模块数，如「37 条 / 11 模块」，以及文件末尾的校验块）。
- **结构类**（建表 / 加列 / 加索引）：`db/init.sql` 是 Navicat 导出的 dump，会比另两份多出 `CHARACTER SET` / `COLLATE` / `ROW_FORMAT` 等写法，**不要求逐字相同，但字段、类型、默认值、索引、外键、注释必须完全一致**；`manifest/sql/0001_init.sql` 则与 `db/data_YYMMDD.sql` 保持一致。

### 执行方式

```bash
cd life-assisitant-api
go run scripts/init_db.go db/data_260919.sql   # 老库：只跑增量
go run scripts/init_db.go db/init.sql          # 新库：建表（Navicat dump）
go run scripts/init_db.go db/init_data.sql     # 新库：种子数据
go run scripts/init_db.go                      # 不传参数 = manifest/sql/0001_init.sql（建表 + 种子）
```

DSN 从 `manifest/config/config.yaml` 的 `database.default.link` 读取（与服务端同源，不再维护第二份连接串）。

### 新增权限点时的同步清单（容易漏）

`permissions` / `role_permissions` 的种子分布在两份文件里，新增权限点时必须**全部**改到：

1. 两份种子的 `permissions` INSERT（`db/init_data.sql` + `manifest/sql/0001_init.sql`）；
2. 授权语句：`admin` 走全量、`user` 走「排除 `user_mgmt` / `role_mgmt`」的推导 —— 新点若属个人域，`user` 会自动拿到，**但要核对条数**；
3. 注释与校验块里的**条数与模块数**（当前为 **37 条 / 11 模块**，`user` **27** 条）；
4. **两端权限管理页的模块名与展示顺序**：`life-assisitant-ui-mobile/src/pages/system/permissions.vue` 与 `life-assisitant-ui-desktop/src/pages/permission/index.tsx` 的 `MODULE_NAMES` —— 这两份**必须逐字一致**，顺序即权限矩阵页的分组顺序。

> 历史迁移脚本（`2609xx_*.sql`）的内容已全部并入上述两份种子，不再单独保留；**本次起，所有变更统一走 `data_YYMMDD.sql` + 并入全量**这一条路径。

---

## 📖 文档导航

**先看这两份**：
- [00-总览.md](./md/spec/00-总览.md) — 产品定位 + 团队怎么协作
- [08-技术栈.md](./md/spec/08-技术栈.md) — 我们用什么技术

**完整文档**：[`md/spec/`](./md/spec/) （24 篇，11000+ 行）

按角色：
| 你是 | 看这些 |
|---|---|
| 产品经理 | 00-总览 / 01-信息架构 / 各功能 spec |
| 设计师 | 02-导航规范 / 03-设计系统 / 各功能 spec |
| 前端工程师 | 08-技术栈 / 40-前端架构 / 各功能 spec |
| 后端工程师 | 08-技术栈 / 30-后端架构 / 31-数据访问层 / 04-API规范 |
| 测试工程师 | 各功能 spec 的「验收标准」章节 |
| 运维 | 50-部署运维 |

---

## 🏗️ 完整目录树

```
life-assisitant/                          ← 本仓库根
├── README.md                             ← 项目总入口（本文件）
├── docker-compose.dev.yml                ← MySQL + Redis + Adminer + Redis Commander
├── md/spec/                              ← 24 篇 spec（设计/技术/产品）
│
├── life-assisitant-api/                  ← Go 后端（GoFrame v2 + GORM + MySQL + Redis + JWT）
│   ├── cmd/server/                       ← 主入口
│   ├── internal/                         ← 业务代码（controller/service/dao/model/middleware/...）
│   ├── manifest/
│   │   ├── config/                       ← GoFrame 配置
│   │   └── sql/                          ← 数据库迁移 SQL（被 docker-compose 自动执行）
│   ├── go.mod
│   └── README.md
│
├── life-assisitant-ui-mobile/            ← 移动端 H5（Vue 3 + Vant 4）
│   ├── src/
│   │   ├── api/                          ← 接口层
│   │   ├── pages/                        ← 5 个 Tab 页面 + 登录页
│   │   ├── layouts/                      ← HomeLayout（含 TabBar）
│   │   ├── stores/                       ← Pinia
│   │   ├── router/
│   │   ├── styles/                       ← 设计系统 token
│   │   └── ...
│   ├── package.json
│   └── README.md
│
└── life-assisitant-ui-desktop/           ← 桌面端 Web（Vue 3 + Semi Design）
    ├── src/
    │   ├── api/                          ← 接口层
    │   ├── pages/                        ← 7 个页面（业务 5 + 管理 2）
    │   ├── layouts/                      ← MainLayout（Sidebar + Header）
    │   ├── stores/
    │   ├── router/
    │   ├── styles/
    │   └── ...
    ├── package.json
    └── README.md
```

---

## 🎯 当前进度

✅ v1.0 MVP 设计 + 文档完成
✅ v1.0 后端骨架完成（44 文件，3 子目录都在 `life-assisitant-api/` `life-assisitant-ui-mobile/` `life-assisitant-ui-desktop/`）
⬜ v1.0 前端业务开发（任务/记录/统计/我的）
⬜ v1.0 联调 + 灰度

详见 [07-版本路线图.md](./md/spec/07-版本路线图.md)

---

## 🤝 团队约定

- **代码提交前**：先看对应模块的 spec 文档
- **API 变更**：同步更新 04-API规范.md 和 05-数据模型.md
- **新功能**：先写 spec，再开发
- **设计稿变更**：用 Ardot（`709118840108992`），节点 ID 在 spec 中标注
- **子项目独立**：3 个子目录各自的 README 是该子项目的入口

---

## 📞 联系方式

- 产品：[待填]
- 设计：[待填]
- 技术：[待填]
- Issue：本仓库 GitHub Issues

---

_本文档维护：每两周 review 一次，确保与代码实现同步_
