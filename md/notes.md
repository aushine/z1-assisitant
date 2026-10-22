2026-10-20 19:40 状态机轮次：活跃批次 spec-20261001-v3(√)，完成声明分支 T-004-schedule(8b643f7) 已包含于 main(97d8103)，无新提交；上轮 75dfc5c 已 deployed，本轮 no-op。
2026-10-21 19:00 状态机轮次：活跃批次 spec-20261001-v3(√)，phase=deployed，t_deploy_done=2026-10-20 11:17(commit 75dfc5c)；远程 main HEAD=4232564 无新提交，T-004-schedule 已为 origin/main 祖先，无待合并内容 → no-op，未部署未通知。
2026-10-22 08:40 状态机轮次：活跃批次 spec-20261001-v3(√)，phase=deployed；main HEAD=43f1ea2，完成声明分支 T-004-schedule(8b643f7) 已是 main 祖先，无待合并内容；上轮 75dfc5c 已 deployed 且自检 HTTP 200 正常 → 幂等 no-op，未部署未通知。
2026-10-22 16:10 状态机轮次：活跃批次 spec-20261001-v3(√)，phase=deployed；main HEAD=8e891e3，T-004-schedule(8b643f7) 已是 main 祖先 → 幂等 no-op，未部署未通知。
  ⚠️ 外部异常（未主动处理，等指示）：https://voz21.cn/z1/、/z1-app/、/z1/api/health 公网均返回 404（Spring 错误体 "No static resource z1"，来自 :8090）；Pi 本机 127.0.0.1/z1/ 与 /z1-app/ 均 200。疑似 nginx 中 /z1/ 系列 location 未生效或被其它 server 块抢先匹配（nginx 1.30.4，halo 容器占 0.0.0.0:8899->8090）。
