# 飞书推送设置模块 — 设计文档

**日期**: 2026-06-02
**状态**: 已确认

---

## 1. 概述

在设置 → 飞书同步子页面中，于"立刻推送/拉取"操作按钮区域之后，新增"推送设置"模块。用户可配置飞书群聊 ID，并测试消息发送。未来事件类型由队友补充。

## 2. 架构

```
前端 (settings.html / settings.js)
  └── 推送设置 box（settings-sub-7 内，操作按钮区域之后）
      ├── 两层开关依赖（飞书同步关 → 推送置灰）
      ├── 多行文本框（chat_id 列表）
      ├── 保存按钮
      └── 测试发送按钮 → 弹出自定义消息输入框 → 逐群发送

后端 (routes/feishu.py)
  ├── GET  /api/feishu/push-config       读取推送配置
  ├── POST /api/feishu/push-config/save  保存推送配置
  └── POST /api/feishu/push-config/test  发送测试消息

数据存储 (config 表)
  category='feishu_push'
  ├── key='enabled'   → "0"|"1"
  └── key='chat_ids'  → 原始文本（换行分隔）
```

## 3. UI 行为

### 3.1 两层依赖

| 飞书同步 | 推送 toggle | 推送 box | textarea / 按钮 |
|----------|------------|----------|----------------|
| 关闭     | —          | 全部置灰  | 不可交互 |
| 开启     | 关闭（默认）| 可操作   | 置灰 |
| 开启     | 开启       | 可操作    | 可交互 |

### 3.2 布局

- box 标题："📨 推送设置"
- 标题行右侧：iOS toggle + 状态标签（已开启/已关闭）
- toggle 开启时显示：多行 textarea + 保存按钮 + 测试发送按钮
- 测试发送：弹出 prompt 输入自定义消息，确定后逐群发送并 toast 反馈结果

## 4. API 设计

### 4.1 GET /api/feishu/push-config

返回：
```json
{
  "enabled": false,
  "chat_ids": "oc_xxx\roc_yyy"
}
```

### 4.2 POST /api/feishu/push-config/save

请求：
```json
{
  "enabled": true,
  "chat_ids": "oc_xxx\roc_yyy"
}
```

返回：`{"msg": "保存成功"}`

### 4.3 POST /api/feishu/push-config/test

请求：
```json
{
  "message": "自定义测试内容"
}
```

逻辑：
1. 从 config 表读取 chat_ids，按行 split 过滤空行
2. 若为空 → 返回 400 `{"error": "未配置群聊 ID"}`
3. 逐群调用飞书 IM API `POST /im/v1/messages?receive_id_type=chat_id`
4. 单个失败不影响其他

返回：
```json
{
  "results": [
    {"chat_id": "oc_xxx", "success": true},
    {"chat_id": "oc_yyy", "success": false, "error": "chat not found"}
  ]
}
```

## 5. 实现范围

- `templates/panels/settings.html`：在操作按钮区域之后新增推送设置 box
- `static/settings.js` 或 `static/feishu-sync.js`：推送相关前端逻辑
- `routes/feishu.py`：新增 3 个路由
- 不涉及数据库迁移（使用现有 config 表）
