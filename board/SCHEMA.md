# board/T-XXX.json 状态文件

```json
{
  "id": "T-042",
  "spec": "specs/T-042-quick-sort.md",
  "title": "实现快速排序 CLI",
  "status": "todo",
  "branch": null,
  "pr": null,
  "claimed_by": null,
  "updated_at": "2026-09-30T10:00:00Z",
  "log": [{ "at": "...", "from": "todo", "to": "claimed", "by": "runner", "note": "" }]
}
```

- `status`: `todo | claimed | in-progress | blocked | pr-open | merged | failed`
- `schedule`: 批次 schedule 文件名（无 .md），来自 spec 头部 `schedule:` 行；可空（单发任务）。
- 转换规则：`todo→claimed`（runner 独占写，commit 即锁）；`claimed→in-progress→pr-open`（worker）；`in-progress→blocked`（worker 遇到需要决策的问题，note 必填，runner 在群里 @阿派 请示）；`blocked→todo`（`hub-runner.js unblock T-xxx`，阿派/主人答复后由主会话执行）；`pr-open→merged`（人 merge 后 runner 对账）；任何状态可 `→failed`，note 必填原因。
- 本目录由守护进程维护；人只改 specs/，不手改 board（要重置状态就在群里说）。
