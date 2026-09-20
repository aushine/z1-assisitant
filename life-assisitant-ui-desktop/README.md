# Z1 · Zero to One · 桌面端 (life-assisitant-ui-desktop)

Vue 3 + Vite + Semi Design + Pinia + Axios 构建的个人效率管理桌面端 Web 应用。

配套文档仓库：`../md/spec/`
- 总览 [00-总览.md](../md/spec/00-总览.md)
- 导航规范 [02-导航规范.md](../md/spec/02-导航规范.md)
- 设计系统 [03-设计系统.md](../md/spec/03-设计系统.md)
- 前端架构 [40-前端架构.md](../md/spec/40-前端架构.md)

## 技术栈

| 类别 | 选型 | 版本 |
|---|---|---|
| 框架 | Vue | ^3.4 |
| 构建 | Vite | ^5.0 |
| UI 库 | Semi Design | ^2.49 |
| 路由 | Vue Router | ^4.2 |
| 状态 | Pinia | ^2.1 |
| HTTP | Axios | ^1.6 |
| 日期 | Day.js | ^1.11 |
| 样式 | Sass | ^1.69 |
| 语言 | TypeScript | ^5.3 (strict) |

## 目录结构

```
life-assisitant-ui-desktop/
├── src/
│   ├── api/           # Axios 实例 + 各业务模块 API
│   │   ├── request.ts
│   │   ├── auth.ts
│   │   ├── user.ts
│   │   ├── role.ts
│   │   ├── permission.ts
│   │   └── types.ts
│   ├── components/    # 公共业务组件
│   ├── layouts/       # 布局（MainLayout）
│   ├── pages/         # 页面
│   │   ├── login/
│   │   ├── home/
│   │   ├── task/
│   │   ├── record/
│   │   ├── stat/
│   │   ├── me/
│   │   ├── user/         # 用户管理 (admin)
│   │   ├── permission/   # 权限管理 (admin)
│   │   └── error/        # 403 / 404
│   ├── router/        # 路由表 + 守卫
│   ├── stores/        # Pinia stores (user, app)
│   ├── styles/        # tokens.scss / reset.scss / global.scss
│   ├── types/         # 全局类型 + 自动生成的 components.d.ts
│   ├── utils/         # storage / permissions / format
│   ├── App.vue
│   ├── main.ts
│   └── env.d.ts
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
└── package.json
```

## 启动方式

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量
cp .env.example .env

# 3. 启动开发服务器（端口 5174）
npm run dev

# 4. 类型检查
npm run type-check

# 5. 生产构建
npm run build
```

## 默认登录账号

| 账号 | 密码 | 角色 | 可见模块 |
|---|---|---|---|
| `admin` | `admin123` | admin | 全部 + 用户管理 + 权限管理 |
| `editor` | `editor123` | editor | 业务模块读写 |
| `viewer` | `viewer123` | viewer | 只读 |

> 实际账号由后端服务下发，本项目仅做前端 MVP。可通过浏览器 devtools 在
> localStorage 中手动注入 `access_token` / `refresh_token` / `user` 后体验完整流程。

## 路由表

| 路径 | 页面 | 权限 |
|---|---|---|
| `/login` | 登录页 | 公开 |
| `/` | MainLayout 壳 | 需登录 |
| `/home` `/task` `/record` `/stat` `/me` | 业务模块 | 需登录 |
| `/system/user` | 用户管理 | admin |
| `/system/permission` | 权限管理 | admin |
| `/403` | 无权限 | 公开 |
| `/404` | 404 | 公开 |

## 关键交互

- **侧边栏**：260px 固定宽，分「个人功能 / 系统管理」两组；激活项 `#E0F2FF` 背景 + `#014DB2` 文字
- **顶部 Header**：80px 高，含页面标题 + 右侧角色徽章 + 头像
- **登录页**：1280×800 双 640 分栏；左侧三色渐变品牌区 + 右侧 480px 居中表单
- **路由守卫**：
  - 未登录访问受保护路由 → `/login?redirect=...`
  - 已登录访问 `/login` → `/home`
  - 非 admin 访问 `/system/*` → `/403`

## 设计 Token

所有颜色 / 间距 / 圆角 / 阴影见 `src/styles/tokens.scss`，
与 `md/spec/03-设计系统.md` 完全对齐。

## License

Internal use only.
