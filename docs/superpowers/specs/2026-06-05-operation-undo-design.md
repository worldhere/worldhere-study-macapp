# 操作撤回（快照制）

**日期**: 2026-06-05
**状态**: 设计中

---

## 1. 问题

目前的撤回依赖 `deletion_log` 记录 + 逐个逆向操作，但系统副作用太多（任务状态联动、timeline 归一化、飞书通知 + push_log 去重），逆向逻辑越来越不可靠。

## 2. 方案：操作前快照

不纠结"怎么倒回去"。操作前把涉及的行全量序列化存成快照文件，撤回时直接 INSERT 回数据库 + DELETE 当前数据行。

飞书那边不管——发了就发了，数据回来就行，下次检测时自然重新生成事件。

## 3. 存储位置

```
{存档目录}/undo_sessions/{session_id}/
```

- `{存档目录}` — 与 `create_save()` 使用的 `save_dir` 相同（`db.py` 中 `DATA_DIR` 的同级或子目录）
- `{session_id}` — 服务端生成的会话标识，页面加载时由前端获取
- 目录在页面关闭时清理（前端 `beforeunload` 通知服务端删除）

与存档系统放一起的原因：存档功能本身就是"回到过去"，撤回是"回到操作前"，本质相同。

## 4. 快照内容

一个操作对应一个快照文件，JSON 格式：

```json
{
  "operation": "recycle_schedules",
  "label": "回收 3 条排班",
  "captured_at": "2026-06-05 14:30:00",
  "data": {
    "schedules": [
      {"id": 1, "date": "...", "machine_id": 2, ...},
      {"id": 2, "date": "...", "machine_id": 3, ...}
    ],
    "tasks": [
      {"id": 5, "status": "已分配", ...}
    ],
    "feishu_record_mapping": [
      {"schedule_id": 1, "machine_id": 2, "feishu_record_id": "recXXXX"}
    ]
  }
}
```

恢复时：按表名分组 → `INSERT OR REPLACE` 回原表 + 清理当前可能残留的数据行。

## 5. 支持的操作

| 操作 | 快照范围 |
|------|---------|
| 回收排班（按 schedule_ids） | schedules + tasks + feishu_record_mapping |
| 回收排班（按 task_ids） | 同上 |
| 删除任务 | tasks + schedules + feishu_record_mapping |
| 批量完成/取消完成 | schedules（只恢复完成前状态） |
| 批量延迟 | schedules（恢复 delay 前状态） |

## 6. 生命周期

```
操作前 → POST /api/undo/snapshot   创建快照，返回 session_id + snapshot_id
  ↓
POST /api/操作                      正常执行操作
  ↓
用户想撤回 → POST /api/undo/restore/{snapshot_id}   读取快照，INSERT 恢复，删除快照文件
  ↓
用户离开 → beforeunload → POST /api/undo/cleanup/{session_id}   删除整个会话目录
```

- 用户打开页面前 30 秒不操作 → 快照不创建（不需要撤回）
- 仅保留最近 10 个快照（多余 FIFO 丢弃）
- 服务端定时扫描：超过 1 小时的孤儿 session 目录自动清理

## 7. 前端交互

回收/删除/延迟 操作成功后，toast 消息末尾加"撤销"链接：

```
已回收 3 条排班。  [撤销]
```

点击"撤销" → 调 restore 接口 → toast 提示结果 → 刷新当前面板。

**不在**变更后 5 秒自动消失——"撤销"链接一直留在 toast 里，直到用户点掉 toast 或执行下一个操作。

## 8. 不在范围内

- 飞书通知的撤回（push_log 不回滚，已发的卡片不变）
- 多步骤联合撤销（只撤上一次操作）
- 跨页面/跨会话的撤销
- deletion_log 的改动（保留现有 deletion_log 不动）

## 9. 接口设计

### POST /api/undo/snapshot
```json
// 请求
{
  "session_id": "abc123",
  "label": "回收 3 条排班",
  "schedule_ids": [1, 2, 3]
}

// 响应
{"snapshot_id": "snap_001", "ok": true}
```

### POST /api/undo/restore/<snapshot_id>
```json
// 响应
{"ok": true, "restored": {"schedules": 3, "tasks": 3}}
// 或
{"ok": false, "msg": "快照已过期或不存在"}
```

### POST /api/undo/cleanup/<session_id>
```json
// 响应
{"ok": true}
```

## 10. 风险与限制

- **并发**：两个用户同时操作同一批数据 → 快照恢复可能覆盖对方的修改。接受此限制——撤回是低频操作，且通常是单人操作后立即撤回。
- **快照与当前数据不一致**：恢复时检查要 INSERT 的 ID 是否已存在（被其他人新建了同名记录），冲突时跳过并提示。
- **文件系统依赖**：不依赖数据库事务，文件写入比 DB 更可靠（原子写入 + 无锁）。
