# Z1 一键发版（自动化部署）

> 目标：在本机（Windows）敲**一条命令**，自动完成「前端 build → 后端 arm64 二进制 → 传输到 Pi → Pi 上打镜像 → 部署 → 自检」。
> 配套文件：`deploy/deploy.bat`（本机入口）、`deploy/compile-api.bat`（交叉编译）、`deploy/remote-deploy.sh`（Pi 侧执行）。
> 手动分步流程见 `upgrade.md`（本文是它的自动化封装）。
>
> **想 push 一下就自动上线？** 那用 CI/CD 流水线，见 `CI-CD.md`。本文是「CI 不可用 / 本地验证」时的手动通道，
> 两条路走**同一套 Pi 侧脚本**，行为一致。

---

## 一、首次准备（只做一次）

### 0. 目录属主（关键，否则 scp 会 Permission denied）

Pi 上 `/opt/z1-deploy` 必须是 **`hewl` 所有**，否则 `hewl` 用户 scp 传新文件（如 `remote-deploy.sh`、`z1-api.tar`）会被拒：

```bash
# Pi 上执行一次（若之前用 sudo 手工建过目录，属主会是 root）
sudo chown -R hewl:hewl /opt/z1-deploy
```

> 症状：`scp: dest open "...": Permission denied`。
> `/var/www/z1`、`/var/www/z1-app` 保持 **root 属主**（该主机 `/var/www` 是 root 的），部署脚本用 `sudo -n` 写入，已实测可行。

### 1. 配置 SSH 免密登录

脚本要无人值守登 Pi，必须先配免密（否则每步都要输密码）。本机已生成过 `~/.ssh/id_ed25519`，**你只需把公钥装到 Pi**：

```powershell
# 在本机 PowerShell 执行（会提示输入 Pi 上 hewl 用户的密码，输一次即可）
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh hewl@192.168.101.75 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo INSTALL_DONE"
```

验证免密（应直接输出 `KEY_OK`，不再问密码）：

```powershell
ssh -o BatchMode=yes hewl@192.168.101.75 "echo KEY_OK"
```

> ⚠️ 若本机没有 `id_ed25519`（换电脑了），先跑：`ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519 -N '""'`，再执行上面的装公钥命令。

### 2. 本机需要 Go 工具链（不再需要 Docker Desktop）

后端改成**交叉编译出 arm64 二进制**（`compile-api.bat`），镜像在 Pi 上原生构建。
所以本机只需要 **Go 1.22+**，**不需要 Docker Desktop 在跑**：

```powershell
go version    # 期望 go1.22 或更高
```

> 为什么不本机打镜像了：本机是 x86，打 arm64 镜像要走 QEMU 模拟，慢且偶发失败。
> Pi 是原生 arm64、有 Docker，几秒钟就能打好。这也让手动发版和 CI 走完全相同的路径。

### 3. 确认 Pi 上目录就位

```bash
# Pi 上应存在（首次部署时已建好）
ls /opt/z1-deploy/docker-compose.prod.yml /opt/z1-deploy/config.prod.yaml
docker network ls | grep gouxiong-net
```

---

## 二、日常发版：一条命令

```powershell
cd D:\work_space\life-assisitant\deploy
.\deploy.bat
```

**它会自动依次做**：

| 步骤 | 动作 |
|---|---|
| 1 | 本机 build 桌面端（`npm run build`，base 已固化在 `vite.config.ts`） |
| 2 | 本机 build 移动端（同上） |
| 3 | 本机 `compile-api.bat` 交叉编译 **linux/arm64 二进制**（秒级，不需要 Docker） |
| 4 | `scp` 把 `dist/z1`、`dist/z1-app`、`build/server`、`Dockerfile.arm64`、`remote-deploy.sh` 推到 Pi |
| 5 | `ssh` 在 Pi 上跑 `remote-deploy.sh build`（原生 arm64 打镜像）→ `remote-deploy.sh all`（`docker load` → 重建 `z1-api` → 覆盖 `/var/www` 静态 → `nginx -t && reload` → **自动验证**） |

**验证内容**（脚本自动做，结果直接打印）：
- 后端 `/z1/api/v1/health`（直连 8090 + 经 nginx 80）都通？
- 桌面 `/z1/`、移动 `/z1-app/` 入口 200？
- **入口引用的主 JS 能取到？**（专门用来抓「base 丢失导致白屏 404」——一旦 JS 404 会明确报 `BASE-PATH PROBLEM`）

全通过打印 `RELEASE OK`，有失败打印明细并以非 0 退出。

> 本机会用 `git rev-parse --short HEAD` 把当前 commit 编进二进制，
> 启动日志第一行会显示 `<commit短SHA>`，方便确认线上跑的是哪一版。

---

## 三、增量发版（只改一端，省时间）

```powershell
.\deploy.bat --ui     # 只发前端：跳过后端 build 和 docker load（前端改动最常用）
.\deploy.bat --api    # 只发后端：跳过前端 build，只出镜像 + 重建容器
```

---

## 四、发版后

- 浏览器 **Ctrl+Shift+R 强刷**（`index.html` 有缓存，带 hash 的 assets 会自然更新）。
- 回滚：Pi 上每次发版会给静态目录留一份备份 `/var/www/z1.bak.<时间戳>`、`/var/www/z1-app.bak.<时间戳>`；后端镜像保留上一版 tar 即可回滚（见 `upgrade.md` §6）。

---

## 五、改配置（不是发版）

`config.prod.yaml` 的改动**不用发版**，直接在 Pi 上改完重启即可：

```bash
vi /opt/z1-deploy/config.prod.yaml
docker compose -f /opt/z1-deploy/docker-compose.prod.yml restart z1-api
```

---

## 六、脚本配置项（换环境时改这里）

`deploy.bat` 顶部：

```bat
set "PI_HOST=192.168.101.75"
set "PI_USER=hewl"
set "PI_DIR=/opt/z1-deploy"
```

`remote-deploy.sh` 顶部：`DIR` / `WEB_DESKTOP` / `WEB_MOBILE` / compose 路径。

---

## 七、常见问题

| 现象 | 原因 / 解决 |
|---|---|
| **双击运行一闪而过、看不到报错** | 已修：脚本结尾加 `pause` 会停住；若仍秒关，改用**命令行运行**（`cd deploy` 后 `.\deploy.bat`），或看 `deploy` 目录下的输出 |
| `scp: dest open "...": Permission denied` | 目标目录属主不是 hewl → Pi 上 `sudo chown -R hewl:hewl /opt/z1-deploy`（见「一、0」） |
| `sudo -n failed ... needs passwordless sudo` | Pi 上 `hewl` 缺免密 sudo → 检查 `/etc/sudoers.d/` 配置 |
| `Permission denied (publickey,password)` | 免密没配好 → 重做「一、1」 |
| `[ERROR] backend compile failed` | 本机 Go 工具链问题 → `go version` 确认 ≥1.22；再看 `go build` 的具体报错 |
| Pi 上报 `docker build failed` / `build/server not found` | 二进制没传上去 → 检查第 4 步 scp 是否成功；Pi 上 `ls -lh /opt/z1-deploy/build/server` |
| **容器起不来：`exec: "./server": permission denied`** | 见下节「⚠️ 可执行位」——已在 `Dockerfile.arm64` + `remote-deploy.sh` 双层修复 |
| `docker version --format` 报错 / `Cannot connect` | Pi 上 Docker 没跑或 hewl 不在 docker 组 → `sudo systemctl status docker`、`groups hewl` |
| 自检报 `BASE-PATH PROBLEM` | 前端产物 base 丢了 → 检查 `vite.config.ts` 的 `base` 字段是否存在 |
| `bad interpreter: /bin/bash^M` | `remote-deploy.sh` 被改成了 CRLF → 改回 LF（`.gitattributes` 已声明 `*.sh eol=lf`） |
| 改完前端页面没变 | 浏览器强刷（Ctrl+Shift+R） |
| `z1-api` 起不来 | `docker compose -f /opt/z1-deploy/docker-compose.prod.yml logs z1-api` |
| 外网间歇打不开、Pi 回环却全绿 | Cloudflare Tunnel 的 QUIC 链路问题，与应用无关 → 见 `CI-CD.md` §五 |

> CI 流水线相关的排障见 `CI-CD.md` §五。

---

## 八、⚠️ 可执行位（2026-09-21 踩过的坑）

**症状**：部署到最后一步 `compose up` 失败，容器停在 `Created` 状态，**API 整个挂掉**：

```
Error response from daemon: ... error during container init:
exec: "./server": permission denied
```

**原因**：`docker build` 的 `COPY` 会**原样保留源文件的权限位**。
二进制是 Windows 上 `scp` 传过来的 —— Windows 没有可执行位概念，落到 Pi 上是 `0644`，
于是镜像里的 `/app/server` 也是 `0644`，容器启动时 `exec ./server` 被拒。

**为什么以前没这问题**：老的 `build.bat` 是在 **Windows 主机**上 `docker build`，
Docker Desktop 会自动给 COPY 进去的文件补 `0755`。改成「Pi 上原生构建」后才暴露。

**现在的双层防护**：

| 层 | 位置 | 作用 |
| --- | --- | --- |
| 1 | `remote-deploy.sh` 的 `build` 模式 | 构建前 `chmod +x build/server`，并打印实际 mode |
| 2 | `Dockerfile.arm64` | `RUN chmod +x ./server`，兜底保证镜像内一定可执行 |

外加**构建后自检**：脚本会读镜像内 `/app/server` 的权限位，不可执行就直接失败
（报 `image entrypoint ./server not executable`），把问题拦在构建阶段而不是等容器启动。

**手工应急恢复**：

```bash
ssh hewl@192.168.101.75
cd /opt/z1-deploy
chmod +x build/server
./remote-deploy.sh build && ./remote-deploy.sh all
```

