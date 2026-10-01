# Z1 项目记忆（专属）

> 本文件 `z1-assisitant/NOTES.md` 是 **Z1 生活助手** 的项目级记忆（随仓库走，clone/pull 即得）。
> 所有 Z1 相关的上下文、决策、改动记录都写在这里，**不要污染主工作空间**。
> 主工作空间的 AGENTS.md / MEMORY.md 只保留对 Z1 的索引，不放大段细节。

---

## 0. 权威文档在哪（最重要）

| 文档 | 位置 | 说明 |
| --- | --- | --- |
| **总集 Spec（当前唯一有效规范）** | `z1-assisitant/md/spec/` | 17 个文件，描述"**现在代码里是什么样**"，基准时间 2026-09-24 |
| ├ 总入口 | `md/spec/README.md` | 速查卡、模块全景、状态一览、铁律 |
| ├ 数据模型 | `md/spec/03-数据模型.md` | 24 张表、关键约束、迁移纪律、已知坑 |
| ├ 财务 | `md/spec/08-记录-财务.md` | 账户三层、记一笔、流水、预算、分类 |
| ├ 习惯 | `md/spec/07-记录-习惯.md` | streak、分类、打卡 |
| ├ 任务 | `md/spec/06-任务.md` | 5 视图、详情、批处理 |
| └ 其余 | `00~14` + `99-附录` | 总览/IA/设计系统/API/健康/统计/我的/权限/通知/部署/断线清单 |
| Pi 部署手册 | `../PI-ACCESS.md` | 反向隧道 + 构建部署 |

> ⚠️ **注意**：`md/spec/` 全套文件在本地磁盘都在，但 **git 只跟踪了 `md/spec/README.md` 一个**（其余可能是"本地保留未入库"或未 add）。
> ⚠️ 历史设计文档（2026-08~09 的 14 批）已归档到 `md/archive/`（本地保留、未入库、只读）。
> **冲突优先级：代码 > spec > 历史文档。**

### 三条铁律（spec §0）
1. **默认双端覆盖** —— 任何改动除非特别说明，都要同时给移动端 + 桌面端方案，只做单端会被打回。
2. **不确定先问** —— 方案/顺序/范围/spec 与代码冲突，先确认再动手。中途改主意是大忌。
3. **改了要回写** —— 落地后把结论回写进 spec 对应章节。

---

## 1. 项目是什么

- **名称**：Z1（代号）· life-assisitant · Zero to One
- **定位**：跨端个人生活管理系统 —— 任务 / 习惯 / 记账 / 健康 / 统计 五件事
- **形态**：**双端 Web**（移动端 H5 + 桌面端 Web），共用同一套后端 + 同一个数据库
- **技术栈**：Go + GoFrame v2 / MySQL 8 / Redis；移动端 Vue 3 + Vant 4；桌面端 React 18 + Semi Design

### 地址与环境
| 项 | 值 |
| --- | --- |
| 后端端口 | **8090**（`manifest/config/config.yaml`） |
| API 前缀 | **`/z1/api/v1`** |
| 桌面端 | base `/z1/` · dev 5174 · 产物 `dist/z1` · 路由 `/home /todo /record /stat /me /system/*` |
| 移动端 | base `/z1-app/` · dev 5173 · 产物 `dist/z1-app` · 路由 `/home /task /record /stat /me` |
| 线上 | `https://voz21.cn/z1/`（桌面）、`https://voz21.cn/z1-app/`（移动） |
| 数据库 | MySQL 8 · `192.168.101.75:4417/life_assistant` ⚠️ **本地与线上同一个库** |
| 演示账号 | `admin@life.app` / `Admin@123` |

### 设计令牌（速查）
- 主色 `#014DB2`；成功 `#10B981` / 警告 `#F59E0B` / 危险 `#EF4444`；强调 `#8B5CF6`
- 间距 4px 网格 `space-1..10 = 4/8/12/16/20/24/32/40/48/56`；圆角 `xs4/sm6/md8/lg10/xl16/2xl20/pill`
- 字号 `display32/h1 26/h2 22/h3 18/h4 16/body 15/body-sm 14/caption 13/caption-sm 12/micro 11`
- 卡片内边距 20px（默认）/ 24px（主卡），圆角 16
- **图标库：lucide `0.300.0`（精确锁，两端同版本）**
- ⚠️ 记账配色与股市相反：**支出红 / 收入绿**；信用账户余额**存负数**

---

## 2. 仓库与身份

| 项 | 值 |
| --- | --- |
| 仓库路径 | `~/.openclaw/workspace/z1/z1-assisitant`（工作目录即仓库根） |
| remote | `git@github.com:aushine/z1-assisitant.git`（SSH） |
| 分支 | `main`（跟踪 `origin/main`） |
| git 身份 | `xiong-claw <claw@voz21.cn>` |
| GitHub 认证 | SSH key `/home/admin/.ssh/id_ed25519_z1`（`~/.ssh/config` 里绑定 `Host github.com`） |

> ⚠️ 2026-09-24：原 config 指向 `id_ed25519_github`，但该 key 在 GitHub 未授权（Permission denied）。
> 已改为 `id_ed25519_z1`，验证通过。**PI-ACCESS.md 第 1 节仍写旧 key，待更新。**

## 3. 目录结构

```
z1-assisitant/
├─ md/spec/                      # ⭐ 总集 spec（当前唯一有效规范）
├─ life-assisitant-api/          # Go 后端（cmd/server、internal、Dockerfile.arm64）
│   ├─ internal/model/           # 实体（user_category.go 等，注释含铁律）
│   ├─ internal/utility/         # 种子/词表（finance_category_seed.go、user_category_seed.go、account_vocab.go）
│   ├─ db/init.sql               # DDL 副本 1
│   └─ manifest/sql/0001_init.sql # DDL 副本 2（⚠️ 双副本必须同步）
├─ life-assisitant-ui-desktop/   # 桌面端 React+Semi，base=/z1/，产物 -> ../dist/z1
├─ life-assisitant-ui-mobile/    # 移动端 Vue+Vant，base=/z1-app/，产物 -> ../dist/z1-app
│   ├─ src/pages/                # 页面（login/home/task/record/stat/me/system 等）
│   ├─ src/utils/category-dict.ts # 分类字典
│   └─ src/stores/user-category.ts
└─ deploy/                       # 部署脚本（Windows 侧为主）+ nginx-z1.conf
```

---

## 4. 工作分工（重要）

| 环节 | 谁做 | 在哪 |
| --- | --- | --- |
| 写/改代码 | **我（VPS agent）** | `~/.openclaw/workspace/z1/z1-assisitant` |
| commit + push | **我** | 同上 → GitHub |
| pull + 构建 + 部署 | **Pi（树莓派）** | `/opt/z1-src` + `/opt/z1-deploy` |

**流程**：改代码 → push → 让 Pi pull 并构建部署。
**为什么构建在 Pi**：目标是 arm64，Pi 原生编译直接可用；VPS 是 amd64 编出来跑不了，且内存仅 ~1.8G（可用 ~0.7G），`npm run build` 易 OOM。
**Pi 访问**：`ssh pi "<命令>"`；一键部署 `ssh pi "/opt/z1-deploy/pi-build-deploy.sh all"`（可选 api/ui/pull）。详见 `PI-ACCESS.md`。

---

## 5. 关键业务知识（改代码前先看）

### 5.1 分类体系（⚠️ 高频改动区）
- **财务分类** `finance_categories`：**两级**（`parent_id`，空串=一级，**不能用 NULL**）；一级 12 支出 + 8 收入，二级 85 个（每个有独立 icon），共 105 条/用户。
- **习惯/待办分类** `user_categories`：与财务**分开的表**，两域共用（`domain` = habit/task）；**目前只做一级**（spec D21 决策：数量少、选择频率低；表结构**预留了 `parent_id`**）。
  - ⚠️ 分类 id 保留旧值：习惯 `sport/diet/life/study`、任务 `c_work/c_study/c_life/c_health/c_social/c_other` → 存量零迁移。
  - 管理入口：**我的 → 分类管理**（习惯与待办共一页，页内分段）。

### 5.2 记一笔的金额键盘（移动端 `AmountPad`，spec 08 §2.1）
- **期望设计**：金额框与键盘**组成一块计算器** —— 金额框**同一 DOM 元素、不隐藏不重建**，键盘升起时**平移到键盘正上方**。
- ⚠️ 金额框**必须移出 `.sheet-body`**（放进覆盖层 `.calc-dock`），否则被 `overflow` 裁剪。
- 视觉四条件：上下零缝隙 + 共用外圆角（金额框 `20 20 0 0`）+ 同一底色且删掉键盘原有 `border-top` + 投影只加在金额框上。
- ⚠️ `--calc-dock-h` 用 **ResizeObserver 运行时测量**（写死 token 会留白错位）。
- 4 列 × 4 行 + 末行 `=` / `完成`；求值左到右不做优先级；全程「分」上整数运算。

### 5.3 全局已知坑（spec 03 §9）
- K1 后端空切片序列化 = `null` 不是 `[]` ⇒ store 入口 `?? []` 归一化（曾白屏）
- K2 `source/contact/settle_of` 空值 omitempty 消失 ⇒ 禁止 `=== ''` 判空
- K5 `week_completion_rate` 是 0–100，其余 rate 是 0–1（桌面端 `*100` 是 bug）
- K7 预算 `used` 按 `period + 当前时间` 现算，忽略冻结的 start/end_date

### 5.4 迁移纪律（spec 03 §8，血泪）
- DDL **双副本同步**（`db/init.sql` + `manifest/sql/0001_init.sql`）；改 model 查 `dao/db.go` AutoMigrate
- **索引 tag 必须显式写名**，否则 GORM AutoMigrate 误删索引 → `Error 1553`
- 跑 SQL 用 `scripts/sqlrun/main.go`，**不要用 `init_db.go`**（失败只记日志）
- 共享库清理**先 SELECT 白名单**再逐条 DELETE（⚠️ 本地=线上）
- ⚠️ 项目**无 git 归档历史**（spec 自述），删了就没了

### 5.5 断线清单（spec §5 / 99-附录）
- ❌ **通知投递**断线（表/接口齐全，无生产者、无 cron）→ `reminder_at` 写了没人推
- ❌ **循环任务实例化**断线（`recurrence_rule` 只存不生成）
- ⚠️ `/sync` 是假接口；❌ 全量导出/导入只有 `GET /stats/export`(CSV)
- ❌ 目标(Goal)/周报月报未做；`me/reminders`、`me/data` 二级页未建

---

## 6. 改动日志

### 2026-10-01（夜 · v3 iframe 内嵌页）
- **spec-20261001-v3（H1：「性价比人生指南」由外链改为 iframe 内嵌页）上线**：
  - 罗格在分支 `T-004-schedule` 开发（8b643f7），收口提交 main（209121c，含 `(√)` + 完成声明）。
  - 主理人核验：双端 `vue-tsc`/`tsc` **0 错误**；合并 main（`cb0e33d`）；board T-004 `pr-open→merged`。
  - 部署 Pi 成功，自检全绿（桌面/移动/后端均 200）；线上双端 JS 实测含 `MeHtlb`/`htlb-frame`。
  - 实现：双端新增站内二级页 `/me/htlb`（移动 `pages/me/htlb.vue`、桌面 `pages/me/htlb.tsx`），iframe 内嵌 `${location.protocol}//${location.host}/htlb/HowToLiveBetter.html`，带返回按钮；解决 Safari 跳出 app 的割裂感。
- **⚠️ Pi 部署环境严重不稳定（待处理）**：
  - 现象：`npm ci` 反复失败 —— `ENOTEMPTY: directory not empty`（rmdir 删不掉的目录）、`node_modules/.bin` 目录**整个消失**、包解包不完整（缺 vite/tsc/vue-tsc）、一次 `npm ci` 被 **Killed**（疑似 OOM）。
  - 环境：Raspberry Pi 4B，3.7G 内存（可用 ~3.1G，非紧张），ext4 on mmcblk0p2。无 kernel OOM 记录。磁盘充足（18%）。**高度怀疑 ext4 文件系统元数据不一致**（目录项与 inode 对不上），或 SD 卡写入不稳定。
  - 本次绕过：手工 `npm ci --maxsockets 1`（逐端装稳）+ 直接 `node node_modules/typescript/bin/tsc` / `node node_modules/vite/bin/vite.js`（绕过消失的 .bin 链接）+ 手工 `remote-deploy.sh all`。
  - **待办**：磁盘 fsck（需卸载/重启，影响 Pi 服务，待用户择机）；或给 npm 加更保守参数 / 给 Pi 加 swap。
- **状态机时序小注**：罗格 20:47 push（改名+代码同一次 push）时，hook 首次触发读到的是旧 ref（未带 `(√)`）→ 静默退出；手动 `git fetch` 后立即正确识别。**建议**：状态机 hook 触发前先 `sleep 2` 或 fetch 后重试一次，避免同 push 竞态。

### 2026-10-01（晚）
- **流程二次拍板：完成信号改为「分支开发 + main 写完成声明」**（用户 19:51，因为分支提交状态机监测不到）：
  - **spec 目录不建分支**（只在 main，主理人下发物）；**代码才走 feature 分支**（如 `T-003-schedule`）。
  - 罗格完成后在 **main** 上：① schedule.md 头部加「完成声明」行（写明分支名）；② spec 目录改名加 `(√)`。
  - 主理人状态机在 main 检测到 `(√)` → 读完成声明取分支名 → **在该分支取代码验收** → 合并 main → 部署。
  - 已回写 `md/PROCESS.md`（§3.3/§3.4/§4/§5.2），commit `073ff2f`。
- **状态机升级**（`scripts/z1-fsm.py`）：`parse_schedule` 新增解析完成声明的分支名（容多写法：`完成声明：已在分支 \`x\`` / `✅ 已在分支 x 完成`）；`verify` 支持在 **origin/<分支>** 上取文件核对；`cmd_check` 多打印「完成声明的分支」。
- **spec-20261001-v2（G1 外链入口）全程跑通并上线**：
  - 罗格在分支 `T-003-schedule` 开发（cdb3fd0），收口提交 main（4ed68b7，含 `(√)` + 完成声明）。
  - 主理人核验：双端 `vue-tsc`/`tsc` 0 错误；**合并 main**（`587cffb`，merge commit）；清理 main 上无 `(√)` 残留目录（`b39d345`）；board T-003 `pr-open→merged`（`f181f84`）。
  - **部署 Pi**：`vps-deploy.sh all` 耗时 286s，自检全绿（桌面/移动/后端均 200）；线上双端 JS 实测含 `HowToLiveBetter`。
  - 功能：个人空间「健康设置」→「性价比人生指南」，点击跳 `${location.protocol}//${location.host}/htlb/HowToLiveBetter.html`（运行时取 host，不写死）。
- **记忆**：完成信号规范存于 `md/PROCESS.md` §3.3。

### 2026-10-01
- **完成信号规范化批次 `md/spec-20261001-v1(√)`**（用户拍板：后缀统一为**全角 `(√)`**，v1/v2/v3 确认全部已上线）：
  - 主因：罗格 18:48–18:58 把完成信号打成**裸 `√`**（`spec-xxx-v1√`），与 `md/PROCESS.md` §3.3 规定的 `(√)` 不符 → 触发状态机误判。
  - **状态机 BUG（已修）**：`scripts/z1-fsm.py` 的 `find_active_spec()` ①正则只认全角 `(√)`，裸 `√` 不匹配 → 落入无排序的 `os.listdir` fallback → **误选中 9/24 的 `spec-20260924-v1√` 当活跃批次**并判「已完成」；②`spectest-*` 非标准命名被忽略。
    - 修复：正则兼容 `(√)` 与裸 `√`；**显式按 (日期, 版本号) 排序**（弃用 listdir 顺序）；**非 `spec-<日期>-v<数字>` 主格式一律忽略**（spectest 不再能误入）。已用临时 fixture 回归（裸√识别 / 排序 / spectest 排除）通过。
    - 止血：误判期间**关停** cron `596cb817`（每10分钟轮询）+ `systemctl --user stop z1-hook.service`（push→FSM），均已确认生效（8790 端口释放）。修好后**尚未重开**，待用户确认。
  - 罗格交付（`6fbbde1` + `4086d51`）：4 个目录 `git mv` 为 `(√)`（R100 全改名）；`board/T-001.json` spec 指向校正为 `md/spec-20260924-v3(√)/README.md`、status `blocked→merged`；`md/spec-20261001-v1` 收口打 `(√)`。核验：**零业务代码改动**，schedule 全勾，`md/` 下无裸 `√` 残留。**主理人核验通过。**
  - 遗留：`board/T-002.json` 是 runner 从本批 schedule 误收进来的伪任务（仍 in-progress），需清理；`schedules/spec-20261001-v1.md` 里 T-002 复选框未勾。
- **罗格侧子代理通道故障**：`provider account:bigmodel-start-plan 缺失`，两次派发均失败，罗格按预案 inline 执行。

### 2026-09-30
- **NOTES.md 迁入仓库根**（commit `32b5734`）：`z1/NOTES.md` → `z1-assisitant/NOTES.md`，成为项目级记忆，随仓库走（clone/pull 即得）。工作目录 = 仓库根。
- **md/测试文件.txt**（commit `69d8853`，后追加 commit `91e7563`）：内容「这是写给罗格看的测试文件校验码113223333」+「测试发送到飞书群」。用于跨 bot 同步链路 + 飞书群发文件能力测试，均已验证通过。
- 群协作规则（用户明确）：只在需要对方干活/配合时才 @ 另一个 bot，纯确认收尾不 @。

### 2026-09-24
- 配置 SSH 认证，验证 git push 通链（测试提交 `d943efa`）
- 仓库从 workspace 根移动到 `z1/z1-assisitant`
- 建立本记忆文件 `z1/NOTES.md`
- pull 到 `a633b10 merge`（含 `01c0cdb 项目spec提交`），**通读 `md/spec/` 全套 spec 并整合进本记忆**
- 用户提出 7 条移动端 UI/交互需求（见下 §7），待落地方案

---

## 7. 本轮需求（2026-09-24 用户提出）→ 已设计 spec：`md/spec-20260924-v1/`

**性质分类**（用户明确）：R1/R2/R6 = 能顺手改的小 bug/一致性；R3/R4/R5/R7 = 需求。

| # | 端 | 需求 | 性质 | spec 篇 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R1 | 移动 | 登录页重复 Z1 图标 + slogan 被裁 | 🔧bug | `01-登录页修复.md` | 待实施 |
| R2 | 移动 | 待办/习惯完成列表图标偏小 → 统一 IconBox 40/20 | 🎨一致性 | `02-完成列表图标统一.md` | 待实施 |
| R3 | 双端 | 待办+习惯**二级分类**（内置种子+用户增删） | 📋需求 | `03-习惯与待办二级分类.md` | 待实施 |
| R4 | 双端 | 分类管理去分段，各自入口独立 | 📋需求 | `04-分类管理改造.md` | 待实施 |
| R5 | 双端 | 周期切换改**下拉/弹层** | 📋需求 | `05-周期切换交互.md` | 待实施 |
| R6 | 移动 | SummaryCards 的 `replay` 换 toggle 图标 | 🔧小改 | `02-...md` R6 | 待实施 |
| R7 | 移动 | 记一笔计算盘与金额框组一体（回归 spec 08 §2.1） | 📋需求 | `06-记一笔计算器.md` | 待实施 |

**用户决策留档**（2026-09-24）：
- D1 二级分类：**做**（推翻原 D21「只做一级」）
- D2 二级来源：**内置种子**（参考财务分类）
- D3 用户可**增删**二级（参考收支流水分类交互）
- D4 统计**归集**：记二级 → 归一级
- D5 现有数据**要迁移**，脚本由 agent 在 Pi 上执行（库在 Pi）
- D6 周期切换形式：**B 下拉/弹层**
- D7 「旋转图标」= `SummaryCards.vue` 里的 `replay`
- D8 桌面端：**agent 设计**（双端覆盖）

### 实施进度日志
- 2026-09-24：**修复待办切二级 tab 数据残留**（commit `e8d544c`，已部署）：
  - 现象（用户）：待办模块由「今日」切到「即将」时，一瞬间「即将」里还显示「今日」的数据，等请求回来才替换。
  - 根因：task store 的 `setFilter/setPriority/setSort/setKeyword/resetQuery` 先改 query 再 `fetchTasks()`，而 `fetchTasks` **请求飞行期间不清空旧列表**（只在响应回来后 `tasks.value = res.items` 替换）→ 旧 tab 数据一直显示。
  - 修复：`fetchTasks` 新增 `opts.reset` —— 换数据集的操作传 `reset:true`，立即清空 `tasks` + `loadedOnce=false`；任务页骨架屏条件改 `(listLoading || loading) && tasks.length===0`。KeepAlive 静默刷新**不**传 reset（有意保留不闪）。
  - 验证：`vue-tsc` 通过；线上 mobile 200，入口 JS `index-CD_uocu_.js`。
  - ⚠️ 区分两类问题：① 转场残留（KeepAlive×Transition，`b7b0dcc` 修）；② 数据残留（换数据集不清旧列表，本次修）。
- 2026-09-24：**修复主 Tab 转场残留 bug**（commit `b7b0dcc`，已部署）：
  - 现象（用户）：切换模块（胶囊导航）**上一屏画面残留**；切 tab **上一页数据残留**。
  - 根因：`<KeepAlive>`（v2 引入）与**无 mode** 的 `<Transition>`（v2 去掉了 out-in）是**冲突组合**——KeepAlive 要把旧页 deactivate 保留，Transition 要让它离场并移除，同一节点两套意图打架 → 旧页 DOM 赖在 `.content` 不走；v3 的 `position:absolute;z-index:2` 把它顶到新页上方，暴露成可见残影。**残留其实从 v2 就潜伏，v3 放大**。
  - 修复：`<transition>` 改回 **`mode="out-in"`**（旧页完全离场后新页才进，同一时刻 `.content` 仅一个子元素，不与 KeepAlive 冲突）；移除 leaving 的 absolute/z-index（不再需要即可）。方向感仍在（先后而非同时）；旧页是缓存 DOM 无重拉、不白屏。
  - 验证：移动端 `vue-tsc` 通过；线上 `HomeLayout-C-gTx7s9.css` 已无 `absolute!important`，mobile 200。
- 2026-09-24：**方案 D（快照/位移转场）实现并上线**（commit `82b1cfd`，spec `md/spec-20260924-v3/`）：
  - 用户从 A/B/C/D 选中 **D**（方向感知横滑，非真跟手）——既能给方向感/推挤感，又比 C 成本低（无需相邻页常驻）。
  - HomeLayout：`slideDir`（forward/backward）按 `activeIndex` 增减判定；`<transition :name="transitionName">`。
  - CSS：`slide-forward/backward`（`translateX(±18%)` + opacity，200ms `--ease-default`）；**leaving 转场期 `position:absolute!important`**（避免 `.content` flex 列两子均分高度抽动）—— ⚠️ 踩坑：scoped 样式下后代选择器会被编译掉，必须用 `:deep()` + `!important`。
  - `fade-page` 保留做兑底（非主 Tab 跳转/二级页）；`prefers-reduced-motion` 降级为无位移。
  - 桌面端不做（SideMenu 导航，无底部 Tab 语义）。
  - 验证：移动端 `vue-tsc` 通过、构建 OK、线上 `HomeLayout-BrSfHdsr.css` 含规则且 200；mobile 200。
  - ⏳ 待用户真机验收（方向对不对/没抽动/胶囊同步）。
  - 💡 后续可选：方案 C（真 1:1 跟手横移，需相邻页常驻，内存/手势冲突回归成本高）作为增强项。
- 2026-09-24：**用户拍板方案 B —— 把 v1 全部做完并部署**（R3/R4）。核清：v1 七篇中 R1/R2/R5/R6/R7 早已上线，**仅剩 R3（二级分类）+ R4（分类管理改造）**。
- 2026-09-24：**R3 后端落地 + 迁库 + 部署**（commit `b505318`/`bab92aa`）：
  - model `user_categories` 加 `parent_id`（空串=一级）/`full_name`；uk_user_cat 加 parent_id 列。
  - 种子扩展：habit 一级 4 + 二级 18，task 一级 6 + 二级 16（图标均核对 lucide 0.300.0 真实存在）。
  - service/dao：create 支持 parent_id（父校验）、rename 重算 full_name（含子级联动）、**删一级级联软删二级**。
  - 统计归集 R3-3：`stats.go` 新增 `categoryRollup`，任务按分类统计**二级归到一级**（否则记二级的看板永远 0）。
  - 迁移 `manifest/sql/alter_260924v1_user_categories_parent.sql`（幂等）**已在 Pi 执行**：加列/换索引/补种 **+34 条二级**（当库 1 个用户有分类；其余用户懒播种）。
  - ⚠️ 踩坑：迁移里 JOIN users 写错列（`u.uid`/`is_deleted`）→ 改为 `u.id`/`deleted_at IS NULL`；sqlrun 需 cwd 下有 `manifest/config/config.yaml`（从 `config.example.yaml` 造一份指向 `127.0.0.1:4417`，用完删除——该文件 gitignore）。
  - API 线上验证：`GET /user-categories?domain=habit` 返回 22 条（4 一级 + 18 二级），含 parent_id/full_name。
- 2026-09-24：**R3 前端 + R4 落地并部署**（commit `60e7daa`，双端）：
  - 移动端：store 树助手（listTopLevel/listChildren/sortFlat——旧 sortNodes 会把一二级混插）；CategoryTiles 两级选择器（点一级展开二级、「不限」首项）；`me/categories.vue` **去页内分段**+按 `?domain=` 单域展示+可展开树+动态标题（习惯/待办分类管理）；HabitSection 筛选只列一级。
  - 桌面端：types/store 加 parent_id/full_name + listTopLevel/listChildren；CategoryTiles 两级；`me/categories.tsx` 去分段+两级树；`me/index` 入口**拆成「习惯分类管理」「待办分类管理」两枚**（各带 domain）；树形 CSS。
  - 双端 `vue-tsc`/`tsc` 本地通过；线上 200/200/200，资源版本一致。
  - ⏳ 待用户真机验收（R3/R4）。
- 2026-09-24：部署 v1 阶段 A/B/C 到线上（commit `c448f54`，含用户的 gitignore 修复 `fae19ab`）。
- 2026-09-24：**用户反馈主 Tab 切换有 0.几秒空白**（不跟手）。agent 诊断出三因：① 5 Tab 页无 `<KeepAlive>`，切页即销毁重建；② 各页 `onMounted` 重拉首屏数据（首页 5 个并发）；③ `fade-page` 串行 `out-in` 260ms。chunk 预取 `router/prefetch.ts` 已有。
- 2026-09-24：**设计 spec `md/spec-20260924-v2/`（3 篇）**，commit `fe4054b` 已 push。方案：S1 KeepAlive 缓存 5 主 Tab + `onActivated` 静默刷新；S2 过渡改重叠/≤120ms；S3 骨架屏兜底。**主 Tab 横移明确不做**（低端机成本高、与滑删/横滚抢手势、违反主 Tab 惯例）。
- 2026-09-24：**用户确认，实施 v2 并部署上线**（commit `5a5b63c`，已部署 Pi 验证通过）：
  - 移动端：HomeLayout 套 `<KeepAlive :include>`；**各页 `defineOptions({name})`**（关键坑：index.vue 推断名都是 index，不写 name 缓存失效）；key 由 fullPath 改 `route.name`（overlay 子路由返回宿主 **name** 保不重建）；5 页 `onMounted`→`onActivated`（首拉 loading/回归静默），task 加 `onDeactivated` 清多选；`task.fetchTasks`/`stats.refresh+fetch*` 支持 `silent`。
  - S2：`fade-page` 去 `mode=out-in`，260ms→80ms 重叠 + reduce-motion。
  - 桌面端：首页模块级 SWR 缓存（`homeCache`）。
  - S3：实测已有内联骨架，未重复新增。
  - 踩坑：`@click="refresh"` 传 PointerEvent 与 `refresh(opts?)` 类型不兼容 → `@click="refresh()"`（build 时 `vue-tsc` 捕获）。
  - ⏳ 待用户真机验收（切 Tab 是否瞬切、数据是否更新、滚动位置是否保留）。
- 2026-09-24：设计 spec `md/spec-20260924-v1/`（7 篇）完成，用户确认后开工。
  - R3 待确认点（用户已采纳 agent 方案）：内置二级清单按 spec 草案、删一级级联软删。
- 2026-09-24：**阶段 A 落地**（commit `2d5c81c`）：R1 登录页 / R2 图标统一 / R6 换 toggle 图标。
- 2026-09-24：**阶段 B+C 落地**（commit `a96b234`）：R5 周期切换改下拉/弹层（双端）、R7 计算器去夹层抓手条。
- ⏳ **待部署**（用户指令：先 push 不部署，等通知）。
- ⏳ **待做**：阶段 D（R3 二级分类 + R4 分类管理）—— 需先迁库（脚本 agent 在 Pi 上执行）。
