# Z1 CI/CD 流水线说明

> 从 `git push origin main` 到 `https://voz21.cn` 生效，全自动，无需人操作。
> 仓库：`github.com/aushine/z1-assisitant`　Pi：`hewl@192.168.101.75`

---

## 一、整体架构

```
  你 push 到 main
        │
        ▼
┌──────────────────────────────────────────────┐
│ Job 1  build          （GitHub 托管 runner）   │
│  · 后端 go vet + go test                      │
│  · 前端 type-check ×2                         │
│  · 后端 交叉编译 linux/arm64 二进制            │
│  · 前端 vite build ×2（base 已固化）           │
│  · 产物自检：index.html 资源路径是否带 base 前缀 │
│  · 打包 artifact → z1-deploy-bundle           │
└──────────────────────────────────────────────┘
        │  artifact
        ▼
┌──────────────────────────────────────────────┐
│ Job 2  deploy    （Pi 上的 self-hosted runner）│
│  · 下载 artifact 铺到 /opt/z1-deploy           │
│  · docker build 打 z1-api:latest（Pi 原生 arm64）│
│  · remote-deploy.sh all：                     │
│      docker load → compose up -d              │
│      → 切换 /var/www/{z1,z1-app}（自动备份）   │
│      → nginx -t && reload                     │
│      → 自检（health / 两端入口 / 主 JS 可达）  │
└──────────────────────────────────────────────┘
        │
        ▼
   https://voz21.cn/z1/   ·   /z1-app/
```

### 为什么是两个 runner？

Pi 在**局域网内**，没有公网入站端口。GitHub 的托管 runner 无法主动连它。

所以反过来：**Pi 上装一个 runner，让它主动出网向 GitHub 领任务**。这样 Pi 不需要任何端口映射，也不需要把 SSH 暴露出去。

### 为什么镜像在 Pi 上构建而不是 GitHub？

| 方案 | 问题 |
| --- | --- |
| GitHub runner 用 QEMU 模拟 arm64 构建 | 慢（每次 2–5 分钟），且模拟下 `apk` 偶发失败 |
| **Pi 原生构建（当前方案）** | arm64 原生，秒级；GitHub 只负责编译二进制 |

Go 交叉编译 arm64 在 x86 上是**原生操作**（不需要 QEMU），所以：
**GitHub 编译二进制 → Pi 只做「打包镜像 + 部署」**，正好符合「Pi 只部署不构建」的定位。

---

## 二、Pi 上安装 self-hosted runner（一次性）

### 前置条件（都已就绪，核对一遍）

```bash
# 1. hewl 在 docker 组（不需要 sudo 就能用 docker）
groups hewl | grep -q docker && echo "docker 组 OK"

# 2. hewl 有免密 sudo（nginx -t / systemctl reload 要用）
sudo -n true && echo "免密 sudo OK"

# 3. /opt/z1-deploy 属主是 hewl（否则 scp 会 Permission denied）
ls -ld /opt/z1-deploy    # 期望 drwxr-xr-x ... hewl hewl

# 4. Pi 是 arm64
uname -m                 # 期望 aarch64
```

如果有任何一条不满足，先修：

```bash
sudo usermod -aG docker hewl          # 然后重新登录生效
sudo chown -R hewl:hewl /opt/z1-deploy
```

### 安装步骤

**第 1 步** — 在 GitHub 上取注册命令：

浏览器打开 `https://github.com/aushine/z1-assisitant/settings/actions/runners/new`

选择 **Linux / ARM64**，页面会给出带 token 的下载与配置命令。**token 一小时过期**，所以下面两步要连着做。

**第 2 步** — 在 Pi 上下载并配置（用页面上给的真实命令，下面是对应关系）：

```bash
# 建议装在 hewl 家目录，避免权限问题
mkdir -p ~/actions-runner && cd ~/actions-runner

# ↓ 这两条用 GitHub 页面上给你的原文（含版本号与 token）
curl -o actions-runner-linux-arm64-<版本>.tar.gz -L \
  https://github.com/actions/runner/releases/download/v<版本>/actions-runner-linux-arm64-<版本>.tar.gz
tar xzf ./actions-runner-linux-arm64-<版本>.tar.gz

# 配置：URL / token 都用页面上给的真实值
# ⚠️ --labels 必须包含 z1-pi，workflow 里就是这么找 runner 的
./config.sh \
  --url https://github.com/aushine/z1-assisitant \
  --token <页面上给你的token> \
  --name z1-pi \
  --labels self-hosted,linux,arm64,z1-pi \
  --work _work \
  --unattended
```

**第 3 步** — 装成后台服务（开机自启，掉线自动重连）：

```bash
cd ~/actions-runner
sudo ./svc.sh install hewl
sudo ./svc.sh start
sudo ./svc.sh status      # 期望 active (running)
```

**第 4 步** — 回 GitHub 页面确认：

`Settings → Actions → Runners` 里应出现 **z1-pi**，状态绿色 **Idle**。

---

## 三、日常使用

### 发版 = push

```bash
git add -A
git commit -m "feat: 改了什么"
git push origin main
```

推完去 `https://github.com/aushine/z1-assisitant/actions` 看进度。约 3–6 分钟上线。

### 手动触发

Actions 页面 → 左侧 **CI/CD** → 右侧 **Run workflow**。
有个 `skip_tests` 勾选框：应急时勾上可跳过测试与类型检查，直接构建部署。

### 回滚

三种方式，按场景选：

```bash
# —— 方式 1：GitHub 上重跑旧 commit 的 workflow（最推荐）
# Actions → 选一个历史成功的 run → Re-run all jobs
# 注意：重跑用的是那次 run 的代码快照，不会拿到最新代码

# —— 方式 2：本地 revert 后 push（走完整流水线，最规范）
git revert <坏掉的commit> && git push origin main

# —— 方式 3：手工恢复 Pi 上的静态目录（最快，仅限前端）
ssh hewl@192.168.101.75
ls -d /var/www/z1.bak.*        # 找到部署前自动备份的目录
sudo rm -rf /var/www/z1 && sudo cp -r /var/www/z1.bak.<时间戳> /var/www/z1
```

> 每次前端部署都会自动备份为 `/var/www/{z1,z1-app}.bak.<YYYY-MM-DD_HHMMSS>`。
> 备份会累积，确认稳定后手动清理旧的即可。

---

## 四、手动发版（CI 不可用时）

CI 挂了、或者你想在本地验证时，用 `deploy/deploy.bat`：

```bat
cd D:\work_space\life-assisitant\deploy
deploy.bat            :: 三端全量发版
deploy.bat --ui       :: 只发前端
deploy.bat --api      :: 只发后端
```

它跟 CI **走完全相同的 Pi 侧脚本**（`remote-deploy.sh`），所以两条路的行为一致。

流程：本机编译 arm64 二进制 + 前端 build → scp 到 Pi → Pi 上打镜像 → 部署 + 自检。

---

## 五、排查

### 流水线红了，先看哪里

| 失败的 Job | 看哪个 Step | 常见原因 |
| --- | --- | --- |
| build | Go — test | 单测挂了，看日志里的 `--- FAIL` |
| build | Desktop/Mobile UI — type-check | TS 类型错误 |
| build | Verify build output | base 路径不对（防白屏的闸门） |
| deploy | Stage artifacts | scp/cp 权限问题（`/opt/z1-deploy` 属主） |
| deploy | Build backend image | Dockerfile 或二进制缺失 |
| deploy | Deploy & self-check on Pi | 自检失败，看具体哪一项 |

### 常见问题

**Q：deploy job 一直 pending，不开始**
Pi 的 runner 没在跑。`ssh hewl@192.168.101.75 'sudo ~/actions-runner/svc.sh status'`，不 running 就 `start`。

**Q：`sudo -n failed`**
`hewl` 的免密 sudo 掉了。检查 `/etc/sudoers.d/` 里的配置还在不在。

**Q：`Permission denied` 写 `/opt/z1-deploy`**
```bash
sudo chown -R hewl:hewl /opt/z1-deploy
```

**Q：部署成功但页面白屏 / 资源 404**
先看 CI 的 **Verify build output** 是否通过（它专门拦这个问题）。
若 CI 过了、线上还 404，就是浏览器缓存，`Ctrl+Shift+R`。
再不行查 nginx：`sudo nginx -T | grep -A5 'location /z1'`。

**Q：`exec: "./server": permission denied`（容器起不来，API 全挂）**

⚠️ **已修复，但要知道原因**（2026-09-21 踩过）：

`docker build` 的 `COPY` 会**原样保留源文件的权限位**。二进制是从 Windows 用 `scp`
传上来的，Windows 没有「可执行位」这个概念，所以落到 Pi 上是 **0644** →
`COPY build/server ./server` 把 0644 带进镜像 → 容器启动时 `exec ./server` 被拒。

为什么以前没暴露：老的 `build.bat` 是在 **Windows 主机**上 `docker build` 的，
Docker Desktop 会给 COPY 进去的文件自动补 0755。改成「Pi 上原生构建」后就暴露了。

现在是**双层防护**，正常不会复发：

| 层 | 位置 | 作用 |
| --- | --- | --- |
| 1 | `remote-deploy.sh` 的 `build` 模式 | 构建前 `chmod +x build/server`，并打印 mode |
| 2 | `Dockerfile.arm64` | `RUN chmod +x ./server`，兜底保证镜像内一定可执行 |

另外 `remote-deploy.sh build` 新增了**构建后自检**：读镜像内 `/app/server` 的权限位，
不可执行就直接失败并报 `image entrypoint ./server not executable`，
把这类问题拦在「镜像构建」阶段，而不是等容器启动才炸。

> 手工应急恢复（万一再遇到）：
> ```bash
> ssh hewl@192.168.101.75
> cd /opt/z1-deploy
> chmod +x build/server
> ./remote-deploy.sh build && ./remote-deploy.sh all
> ```

**Q：外网间歇性打不开，但 Pi 本机 100% 正常**

先分清是哪一层（**回环正常 = 应用和 nginx 都没问题**）：

```bash
ssh hewl@192.168.101.75
# nginx + 应用：连续 10 次，应该 10/10 都是 200
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1/z1/; done

# 公网侧：若成功率很低，问题在 Cloudflare Tunnel，不在你的应用
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code}\n" --max-time 6 https://voz21.cn/z1/; done
```

若回环全绿、公网忽好忽坏 → 看 tunnel 日志：

```bash
sudo journalctl -u cloudflared -n 50 --no-pager | grep -i "quic\|error"
```

出现 `failed to accept QUIC stream: timeout: no recent network activity`
= **QUIC（UDP）链路被网络环境限流**。对策是把隧道协议从 QUIC 换成 HTTP/2（走 TCP 443）：

```bash
# 编辑 cloudflared 的 systemd 服务，在 ExecStart 的 run 后加 --protocol http2
sudo systemctl edit cloudflared
# [Service]
# ExecStart=
# ExecStart=/usr/local/bin/cloudflared --no-autoupdate --protocol http2 tunnel run <tunnel-id>
sudo systemctl daemon-reload && sudo systemctl restart cloudflared
```

> 注意：该隧道可能还承载其他站点，改之前确认影响面。

**Q：想确认线上跑的是哪次提交**
```bash
ssh hewl@192.168.101.75 'docker logs --tail 30 z1-api | head -3'
```
启动第一行会打印 `🚀 生活助手 API 启动中 (build=<commit短SHA>)`。

**Q：后端容器起不来**
```bash
ssh hewl@192.168.101.75
cd /opt/z1-deploy
docker compose -f docker-compose.prod.yml logs --tail=100 z1-api
docker compose -f docker-compose.prod.yml ps
```

---

## 六、设计说明（给以后的自己）

### 密钥是怎么隔离的

`deploy/config.prod.yaml`（含 MySQL 密码、JWT secret）和 `deploy/docker-compose.prod.yml`
**都在 `.gitignore` 里，从不入库**。CI 也从不读写它们。

线上容器用的配置来自 Pi 本地文件，通过 compose 的 bind mount 注入：

```yaml
volumes:
  - ./config.prod.yaml:/app/manifest/config/config.yaml:ro
```

所以镜像里 bake 的 `config.yaml` 是**占位文件**（CI 里由 placeholder 生成），构建能过、运行时不生效。**密钥永远不会进 GitHub**。

### 为什么 CI 里要单独做 base 路径自检

历史上出过一次事故：vite build 漏了 `--base`，产物里资源指向 `/assets/index-xxx.js`
而不是 `/z1/assets/index-xxx.js`，上线后**整站白屏 404**。
现在 `base` 已固化进 `vite.config.ts`，CI 再额外加一道闸门，在上传 artifact 前就拦住。
`remote-deploy.sh` 的部署后自检里还有第二道（抓 index.html 里的主 JS 实际请求一遍）。

### 并发控制

workflow 里有：

```yaml
concurrency:
  group: z1-deploy-${{ github.ref }}
  cancel-in-progress: false
```

连推两次不会并发部署（避免两个进程同时改 `/var/www`），后到的排队。
`cancel-in-progress: false` 是为了**不打断正在进行的部署** —— 部署中途被打断会留下半套静态文件。
