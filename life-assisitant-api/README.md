# Z1 · Zero to One · Backend API

Z1 (Zero to One) 后端 API（GoFrame v2 + GORM v2 + MySQL 8 + Redis 7）

> 完整规范见 `../md/spec/`（30-后端架构 / 31-数据访问层 / 04-API规范 / 06-错误码 / 20-登录认证 / 21-用户管理 / 22-权限管理）

---

## 1. 技术栈

| 组件 | 版本 | 用途 |
|---|---|---|
| Go | 1.22+ | 运行时 |
| GoFrame | v2.6+ | HTTP / 配置 / 日志 / 校验 / Redis |
| GORM | v1.25+ | ORM |
| GORM Gen | v0.3+ | 类型安全 DAO（已手写，本仓库无需跑 gen） |
| MySQL | 8.0 | 主数据 |
| Redis | 7.x | 缓存 / Token 黑名单 / 限流 |
| JWT | golang-jwt/jwt/v5 | access_token + refresh_token |
| bcrypt | golang.org/x/crypto | 密码哈希 cost=12 |

---

## 2. 目录结构

```
api/
├── cmd/server/main.go              # 入口
├── manifest/
│   ├── config/config.yaml          # GoFrame 配置
│   └── sql/0001_init.sql           # 数据库初始化
├── internal/
│   ├── consts/ecode/               # 业务错误码常量
│   ├── response/                   # 统一响应格式
│   ├── utility/                    # JWT / hash / id 工具
│   ├── middleware/                 # JWT / CORS / Recovery / Logger / RBAC / RateLimit
│   ├── model/                      # GORM 实体 + DTO
│   ├── dao/                        # 数据访问（手写 DAO 接口）
│   ├── service/                    # 业务逻辑（interface + impl）
│   └── controller/                 # HTTP 控制器 + 路由
└── go.mod
```

---

## 3. 本地启动

### 3.1 前置条件

- Go 1.22+
- 启动 `../life-assisitant` 仓库中的 `docker-compose.dev.yml`（提供 MySQL + Redis）
- 数据库账号：`root` / `root123`，数据库名 `life_assistant`

### 3.2 启动步骤

```bash
# 步骤 1：进入项目目录
cd .. && cd life-assisitant-api

# 步骤 2：拉取依赖
go mod tidy

# 步骤 3：启动 MySQL + Redis（在项目根目录执行）
cd ../life-assisitant
docker compose up -d
# 等待健康检查通过（docker ps 看 STATUS = healthy）

# 步骤 4：执行数据库迁移
# 方式 A：容器自动初始化（首次启动时 docker-entrypoint-initdb.d 会执行 manifest/sql/0001_init.sql）
# 方式 B：手动执行
mysql -h 127.0.0.1 -uroot -proot123 life_assistant < manifest/sql/0001_init.sql

# 步骤 5：启动后端
cd ../life-assisitant-api
go run cmd/server/main.go
# 看到 🚀 life-assistant-api starting... 即成功
# 默认监听 :8090（config.yaml server.address）

### 3.3 验证

```bash
# 健康检查
curl http://localhost:8090/z1/api/v1/health
# 返回 {"code":0,"message":"ok","data":{"status":"up"}}

# 登录
curl -X POST http://localhost:8090/z1/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123","device_id":"d_test_001"}'
```

---

## 4. 测试账号

| 用户名 | 邮箱 | 密码 | 角色 | 备注 |
|---|---|---|---|---|
| `admin` | `admin@life.app` | `Admin@123` | admin | 系统默认管理员（用户名/邮箱均可登录） |

> 默认管理员种子由 `db/init_data.sql` 预置，密码哈希为 bcrypt。

---

## 5. API 列表

所有接口统一前缀：`/z1/api/v1`（`/z1` 为服务前缀，防 nginx 与其他服务撞名；常量定义见 `internal/consts/routes.go`），统一响应格式：

```json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "request_id": "req_xxx"
}
```

### 5.1 认证

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/auth/login` | 公开 | 账号密码登录 |
| POST | `/auth/register` | 公开 | 注册账号 |
| POST | `/auth/refresh` | 公开 | 用 refresh_token 换新一对 |
| POST | `/auth/forgot-password` | 公开 | 申请重置密码（生成 token） |
| POST | `/auth/reset-password` | 公开 | 凭 token 重置密码 |
| POST | `/auth/logout` | 需登录 | 退出（支持单设备/全部设备） |
| POST | `/auth/change-password` | 需登录 | 修改密码 |
| GET  | `/auth/me` | 需登录 | 获取当前用户 |
| GET  | `/auth/me/permissions` | 需登录 | 获取当前用户的有效权限 |

### 5.2 用户管理（**仅 admin**）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET    | `/users` | 用户列表（keyword/role/status/page/page_size） |
| POST   | `/users` | 新建用户（返回初始密码） |
| GET    | `/users/:id` | 用户详情 |
| PATCH  | `/users/:id` | 更新用户（带 version 乐观锁） |
| PATCH  | `/users/:id/status` | 启用/禁用 |
| DELETE | `/users/:id` | 删除（软删，30 天可恢复） |
| PUT    | `/users/:id/role` | 分配角色 |
| GET    | `/users/:id/permissions` | 用户的有效权限 |

### 5.3 角色 / 权限

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET  | `/roles` | 需登录 | 角色列表 |
| GET  | `/roles/:code` | 需登录 | 角色详情 |
| GET  | `/roles/:code/permissions` | 需登录 | 角色权限矩阵 |
| PUT  | `/roles/:code/permissions` | admin | 更新角色权限矩阵（乐观锁） |
| GET  | `/permissions` | 需登录 | 全部权限点 |

### 5.4 任务（**MVP**）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET    | `/tasks` | 需登录 | 任务列表（filter/status/priority/keyword/sort/page/page_size） |
| POST   | `/tasks` | 需登录 | 创建任务（title 必填） |
| GET    | `/tasks/:id` | 需登录 | 任务详情 |
| PATCH  | `/tasks/:id` | 需登录 | 部分更新（字段可选） |
| PATCH  | `/tasks/:id/complete` | 需登录 | 切换完成状态（todo ↔ done） |
| DELETE | `/tasks/:id` | 需登录 | 删除（软删） |

**Filter 取值**：`all`（默认）/ `today` / `upcoming` / `done` / `overdue`

**Sort 取值**：`due_time`（默认）/ `priority` / `created_at`

> MVP 范围不包含：子任务、提醒、重复、附件。

### 5.5 习惯（**MVP**）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET    | `/habits` | 需登录 | 习惯列表（status/page/page_size） |
| GET    | `/habits/today` | 需登录 | 今日所有 active 习惯 + 完成状态（date 可选） |
| GET    | `/habits/:id` | 需登录 | 习惯详情 |
| POST   | `/habits` | 需登录 | 创建习惯 |
| PATCH  | `/habits/:id` | 需登录 | 部分更新（字段可选） |
| DELETE | `/habits/:id` | 需登录 | 删除（软删） |
| POST   | `/habits/:id/log` | 需登录 | 打卡（upsert：同 habit+date count 累加） |

**Frequency 取值**：`daily`（默认）/ `weekly` / `monthly`

> MVP 范围不包含：子任务、提醒、重复 RRULE。

### 5.6 记账（**MVP**）

#### 5.6.1 账户

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET    | `/accounts` | 需登录 | 当前用户所有账户 + 总净资产 |
| GET    | `/accounts/total` | 需登录 | 净资产合计 |
| POST   | `/accounts` | 需登录 | 创建账户（type: saving/credit/huabei/wechat） |
| PATCH  | `/accounts/:id` | 需登录 | 更新账户（name/icon/color/balance） |
| DELETE | `/accounts/:id` | 需登录 | 删除（软删；有关联交易时禁止） |

#### 5.6.2 交易

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET    | `/transactions` | 需登录 | 交易列表（type/account_id/start_date/end_date/page/page_size） |
| GET    | `/transactions/:id` | 需登录 | 交易详情 |
| POST   | `/transactions` | 需登录 | 创建交易（type=expense/income） |
| POST   | `/transactions/transfer` | 需登录 | 转账（事务内：扣 from 余额 + 加 to 余额） |
| PATCH  | `/transactions/:id` | 需登录 | 更新交易（amount 变化时同步调整账户余额） |
| DELETE | `/transactions/:id` | 需登录 | 删除（软删；反向回滚账户余额） |

**Transaction.type 取值**：`expense` / `income` / `transfer`

> MVP 范围不包含：分类管理、预算、附件、位置。

### 5.7 统计（**MVP**）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/stats/overview` | 需登录 | 聚合 KPI：今日任务/本周完成率/本月支出收入/总余额/今日习惯 |

### 5.8 健康检查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（无鉴权） |

---

## 6. 错误码

详见 `../md/spec/06-错误码.md`，代码常量在 `internal/consts/ecode/ecode.go`。

| 段 | 范围 | 模块 |
|---|---|---|
| 1xx | 401001-401013 | 认证 |
| 2xx | 403001-403010 | 权限 |
| 3xx | 400001-400006 / 404001 | 用户 |
| 4xx | 400101-400104 / 403101 / 404101 | 任务 |
| 5xx | 400201-400202 / 403201 / 404201 / 500201 | 习惯 |
| 6xx | 400301-400304 / 403301 / 404301 | 账户 |
| 7xx | 400401-400402 / 403401 / 404401 | 交易 |
| 8xx | 500501 | 统计 |
| 9xx | 400xxx / 404xxx / 409xxx / 500xxx / 503xxx | 系统/通用 |

---

## 7. 中间件链

执行顺序：

```
RequestId → CORS → Recovery → AccessLog → ErrorHandler → JwtAuth → [RequireAdmin（仅管理接口）] → Controller
```

- `JwtAuth`：白名单（login/register/refresh/forgot-password/reset-password/health）放行，其他需 `Authorization: Bearer xxx`
- `RequireAdmin`：仅 `admin` 角色可访问

---

## 8. 配置覆盖

通过环境变量覆盖 `manifest/config/config.yaml`：

```bash
export GF_DATABASE_DEFAULT_LINK="mysql:user:pass@tcp(host:3306)/db?charset=utf8mb4&parseTime=true&loc=Local"
export GF_REDIS_DEFAULT_ADDRESS="host:6379"
export GF_JWT_ACCESS_SECRET="strong-secret-32-chars-min"
export GF_JWT_REFRESH_SECRET="another-strong-secret-32-chars-min"
```

参考 `.env.example`。

---

## 9. 常见问题

**Q: 启动报错 `connect: connection refused`？**
A: MySQL 或 Redis 没起来。跑 `docker compose -f ../life-assisitant/docker-compose.dev.yml up -d` 并等待 healthcheck。

**Q: `Unknown database 'life_assistant'`？**
A: 没执行 0001_init.sql。手动跑：
```bash
mysql -h 127.0.0.1 -uroot -proot123 -e "CREATE DATABASE IF NOT EXISTS life_assistant CHARACTER SET utf8mb4;"
mysql -h 127.0.0.1 -uroot -proot123 life_assistant < manifest/sql/0001_init.sql
```

**Q: 登录返回 401001？**
A: 用户名或密码错误。默认 admin 账号：`admin` / `Admin@123`（用户名/邮箱都能登录）。

**Q: JWT token 无效？**
A: 检查 `manifest/config/config.yaml` 里 `jwt.accessSecret` 是否被环境变量覆盖了，access/refresh 用了不同 secret。

---

## 10. 下一步

- [x] 任务模块（tasks）—— MVP
- [x] 习惯模块（habits / habit_logs）—— MVP
- [x] 记账模块（accounts / transactions + transfer）—— MVP
- [x] 统计模块（stats overview）—— MVP
- [ ] 预算模块（budgets）
- [ ] 报表导出（stats 详细）
- [ ] WebSocket 实时权限推送
- [x] Docker 化部署 → 见 **§11 Docker 部署（arm64 生产线）**

---

## 11. Docker 部署（arm64 生产线）

镜像目标平台 **linux/arm64**（如飞腾/鲲鹏/GNSS 服务器、树莓派、云 arm64 实例）。
产物统一落在仓库根 `../dist/`：

```
dist/
├── z1-api.tar    后端 arm64 docker 镜像（本章节）
├── z1/           桌面端静态文件（life-assisitant-ui-desktop → npm run build）
└── z1-app/       移动端静态文件（life-assisitant-ui-mobile → npm run build）
```

### 11.1 构建机打包（Windows，一步到位）

在本目录执行 `build.bat`，三步全自动：

1. **宿主交叉编译**：`GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o build\server .\cmd\server`
   —— 不在容器里编译，免 QEMU 模拟、免镜像 Go 版本与 go.mod 版本线对齐问题
2. `docker build -f Dockerfile.arm64 --platform linux/arm64 -t z1-api:latest .`
   （`Dockerfile.arm64` 只做「装运行时」：alpine + 时区 Asia/Shanghai + CA 证书 + 二进制 + 内嵌 config.yaml）
3. `docker save -o ..\dist\z1-api.tar z1-api:latest`

> 想带 SMP 配置打包时注意：`Dockerfile.arm64` 固定内嵌 `manifest/config/config.yaml`；
> 若需换默认配置，改 COPY 行或用环境变量在运行时覆盖（推荐后者）。

### 11.2 外置配置文件工作流（推荐 · 已实测）

镜像内同时烧了两份配置：`config.yaml`（默认，可被挂载遮蔽）与 **`config-smp.yaml`（全套外置模板）**。
部署时把模板 cp 出来改好，再单文件挂回去当正本——数据库、JWT、日志、存储路径全在文件里配置：

```bash
# ① 传镜像并加载
scp dist/z1-api.tar user@server:/opt/z1/
docker load -i /opt/z1/z1-api.tar

# ② 从镜像提取模板（create+cp，无需起容器）
docker create --name z1-tpl z1-api:latest
docker cp z1-tpl:/app/manifest/config/config-smp.yaml /opt/z1/config.yaml
docker rm z1-tpl

# ③ 编辑 /opt/z1/config.yaml ——至少改这几处：
#    database.default.link     你的 MySQL DSN
#    jwt.accessSecret / refreshSecret   生产强随机（各 ≥32 字符，勿用模板占位值）
#    database.debug            生产改 false
#    storage.upload_dir        默认 ./data/uploads（对应容器卷 /app/data/uploads）

# ④ 单文件挂载覆盖镜像内默认配置（:ro 只读），起容器
docker run -d --name z1-api --restart unless-stopped \
  -p 8090:8090 \
  -v /opt/z1/config.yaml:/app/manifest/config/config.yaml:ro \
  -v z1-uploads:/app/data/uploads \
  z1-api:latest

# ⑤ 验证
curl -s http://127.0.0.1:8090/z1/api/v1/health   # 期望 {"code":0,...,"status":"up"}
docker logs -f z1-api                          # 路由 dump / MySQL 初始化日志
```

要点：
- 挂载的文件即**唯一配置正本**（文件缺的键回落 GoFrame 内置默认）；单文件挂载只遮蔽 `config.yaml`，镜像里的 `config-smp.yaml` 参考副本仍可见，可随时再 cp
- 更新配置：改 `/opt/z1/config.yaml` 后 `docker restart z1-api` 即生效（启动时读取）
- `GF_*` 环境变量保留**最终覆盖权**（env > 挂载文件），临时热修不用动文件
- 改 `storage.upload_dir` 为其他路径时，`-v` 挂载点要同步改，否则头像不落卷

### 11.3 目标服务器部署（纯 env 覆盖备选 · 不外置文件）

```bash
docker load -i /opt/z1/z1-api.tar
docker run -d --name z1-api --restart unless-stopped \
  -p 8090:8090 \
  -e GF_DATABASE_DEFAULT_LINK="root:你的密码@tcp(数据库IP:4417)/life_assistant?charset=utf8mb4&parseTime=true&loc=Local" \
  -e GF_JWT_ACCESS_SECRET="生产随机串-至少32字符" \
  -e GF_JWT_REFRESH_SECRET="另一个生产随机串-至少32字符" \
  -v z1-uploads:/app/data/uploads \
  z1-api:latest
curl -s http://127.0.0.1:8090/z1/api/v1/health
```

### 11.4 常用环境变量（GoFrame `GF_<段>_<键>` 规则，覆盖内嵌 config.yaml）

| 变量 | 作用 | 生产建议 |
|---|---|---|
| `GF_DATABASE_DEFAULT_LINK` | MySQL DSN（唯一键整体覆盖 link） | **必填**，勿用镜像默认 |
| `GF_JWT_ACCESS_SECRET` / `GF_JWT_REFRESH_SECRET` | 双 token 签名密钥 | **必须换**，仓库值是占位；泄露=任意伪造登录态 |
| `GF_SERVER_ADDRESS` | 监听地址 | 默认 `:8090` |
| `GF_STORAGE_UPLOAD_DIR` | 头像上传落盘根 | 默认 `./data/uploads`（=卷 `/app/data/uploads`）；改路径记得同步挂卷 |
| `GF_DATABASE_DEBUG` | SQL 日志 | 生产置 `false` |

### 11.5 数据库初始化（镜像不含建库职责，连库前先备好）

- **全新环境**：依次执行 `db/init.sql`（结构）+ `db/init_data.sql`（参考数据）——两份基线已归集历次修复，跑完即达当前态，**无需再跑任何 `db/*.sql` 迁移**。
- **存量环境升级**：只跑 `db/` 下尚未执行过的新增迁移（幂等设计，可重复执行），例如：
  `go run scripts/init_db.go db/260918_user_pwd_avatar.sql`（或 `mysql < 该文件`）。

### 11.6 compose 片段（可选，对应 11.2 外置文件流）

```yaml
services:
  z1-api:
    image: z1-api:latest                # docker load 后即可引用
    ports: ["8090:8090"]
    volumes:
      - ./config.yaml:/app/manifest/config/config.yaml:ro   # 11.2 提取并改好的外置正本
      - z1-uploads:/app/data/uploads
    restart: unless-stopped
volumes:
  z1-uploads:
```

### 11.7 前端配套（静态双端怎么接上 API）

`z1/`、`z1-app/` 是纯静态产物，任意 nginx 托管即可。第十三轮起后端全部收敛在 **`/z1` 服务前缀**
（API=`/z1/api/v1/*`、头像静态=`/z1/uploads/*`），**nginx 只需一条 location，且不与其他服务撞名**：

```nginx
location /z1/ { proxy_pass http://127.0.0.1:8090; }   # API + 上传静态一个入口全带走
```

前端构建默认 `VITE_API_BASE=/z1/api/v1`（相对路径），同源反代即通；跨域直连后端时需改构建期 env 为绝对地址（如 `https://api.life.app/z1/api/v1`）。
